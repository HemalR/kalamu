/**
 * npm update check (SPEC key decision 14). A single outbound call to the npm
 * registry, throttled to about once a day via a ~/.kalamu cache, surfaced as a
 * CLI banner and a web/hub chip. Default-on with opt-out (see config.ts).
 *
 * Everything here is best-effort: offline, a slow registry, a corrupt cache or
 * an opt-out all degrade to "no update known" and never throw. The comparison
 * the caller displays comes from the cache (instant, sync); the network only
 * refreshes that cache for next time.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { get } from "node:https";
import { dirname, join } from "node:path";
import { kalamuHome, updateCheckEnabled } from "./config.js";

const REGISTRY_URL = "https://registry.npmjs.org/kalamu/latest";
const TTL_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 2000;

function cacheFile(): string {
  return join(kalamuHome(), "update-check.json");
}

interface Cache {
  /** epoch ms of the last registry read attempt (success or failure). */
  checkedAt: number;
  /** latest version from npm, or null if never fetched successfully. */
  latest: string | null;
}

export interface UpdateInfo {
  current: string;
  latest: string | null;
  updateAvailable: boolean;
}

/** "x.y.z" → [x,y,z]; null for pre-release/build or non-numeric versions. */
function parseVersion(v: string): [number, number, number] | null {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v.trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** True when `latest` is strictly newer than `current` (both plain x.y.z). */
export function isNewer(latest: string, current: string): boolean {
  const a = parseVersion(latest);
  const b = parseVersion(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return false;
}

function toInfo(current: string, latest: string | null): UpdateInfo {
  return { current, latest, updateAvailable: latest !== null && isNewer(latest, current) };
}

function readCache(file: string): Cache | null {
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as Partial<Cache>;
    if (typeof parsed.checkedAt === "number") {
      return { checkedAt: parsed.checkedAt, latest: typeof parsed.latest === "string" ? parsed.latest : null };
    }
  } catch {
    // missing or corrupt → no cache
  }
  return null;
}

function writeCache(file: string, cache: Cache): void {
  try {
    mkdirSync(dirname(file), { recursive: true });
    const temp = `${file}.${process.pid}.tmp`;
    writeFileSync(temp, JSON.stringify(cache), "utf8");
    renameSync(temp, file);
  } catch {
    // cache is best-effort; a write failure just means we re-check next time
  }
}

/** GET the registry's `latest` version; resolves null on any failure. */
function fetchLatest(): Promise<string | null> {
  return new Promise((resolve) => {
    const req = get(REGISTRY_URL, { timeout: FETCH_TIMEOUT_MS, headers: { accept: "application/json" } }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        resolve(null);
        return;
      }
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => {
        try {
          const version = (JSON.parse(body) as { version?: unknown }).version;
          resolve(typeof version === "string" ? version : null);
        } catch {
          resolve(null);
        }
      });
    });
    req.on("timeout", () => req.destroy());
    req.on("error", () => resolve(null));
  });
}

/** Sync, no network: the comparison from whatever the cache already holds. */
export function cachedUpdate(current: string, file = cacheFile()): UpdateInfo {
  return toInfo(current, readCache(file)?.latest ?? null);
}

interface RefreshOptions {
  file?: string;
  now?: number;
  fetchImpl?: () => Promise<string | null>;
}

/**
 * Return the current comparison, first refreshing the cache from npm when it is
 * stale (older than a day). No-op returning "no update" when the check is
 * disabled. Never throws or rejects. `now`/`file`/`fetchImpl` are injectable
 * for tests.
 */
export async function refreshUpdate(current: string, opts: RefreshOptions = {}): Promise<UpdateInfo> {
  if (!updateCheckEnabled()) return toInfo(current, null);
  const file = opts.file ?? cacheFile();
  const now = opts.now ?? Date.now();
  const cache = readCache(file);
  if (cache && now - cache.checkedAt < TTL_MS) return toInfo(current, cache.latest);
  const latest = await (opts.fetchImpl ?? fetchLatest)();
  // Stamp the attempt even on failure so a flaky registry doesn't get hit every
  // run; keep the last known version when this fetch came back empty.
  const resolved = latest ?? cache?.latest ?? null;
  writeCache(file, { checkedAt: now, latest: resolved });
  return toInfo(current, resolved);
}
