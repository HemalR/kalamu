import { initKalamu, pathsFor } from "@kalamu/core/store";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isAlive, readLock, writeLock } from "../src/lock.js";
import { stopKalamu } from "../src/stop.js";

let base: string;
let logs: string[];

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "kalamu-stop-"));
  logs = [];
  vi.spyOn(console, "log").mockImplementation((msg: string) => {
    logs.push(msg);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(base, { recursive: true, force: true });
});

describe("stopKalamu", () => {
  it("reports nothing running when there is no project and no hub lock", async () => {
    const empty = join(base, "nowhere");
    await stopKalamu(empty);
    expect(logs[0]).toMatch(/no kalamu server was found running/i);
  });

  it("reports nothing running for a project with no lock file", async () => {
    const root = join(base, "project");
    initKalamu(root);
    await stopKalamu(root);
    expect(logs[0]).toMatch(/no kalamu server is running for this project/i);
  });

  it("cleans up a stale lock (process already dead) and reports nothing running", async () => {
    const root = join(base, "project");
    initKalamu(root);
    const lockPath = join(pathsFor(root).dir, "server.lock");
    writeLock(lockPath, { pid: 2 ** 30, port: 4242 });
    await stopKalamu(root);
    expect(readLock(lockPath)).toBeNull();
    expect(logs[0]).toMatch(/no kalamu server is running for this project/i);
  });

  it("stops a live project server and removes its lock", async () => {
    const root = join(base, "project");
    initKalamu(root);
    const lockPath = join(pathsFor(root).dir, "server.lock");
    const child: ChildProcess = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
    await new Promise((resolve) => child.once("spawn", resolve));
    const pid = child.pid;
    if (pid === undefined) throw new Error("child did not get a pid");
    writeLock(lockPath, { pid, port: 4242 });

    await stopKalamu(root);

    expect(isAlive(pid)).toBe(false);
    expect(readLock(lockPath)).toBeNull();
    expect(logs[0]).toMatch(/stopped the kalamu server for this project/i);
    expect(logs[0]).toContain("4242");
  });

  it("falls back to stopping a foreground hub when no project is found", async () => {
    const home = join(base, "home");
    mkdirSync(home, { recursive: true });
    process.env.KALAMU_HOME = home;
    try {
      const child: ChildProcess = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
      await new Promise((resolve) => child.once("spawn", resolve));
      const pid = child.pid;
      if (pid === undefined) throw new Error("child did not get a pid");
      writeLock(join(home, "hub.lock"), { pid, port: 4400 });

      await stopKalamu(join(base, "nowhere"));

      expect(isAlive(pid)).toBe(false);
      expect(logs[0]).toMatch(/stopped the kalamu hub/i);
    } finally {
      delete process.env.KALAMU_HOME;
    }
  });
});
