<script lang="ts">
  /**
   * The Kalamu wordmark: the fanned-k mark doubles as the "k", "alamu"
   * completes the word. The mark reads as a tiny outline — a bullet on the
   * stem, a checkbox nested beneath — and inherits the brand accent (--brand).
   * `size` is the "alamu" font-size in px; the mark scales from it.
   */
  let { size = 14 }: { size?: number } = $props();
</script>

<span class="wordmark" aria-label="kalamu" style:--wm-size={`${size}px`}>
  <svg class="mark" viewBox="18 13 66 75" aria-hidden="true">
    <g fill="none" stroke="currentColor" stroke-width="7" stroke-linecap="round">
      <path d="M30 18 L30 84" />
      <path d="M34 51 L78 20" />
      <path d="M56 63 L82 82" />
    </g>
    <circle cx="30" cy="47" r="8" fill="currentColor" />
    <rect x="39" y="54.5" width="15" height="15" rx="3.5" fill="none" stroke="currentColor" stroke-width="6" />
  </svg><span class="rest">alamu</span>
</span>

<style>
  .wordmark {
    display: inline-block;
    font-size: var(--wm-size);
    line-height: 1;
    color: var(--fg);
    white-space: nowrap;
  }
  /* Inline SVG: its bottom edge sits on the text baseline, and the viewBox is
     cropped to the stem's foot — so the k rests on the baseline like a glyph. */
  .mark {
    height: calc(var(--wm-size) * 0.92);
    width: auto;
    /* --mark is set to the active project's colour in the hub; falls back to
       the bronze brand when there's no project (standalone / hub default). */
    color: var(--mark, var(--brand));
    vertical-align: baseline;
  }
  /* Monospace, echoing the outline text; kerned just under the mark's arm. */
  .rest {
    font-family: ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, monospace;
    font-weight: 500;
    letter-spacing: -0.01em;
    margin-left: 0.12em;
  }
</style>
