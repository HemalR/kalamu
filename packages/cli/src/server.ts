import {
  addBlocker,
  addNode,
  buildTree,
  deleteNode,
  effectivePriority,
  endTask,
  markDone,
  moveNode,
  nextTask,
  nodeSchema,
  OperationError,
  preorder,
  removeBlocker,
  reopen,
  searchNodes,
  serializeJsonl,
  startTask,
  uiStateSchema,
  updateNode,
  validateOutline,
  TAG_PATTERN,
  type KalamuNode,
  type NodeKind,
} from "@kalamu/core";
import {
  readMeta,
  readOutline,
  readUiState,
  StoreError,
  withOutline,
  writeMeta,
  writeOutline,
  writeUiState,
  type KalamuPaths,
} from "@kalamu/core/store";
import { Hono, type Context } from "hono";
import { streamSSE } from "hono/streaming";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, watch, writeFileSync, type FSWatcher } from "node:fs";
import { basename, dirname, extname, join, normalize, sep } from "node:path";
import { z } from "zod";
import { editorTemplate } from "./config.js";
import { hubAgentInstalled } from "./launch.js";
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

/** Project name for the UI title: package.json `name` if present, else the root directory's name. */
export function projectName(root: string): string {
  try {
    const pkg: unknown = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    if (pkg !== null && typeof pkg === "object" && "name" in pkg && typeof pkg.name === "string" && pkg.name.trim() !== "") {
      return pkg.name;
    }
  } catch {
    // no package.json (or unreadable/invalid) — fall back to the directory name
  }
  return basename(root);
}

/**
 * `displayName` (optional) overrides the derived project name in /api/project —
 * the hub passes a registry-backed lookup so renames apply without restarting
 * the instance. Returning null falls back to projectName().
 */
export function createServer(
  paths: KalamuPaths,
  webAssetsDir: string | null,
  displayName?: () => string | null,
): KalamuServer {
  const app = new Hono();
  const listeners = new Set<(event: string) => void>();

  // Warm the update-check cache at startup (throttled to a day, no-op when
  // opted out) so the human's first UI load already knows about a new release.
  void refreshUpdate(CURRENT_VERSION);

  // One watcher on .kalamu/ catches every writer — this server, the CLI,
  // an agent in a terminal, a git checkout. Debounced per event type.
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
  let watcher: FSWatcher | null = null;
  try {
    watcher = watch(paths.dir, (_type, filename) => {
      if (filename === "outline.jsonl") broadcast("outline-changed");
      if (filename === "meta.json") broadcast("meta-changed");
    });
  } catch {
    // watching is best-effort; the UI still works without live reload
  }

  const readNodes = (): KalamuNode[] => preorder(buildTree(readOutline(paths.outline).nodes));

  app.onError((err, c) => {
    if (err instanceof OperationError && err.message.startsWith("no node with id")) {
      return c.json({ error: err.message }, 404);
    }
    // SPEC "HTTP API": a blocker cycle is a conflict with existing edges, not
    // a malformed request.
    if (err instanceof OperationError && err.message.endsWith("would create a cycle")) {
      return c.json({ error: err.message }, 409);
    }
    if (err instanceof OperationError || err instanceof StoreError) {
      return c.json({ error: err.message }, 400);
    }
    if (err instanceof z.ZodError) {
      return c.json({ error: err.issues[0]?.message ?? "invalid request body" }, 400);
    }
    console.error(err);
    return c.json({ error: "internal error" }, 500);
  });

  app.get("/api/nodes", (c) => c.json({ nodes: readNodes() }));

  // Whole-outline replace: exists for the UI's undo/redo (snapshot + restore).
  // Deliberately last-write-wins; the payload is fully validated first.
  app.put("/api/nodes", async (c) => {
    const body = z.object({ nodes: z.array(nodeSchema) }).parse(await c.req.json());
    const validation = validateOutline(serializeJsonl(body.nodes));
    if (!validation.valid) return c.json({ error: validation.errors[0] }, 400);
    writeOutline(paths.outline, preorder(buildTree(body.nodes)));
    return c.json({ nodes: readNodes() });
  });

  app.get("/api/nodes/:id", (c) => {
    const node = readNodes().find((n) => n.id === c.req.param("id"));
    return node ? c.json(node) : c.json({ error: `no node with id ${c.req.param("id")}` }, 404);
  });

  app.post("/api/nodes", async (c) => {
    const body = addBody.parse(await c.req.json());
    const node = withOutline(paths.outline, (nodes) => {
      const result = addNode(nodes, {
        parentId: body.parentId ?? undefined,
        kind: body.kind as NodeKind | undefined,
        text: body.text,
        priority: body.priority,
        tags: body.tags,
        assignee: body.assignee,
        // Everything through the web UI is the developer typing (key decision 15).
        createdBy: "human",
        afterId: body.afterId,
        beforeId: body.beforeId,
      });
      return { nodes: result.nodes, result: result.node };
    });
    return c.json(node, 201);
  });

  app.patch("/api/nodes/:id", async (c) => {
    const body = patchBody.parse(await c.req.json());
    const node = withOutline(paths.outline, (nodes) => {
      const result = updateNode(nodes, c.req.param("id"), body);
      return { nodes: result.nodes, result: result.node };
    });
    return c.json(node);
  });

  app.delete("/api/nodes/:id", (c) => {
    const recursive = c.req.query("recursive") === "true";
    const deleted = withOutline(paths.outline, (nodes) => {
      const result = deleteNode(nodes, c.req.param("id"), { recursive });
      return { nodes: result.nodes, result: result.deletedCount };
    });
    return c.json({ id: c.req.param("id"), deleted });
  });

  app.post("/api/nodes/:id/move", async (c) => {
    const body = moveBody.parse(await c.req.json());
    const node = withOutline(paths.outline, (nodes) => {
      const result = moveNode(nodes, c.req.param("id"), body);
      return { nodes: result.nodes, result: result.node };
    });
    return c.json(node);
  });

  app.post("/api/nodes/:id/done", (c) => {
    const node = withOutline(paths.outline, (nodes) => {
      const result = markDone(nodes, c.req.param("id"));
      return { nodes: result.nodes, result: result.node };
    });
    return c.json(node);
  });

  app.post("/api/nodes/:id/reopen", (c) => {
    const node = withOutline(paths.outline, (nodes) => {
      const result = reopen(nodes, c.req.param("id"));
      return { nodes: result.nodes, result: result.node };
    });
    return c.json(node);
  });

  app.post("/api/nodes/:id/start", async (c) => {
    const body = startBody.parse(await c.req.json().catch(() => ({})));
    const node = withOutline(paths.outline, (nodes) => {
      const result = startTask(nodes, c.req.param("id"), { force: body.force });
      return { nodes: result.nodes, result: result.node };
    });
    return c.json(node);
  });

  app.post("/api/nodes/:id/end", (c) => {
    const node = withOutline(paths.outline, (nodes) => {
      const result = endTask(nodes, c.req.param("id"));
      return { nodes: result.nodes, result: result.node };
    });
    return c.json(node);
  });

  app.post("/api/nodes/:id/block", async (c) => {
    const body = blockBody.parse(await c.req.json());
    const node = withOutline(paths.outline, (nodes) => {
      const result = addBlocker(nodes, c.req.param("id"), body.by);
      return { nodes: result.nodes, result: result.node };
    });
    return c.json(node);
  });

  // No :byId clears every blocker on the node.
  app.delete("/api/nodes/:id/block/:byId?", (c) => {
    const node = withOutline(paths.outline, (nodes) => {
      const result = removeBlocker(nodes, c.req.param("id"), c.req.param("byId"));
      return { nodes: result.nodes, result: result.node };
    });
    return c.json(node);
  });

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
      content = readFileSync(paths.outline, "utf8");
    } catch {
      return c.json({ error: "no outline file" }, 400);
    }
    return c.json(validateOutline(content));
  });

  // Pasted images: content-hashed file in .kalamu/assets/ (committed — assets
  // are outline content, SPEC key decision 11); identical pastes dedupe.
  app.post("/api/assets", async (c) => {
    const type = c.req.header("content-type")?.split(";")[0]?.trim() ?? "";
    const ext = IMAGE_TYPES[type];
    if (!ext) return c.json({ error: `unsupported image type "${type}"` }, 415);
    const bytes = Buffer.from(await c.req.arrayBuffer());
    if (!bytes.length) return c.json({ error: "empty body" }, 400);
    if (bytes.length > MAX_ASSET_BYTES) return c.json({ error: "image exceeds 20 MB" }, 413);

    const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 12);
    const filename = `img-${hash}${ext}`;
    const assetsDir = join(paths.dir, "assets");
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
  // 19) open here as plain text. Repo files only, `.md` only — this is a doc
  // viewer, never a general file server.
  app.get("/docs/*", (c) => {
    let raw: string;
    try {
      raw = decodeURIComponent(c.req.path.slice("/docs/".length));
    } catch {
      return c.text("not found", 404);
    }
    const repoRoot = dirname(paths.dir);
    const full = normalize(join(repoRoot, raw));
    if (!full.startsWith(repoRoot + sep) || extname(full) !== ".md") return c.text("not found", 404);
    if (!existsSync(full) || !statSync(full).isFile()) return c.text("not found", 404);
    return c.body(readFileSync(full), 200, { "Content-Type": "text/plain; charset=utf-8" });
  });

  app.get("/assets/:file", (c) => {
    const file = basename(c.req.param("file")); // basename defeats traversal
    const full = join(paths.dir, "assets", file);
    if (!existsSync(full)) return c.text("not found", 404);
    const type = Object.entries(IMAGE_TYPES).find(([, e]) => e === extname(file))?.[0];
    return c.body(readFileSync(full), 200, { "Content-Type": type ?? "application/octet-stream" });
  });

  // Completion source for `@file` references (SPEC key decision 19). Paths
  // only — the outline never stores repo file contents.
  app.get("/api/files", (c) => c.json(repoFiles(dirname(paths.dir))));

  // platform + hubInstalled drive the UI's hub-discovery hints: install advice
  // is only shown where `hub install` exists and hasn't already been run.
  // version/latestVersion/updateAvailable drive the UI's update chip: the
  // comparison is served from cache (instant); the fire-and-forget refresh
  // warms it — throttled to a day and a no-op when opted out — for next poll.
  app.get("/api/project", (c) => {
    const update = cachedUpdate(CURRENT_VERSION);
    void refreshUpdate(CURRENT_VERSION);
    return c.json({
      name: displayName?.() ?? projectName(dirname(paths.dir)),
      platform: process.platform,
      hubInstalled: hubAgentInstalled(),
      version: CURRENT_VERSION,
      latestVersion: update.latest,
      updateAvailable: update.updateAvailable,
      // `@file` chips become editor deep links built from these two.
      repoRoot: dirname(paths.dir),
      editorTemplate: editorTemplate(),
    });
  });

  app.get("/api/meta", (c) => c.json(readMeta(paths.meta)));

  app.put("/api/tags/:tag", async (c) => {
    const tag = c.req.param("tag").toLowerCase();
    if (!TAG_PATTERN.test(tag)) return c.json({ error: `invalid tag name "${tag}"` }, 400);
    const body = tagBody.parse(await c.req.json());
    const meta = readMeta(paths.meta);
    const overrides = { ...meta.tags };
    if (body.color === null) delete overrides[tag];
    else overrides[tag] = body.color;
    const updated = { ...meta, tags: Object.keys(overrides).length ? overrides : undefined };
    if (updated.tags === undefined) delete updated.tags;
    writeMeta(paths.meta, updated);
    return c.json(readMeta(paths.meta));
  });

  app.get("/api/ui-state", (c) => c.json(readUiState(paths.uiState)));

  app.put("/api/ui-state", async (c) => {
    // Core's schema, not a local copy: the two drifted once (a new view-state
    // key silently stripped on write), and there is nothing server-specific here.
    const body = uiStateSchema.parse(await c.req.json());
    writeUiState(paths.uiState, body);
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
      watcher?.close();
      for (const timer of timers.values()) clearTimeout(timer);
      listeners.clear();
    },
  };
}
