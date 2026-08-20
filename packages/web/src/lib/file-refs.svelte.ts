/**
 * Repo file references (`@src/lib/caret.ts`): the path list behind the `@`
 * picker, and the editor deep link behind a rendered file chip. One module-level
 * singleton because the list is per-repo, not per-node — hundreds of rows must
 * not each fetch it.
 */
import { api, type ProjectInfo } from "./api";

/** Most matches a caret menu can usefully show. */
const MAX_MATCHES = 12;

// State, not plain variables: /api/project resolves after the first render, so
// chips already on screen have to pick the editor link up when it lands.
let repoRoot = $state("");
let editorTemplate = $state<string | null>(null);
let paths = $state<string[]>([]);
/** Set on the first load() so a repeat or concurrent call is a no-op. */
let requested = false;

function rank(path: string, query: string): number {
  const base = path.slice(path.lastIndexOf("/") + 1).toLowerCase();
  if (base.startsWith(query)) return 0;
  if (base.includes(query)) return 1;
  return path.toLowerCase().includes(query) ? 2 : -1;
}

export const fileRefs = {
  /** Record the repo details the chips need; called once, when /api/project lands. */
  configure(project: ProjectInfo): void {
    repoRoot = project.repoRoot;
    editorTemplate = project.editorTemplate;
  },

  /**
   * The configured editor's URL for a repo-relative path, or null when the
   * human hasn't run `kalamu config editor <name>`. Editors want an absolute
   * path; encodeURI keeps the separators and escapes spaces. The path is
   * normalised to forward slashes with exactly one leading slash so a single
   * preset works everywhere — `vscode://file` + `/repo/a.ts` is the documented
   * shape, and a Windows root becomes `/C:/repo/a.ts` rather than breaking it.
   */
  editorUrl(path: string): string | null {
    if (editorTemplate === null) return null;
    const absolute = `${repoRoot}/${path}`.replaceAll("\\", "/");
    return editorTemplate.replaceAll("{path}", encodeURI(absolute.startsWith("/") ? absolute : `/${absolute}`));
  },

  get files(): string[] {
    return paths;
  },

  /** Fetch the repo's tracked paths at most once per session. */
  load(): void {
    if (requested) return;
    requested = true;
    void api
      .getFiles()
      .then((result) => {
        paths = result.files;
      })
      .catch(() => {
        // No file list is a degraded picker, never a broken editor.
      });
  },

  /**
   * Paths matching `filter`, best first: basename prefix, then basename
   * substring, then anywhere in the path. An empty filter is the head of the list.
   */
  match(filter: string): string[] {
    const query = filter.toLowerCase();
    if (query === "") return paths.slice(0, MAX_MATCHES);
    const scored: { path: string; score: number }[] = [];
    for (const path of paths) {
      const score = rank(path, query);
      if (score !== -1) scored.push({ path, score });
    }
    return scored
      .sort((a, b) => a.score - b.score)
      .slice(0, MAX_MATCHES)
      .map((entry) => entry.path);
  },
};
