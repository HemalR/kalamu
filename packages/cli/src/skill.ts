/**
 * The Kalamu agent skill (skills/kalamu/SKILL.md in the repo) is published
 * through skills.sh, whose CLI owns the hard part: it asks which agents to
 * install for and knows every agent's skills directory. `kalamu init` only
 * offers the handoff — it must never prompt when driven by an agent or a
 * script, so everything here is gated on an interactive TTY.
 */
import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";

/** GitHub slug the skill installs from; must match the published repo. */
export const SKILL_REPO = "hemalr/kalamu";

export function isInteractive(): boolean {
  return process.stdin.isTTY === true && process.stdout.isTTY === true;
}

/** `kalamu init --skill` / interactive consent → hand off to `npx skills add`. */
export function installSkill(): void {
  console.log(`Handing off to skills.sh (npx skills add ${SKILL_REPO}) — it will ask which agents to install for.`);
  const result = spawnSync("npx", ["skills", "add", SKILL_REPO], { stdio: "inherit" });
  if (result.error) {
    console.error(`kalamu: could not run npx (${result.error.message}); install manually with: npx skills add ${SKILL_REPO}`);
    process.exitCode = 1;
  } else if (result.status !== 0 && result.status !== null) {
    process.exitCode = result.status;
  }
}

export async function askYesNo(question: string, defaultYes: boolean): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question(`${question} ${defaultYes ? "[Y/n]" : "[y/N]"} `)).trim();
    return answer === "" ? defaultYes : /^y(es)?$/i.test(answer);
  } catch {
    return false; // EOF (Ctrl+D) declines rather than crashing
  } finally {
    rl.close();
  }
}

export async function offerSkillInstall(): Promise<void> {
  if (await askYesNo("Install the Kalamu agent skill so your coding agents use the outline?", false)) {
    installSkill();
  } else {
    console.log(`Skipped. Later: npx skills add ${SKILL_REPO}`);
  }
}
