import { findRoot, initKalamu, pathsFor } from "@kalamu/core/store";
import { serve } from "@hono/node-server";
import { detectHub, HUB_PORT, wakeInstalledHub } from "./hub.js";
import { openBrowser, pickPort, webAssetsDir } from "./launch.js";
import { readRegistry, registerProject } from "./registry.js";
import { createServer } from "./server.js";

const DEFAULT_PORT = 4242;

export interface OpenOptions {
  port?: string;
  browser?: boolean;
}

export async function open(cwd: string, options: OpenOptions): Promise<void> {
  const root = findRoot(cwd) ?? cwd;
  initKalamu(root); // ensure .kalamu exists (never overwrites)
  registerProject(root);
  const paths = pathsFor(root);

  // A running hub already serves every registered project — reuse it instead
  // of starting one more server, and wake a launchd-installed hub that isn't
  // answering (SPEC "Hub"). An explicit --port opts out.
  if (options.port === undefined) {
    const running = await detectHub();
    if (running || (await wakeInstalledHub())) {
      const slug = readRegistry().projects.find((p) => p.path === root)?.slug;
      if (slug) {
        const url = `http://127.0.0.1:${HUB_PORT}/p/${slug}`;
        console.log(running ? "Kalamu hub is already serving this project" : "Started the installed Kalamu hub");
        console.log(`  ${url}`);
        if (options.browser !== false) openBrowser(url);
        return;
      }
    }
  }

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
