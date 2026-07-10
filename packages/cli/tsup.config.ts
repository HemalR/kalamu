import { readFileSync } from "node:fs";
import { defineConfig } from "tsup";

const { version } = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as {
  version: string;
};

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  platform: "node",
  target: "node20",
  clean: true,
  // Bundle everything (including workspace core) so installed users
  // don't inherit our dependency tree.
  noExternal: [/.*/],
  define: {
    // package.json is the single source of truth for the version.
    __KALAMU_VERSION__: JSON.stringify(version),
  },
  banner: {
    // Shebang + CJS interop: bundled CJS deps (commander) call require() at
    // runtime, which does not exist in an ESM entry without this shim.
    js: '#!/usr/bin/env node\nimport { createRequire as __createRequire } from "node:module";\nconst require = __createRequire(import.meta.url);',
  },
});
