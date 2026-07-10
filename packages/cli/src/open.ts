import { initKalamu, pathsFor } from "@kalamu/core/store";
import { serve } from "@hono/node-server";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer as createNetServer } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { findRoot } from "@kalamu/core/store";
import { createServer } from "./server.js";

const DEFAULT_PORT = 4242;

function portIsFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = createNetServer();
    probe.once("error", () => resolve(false));
    probe.once("listening", () => probe.close(() => resolve(true)));
    probe.listen(port, "127.0.0.1");
  });
}

async function pickPort(preferred: number, explicit: boolean): Promise<number> {
  if (explicit) {
    if (await portIsFree(preferred)) return preferred;
    throw new Error(`port ${preferred} is already in use`);
  }
  for (let port = preferred; port < preferred + 20; port++) {
    if (await portIsFree(port)) return port;
  }
  throw new Error(`no free port between ${preferred} and ${preferred + 19}`);
}

function openBrowser(url: string): void {
  const command =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  spawn(command, [url], { stdio: "ignore", detached: true, shell: process.platform === "win32" }).unref();
}

function webAssetsDir(): string | null {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const candidate of [join(here, "web"), join(here, "..", "dist", "web")]) {
    if (existsSync(join(candidate, "index.html"))) return candidate;
  }
  return null;
}

export interface OpenOptions {
  port?: string;
  browser?: boolean;
}

export async function open(cwd: string, options: OpenOptions): Promise<void> {
  const root = findRoot(cwd) ?? cwd;
  initKalamu(root); // ensure .kalamu exists (never overwrites)
  const paths = pathsFor(root);

  const explicit = options.port !== undefined;
  const port = await pickPort(explicit ? Number(options.port) : DEFAULT_PORT, explicit);
  const { app, close } = createServer(paths, webAssetsDir());

  const server = serve({ fetch: app.fetch, port, hostname: "127.0.0.1" });
  const url = `http://127.0.0.1:${port}`;
  console.log(`Kalamu serving ${paths.outline}`);
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
