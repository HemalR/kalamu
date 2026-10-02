/**
 * Layout breakpoints, for MediaQuery (svelte/reactivity) in script. CSS media
 * queries cannot read custom properties, so stylesheets repeat these literals
 * with a comment pointing here — change both together.
 */

/**
 * Below this the hub's project sidebar collapses into a drawer. 800px is where
 * the 230px column still leaves the outline ~500px of text — a portrait
 * tablet keeps its sidebar.
 */
export const DRAWER_QUERY = "max-width: 799.98px";

/** Phones: tighter outline indent, page padding and row furniture. */
export const PHONE_QUERY = "max-width: 639.98px";
