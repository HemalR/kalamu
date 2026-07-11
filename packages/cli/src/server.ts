import {
  addNode,
  buildTree,
  deleteNode,
  markDone,
  moveNode,
  nextTask,
  nodeSchema,
  OperationError,
  preorder,
  reopen,
  searchNodes,
  serializeJsonl,
  setHandoff,
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
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, watch, writeFileSync, type FSWatcher } from "node:fs";
import { basename, dirname, extname, join, normalize } from "node:path";
import { z } from "zod";

const IMAGE_TYPES: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/svg+xml": ".svg",
};
const MAX_ASSET_BYTES = 20 * 1024 * 1024;

const priorityValue = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]);
const kindValue = z.enum(["bullet", "task"]);
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

const handoffBody = z.object({ target: z.string().min(1), ref: z.string().min(1) });
const tagBody = z.object({ color: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable() });
const uiStateBody = z.object({ collapsed: z.array(z.string()) });

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json",
  ".woff2": "font/woff2",
  ".map": "application/json",
};

export interface KalamuServer {
  app: Hono;
  close: () => void;
}

/** Project name for the UI title: package.json `name` if present, else the root directory's name. */
function projectName(root: string): string {
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

export function createServer(paths: KalamuPaths, webAssetsDir: string | null): KalamuServer {
  const app = new Hono();
  const listeners = new Set<(event: string) => void>();

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

  app.post("/api/nodes/:id/handoff", async (c) => {
    const body = handoffBody.parse(await c.req.json());
    const node = withOutline(paths.outline, (nodes) => {
      const result = setHandoff(nodes, c.req.param("id"), body.target, body.ref);
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
      priority: result.node.priority ?? 3,
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

  app.get("/assets/:file", (c) => {
    const file = basename(c.req.param("file")); // basename defeats traversal
    const full = join(paths.dir, "assets", file);
    if (!existsSync(full)) return c.text("not found", 404);
    const type = Object.entries(IMAGE_TYPES).find(([, e]) => e === extname(file))?.[0];
    return c.body(readFileSync(full), 200, { "Content-Type": type ?? "application/octet-stream" });
  });

  app.get("/api/project", (c) => c.json({ name: projectName(dirname(paths.dir)) }));

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
    const body = uiStateBody.parse(await c.req.json());
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
  app.get("*", (c) => {
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
  });

  return {
    app,
    close: () => {
      watcher?.close();
      for (const timer of timers.values()) clearTimeout(timer);
      listeners.clear();
    },
  };
}
