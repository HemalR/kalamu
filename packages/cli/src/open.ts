import { findRoot, initKalamu } from "@kalamu/core/store";
import { serve } from "@hono/node-server";
import { join } from "node:path";
import { resolvePaths } from "./context.js";
import { detectHub, hubPort, wakeInstalledHub } from "./hub.js";
import { openBrowser, pickPort, webAssetsDir } from "./launch.js";
import { removeLock, writeLock } from "./lock.js";
import { slugFor } from "./registry.js";
import { createServer } from "./server.js";

const DEFAULT_PORT = 4242;

export interface OpenOptions {
  port?: string;
  browser?: boolean;
}

export async function open(cwd: string, options: OpenOptions): Promise<void> {
  // A fresh directory is initialised; an existing project is only resolved —
  // init would quietly start an empty outline where a local store's data is
  // merely missing on this machine (resolvePaths explains that case instead).
  if (findRoot(cwd) === null) initKalamu(cwd);
  const paths = resolvePaths(cwd);

  // A running hub already serves every registered project — reuse it instead
  // of starting one more server, and wake a launchd-installed hub that isn't
  // answering (SPEC "Hub"). An explicit --port opts out.
  if (options.port === undefined) {
    const port = hubPort();
    const running = await detectHub(port);
    if (running || (await wakeInstalledHub())) {
      const slug = slugFor(paths.root);
      if (slug) {
        const url = `http://127.0.0.1:${running ? port : hubPort()}/p/${slug}`;
        console.log(running ? "Kalamu hub is already serving this project" : "Started the installed Kalamu hub");
        console.log(`  ${url}`);
        if (options.browser !== false) openBrowser(url);
        return;
      }
    }
  }

  const explicit = options.port !== undefined;
  const port = await pickPort(explicit ? Number(options.port) : DEFAULT_PORT, explicit);
  const { app, close } = createServer(paths.root, webAssetsDir());

  const server = serve({ fetch: app.fetch, port, hostname: "127.0.0.1" });
  const url = `http://127.0.0.1:${port}`;
  console.log(`Kalamu serving ${paths.outline}`);
  console.log(`  ${url}`);

  // So `kalamu stop`, run from any terminal, can find and stop this process
  // without needing to know which tab it's running in.
  const lockPath = join(paths.dir, "server.lock");
  writeLock(lockPath, { pid: process.pid, port });

  const shutdown = (): void => {
    removeLock(lockPath);
    close();
    server.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  if (options.browser !== false) openBrowser(url);
}
