/**
 * The wall clock, as a reactive value. Relative timestamps have to age on their
 * own — a `$derived` that closes over `new Date()` never re-runs, so a window
 * left open all day would keep reading "now" — and there is one row per node,
 * so a timer per row would be hundreds of them. Everything that renders a
 * relative time reads this single ticking value instead.
 */

/** Well under a minute, so the coarsest unit we print is never visibly stale. */
const TICK_MS = 30_000;

let ticks = $state(0);

setInterval(() => {
  ticks++;
}, TICK_MS);

export const now = {
  /**
   * Milliseconds since the epoch, read fresh. The tick is only the repaint
   * signal: subscribing to it is what re-runs the caller, but the answer comes
   * from the clock, so a node created between two ticks is never dated into
   * the future.
   */
  get current(): number {
    void ticks;
    return Date.now();
  },
};
