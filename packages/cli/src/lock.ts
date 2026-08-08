/**
 * PID lock files, so `kalamu stop` can find and stop a `kalamu open`/`kalamu
 * hub` server left running in a terminal tab nobody remembers. Written by the
 * server on startup, removed on graceful shutdown; a lock whose pid is no
 * longer alive is stale (a crash, a `kill -9`) and is cleaned up on sight.
 */
import { readFileSync, unlinkSync, writeFileSync } from "node:fs";

export interface Lock {
  pid: number;
  port: number;
}

export function writeLock(path: string, lock: Lock): void {
  writeFileSync(path, JSON.stringify(lock));
}

export function readLock(path: string): Lock | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
  if (
    parsed === null ||
    typeof parsed !== "object" ||
    typeof (parsed as Lock).pid !== "number" ||
    typeof (parsed as Lock).port !== "number"
  ) {
    return null;
  }
  return parsed as Lock;
}

export function removeLock(path: string): void {
  try {
    unlinkSync(path);
  } catch {
    // already gone
  }
}

export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * SIGTERM then poll for exit. Returns true once the process is confirmed
 * gone (including if it was already gone), false if it outlives `timeoutMs`.
 */
export async function stopPid(pid: number, timeoutMs = 3000): Promise<boolean> {
  if (!isAlive(pid)) return true;
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    return true; // died between the check and the signal
  }
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (!isAlive(pid)) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}
