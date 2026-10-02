import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { z } from "zod";

const packageName = z.object({ name: z.string().trim().min(1) });

/**
 * A project's display name — the UI title, the hub sidebar, the registry's
 * slug source: package.json `name` if present, else the root directory's name.
 */
export function projectName(root: string): string {
  try {
    return packageName.parse(JSON.parse(readFileSync(join(root, "package.json"), "utf8"))).name;
  } catch {
    return basename(root); // no package.json, or no usable name in it
  }
}
