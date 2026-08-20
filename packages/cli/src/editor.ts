/**
 * Editor deep links for `@path` file references (SPEC key decision 19).
 * Which editor to open is a per-developer preference, not repo content, so it
 * lives in the machine-global config (~/.kalamu/config.json) alongside the
 * other plumbing — never in meta.json.
 *
 * A template is any URL containing `{path}`, which is replaced with the file's
 * absolute path — forward slashes, always leading with one, so the presets read
 * the same on every platform (`/repo/src/a.ts`, `/C:/repo/src/a.ts`). Presets
 * cover the common editors; anything else can be typed out in full.
 *
 * The URL itself is built in the web UI (packages/web/src/lib/file-refs.svelte.ts),
 * which is where the chips live; this module only resolves and validates.
 */

import { createInterface } from "node:readline/promises";

/** Known editors, by the name accepted by `kalamu config editor <name>`. */
export const EDITOR_PRESETS = {
  vscode: "vscode://file{path}",
  cursor: "cursor://file{path}",
  windsurf: "windsurf://file{path}",
  zed: "zed://file{path}",
  sublime: "subl://open?url=file://{path}",
  textmate: "txmt://open?url=file://{path}",
  idea: "idea://open?file={path}",
  webstorm: "webstorm://open?file={path}",
} as const satisfies Record<string, string>;

export type EditorPreset = keyof typeof EDITOR_PRESETS;

/** Schemes that would turn a node's file chip into script execution. */
const UNSAFE_SCHEME = /^(?:javascript|data|vbscript):/i;

/**
 * What `kalamu init` offers, in order — the editors a solo developer is most
 * likely to be running. The rest of EDITOR_PRESETS stays reachable through
 * `kalamu config editor <name>`; a menu of eight is a wall, not a choice.
 */
export const EDITOR_CHOICES = [
  { preset: "vscode", label: "VS Code" },
  { preset: "cursor", label: "Cursor" },
  { preset: "zed", label: "Zed" },
  { preset: "windsurf", label: "Windsurf" },
  { preset: "sublime", label: "Sublime Text" },
] as const satisfies readonly { preset: EditorPreset; label: string }[];

export function isEditorPreset(value: string): value is EditorPreset {
  return Object.hasOwn(EDITOR_PRESETS, value);
}

/**
 * Resolve a configured value (preset name or raw template) to a URL template,
 * or null when it is neither. Custom templates must carry `{path}` and use an
 * ordinary scheme — the result becomes an href in the web UI.
 */
export function resolveEditorTemplate(value: string): string | null {
  const trimmed = value.trim();
  if (isEditorPreset(trimmed)) return EDITOR_PRESETS[trimmed];
  if (!trimmed.includes("{path}")) return null;
  if (UNSAFE_SCHEME.test(trimmed)) return null;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return null;
  return trimmed;
}

/**
 * Ask which editor `@file` references should open in. Interactive init only —
 * the caller gates on a TTY. Enter takes the first choice (VS Code); anything
 * unrecognised, or EOF, declines rather than guessing.
 */
export async function askEditorPreset(): Promise<EditorPreset | null> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const menu = EDITOR_CHOICES.map((choice, i) => `  ${i + 1}) ${choice.label}`).join("\n");
  try {
    console.log(`\nWhich editor should @file references open in?\n${menu}\n  s) Skip — set it later with \`kalamu config editor <name>\``);
    const answer = (await rl.question(`Choose [1-${EDITOR_CHOICES.length}, default 1]: `)).trim();
    if (answer === "") return EDITOR_CHOICES[0].preset;
    const index = Number(answer);
    return Number.isInteger(index) && index >= 1 && index <= EDITOR_CHOICES.length
      ? EDITOR_CHOICES[index - 1]!.preset
      : null;
  } catch {
    return null; // EOF (Ctrl+D) skips rather than crashing
  } finally {
    rl.close();
  }
}
