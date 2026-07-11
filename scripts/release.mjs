#!/usr/bin/env node
/**
 * Release the kalamu CLI to npm, prescriptively and in one shot:
 *
 *   pnpm release            # patch bump (0.1.0 -> 0.1.1)
 *   pnpm release minor      # 0.1.0 -> 0.2.0
 *   pnpm release major      # 0.1.0 -> 1.0.0
 *   pnpm release 0.2.5      # explicit version
 *
 * Steps: clean-tree check -> bump packages/cli/package.json (single source
 * of truth; the build injects it into the binary) -> test -> build ->
 * verify the built binary reports the new version -> commit + tag ->
 * npm publish -> push. Aborts on the first failure; nothing is pushed or
 * published until tests and the version check pass.
 */
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const cliDir = fileURLToPath(new URL("../packages/cli", import.meta.url));

function run(cmd, opts = {}) {
  console.log(`\n> ${cmd}`);
  try {
    execSync(cmd, { stdio: "inherit", cwd: root, ...opts });
  } catch {
    fail(`"${cmd}" failed — see output above`);
  }
}

function capture(cmd, opts = {}) {
  return execSync(cmd, { encoding: "utf8", cwd: root, ...opts }).trim();
}

function fail(message) {
  console.error(`\nrelease: ${message}`);
  process.exit(1);
}

const bump = process.argv[2] ?? "patch";
if (!/^(patch|minor|major|\d+\.\d+\.\d+)$/.test(bump)) {
  fail(`expected patch, minor, major, or x.y.z — got "${bump}"`);
}

// Refuse to release anything that isn't committed, and only release from main.
if (capture("git status --porcelain") !== "") {
  fail("working tree is not clean — commit or stash first");
}
if (capture("git branch --show-current") !== "main") {
  fail("releases are cut from main only");
}

// npm sessions expire; catch that before we bump, commit, or tag anything.
try {
  capture("npm whoami", { stdio: ["ignore", "pipe", "ignore"] });
} catch {
  fail("not logged in to npm (npm whoami failed) — run `npm login` first");
}

run(`npm version ${bump} --no-git-tag-version`, { cwd: cliDir });
const { version } = JSON.parse(readFileSync(new URL("../packages/cli/package.json", import.meta.url), "utf8"));
console.log(`\nReleasing kalamu v${version}`);

run("pnpm -r --if-present typecheck");
run("pnpm test");
run("pnpm build");

// The binary must report the version we are about to publish.
const reported = capture("node packages/cli/dist/index.js --version");
if (reported !== version) {
  fail(`built binary reports ${reported}, expected ${version} — version injection is broken`);
}

run(`git commit -am "Release v${version}"`);
run(`git tag v${version}`);
run("npm publish", { cwd: cliDir });
run("git push --follow-tags");

console.log(`\nDone: kalamu v${version} is on npm and main is pushed.`);
console.log(`Global installs are frozen snapshots — update each machine with: npm i -g kalamu`);
