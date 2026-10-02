/**
 * Outline-wide keys, shared by App (a window listener) and the landing-page
 * embed (a listener on its own card). Overlay openers are the caller's: a
 * surface without a cheat sheet or Find leaves those keys to the browser.
 */
import type { OutlineStore } from "./outline.svelte";
import { popoverOpen } from "./popover";
import { matches, SHORTCUTS as S } from "./shortcuts";

export interface OverlayOpeners {
  palette: () => void;
  /** Mod+/ toggles (`toggle` true); `?` outside a text field only opens. */
  help?: (toggle: boolean) => void;
  find?: () => void;
}

/** Text fields own their keystrokes: `?` types, and Mod+Z undoes the field's own edit. */
function isTextField(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

/**
 * Handle one keydown; the caller skips this while an overlay owns the keyboard.
 * An event something nearer already handled (defaultPrevented — e.g. Escape
 * closing a popover, see lib/popover.ts) is left alone.
 */
export function handleGlobalKeys(event: KeyboardEvent, store: OutlineStore, open: OverlayOpeners): void {
  if (event.isComposing || event.defaultPrevented) return;
  const claim = (action: () => void): void => {
    event.preventDefault();
    action();
  };
  // These work from anywhere, including mid-edit.
  if (open.help && matches(event, S.help)) return claim(() => open.help?.(true));
  // The palette acts on the last-focused node, so it needs none focused now.
  if (matches(event, S.palette)) return claim(open.palette);
  // Pressed again while Find is open it falls through to the browser's own find
  // (Find stops propagation and nothing prevents the default).
  if (open.find && matches(event, S.find)) return claim(open.find);
  if (matches(event, S.toggleHideDone)) return claim(() => store.toggleHideDone());
  if (matches(event, S.zoomOut)) return claim(() => store.zoomOut());

  if (isTextField(event.target)) return;
  // From here on: nothing is being typed into.
  if (event.key === "Escape") {
    // An open popover takes this Escape (lib/popover.ts) — and on the embed
    // this listener runs first, before it is marked handled.
    if (popoverOpen()) return;
    // Escape cascade: clear the tag filter first, then the zoom.
    if (store.filterTag !== null) store.setFilter(null);
    else if (store.zoomNode !== null) store.setZoom(null);
    return;
  }
  if (open.help && event.key === "?" && !event.metaKey && !event.ctrlKey) return claim(() => open.help?.(false));
  if (matches(event, S.redo)) return claim(() => store.redo());
  if (matches(event, S.undo)) return claim(() => store.undo());
}
