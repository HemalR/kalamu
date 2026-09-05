/**
 * Installed-app launches. The manifest declares `launch_handler:
 * focus-existing`, so once the hub is installed as an app (and "open supported
 * links" is on), clicking a Kalamu deep link outside the browser focuses the
 * one existing Kalamu window and queues the URL here instead of opening yet
 * another tab. Pure planning is separate from the DOM glue so it can be tested.
 */

export type LaunchStep =
  /** A different project (or the hub root): full navigation, like the sidebar. */
  | { kind: "navigate"; href: string }
  /** Same project: the hash is zoom's only state, so applying it is the whole jump. */
  | { kind: "zoom"; hash: string }
  | { kind: "noop" };

export function planLaunch(target: URL, current: URL): LaunchStep {
  if (target.origin !== current.origin || target.pathname !== current.pathname) {
    return { kind: "navigate", href: target.href };
  }
  return target.hash === current.hash ? { kind: "noop" } : { kind: "zoom", hash: target.hash };
}

// `launchQueue` is not in lib.dom yet; this is the slice of the spec we use.
interface LaunchParams {
  readonly targetURL: string | null;
}
interface LaunchQueue {
  setConsumer(consumer: (params: LaunchParams) => void): void;
}

/** Hands every launch URL to `onLaunch`; a no-op where launchQueue is unsupported (plain tabs, Safari). */
export function consumeLaunches(onLaunch: (target: URL) => void): void {
  const queue = (window as Window & { launchQueue?: LaunchQueue }).launchQueue;
  queue?.setConsumer(({ targetURL }) => {
    if (targetURL !== null) onLaunch(new URL(targetURL));
  });
}
