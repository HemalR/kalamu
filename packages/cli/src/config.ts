/**
 * Machine-global CLI settings at ~/.kalamu/config.json — plumbing, never
 * canonical outline data (like the hub registry). A corrupt or missing file
 * always reads as defaults.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { resolveEditorTemplate } from "./editor.js";
import { DEFAULT_HUB_BASE_URL } from "./hub-url.js";

/** ~/.kalamu — machine-global state dir. KALAMU_HOME overrides it for tests. */
export function kalamuHome(): string {
  return process.env.KALAMU_HOME ?? join(homedir(), ".kalamu");
}

export interface Config {
  /** false disables the npm update check (default on). */
  updateCheck?: boolean;
  /** true once the one-time "we check npm" notice has been shown. */
  updateNoticeSeen?: boolean;
  /** Machine-local base address used for shareable hub node links. */
  baseUrl?: string;
  /** Editor preset name or `{path}` URL template for `@file` references. */
  editor?: string;
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
 * Normalize a configured hub base URL. Only ordinary HTTP(S) addresses are
 * accepted: credentials could leak through a pasted link, while query/hash
 * components would conflict with Kalamu's own project path and zoom hash.
 */
export function normalizeBaseUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.username !== "" || url.password !== "" || url.search !== "" || url.hash !== "") return null;
    return url.toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
}

/** Configured link base, or the default hub address for old/unconfigured installs. */
export function hubBaseUrl(): string {
  const configured = readConfig().baseUrl;
  return typeof configured === "string" ? (normalizeBaseUrl(configured) ?? DEFAULT_HUB_BASE_URL) : DEFAULT_HUB_BASE_URL;
}

/**
 * The configured editor deep-link template, or null when unset (or set to a
 * value that no longer resolves). The web UI turns `@path` chips into links
 * with it; without one, a chip click explains how to configure it.
 */
export function editorTemplate(): string | null {
  const configured = readConfig().editor;
  return typeof configured === "string" ? resolveEditorTemplate(configured) : null;
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
