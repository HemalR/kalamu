/** Human-facing CLI operations for inspecting and pruning the hub registry. */
import type { CommandResult } from "./context.js";
import { CliError } from "./context.js";
import { readRegistry, unregisterProject } from "./registry.js";

export function listHubProjects(): CommandResult {
  const projects = readRegistry().projects.map(({ slug, path }) => ({ slug, path }));
  return {
    text:
      projects.length === 0
        ? "No projects registered."
        : projects.map(({ slug, path }) => `${slug}\t${path}`).join("\n"),
    json: { projects },
  };
}

export function forgetHubProject(slug: string | undefined): CommandResult {
  if (slug === undefined) throw new CliError("hub forget requires a project slug (run `kalamu hub list` to find it)");
  const entry = readRegistry().projects.find((project) => project.slug === slug);
  if (!entry || !unregisterProject(slug)) throw new CliError(`no registered project "${slug}"`);
  return {
    text:
      `Forgot ${slug} (${entry.path}). Project data was not changed; ` +
      "the next Kalamu command run there will register it again.",
    json: { slug, path: entry.path, forgotten: true },
  };
}
