/**
 * Dark/light mode. Follows the system until the user explicitly toggles;
 * the override lives in localStorage (per-browser view state, never in
 * .kalamu/) and is applied as `data-theme` on <html> for app.css to pick up.
 */
import { MediaQuery } from "svelte/reactivity";

const STORAGE_KEY = "kalamu-theme";

type Mode = "light" | "dark";

function storedOverride(): Mode | null {
  const value = localStorage.getItem(STORAGE_KEY);
  return value === "light" || value === "dark" ? value : null;
}

const systemDark = new MediaQuery("(prefers-color-scheme: dark)");

let override = $state<Mode | null>(storedOverride());

// Apply a stored override immediately so CSS never flashes the system theme.
if (override !== null) document.documentElement.dataset.theme = override;

export const theme = {
  /** Effective mode: the explicit override if set, otherwise the system's. */
  get mode(): Mode {
    return override ?? (systemDark.current ? "dark" : "light");
  },
  toggle(): void {
    override = this.mode === "dark" ? "light" : "dark";
    localStorage.setItem(STORAGE_KEY, override);
    document.documentElement.dataset.theme = override;
  },
};
