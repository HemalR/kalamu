/**
 * Machine-global CLI settings at ~/.kalamu/config.json — plumbing, never
 * canonical outline data (like the hub registry). Today it holds only the
 * update-check opt-out; a corrupt or missing file always reads as defaults.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** ~/.kalamu — machine-global state dir. KALAMU_HOME overrides it for tests. */
export function kalamuHome(): string {
  return process.env.KALAMU_HOME ?? join(homedir(), ".kalamu");
}

export interface Config {
  /** false disables the npm update check (default on). */
  updateCheck?: boolean;
  /** true once the one-time "we check npm" notice has been shown. */
  updateNoticeSeen?: boolean;
}

function configFile(): string {
  return join(kalamuHome(), "config.json");
}

export function readConfig(): Config {
  try {
    const parsed: unknown = JSON.parse(readFileSync(configFile(), "utf8"));
    if (parsed !== null && typeof parsed === "object") return parsed as Config;
  } catch {
    // missing or corrupt → defaults
  }
  return {};
}

export function writeConfig(config: Config): void {
  const file = configFile();
  mkdirSync(kalamuHome(), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  renameSync(temp, file);
}

/**
 * Whether the update check may touch the network. Off when
 * KALAMU_NO_UPDATE_CHECK is set, in CI, or when the config opts out; on by
 * default (SPEC key decision 14).
 */
export function updateCheckEnabled(): boolean {
  if (process.env.KALAMU_NO_UPDATE_CHECK) return false;
  if (process.env.CI) return false;
  return readConfig().updateCheck !== false;
}
