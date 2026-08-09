/**
 * How a subtree's counts become dashes in the segmented progress bar.
 *
 * Up to MAX_DASHES units the bar is literal: one dash per unit. Beyond that it
 * buckets, so a hundred-item subtree draws the same width as a ten-item one —
 * the dashes are the shape of the progress, the caption carries the numbers.
 *
 * Pure and unit-tested; the counting itself lives in @kalamu/core's progress.ts.
 */

/** The widest the strip ever gets. Above this, units bucket proportionally. */
export const MAX_DASHES = 20;

export interface DashCounts {
  done: number;
  /** Claimed but unfinished. */
  active: number;
  /** Neither done nor claimed. */
  rest: number;
}

/**
 * Dashes per slice, always summing to `total` (literal mode) or exactly
 * MAX_DASHES (bucketed mode). Buckets use largest-remainder apportionment, then
 * guarantee any non-zero slice at least one dash — "some done" must never draw
 * as "none done".
 */
export function dashCounts(done: number, active: number, total: number): DashCounts {
  const rest = Math.max(total - done - active, 0);
  if (total <= 0) return { done: 0, active: 0, rest: 0 };
  if (total <= MAX_DASHES) return { done, active, rest };

  const sum = done + active + rest;
  const shares = (
    [
      ["done", done],
      ["active", active],
      ["rest", rest],
    ] as const
  ).map(([slice, units]) => {
    const exact = (units * MAX_DASHES) / sum;
    return { slice, units, dashes: Math.floor(exact), fraction: exact % 1 };
  });

  // The floors leave 0–2 dashes over; the largest fractions take them.
  let spare = MAX_DASHES - shares.reduce((n, share) => n + share.dashes, 0);
  for (const share of [...shares].sort((a, b) => b.fraction - a.fraction)) {
    if (spare <= 0) break;
    share.dashes++;
    spare--;
  }

  // A slice that rounded away to nothing borrows from the largest one, which
  // holds at least a third of the strip and can always spare a dash.
  for (const share of shares) {
    if (share.units === 0 || share.dashes > 0) continue;
    shares.reduce((a, b) => (b.dashes > a.dashes ? b : a)).dashes--;
    share.dashes++;
  }

  const out: DashCounts = { done: 0, active: 0, rest: 0 };
  for (const share of shares) out[share.slice] = share.dashes;
  return out;
}
