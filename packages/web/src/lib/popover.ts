/**
 * Attachments shared by every anchored popover (row menus, the tag popover,
 * the filter menu, the hub's colour popover and drawer) and the modal panels'
 * scrolling lists.
 */
import type { Attachment } from "svelte/attachments";

/** Open dismissables, innermost (most recently opened) last. */
const stack: (() => void)[] = [];

/**
 * Escape closes the innermost open popover and nothing else. Listening on
 * `document` in the bubble phase puts this after the focused element's own
 * handlers (an inline rename input cancels itself first) and before App's
 * `window` handler, which skips the event because it is marked handled —
 * otherwise the same press would also clear the tag filter or zoom out.
 */
function onDocumentKeydown(event: KeyboardEvent): void {
  if (event.key !== "Escape" || event.isComposing || event.defaultPrevented) return;
  const close = stack.at(-1);
  if (close === undefined) return;
  event.preventDefault();
  close();
}

/**
 * Whether any dismissable popover is open. A key listener that runs before
 * `document` (the embed's, on its own card) checks this rather than relying
 * on the Escape having been marked handled yet.
 */
export const popoverOpen = (): boolean => stack.length > 0;

/**
 * Close a popover on a pointerdown outside `element`, or on Escape. Attach it
 * to the wrapper holding both the trigger and the popover (so the trigger's
 * own toggle isn't an outside press), and only while open:
 * `{@attach open && dismissable(() => (open = false))}`.
 */
export function dismissable(onclose: () => void): Attachment<HTMLElement> {
  return (element) => {
    // Capture phase: a row's modifier-click chord stops propagation, and must still close menus.
    const onPointerDown = (event: PointerEvent): void => {
      if (event.target instanceof Node && !element.contains(event.target)) onclose();
    };
    const close = (): void => onclose(); // a fresh identity per popover, for the stack
    window.addEventListener("pointerdown", onPointerDown, true);
    if (stack.length === 0) document.addEventListener("keydown", onDocumentKeydown);
    stack.push(close);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      stack.splice(stack.indexOf(close), 1);
      if (stack.length === 0) document.removeEventListener("keydown", onDocumentKeydown);
    };
  };
}

/**
 * Move focus into a popover when it mounts (`pick` chooses the element, the
 * popover itself by default), and hand it back to whatever held it before when
 * the popover closes. Svelte removes the popover's DOM before this teardown
 * runs, so focus that was inside has already fallen to the body; focus that
 * had moved on (Tab out) is left where it went. A click elsewhere that closed
 * the popover still focuses its own target: that happens on mousedown, after.
 */
export function takeFocus(pick: (element: HTMLElement) => HTMLElement | null = (element) => element): Attachment<HTMLElement> {
  return (element) => {
    const previous = document.activeElement;
    pick(element)?.focus();
    return () => {
      const now = document.activeElement;
      const lost = now === null || now === document.body || element.contains(now);
      if (lost && previous instanceof HTMLElement) previous.focus();
    };
  };
}

/** How close to the viewport edge a popover may come. */
const EDGE = 8;

/**
 * Keep an anchored popover on screen: one that would run past the viewport
 * bottom opens upward instead when there is room above, and one that would
 * run past the right edge aligns with its anchor's right edge. Expects the
 * usual placement — `top: calc(100% + gap)` and `left: 0` inside a positioned
 * anchor — and mirrors the gap it finds. Measured once, on open.
 */
export const keepInView: Attachment<HTMLElement> = (element) => {
  const anchor = element.offsetParent?.getBoundingClientRect();
  if (anchor === undefined) return;
  const box = element.getBoundingClientRect();
  const gap = box.top - anchor.bottom;
  if (box.bottom > innerHeight - EDGE && anchor.top - gap - box.height >= EDGE) {
    element.style.top = "auto";
    element.style.bottom = `calc(100% + ${gap}px)`;
  }
  if (box.right > innerWidth - EDGE) {
    element.style.left = "auto";
    element.style.right = "0";
  }
};

/** Height of the fade at a clipped edge. */
const FADE = "24px";

/**
 * Fade whichever edges of a scroll container are clipping content, so a list
 * cut off by its max-height shows there is more. Re-measured on scroll, on
 * resize and whenever the rows change; the mask is set inline, so callers
 * need no styles.
 */
export const scrollFade: Attachment<HTMLElement> = (element) => {
  const update = (): void => {
    const above = element.scrollTop > 1;
    const below = element.scrollTop + element.clientHeight < element.scrollHeight - 1;
    element.style.maskImage =
      above || below
        ? `linear-gradient(${above ? `transparent, black ${FADE}` : "black"}, ${below ? `black calc(100% - ${FADE}), transparent` : "black"})`
        : "";
  };
  update();
  const resized = new ResizeObserver(update);
  resized.observe(element);
  const changed = new MutationObserver(update);
  changed.observe(element, { childList: true, subtree: true });
  element.addEventListener("scroll", update, { passive: true });
  return () => {
    resized.disconnect();
    changed.disconnect();
    element.removeEventListener("scroll", update);
  };
};
