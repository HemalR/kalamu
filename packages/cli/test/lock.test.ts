import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isAlive, readLock, removeLock, stopPid, writeLock } from "../src/lock.js";

let base: string;
let lockPath: string;

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "kalamu-lock-"));
  lockPath = join(base, "server.lock");
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

describe("lock file round-trip", () => {
  it("writes and reads back a lock", () => {
    writeLock(lockPath, { pid: 123, port: 4242 });
    expect(readLock(lockPath)).toEqual({ pid: 123, port: 4242 });
  });

  it("returns null for a missing file", () => {
    expect(readLock(join(base, "nope.lock"))).toBeNull();
  });

  it("returns null for malformed contents", () => {
    writeLock(lockPath, { pid: 123, port: 4242 });
    // Overwrite with something that isn't a valid lock.
    writeLock(lockPath, {} as never);
    expect(readLock(lockPath)).toBeNull();
  });

  it("removeLock is a no-op when the file is already gone", () => {
    expect(() => removeLock(join(base, "nope.lock"))).not.toThrow();
  });
});

describe("isAlive", () => {
  it("is true for the current process", () => {
    expect(isAlive(process.pid)).toBe(true);
  });

  it("is false for a pid nothing is using", () => {
    // Not a guaranteed-free pid on every OS, but 2**30 is astronomically
    // unlikely to be a running process during a test run.
    expect(isAlive(2 ** 30)).toBe(false);
  });
});

describe("stopPid", () => {
  let child: ChildProcess | undefined;

  afterEach(() => {
    if (child && child.pid !== undefined && isAlive(child.pid)) process.kill(child.pid, "SIGKILL");
  });

  it("stops a real running process and resolves true", async () => {
    child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
    await new Promise((resolve) => child?.once("spawn", resolve));
    const pid = child.pid;
    if (pid === undefined) throw new Error("child did not get a pid");
    expect(isAlive(pid)).toBe(true);
    expect(await stopPid(pid)).toBe(true);
    expect(isAlive(pid)).toBe(false);
  });

  it("resolves true immediately for an already-dead pid", async () => {
    expect(await stopPid(2 ** 30)).toBe(true);
  });
});
