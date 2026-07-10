<!--
  Shared modal backdrop: centers the caller's panel, closes on a click outside
  it, and owns Escape for the whole app while mounted. Escape is handled in the
  window's CAPTURE phase so one press works no matter where focus sits (panel,
  body after a stray Tab, …) and so exactly one layer interprets it — App's
  window handler never sees it.

  The overlay also closes when focus LEAVES its subtree while the window stays
  focused. Extensions like Vimium blur focused inputs on Escape and swallow the
  keypress before any page listener (capture included) can see it — this turns
  that blur into a one-press close instead of a stranded palette. Callers must
  put tabindex="-1" on their panel so clicks on non-focusable panel content
  keep focus inside the subtree.
-->
<script lang="ts">
  import type { Snippet } from "svelte";

  interface Props {
    children: Snippet;
    onclose: () => void;
    /** What Escape does instead of closing (the palette steps back a level). */
    onescape?: () => void;
    /** What a focus-leave does instead of closing; `movedTo` is where focus
     * went — null when it fell to the body. */
    onfocusleave?: (movedTo: Element | null) => void;
    /** Gap between the viewport top and the panel. */
    top?: string;
  }

  let { children, onclose, onescape, onfocusleave, top = "6vh" }: Props = $props();

  function onKeydownCapture(event: KeyboardEvent): void {
    if (event.key !== "Escape" || event.isComposing) return;
    event.preventDefault();
    event.stopPropagation();
    (onescape ?? onclose)();
  }

  function onPointerDown(event: PointerEvent): void {
    if (event.target === event.currentTarget) onclose();
  }

  function onFocusOut(event: FocusEvent): void {
    const root = event.currentTarget;
    if (!(root instanceof Node)) return;
    // Cmd+Tab / window blur also blurs the panel; only act while the page keeps focus.
    if (!document.hasFocus()) return;
    const to = event.relatedTarget;
    if (to instanceof Node && root.contains(to)) return;
    const movedTo = to instanceof Element ? to : null;
    // The overlay's own teardown blurs its contents too (Chromium fires
    // focusout while removing the focused element) — acting on that would
    // re-close whatever replaced this overlay. Defer a microtask so teardown
    // finishes, then only treat a still-mounted overlay as a real focus-leave.
    queueMicrotask(() => {
      if (!root.isConnected) return;
      if (onfocusleave) onfocusleave(movedTo);
      else onclose();
    });
  }
</script>

<svelte:window onkeydowncapture={onKeydownCapture} />

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="overlay" style:padding-top={top} onpointerdown={onPointerDown} onfocusout={onFocusOut}>
  {@render children()}
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 30;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding: 0 16px 16px;
    background: rgba(0, 0, 0, 0.35);
  }
</style>
