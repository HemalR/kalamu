/**
 * `kalamu stop` — stop a server left running in a terminal tab nobody
 * remembers: this project's standalone `kalamu open` server first, then a
 * foreground `kalamu hub`. A launchd-installed hub is left alone; KeepAlive
 * would just relaunch it, so that's `kalamu hub uninstall` territory instead.
 */
import { findRoot, pathsFor } from "@kalamu/core/store";
import { join } from "node:path";
import { hubAgentInstalled, hubLaunchAgentPlist } from "./launch.js";
import { hubLockPath } from "./hub.js";
import { isAlive, readLock, removeLock, stopPid } from "./lock.js";

async function stopLock(path: string, describe: (port: number, pid: number) => string): Promise<boolean> {
  const lock = readLock(path);
  if (!lock) return false;
  if (!isAlive(lock.pid)) {
    removeLock(path);
    return false;
  }
  const stopped = await stopPid(lock.pid);
  removeLock(path);
  console.log(
    stopped
      ? `Stopped ${describe(lock.port, lock.pid)}`
      : `Sent a stop signal to ${describe(lock.port, lock.pid)} but it didn't exit in time — check it manually`,
  );
  return true;
}

export async function stopKalamu(cwd: string, launchAgentPlist = hubLaunchAgentPlist()): Promise<void> {
  const root = findRoot(cwd);

  if (root) {
    const stopped = await stopLock(
      join(pathsFor(root).dir, "server.lock"),
      (port, pid) => `the kalamu server for this project (was on http://127.0.0.1:${port}, pid ${pid})`,
    );
    if (stopped) return;
  }

  if (hubAgentInstalled(launchAgentPlist)) {
    console.log(
      "A kalamu hub is installed as a login item — use `kalamu hub uninstall` (or `kalamu restart` to keep it, just refreshed) instead of stop.",
    );
    return;
  }

  const stoppedHub = await stopLock(
    hubLockPath(),
    (port, pid) => `the kalamu hub (was on http://127.0.0.1:${port}, pid ${pid})`,
  );
  if (stoppedHub) return;

  console.log(
    root
      ? "No kalamu server is running for this project, and no foreground hub was found."
      : "No kalamu server was found running in the foreground.",
  );
}
