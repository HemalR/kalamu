import {
  addBlocker,
  addNode,
  buildTree,
  deleteNode,
  effectivePriority,
  endTask,
  markDone,
  markdownHeadings,
  moveNode,
  nextTask,
  nodeSchema,
  preorder,
  removeBlocker,
  renumber,
  reopen,
  searchNodes,
  serializeJsonl,
  startTask,
  TAG_PATTERN,
  uiStateSchema,
  updateNode,
  validateOutline,
  type KalamuNode,
} from "@kalamu/core";
import {
  ConflictError,
  KALAMU_DIR,
  META_FILE,
  offDefaultBranch,
  OUTLINE_FILE,
  pathsFor,
  PROJECT_FILE,
  readMeta,
  readOutline,
  readUiState,
  withOutline,
  writeMeta,
  writeUiState,
  type KalamuPaths,
} from "@kalamu/core/store";
import { Hono, type Context } from "hono";
import { streamSSE } from "hono/streaming";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, watch, writeFileSync, type FSWatcher } from "node:fs";
import { basename, extname, join, normalize } from "node:path";
import { z } from "zod";
import { editorTemplate } from "./config.js";
import { findDoc } from "./context.js";
import { handleError, HttpError, jsonBody, requestGuard } from "./http.js";
import { hubAgentInstalled } from "./launch.js";
import { projectName } from "./project-name.js";
import { cachedUpdate, refreshUpdate } from "./update-check.js";
import { CURRENT_VERSION } from "./version.js";

const IMAGE_TYPES: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/svg+xml": ".svg",
};
const MAX_ASSET_BYTES = 20 * 1024 * 1024;
/** Ceiling on the `@file` completion list — a huge repo degrades, never hangs. */
const MAX_REPO_FILES = 20_000;

/**
 * Repo-relative paths for the `@file` completion menu. `git ls-files` is the
 * source of truth: it already honours .gitignore, so node_modules and build
 * output never reach the menu. A non-git directory falls back to nothing —
 * the picker degrades to plain typing rather than walking an unbounded tree.
 */
function repoFiles(repoRoot: string): { files: string[]; truncated: boolean } {
  let out: string;
  try {
    out = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
      cwd: repoRoot,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return { files: [], truncated: false };
  }
  const all = out.split("\0").filter((line) => line !== "");
  return { files: all.slice(0, MAX_REPO_FILES), truncated: all.length > MAX_REPO_FILES };
}

const priorityValue = z.union([z.literal(1), z.literal(2), z.literal(3)]);
const kindValue = z.enum(["bullet", "task", "discussion"]);
const assigneeValue = z.enum(["human", "agent"]);

const addBody = z.object({
  parentId: z.string().nullish(),
  kind: kindValue.optional(),
  text: z.string(),
  priority: priorityValue.optional(),
  tags: z.array(z.string()).optional(),
  assignee: assigneeValue.optional(),
  afterId: z.string().optional(),
  beforeId: z.string().optional(),
});

const patchBody = z.object({
  text: z.string().optional(),
  kind: kindValue.optional(),
  priority: z.union([priorityValue, z.literal("default")]).optional(),
  addTags: z.array(z.string()).optional(),
  removeTags: z.array(z.string()).optional(),
  // null clears back to unassigned (mirrors UpdateInput).
  assignee: assigneeValue.nullable().optional(),
});

const moveBody = z.object({
  parentId: z.string().nullable().optional(),
  afterId: z.string().optional(),
  beforeId: z.string().optional(),
});

const startBody = z.object({ force: z.boolean().optional() });
const blockBody = z.object({ by: z.string().min(1) });
const tagBody = z.object({ color: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable() });
const replaceBody = z.object({
  nodes: z.array(nodeSchema),
  version: z.string({ required_error: "version is required — send the one the outline was loaded at" }),
});

/** Response header carrying the outline's version token (core `outlineVersion`). */
export const VERSION_HEADER = "X-Kalamu-Version";
/**
 * On a write, the version the operation read before applying itself. When it
 * differs from the version a client last synced to, someone else wrote in
 * between, and the client must not treat the new version as its own.
 */
export const BASE_VERSION_HEADER = "X-Kalamu-Base-Version";

/**
 * Pasted images are user content served from Kalamu's origin, and an SVG can
 * carry script. Sandboxed and never sniffed, they render but cannot run
 * anything as the app.
 */
const UNTRUSTED_CONTENT = { "Content-Security-Policy": "sandbox", "X-Content-Type-Options": "nosniff" };

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".woff2": "font/woff2",
  ".map": "application/json",
};

export interface KalamuServer {
  app: Hono;
  close: () => void;
}

const escapeHtml = (text: string): string =>
  text.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch] ?? ch);

/** The browser view of a doc: its Markdown source, verbatim, with heading lines wrapped in id'd anchors. */
export function docPage(path: string, source: string): string {
  const headings = new Map(markdownHeadings(source).map((h) => [h.line, h.slug]));
  const body = source
    .split("\n")
    .map((line, i) => {
      const slug = headings.get(i);
      return slug === undefined ? escapeHtml(line) : `<span id="${escapeHtml(slug)}">${escapeHtml(line)}</span>`;
    })
    .join("\n");
  return (
    `<!doctype html><meta charset="utf-8"><title>${escapeHtml(path)}</title>` +
    `<style>body{margin:0}pre{margin:0;padding:24px 32px;font:13px/1.5 ui-monospace,monospace;white-space:pre-wrap;word-break:break-word}` +
    `span:target{background:#fff3b0}@media(prefers-color-scheme:dark){body{background:#111;color:#ddd}span:target{background:#5a4a00}}</style>` +
    `<pre>${body}</pre>`
  );
}

/** Static web-asset handler (SPA: unknown paths fall back to index.html). Shared with the hub. */
export function webAppHandler(webAssetsDir: string | null): (c: Context) => Response {
  return (c) => {
    if (!webAssetsDir) {
      return c.html(
        "<h1>Kalamu</h1><p>Web assets are not built. The API is available under <code>/api</code>.</p>",
        200,
      );
    }
    const requested = normalize(c.req.path).replace(/^\/+/, "");
    const candidate = join(webAssetsDir, requested || "index.html");
    const safe = candidate.startsWith(webAssetsDir) && existsSync(candidate) && !candidate.endsWith("/");
    const file = safe && extname(candidate) ? candidate : join(webAssetsDir, "index.html");
    if (!existsSync(file)) return c.text("not found", 404);
    const type = CONTENT_TYPES[extname(file)] ?? "application/octet-stream";
    return c.body(readFileSync(file), 200, { "Content-Type": type });
  };
}

/**
 * The server for the project rooted at `root`, as `kalamu open` runs it and
 * the hub mounts it. `displayName` (optional) overrides the derived project
 * name in /api/project — the hub passes a registry-backed lookup so renames
 * apply without restarting the instance. Returning null falls back to
 * projectName().
 */
export function createServer(
  root: string,
  webAssetsDir: string | null,
  displayName?: () => string | null,
): KalamuServer {
  const app = new Hono();
  const listeners = new Set<(event: string) => void>();

  // Warm the update-check cache at startup (throttled to a day, no-op when
  // opted out) so the human's first UI load already knows about a new release.
  void refreshUpdate(CURRENT_VERSION);

  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const broadcast = (event: string): void => {
    clearTimeout(timers.get(event));
    timers.set(
      event,
      setTimeout(() => {
        for (const listener of listeners) listener(event);
      }, 50),
    );
  };

  // Watchers catch every writer — this server, the CLI, an agent in a
  // terminal, a git checkout — debounced per event type. Two directories: the
  // data dir, and the repo's .kalamu/ (the same one for a repo-store project),
  // where `kalamu migrate` adds or removes the marker.
  let paths = pathsFor(root);
  let watchers: FSWatcher[] = [];
  const onChange = (_type: string, filename: string | null): void => {
    if (filename === OUTLINE_FILE) broadcast("outline-changed");
    else if (filename === META_FILE) broadcast("meta-changed");
    else if (filename === PROJECT_FILE) {
      try {
        current();
      } catch {
        // a broken marker: the next request reports it
      }
    }
  };
  const tryWatch = (dir: string, listener: (type: string, filename: string | null) => void): FSWatcher[] => {
    try {
      return [watch(dir, listener)];
    } catch {
      return []; // watching is best-effort; the UI still works without live reload
    }
  };
  const watchPaths = (): void => {
    for (const watcher of watchers) watcher.close();
    const dirs = new Set([paths.dir, join(root, KALAMU_DIR)]);
    watchers = [...dirs].flatMap((dir) => tryWatch(dir, onChange));
    // A `git checkout` in the main checkout rewrites .git/HEAD; the UI
    // refetches /api/project on this event so the off-default-branch banner
    // (SPEC key decision 20) tracks it live. Non-recursive: the index/ORIG_HEAD
    // churn is filtered by name. Only a repo-store outline is per-branch.
    if (paths.store === "repo") {
      watchers.push(
        ...tryWatch(join(root, ".git"), (_type, filename) => {
          if (filename === "HEAD") broadcast("project-changed");
        }),
      );
    }
  };
  watchPaths();

  /**
   * Where the project's data lives right now. Resolved per request (a marker
   * read) rather than once, so `kalamu migrate` or a data-dir change never
   * strands a running server on the old copy; the watchers follow the data.
   */
  const current = (): KalamuPaths => {
    const next = pathsFor(root);
    if (next.dir !== paths.dir) {
      paths = next;
      watchPaths();
      broadcast("outline-changed");
      broadcast("project-changed");
    }
    return next;
  };

  const readNodes = (): KalamuNode[] => preorder(buildTree(readOutline(current().outline).nodes));

  /** `withOutline` for a route: also reports the base and written versions in the response headers. */
  const write = <R extends { nodes: readonly KalamuNode[] }>(
    c: Context,
    operation: (nodes: KalamuNode[], version: string) => R,
  ): R & { version: string } => {
    let base = "";
    // On a retry the last attempt's base is the one that was written over.
    const written = withOutline(current().outline, (nodes, version) => {
      base = version;
      return operation(nodes, version);
    });
    c.header(BASE_VERSION_HEADER, base);
    c.header(VERSION_HEADER, written.version);
    return written;
  };

  app.use(requestGuard());
  app.onError(handleError);

  app.get("/api/nodes", (c) => {
    const { nodes, version } = readOutline(current().outline);
    c.header(VERSION_HEADER, version);
    return c.json({ nodes: preorder(buildTree(nodes)), version });
  });

  // Whole-outline replace: exists for the UI's undo/redo (snapshot + restore).
  // Conflict-checked, never last-write-wins: the client sends the version its
  // snapshot was taken against, and a newer file (an agent's write) is a 409
  // rather than silently reverted.
  app.put("/api/nodes", async (c) => {
    const body = await jsonBody(c, replaceBody);
    const validation = validateOutline(serializeJsonl(body.nodes));
    if (!validation.valid) throw new HttpError(400, validation.errors[0] ?? "invalid outline");
    const { nodes, version } = write(c, (_nodes, version) => {
      if (version !== body.version) throw new ConflictError("outline changed since it was loaded");
      return { nodes: renumber(preorder(buildTree(body.nodes))) };
    });
    return c.json({ nodes, version });
  });

  app.get("/api/nodes/:id", (c) => {
    const node = readNodes().find((n) => n.id === c.req.param("id"));
    if (!node) throw new HttpError(404, `no node with id ${c.req.param("id")}`, "not-found");
    return c.json(node);
  });

  app.post("/api/nodes", async (c) => {
    const body = await jsonBody(c, addBody);
    const { node } = write(c, (nodes) =>
      addNode(nodes, {
        ...body,
        parentId: body.parentId ?? undefined,
        // Everything through the web UI is the developer typing (key decision 15).
        createdBy: "human",
      }),
    );
    return c.json(node, 201);
  });

  app.patch("/api/nodes/:id", async (c) => {
    const body = await jsonBody(c, patchBody);
    return c.json(write(c, (nodes) => updateNode(nodes, c.req.param("id"), body)).node);
  });

  app.delete("/api/nodes/:id", (c) => {
    const recursive = c.req.query("recursive") === "true";
    const { deletedCount } = write(c, (nodes) => deleteNode(nodes, c.req.param("id"), { recursive }));
    return c.json({ id: c.req.param("id"), deleted: deletedCount });
  });

  app.post("/api/nodes/:id/move", async (c) => {
    const body = await jsonBody(c, moveBody);
    return c.json(write(c, (nodes) => moveNode(nodes, c.req.param("id"), body)).node);
  });

  app.post("/api/nodes/:id/done", (c) => c.json(write(c, (nodes) => markDone(nodes, c.req.param("id"))).node));

  app.post("/api/nodes/:id/reopen", (c) => c.json(write(c, (nodes) => reopen(nodes, c.req.param("id"))).node));

  app.post("/api/nodes/:id/start", async (c) => {
    const { force } = await jsonBody(c, startBody, { optional: true });
    return c.json(write(c, (nodes) => startTask(nodes, c.req.param("id"), { force })).node);
  });

  app.post("/api/nodes/:id/end", (c) => c.json(write(c, (nodes) => endTask(nodes, c.req.param("id"))).node));

  app.post("/api/nodes/:id/block", async (c) => {
    const { by } = await jsonBody(c, blockBody);
    return c.json(write(c, (nodes) => addBlocker(nodes, c.req.param("id"), by)).node);
  });

  // No :byId clears every blocker on the node.
  app.delete("/api/nodes/:id/block/:byId?", (c) =>
    c.json(write(c, (nodes) => removeBlocker(nodes, c.req.param("id"), c.req.param("byId"))).node),
  );

  app.get("/api/search", (c) => {
    const q = c.req.query("q") ?? "";
    return c.json({ nodes: q ? searchNodes(readNodes(), q) : [] });
  });

  app.get("/api/next", (c) => {
    const result = nextTask(readNodes());
    if (!result) return c.json({ id: null });
    return c.json({
      id: result.node.id,
      text: result.node.text,
      priority: effectivePriority(result.node),
      path: result.path,
      reason: result.reason,
    });
  });

  app.get("/api/validate", (c) => {
    let content = "";
    try {
      content = readFileSync(current().outline, "utf8");
    } catch {
      throw new HttpError(400, "no outline file");
    }
    return c.json(validateOutline(content, { docExists: (path) => findDoc(root, path) !== null }));
  });

  // Pasted images: content-hashed file in the data dir's assets/ (they move
  // with the outline — assets are outline content, SPEC key decision 11);
  // identical pastes dedupe. The token in node text keeps the `.kalamu/assets/`
  // form whichever store holds the file.
  app.post("/api/assets", async (c) => {
    const type = c.req.header("content-type")?.split(";")[0]?.trim() ?? "";
    const ext = IMAGE_TYPES[type];
    if (!ext) throw new HttpError(415, `unsupported image type "${type}"`);
    const bytes = Buffer.from(await c.req.arrayBuffer());
    if (!bytes.length) throw new HttpError(400, "empty body");
    if (bytes.length > MAX_ASSET_BYTES) throw new HttpError(413, "image exceeds 20 MB");

    const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 12);
    const filename = `img-${hash}${ext}`;
    const assetsDir = join(current().dir, "assets");
    const target = join(assetsDir, filename);
    if (!existsSync(target)) {
      mkdirSync(assetsDir, { recursive: true });
      const temp = `${target}.${process.pid}.tmp`;
      writeFileSync(temp, bytes);
      renameSync(temp, target);
    }
    return c.json({ path: `.kalamu/assets/${filename}`, url: `/assets/${filename}` }, 201);
  });

  // Doc references: repo-relative `.md` paths in node text (SPEC key decision
  // 19) open here. Repo files only — from any checkout, see `findDoc` — and
  // `.md` only: this is a doc viewer, never a general file server. A browser
  // tab (Accept: text/html) gets the source in a <pre> with every heading
  // carrying its slug as an id, so `#slug` in the URL lands on that heading;
  // any other client gets the raw file.
  app.get("/docs/*", (c) => {
    let raw: string;
    try {
      raw = decodeURIComponent(c.req.path.slice("/docs/".length));
    } catch {
      return c.text("not found", 404);
    }
    const full = findDoc(root, raw);
    if (full === null) return c.text("not found", 404);
    const source = readFileSync(full, "utf8");
    c.header("X-Content-Type-Options", "nosniff");
    if (!c.req.header("accept")?.includes("text/html")) return c.text(source);
    return c.html(docPage(raw, source));
  });

  app.get("/assets/:file", (c) => {
    const file = basename(c.req.param("file")); // basename defeats traversal
    const full = join(current().dir, "assets", file);
    if (!existsSync(full)) return c.text("not found", 404);
    const type = Object.entries(IMAGE_TYPES).find(([, e]) => e === extname(file))?.[0];
    return c.body(readFileSync(full), 200, { "Content-Type": type ?? "application/octet-stream", ...UNTRUSTED_CONTENT });
  });

  // Completion source for `@file` references (SPEC key decision 19). Paths
  // only — the outline never stores repo file contents.
  app.get("/api/files", (c) => c.json(repoFiles(root)));

  // platform + hubInstalled drive the UI's hub-discovery hints: install advice
  // is only shown where `hub install` exists and hasn't already been run.
  // version/latestVersion/updateAvailable drive the UI's update chip: the
  // comparison is served from cache (instant); the fire-and-forget refresh
  // warms it — throttled to a day and a no-op when opted out — for next poll.
  app.get("/api/project", (c) => {
    const update = cachedUpdate(CURRENT_VERSION);
    void refreshUpdate(CURRENT_VERSION);
    const paths = current();
    return c.json({
      name: displayName?.() ?? projectName(root),
      platform: process.platform,
      hubInstalled: hubAgentInstalled(),
      version: CURRENT_VERSION,
      latestVersion: update.latest,
      updateAvailable: update.updateAvailable,
      // `@file` chips become editor deep links built from these two.
      repoRoot: root,
      editorTemplate: editorTemplate(),
      // Where the data lives (SPEC key decision 21): `local` keeps it outside git.
      store: paths.store,
      dataDir: paths.dir,
      // The CLI's stderr warning, surfaced where the human actually looks —
      // only a repo-store outline can be swapped by a checkout.
      branchDrift: paths.store === "repo" ? offDefaultBranch(root) : null,
    });
  });

  app.get("/api/meta", (c) => c.json(readMeta(current().meta)));

  app.put("/api/tags/:tag", async (c) => {
    const tag = c.req.param("tag").toLowerCase();
    if (!TAG_PATTERN.test(tag)) throw new HttpError(400, `invalid tag name "${tag}"`);
    const { color } = await jsonBody(c, tagBody);
    const { meta: file } = current();
    const { tags, ...meta } = readMeta(file);
    const overrides = { ...tags };
    if (color === null) delete overrides[tag];
    else overrides[tag] = color;
    writeMeta(file, Object.keys(overrides).length ? { ...meta, tags: overrides } : meta);
    return c.json(readMeta(file));
  });

  app.get("/api/ui-state", (c) => c.json(readUiState(current().uiState)));

  app.put("/api/ui-state", async (c) => {
    // Core's schema, not a local copy: the two drifted once (a new view-state
    // key silently stripped on write), and there is nothing server-specific here.
    const body = await jsonBody(c, uiStateSchema);
    writeUiState(current().uiState, body);
    return c.json(body);
  });

  app.get("/api/events", (c) =>
    streamSSE(c, async (stream) => {
      const listener = (event: string): void => {
        void stream.writeSSE({ event, data: String(Date.now()) });
      };
      listeners.add(listener);
      stream.onAbort(() => {
        listeners.delete(listener);
      });
      await stream.writeSSE({ event: "connected", data: "ok" });
      // Keep the connection open until the client goes away.
      for (;;) {
        await stream.sleep(30_000);
        await stream.writeSSE({ event: "ping", data: String(Date.now()) });
      }
    }),
  );

  // Static web assets (SPA: unknown paths fall back to index.html).
  app.get("*", webAppHandler(webAssetsDir));

  return {
    app,
    close: () => {
      for (const watcher of watchers) watcher.close();
      for (const timer of timers.values()) clearTimeout(timer);
      listeners.clear();
    },
  };
}
