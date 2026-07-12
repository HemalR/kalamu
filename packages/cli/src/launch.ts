/** Helpers shared by `kalamu open` and `kalamu hub`: ports, browser, assets, launchd. */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer as createNetServer } from "node:net";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const HUB_LAUNCHD_LABEL = "dev.kalamu.hub";

export function hubLaunchAgentPlist(): string {
  return join(homedir(), "Library", "LaunchAgents", `${HUB_LAUNCHD_LABEL}.plist`);
}

/** True when `kalamu hub install` has been run — the plist IS the installed state. */
export function hubAgentInstalled(): boolean {
  return process.platform === "darwin" && existsSync(hubLaunchAgentPlist());
}

export function portIsFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = createNetServer();
    probe.once("error", () => resolve(false));
    probe.once("listening", () => probe.close(() => resolve(true)));
    probe.listen(port, "127.0.0.1");
  });
}

export async function pickPort(preferred: number, explicit: boolean): Promise<number> {
  if (explicit) {
    if (await portIsFree(preferred)) return preferred;
    throw new Error(`port ${preferred} is already in use`);
  }
  for (let port = preferred; port < preferred + 20; port++) {
    if (await portIsFree(port)) return port;
  }
  throw new Error(`no free port between ${preferred} and ${preferred + 19}`);
}

export function openBrowser(url: string): void {
  const command =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  spawn(command, [url], { stdio: "ignore", detached: true, shell: process.platform === "win32" }).unref();
}

export function webAssetsDir(): string | null {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const candidate of [join(here, "web"), join(here, "..", "dist", "web")]) {
    if (existsSync(join(candidate, "index.html"))) return candidate;
  }
  return null;
}
