/**
 * `kalamu hub` — one machine-global server mounting every registered project
 * behind a single UI (SPEC "Hub"). Each project is served by a lazily created
 * instance of the ordinary per-project server, torn down again after idling,
 * so the hub never holds file watchers for dormant projects.
 */
import { pathsFor, readOutline } from "@kalamu/core/store";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { HUB_LAUNCHD_LABEL, hubLaunchAgentPlist, openBrowser, portIsFree, webAssetsDir } from "./launch.js";
import {
  isHexColor,
  projectColor,
  readRegistry,
  recolorProject,
  renameProject,
  unregisterProject,
  type RegistryEntry,
} from "./registry.js";
import { createServer, projectName, webAppHandler, type KalamuServer } from "./server.js";

export const HUB_PORT = 4400;
const IDLE_MS = 5 * 60 * 1000;

interface Instance {
  server: KalamuServer;
  lastAccess: number;
  /** Open SSE streams — an instance with live listeners is never idle. */
  sse: number;
}

export interface HubOptions {
  registryFile?: string;
  idleMs?: number;
}

/** Open (not done, not handed off, non-blank) tasks — the sidebar badge. */
function countOpenTasks(entry: RegistryEntry): number | null {
  try {
    return readOutline(pathsFor(entry.path).outline).nodes.filter(
      (n) => n.kind === "task" && n.text.trim() !== "" && n.doneAt === null && n.handoff === null,
    ).length;
  } catch {
    return null;
  }
}

const byMostRecent = (a: RegistryEntry, b: RegistryEntry): number => b.lastSeenAt.localeCompare(a.lastSeenAt);

export function createHubServer(assetsDir: string | null, options: HubOptions = {}): KalamuServer {
  const app = new Hono();
  const instances = new Map<string, Instance>();
  const idleMs = options.idleMs ?? IDLE_MS;

  const closeInstance = (slug: string): void => {
    instances.get(slug)?.server.close();
    instances.delete(slug);
  };

  const sweeper = setInterval(() => {
    const now = Date.now();
    for (const [slug, instance] of instances) {
      if (instance.sse === 0 && now - instance.lastAccess > idleMs) closeInstance(slug);
    }
  }, 60_000);
  sweeper.unref();

  const getInstance = (slug: string): Instance | null => {
    const existing = instances.get(slug);
    if (existing) {
      existing.lastAccess = Date.now();
      return existing;
    }
    const entry = readRegistry(options.registryFile).projects.find((p) => p.slug === slug);
    if (!entry) return null;
    const instance: Instance = {
      // Registry-backed display name so a rename shows up in the project's own
      // /api/project (the "kalamu | name" header) without restarting the instance.
      server: createServer(pathsFor(entry.path), assetsDir, () => {
        return readRegistry(options.registryFile).projects.find((p) => p.slug === slug)?.name ?? null;
      }),
      lastAccess: Date.now(),
      sse: 0,
    };
    instances.set(slug, instance);
    return instance;
  };

  // Lets `kalamu open` (and the UI) tell a hub apart from anything else on the port.
  app.get("/api/hub", (c) => c.json({ hub: true }));

  app.get("/api/projects", (c) => {
    const projects = [...readRegistry(options.registryFile).projects].sort(byMostRecent).map((entry) => ({
      slug: entry.slug,
      name: entry.name ?? projectName(entry.path),
      path: entry.path,
      color: projectColor(entry),
      openTasks: countOpenTasks(entry),
      lastSeenAt: entry.lastSeenAt,
    }));
    return c.json({ projects });
  });

  // Update a project's display name and/or theme colour (slug — route
  // identity — never changes). A blank value clears that override, reverting
  // to the derived name/colour; the response carries the effective values so
  // the UI can show what a clear reverted to.
  app.patch("/api/projects/:slug", async (c) => {
    const slug = c.req.param("slug");
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid JSON body" }, 400);
    }
    const { name, color } = body !== null && typeof body === "object" ? (body as Record<string, unknown>) : {};
    if (name === undefined && color === undefined) {
      return c.json({ error: `expected {"name"?: string, "color"?: string}` }, 400);
    }
    if (name !== undefined && typeof name !== "string") return c.json({ error: `expected {"name": string}` }, 400);
    if (color !== undefined && (typeof color !== "string" || (color.trim() !== "" && !isHexColor(color.trim())))) {
      return c.json({ error: `expected {"color": "#rrggbb"} (blank clears the override)` }, 400);
    }
    if (name !== undefined && renameProject(slug, name, options.registryFile) === null) {
      return c.json({ error: `no registered project "${slug}"` }, 404);
    }
    if (color !== undefined && recolorProject(slug, color, options.registryFile) === null) {
      return c.json({ error: `no registered project "${slug}"` }, 404);
    }
    const entry = readRegistry(options.registryFile).projects.find((p) => p.slug === slug);
    if (!entry) return c.json({ error: `no registered project "${slug}"` }, 404);
    return c.json({ name: entry.name ?? projectName(entry.path), color: projectColor(entry) });
  });

  // Forget a project: drop the registry entry and tear down any live instance.
  // Non-destructive — .kalamu/ data is untouched and the project re-registers
  // on its next CLI use — so the UI offers no confirmation step either.
  app.delete("/api/projects/:slug", (c) => {
    const slug = c.req.param("slug");
    if (!unregisterProject(slug, options.registryFile)) {
      return c.json({ error: `no registered project "${slug}"` }, 404);
    }
    closeInstance(slug);
    return c.body(null, 204);
  });

  // Project traffic routes into that project's own server instance; everything
  // else under /p/:slug (the SPA shell, its /app bundle) is the hub's own.
  app.all("/p/:slug/*", async (c, next) => {
    const slug = c.req.param("slug");
    const rest = c.req.path.slice(`/p/${slug}`.length);
    if (!rest.startsWith("/api/") && !rest.startsWith("/assets/")) return next();
    const instance = getInstance(slug);
    if (!instance) return c.json({ error: `no registered project "${slug}"` }, 404);
    if (rest === "/api/events") {
      instance.sse++;
      c.req.raw.signal.addEventListener("abort", () => {
        instance.sse--;
        instance.lastAccess = Date.now();
      });
    }
    const url = new URL(c.req.url);
    url.pathname = rest;
    return instance.server.app.fetch(
      new Request(url, {
        method: c.req.raw.method,
        headers: c.req.raw.headers,
        body: c.req.raw.body,
        signal: c.req.raw.signal,
        // Node's fetch requires half duplex for streamed request bodies.
        duplex: "half",
      } as RequestInit),
    );
  });

  // The hub root lands on the most recently used project.
  app.get("/", (c) => {
    const [recent] = [...readRegistry(options.registryFile).projects].sort(byMostRecent);
    if (!recent) {
      return c.html(
        "<h1>Kalamu hub</h1><p>No projects registered yet — run any <code>kalamu</code> command inside a project, then reload.</p>",
      );
    }
    return c.redirect(`/p/${recent.slug}`);
  });

  app.get("*", webAppHandler(assetsDir));

  return {
    app,
    close: () => {
      clearInterval(sweeper);
      for (const slug of [...instances.keys()]) closeInstance(slug);
    },
  };
}

/** True when a Kalamu hub answers on the port (quick probe, never throws). */
export async function detectHub(port = HUB_PORT): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/hub`, { signal: AbortSignal.timeout(400) });
    if (!res.ok) return false;
    const body: unknown = await res.json();
    return body !== null && typeof body === "object" && (body as { hub?: unknown }).hub === true;
  } catch {
    return false;
  }
}

export async function runHub(options: { port?: string; browser?: boolean }): Promise<void> {
  const port = options.port === undefined ? HUB_PORT : Number(options.port);
  if (!(await portIsFree(port))) {
    throw new Error(
      (await detectHub(port))
        ? `a kalamu hub is already running on http://127.0.0.1:${port}`
        : `port ${port} is already in use`,
    );
  }
  const { app, close } = createHubServer(webAssetsDir());
  const server = serve({ fetch: app.fetch, port, hostname: "127.0.0.1" });
  const url = `http://127.0.0.1:${port}`;
  console.log(`Kalamu hub serving ${readRegistry().projects.length} project(s)`);
  console.log(`  ${url}`);

  const shutdown = (): void => {
    close();
    server.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  if (options.browser !== false) openBrowser(url);
}

const escapeXml = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function launchctl(args: string[]): void {
  execFileSync("launchctl", args, { stdio: "ignore" });
}

/** Write a launchd user agent so the hub runs at login (macOS). */
export function installHubAgent(): void {
  if (process.platform !== "darwin") {
    throw new Error(
      "kalamu hub install is macOS-only for now (launchd) — on Linux, run `kalamu hub` from a systemd user unit",
    );
  }
  const script = resolve(process.argv[1] ?? "");
  const log = join(homedir(), ".kalamu", "hub.log");
  mkdirSync(dirname(log), { recursive: true });
  const args = [process.execPath, script, "hub", "--no-browser"];
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${HUB_LAUNCHD_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${args.map((a) => `    <string>${escapeXml(a)}</string>`).join("\n")}
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${escapeXml(log)}</string>
  <key>StandardErrorPath</key>
  <string>${escapeXml(log)}</string>
</dict>
</plist>
`;
  const file = hubLaunchAgentPlist();
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, plist, "utf8");
  const domain = `gui/${process.getuid?.() ?? 0}`;
  try {
    launchctl(["bootout", `${domain}/${HUB_LAUNCHD_LABEL}`]);
  } catch {
    // not currently loaded — first install
  }
  launchctl(["bootstrap", domain, file]);
  console.log(`Installed ${HUB_LAUNCHD_LABEL} — the hub now runs at login on http://127.0.0.1:${HUB_PORT}`);
  console.log(`  plist: ${file}`);
  console.log(`  log:   ${log}`);
}

export function uninstallHubAgent(): void {
  if (process.platform !== "darwin") {
    throw new Error("kalamu hub uninstall is macOS-only for now (launchd)");
  }
  try {
    launchctl(["bootout", `gui/${process.getuid?.() ?? 0}/${HUB_LAUNCHD_LABEL}`]);
  } catch {
    // not loaded
  }
  rmSync(hubLaunchAgentPlist(), { force: true });
  console.log(`Removed ${HUB_LAUNCHD_LABEL} — the hub no longer starts at login`);
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Restart the installed hub so it picks up updated code (a running process
 * never notices a new bundle on disk). Only launchd-managed hubs can be
 * restarted — a foreground hub belongs to whoever's terminal it is running in.
 */
export async function restartHub(): Promise<void> {
  if (process.platform === "darwin" && existsSync(hubLaunchAgentPlist())) {
    const domain = `gui/${process.getuid?.() ?? 0}`;
    try {
      launchctl(["kickstart", "-k", `${domain}/${HUB_LAUNCHD_LABEL}`]);
    } catch {
      // Installed but not loaded (e.g. booted out) — load it instead.
      try {
        launchctl(["bootstrap", domain, hubLaunchAgentPlist()]);
      } catch {
        throw new Error(`launchd could not start ${HUB_LAUNCHD_LABEL} — try \`kalamu hub install\` again`);
      }
    }
    for (let i = 0; i < 10; i++) {
      await sleep(300);
      if (await detectHub()) {
        console.log(`Restarted ${HUB_LAUNCHD_LABEL}`);
        console.log(`  http://127.0.0.1:${HUB_PORT}`);
        return;
      }
    }
    throw new Error(`restarted ${HUB_LAUNCHD_LABEL}, but no hub answered on port ${HUB_PORT} — check ~/.kalamu/hub.log`);
  }
  if (await detectHub()) {
    throw new Error("the hub is running in a terminal, not via launchd — Ctrl+C it and rerun `kalamu hub`");
  }
  throw new Error("no hub is running — start one with `kalamu hub`, or `kalamu hub install` to run it at login");
}
