import { OperationError } from "@kalamu/core";
import { ConflictError, findRoot, StoreError } from "@kalamu/core/store";
import { Command } from "commander";
import * as commands from "./commands.js";
import { readConfig, updateCheckEnabled, writeConfig } from "./config.js";
import { CliError, looksLikeRepo, type CommandResult } from "./context.js";
import { installHubAgent, restartHub, runHub, uninstallHubAgent } from "./hub.js";
import { open } from "./open.js";
import { askYesNo, installSkill, isInteractive, offerSkillInstall } from "./skill.js";
import { refreshUpdate } from "./update-check.js";
import { CURRENT_VERSION } from "./version.js";

const program = new Command();

program
  .name("kalamu")
  .description("Repo-local outliner for turning developer thoughts into agent-ready tasks")
  .version(CURRENT_VERSION);

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

interface InitOptions {
  tour?: boolean;
  skill?: boolean;
  agentDocs?: boolean;
  format?: string;
}

/**
 * `init` plus its interactive offers (tour, agent skill) — shared by the init
 * command and `open`'s fresh-directory bootstrap. Returns false when init
 * itself failed or the repo guard declined. Humans get offers; agents and
 * scripts (no TTY, JSON mode, or --no-*) never block.
 */
async function initWithOffers(opts: InitOptions, guard: { skipRepoGuard?: boolean } = {}): Promise<boolean> {
  const interactive = isInteractive() && opts.format !== "json";
  // Wrong-directory guard: a fresh interactive init somewhere with no repo
  // marker defaults to NO — when the heuristic fires, a mistake is the likelier
  // case. Re-init and non-TTY runs (agents, pre-`git init` scaffolds) never ask.
  if (!guard.skipRepoGuard && interactive && findRoot(process.cwd()) === null && !looksLikeRepo(process.cwd())) {
    const proceed = await askYesNo(
      `This doesn't look like a code repository — initialise Kalamu in ${process.cwd()} anyway?`,
      false,
    );
    if (!proceed) {
      console.log("Nothing initialised. Run kalamu init from your project's root directory.");
      return false;
    }
  }
  const result = run(() => commands.init(process.cwd(), { agentDocs: opts.agentDocs }), opts);
  if (!result || process.exitCode) return false;
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
  return true;
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
  .action(async (opts: InitOptions & { open?: boolean }) => {
    if (!(await initWithOffers(opts))) return;
    // Humans land in the UI; agents and scripts must never end up holding a server.
    if (opts.open === true || (opts.open !== false && isInteractive() && opts.format !== "json")) {
      await open(process.cwd(), {});
    }
  });

program
  .command("open")
  .description("start the local server and open the browser UI (offers to initialise a fresh directory)")
  .option("--port <port>", "port to listen on (default 4242, auto-increments when taken)")
  .option("--no-browser", "do not open a browser")
  .action(async (opts: { port?: string; browser?: boolean }) => {
    try {
      // Fresh directory + a human at the keyboard: confirm before initialising
      // (the path in the prompt catches wrong-directory accidents), then give
      // them init's full onboarding. No repo marker flips the default to NO —
      // one question either way. Non-TTY keeps open()'s silent ensure.
      if (findRoot(process.cwd()) === null && isInteractive()) {
        const repo = looksLikeRepo(process.cwd());
        const question = repo
          ? `No Kalamu project here — initialise ${process.cwd()}?`
          : `This doesn't look like a code repository — initialise Kalamu in ${process.cwd()} anyway?`;
        if (!(await askYesNo(question, repo))) {
          console.log('Nothing initialised. Run "kalamu open" from your project, or "kalamu init" to set one up.');
          return;
        }
        if (!(await initWithOffers({}, { skipRepoGuard: true }))) return;
      }
      await open(process.cwd(), opts);
    } catch (err) {
      console.error(`kalamu: ${(err as Error).message}`);
      process.exitCode = 1;
    }
  });

program
  .command("hub [action]")
  .description("run the multi-project hub (all registered projects, one UI); actions: install, uninstall")
  .option("--port <port>", "port to listen on (default 4400)")
  .option("--no-browser", "do not open a browser")
  .action(async (action: string | undefined, opts: { port?: string; browser?: boolean }) => {
    try {
      if (action === "install") installHubAgent();
      else if (action === "uninstall") uninstallHubAgent();
      else if (action === undefined) await runHub(opts);
      else throw new Error(`unknown hub action "${action}" (expected install or uninstall)`);
    } catch (err) {
      console.error(`kalamu: ${(err as Error).message}`);
      process.exitCode = 1;
    }
  });

program
  .command("restart")
  .description("restart the installed hub (picks up updated code)")
  .action(async () => {
    try {
      await restartHub();
    } catch (err) {
      console.error(`kalamu: ${(err as Error).message}`);
      process.exitCode = 1;
    }
  });

program
  .command("config [key] [value]")
  .description("view or change machine-global settings (key: update-check <on|off>)")
  .action((key: string | undefined, value: string | undefined) => {
    if (key === undefined) {
      const enabled = updateCheckEnabled();
      console.log(`update-check ${enabled ? "on" : "off"}${enabled ? "" : " (KALAMU_NO_UPDATE_CHECK, CI, or config)"}`);
      return;
    }
    if (key !== "update-check") {
      console.error(`kalamu: unknown config key "${key}" (expected update-check)`);
      process.exitCode = 1;
      return;
    }
    if (value !== "on" && value !== "off") {
      console.error(`kalamu: expected "on" or "off" for update-check`);
      process.exitCode = 1;
      return;
    }
    writeConfig({ ...readConfig(), updateCheck: value === "on" });
    console.log(`update-check ${value}`);
  });

program
  .command("list")
  .description("list outline nodes")
  .option("--tasks", "tasks only")
  .option("--open", "open tasks only")
  .option("--done", "done tasks only")
  .option("--handoff", "handed-off tasks only")
  .option("--discussions", "discussions only")
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
  .option("--kind <kind>", "bullet|task|discussion (default bullet)")
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
  .option("--kind <kind>", "bullet|task|discussion")
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
  .option("--discussion", "queue discussions instead of tasks")
  .option("--format <format>", "output format (text|json)")
  .action((opts: commands.NextCommandOptions & { format?: string }) => {
    run(() => commands.next(process.cwd(), opts), opts);
  });

program
  .command("all")
  .description('print every eligible task in queue order (alias for "next --all")')
  .option("--under <id>", "only consider tasks inside this node's subtree")
  .option("--include-handed-off", "also consider tasks already handed off to another system")
  .option("--discussion", "queue discussions instead of tasks")
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

/**
 * After a command finishes, tell a human at the keyboard about a newer npm
 * release (SPEC key decision 14). stderr keeps it clear of `--format json`
 * stdout; the TTY gate keeps agents and scripts from ever seeing it. The first
 * time the check runs we explain it once and how to turn it off. Long-running
 * commands (open/hub) exit via process.exit before this resolves — the web chip
 * covers those sessions instead.
 */
async function notifyUpdate(): Promise<void> {
  if (!isInteractive() || !updateCheckEnabled()) return;
  const config = readConfig();
  if (config.updateNoticeSeen !== true) {
    process.stderr.write(
      "\nkalamu checks npm for a newer version about once a day.\n" +
        "Turn it off: export KALAMU_NO_UPDATE_CHECK=1  (or `kalamu config update-check off`)\n",
    );
    writeConfig({ ...config, updateNoticeSeen: true });
  }
  const { latest, updateAvailable } = await refreshUpdate(CURRENT_VERSION);
  if (updateAvailable && latest) {
    process.stderr.write(
      `\n  kalamu ${latest} available (you have ${CURRENT_VERSION}) · npm i -g kalamu@latest\n\n`,
    );
  }
}

program
  .parseAsync()
  .then(notifyUpdate)
  .catch((err: unknown) => {
    console.error(`kalamu: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  });
