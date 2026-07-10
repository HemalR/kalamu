import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  platform: "node",
  target: "node20",
  clean: true,
  // Bundle everything (including workspace core) so installed users
  // don't inherit our dependency tree.
  noExternal: [/.*/],
  banner: {
    // Shebang + CJS interop: bundled CJS deps (commander) call require() at
    // runtime, which does not exist in an ESM entry without this shim.
    js: '#!/usr/bin/env node\nimport { createRequire as __createRequire } from "node:module";\nconst require = __createRequire(import.meta.url);',
  },
});
