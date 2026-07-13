// The build (tsup `define`) replaces __KALAMU_VERSION__ with package.json's
// version literal. Under Vitest there is no define, so `typeof` guards the
// bare reference — the true branch is never evaluated there. Tests that need a
// real version pass one explicitly to the update-check functions.
declare const __KALAMU_VERSION__: string;

export const CURRENT_VERSION: string =
  typeof __KALAMU_VERSION__ === "string" ? __KALAMU_VERSION__ : "0.0.0";
