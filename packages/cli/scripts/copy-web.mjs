// Ship the compiled web assets inside the CLI package (SPEC: single published package).
import { cpSync, existsSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const webDist = join(here, "..", "..", "web", "dist");
const target = join(here, "..", "dist", "web");

rmSync(target, { recursive: true, force: true });
if (existsSync(webDist)) {
  cpSync(webDist, target, { recursive: true });
  console.log(`copied web assets -> ${target}`);
} else {
  console.warn("web assets not built yet (packages/web/dist missing); `kalamu open` will serve API only");
}

// The repo README/LICENSE are the package's (npm reads them from the package dir).
for (const file of ["README.md", "LICENSE"]) {
  const source = join(here, "..", "..", "..", file);
  if (existsSync(source)) cpSync(source, join(here, "..", file));
}
