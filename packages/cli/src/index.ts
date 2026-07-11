import { OperationError } from "@kalamu/core";
import { ConflictError, StoreError } from "@kalamu/core/store";
import { Command } from "commander";
import * as commands from "./commands.js";
import { CliError, type CommandResult } from "./context.js";
import { open } from "./open.js";
import { askYesNo, installSkill, isInteractive, offerSkillInstall } from "./skill.js";

// Injected by tsup's `define` from package.json at build time.
declare const __KALAMU_VERSION__: string;

const program = new Command();

program
  .name("kalamu")
  .description("Repo-local outliner for turning developer thoughts into agent-ready tasks")
  .version(__KALAMU_VERSION__);

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

/** Print a CommandResult honouring --format json and the result's exit code. */
function emit(result: CommandResult, options: { format?: string }): void {
  if (options.format === "json") console.log(JSON.stringify(result.json));
  else console.log(result.text);
  if (result.exitCode) process.exitCode = result.exitCode;
}

function run(fn: () => CommandResult, options: { format?: string }): CommandResult | undefined {
  try {
    const result = fn();
    emit(result, options);
    return result;
  } catch (err) {
    if (
      err instanceof CliError ||
      err instanceof OperationError ||
      err instanceof StoreError ||
      err instanceof ConflictError
    ) {
      console.error(`kalamu: ${err.message}`);
      process.exitCode = 1;
      return;
    }
    throw err;
  }
}

program
  .command("init")
  .description("initialise Kalamu in the current directory")
  .option("--tour", "seed a self-guided onboarding outline (fresh outlines only)")
  .option("--no-tour", "never offer the tour")
  .option("--skill", "install the Kalamu agent skill via skills.sh (asks which agents)")
  .option("--no-skill", "never offer the agent-skill install")
  .option("--no-agent-docs", "do not add the standing instruction to CLAUDE.md/AGENTS.md")
  .option("--open", "open the web UI when done (default when run interactively)")
  .option("--no-open", "do not open the web UI")
  .option("--format <format>", "output format (text|json)")
  .action(async (opts: { tour?: boolean; skill?: boolean; agentDocs?: boolean; open?: boolean; format?: string }) => {
    const result = run(() => commands.init(process.cwd(), { agentDocs: opts.agentDocs }), opts);
    if (!result || process.exitCode) return;
    // Humans get offers; agents and scripts (no TTY, JSON mode, or --no-*) never block.
    const interactive = isInteractive() && opts.format !== "json";
    const fresh = (result.json as { created: boolean }).created;
    if (opts.tour === true) {
      run(() => commands.tour(process.cwd()), opts);
    } else if (opts.tour !== false && interactive && fresh) {
      if (await askYesNo("Seed a two-minute tour outline to learn the UI?", true)) {
        run(() => commands.tour(process.cwd()), opts);
      }
    } else if (opts.tour === undefined && !interactive && fresh && opts.format !== "json") {
      console.log("\nNew to Kalamu? `kalamu init --tour` seeds a two-minute tour, then `kalamu open`.");
    }
    if (opts.skill === true) installSkill();
    else if (opts.skill !== false && interactive) await offerSkillInstall();
    // Humans land in the UI; agents and scripts must never end up holding a server.
    if (opts.open === true || (opts.open !== false && interactive)) {
      await open(process.cwd(), {});
    }
  });

program
  .command("open")
  .description("start the local server and open the browser UI")
  .option("--port <port>", "port to listen on (default 4242, auto-increments when taken)")
  .option("--no-browser", "do not open a browser")
  .action(async (opts: { port?: string; browser?: boolean }) => {
    try {
      await open(process.cwd(), opts);
    } catch (err) {
      console.error(`kalamu: ${(err as Error).message}`);
      process.exitCode = 1;
    }
  });

program
  .command("list")
  .description("list outline nodes")
  .option("--tasks", "tasks only")
  .option("--open", "open tasks only")
  .option("--done", "done tasks only")
  .option("--handoff", "handed-off tasks only")
  .option("--assignee <who>", "tasks assigned to human or agent")
  .option("--tag <tag>", "nodes carrying a tag")
  .option("--depth <n>", "limit to the first n levels")
  .option("--format <format>", "output format (text|json)")
  .action((opts: commands.ListOptions & { format?: string }) => {
    run(() => commands.list(process.cwd(), opts), opts);
  });

program
  .command("show <id>")
  .description("show a node")
  .option("--children", "include the node's subtree")
  .option("--depth <n>", "include descendants up to n levels below the node (implies --children)")
  .option("--format <format>", "output format (text|json|markdown)")
  .action((id: string, opts: commands.ShowOptions) => {
    run(() => commands.show(process.cwd(), id, opts), opts);
  });

program
  .command("add")
  .description("add a node")
  .requiredOption("--text <text>", "node text")
  .option("--parent <id>", "parent node (omit for top-level)")
  .option("--kind <kind>", "bullet|task (default bullet)")
  .option("--p <priority>", "priority 1 (urgent) to 5 (low); omit for default 3")
  .option("--tag <tag>", "tag (repeatable)", collect, [])
  .option("--assign <who>", "assign the task: human (excluded from next) or agent")
  .option("--after <id>", "insert after this sibling")
  .option("--before <id>", "insert before this sibling")
  .option("--format <format>", "output format (text|json)")
  .action((opts: commands.AddOptions & { format?: string }) => {
    run(() => commands.add(process.cwd(), opts), opts);
  });

program
  .command("update <id>")
  .description("update a node")
  .option("--text <text>", "new text")
  .option("--kind <kind>", "bullet|task")
  .option("--p <priority>", '1-5 or "default" to clear')
  .option("--add-tag <tag>", "add tag (repeatable)", collect, [])
  .option("--remove-tag <tag>", "remove tag (repeatable)", collect, [])
  .option("--assign <who>", "assign the task: human, agent, or none to clear")
  .option("--format <format>", "output format (text|json)")
  .action((id: string, opts: commands.UpdateOptions & { format?: string }) => {
    run(() => commands.update(process.cwd(), id, opts), opts);
  });

program
  .command("move <id>")
  .description("move a node (subtree moves with it)")
  .option("--parent <id>", 'new parent id, or "root" for top level')
  .option("--after <id>", "position after this sibling")
  .option("--before <id>", "position before this sibling")
  .option("--format <format>", "output format (text|json)")
  .action((id: string, opts: commands.MoveOptions & { format?: string }) => {
    run(() => commands.move(process.cwd(), id, opts), opts);
  });

program
  .command("delete <id>")
  .description("delete a node")
  .option("--recursive", "delete the node's subtree too")
  .option("--format <format>", "output format (text|json)")
  .action((id: string, opts: { recursive?: boolean; format?: string }) => {
    run(() => commands.del(process.cwd(), id, opts), opts);
  });

program
  .command("done <id>")
  .description("mark an item done (on bullets: visual strikethrough only)")
  .option("--format <format>", "output format (text|json)")
  .action((id: string, opts: { format?: string }) => {
    run(() => commands.done(process.cwd(), id), opts);
  });

program
  .command("reopen <id>")
  .description("reopen an item")
  .option("--format <format>", "output format (text|json)")
  .action((id: string, opts: { format?: string }) => {
    run(() => commands.reopen(process.cwd(), id), opts);
  });

program
  .command("handoff <id>")
  .description("record that a task was promoted into another system")
  .requiredOption("--target <target>", "where it went (backlog|github|linear|file|...)")
  .requiredOption("--ref <ref>", "reference in the target system")
  .option("--format <format>", "output format (text|json)")
  .action((id: string, opts: { target: string; ref: string; format?: string }) => {
    run(() => commands.handoff(process.cwd(), id, opts), opts);
  });

program
  .command("unhandoff <id>")
  .description("clear a task's handoff record (it becomes eligible for next again)")
  .option("--format <format>", "output format (text|json)")
  .action((id: string, opts: { format?: string }) => {
    run(() => commands.unhandoff(process.cwd(), id), opts);
  });

program
  .command("search <query>")
  .description("search node text")
  .option("--format <format>", "output format (text|json)")
  .action((query: string, opts: { format?: string }) => {
    run(() => commands.search(process.cwd(), query), opts);
  });

program
  .command("next")
  .description("print the next task for an agent (exit 2 when none)")
  .option("--limit <n>", "print the next n tasks in queue order")
  .option("--all", "print every eligible task in queue order")
  .option("--under <id>", "only consider tasks inside this node's subtree")
  .option("--include-handed-off", "also consider tasks already handed off to another system")
  .option("--format <format>", "output format (text|json)")
  .action((opts: commands.NextCommandOptions & { format?: string }) => {
    run(() => commands.next(process.cwd(), opts), opts);
  });

program
  .command("all")
  .description('print every eligible task in queue order (alias for "next --all")')
  .option("--under <id>", "only consider tasks inside this node's subtree")
  .option("--include-handed-off", "also consider tasks already handed off to another system")
  .option("--format <format>", "output format (text|json)")
  .action((opts: Omit<commands.NextCommandOptions, "all" | "limit"> & { format?: string }) => {
    run(() => commands.next(process.cwd(), { ...opts, all: true }), opts);
  });

program
  .command("clean")
  .description("delete completed tasks (and their subtrees) from the outline")
  .option("--dry-run", "list what would be deleted without writing")
  .option("--format <format>", "output format (text|json)")
  .action((opts: { dryRun?: boolean; format?: string }) => {
    run(() => commands.clean(process.cwd(), opts), opts);
  });

program
  .command("validate")
  .description("validate the outline file (exit 1 when invalid)")
  .option("--format <format>", "output format (text|json)")
  .action((opts: { format?: string }) => {
    run(() => commands.validate(process.cwd()), opts);
  });

program.parseAsync().catch((err: unknown) => {
  console.error(`kalamu: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
