#!/usr/bin/env node
/**
 * Release the kalamu CLI to npm, prescriptively and in one shot:
 *
 *   pnpm release                 # patch bump (0.1.0 -> 0.1.1)
 *   pnpm release minor           # 0.1.0 -> 0.2.0
 *   pnpm release major           # 0.1.0 -> 1.0.0
 *   pnpm release 0.2.5           # explicit version
 *   pnpm release minor --otp 123456   # pass a 2FA one-time code to npm publish
 *   pnpm release --publish-only       # resume a tagged release whose publish failed
 *
 * Steps: clean-tree check -> bump packages/cli/package.json (single source
 * of truth; the build injects it into the binary) -> sync README version line
 * -> stamp CHANGELOG's [Unreleased] to this version + date -> test (which
 * typechecks every package first, then runs unit tests) -> build ->
 * verify the built binary reports the new version -> commit + tag ->
 * npm publish -> push. Aborts on the first failure; nothing is pushed or
 * published until tests and the version check pass.
 *
 * Run `/release-prep` first: it writes the CHANGELOG [Unreleased] notes and
 * commits pending work. This script refuses to release if that section is empty.
 */
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

import { confirmed, parseReleaseArgs, recoverableVersion } from "./release-helpers.mjs";

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

function captureOptional(cmd, opts = {}) {
  try {
    return capture(cmd, { stdio: ["ignore", "pipe", "ignore"], ...opts });
  } catch {
    return undefined;
  }
}

function fail(message) {
  console.error(`\nrelease: ${message}`);
  process.exit(1);
}

let releaseArgs;
try {
  releaseArgs = parseReleaseArgs(process.argv.slice(2));
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
const { bump, otp, publishOnly } = releaseArgs;

// Refuse to release anything that isn't committed, and only release from main.
if (capture("git status --porcelain") !== "") {
  fail("working tree is not clean — commit or stash first");
}
if (capture("git branch --show-current") !== "main") {
  fail("releases are cut from main only");
}

// A failed npm publish happens after the version commit and tag are made. At
// that point a blind retry would bump again and stamp a second changelog
// section. Detect the exact tagged-HEAD state before doing any mutation and
// offer to resume at build/publish/push instead.
const packageJsonUrl = new URL("../packages/cli/package.json", import.meta.url);
const currentVersion = JSON.parse(readFileSync(packageJsonUrl, "utf8")).version;
const tagAtHead = captureOptional("git describe --tags --exact-match HEAD");
const recoveryVersion = recoverableVersion(currentVersion, tagAtHead);
let recoverPublish = publishOnly;

if (publishOnly && !recoveryVersion) {
  fail(`--publish-only requires HEAD to be tagged v${currentVersion}`);
}

if (recoveryVersion && !publishOnly) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    fail(
      `HEAD is already the v${recoveryVersion} release; re-run with --publish-only to publish it without another version bump`,
    );
  }

  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await prompt.question(
    `\nHEAD is already release v${recoveryVersion}. Resume with build, npm publish, and push? [Y/n] `,
  );
  prompt.close();
  recoverPublish = confirmed(answer);
}

// npm sessions expire; catch that before we bump, commit, or tag anything.
try {
  capture("npm whoami", { stdio: ["ignore", "pipe", "ignore"] });
} catch {
  fail("not logged in to npm (npm whoami failed) — run `npm login` first");
}

function verifyBuild(version) {
  const reported = capture("node packages/cli/dist/index.js --version");
  if (reported !== version) {
    fail(`built binary reports ${reported}, expected ${version} — version injection is broken`);
  }

  const shippedReadme = readFileSync(new URL("../packages/cli/README.md", import.meta.url), "utf8");
  if (!shippedReadme.includes(`**Current version: v${version}**`)) {
    fail(`packages/cli/README.md does not carry 'Current version: v${version}' after build — a stale README clobbered the release`);
  }
}

if (recoverPublish) {
  console.log(`\nResuming release kalamu v${recoveryVersion} without a version bump`);
  run("pnpm build");
  verifyBuild(recoveryVersion);
  run(`npm publish${otp ? ` --otp=${otp}` : ""}`, { cwd: cliDir });
  run("git push --follow-tags");
  console.log(`\nDone: kalamu v${recoveryVersion} is on npm and main is pushed.`);
  console.log("Global installs are frozen snapshots — update each machine with: npm i -g kalamu");
  process.exit(0);
}

run(`npm version ${bump} --no-git-tag-version`, { cwd: cliDir });
const { version } = JSON.parse(readFileSync(packageJsonUrl, "utf8"));
console.log(`\nReleasing kalamu v${version}`);

// Keep the README's version line in lockstep — npm renders the README as the
// package page, and it ships inside the tarball. Edit the ROOT README, not
// packages/cli/README.md: the build (copy-web.mjs) copies root -> cli on every
// run, so editing the cli copy here would be silently clobbered by `pnpm build`
// below. The release commit (`git commit -am`) picks up both files.
const readmeUrl = new URL("../README.md", import.meta.url);
const readme = readFileSync(readmeUrl, "utf8");
const versionLine = /\*\*Current version: v\d+\.\d+\.\d+\*\*/;
if (!versionLine.test(readme)) {
  fail("README.md is missing its '**Current version: vX.Y.Z**' line — restore it before releasing");
}
writeFileSync(readmeUrl, readme.replace(versionLine, `**Current version: v${version}**`));

// Stamp the changelog: rename '## [Unreleased]' to the version being cut and
// date it, leaving a fresh empty [Unreleased] on top for the next cycle. Refuse
// to release with nothing recorded — the notes under [Unreleased] ARE the
// release notes, and an empty section means the release-prep step was skipped.
const changelogUrl = new URL("../CHANGELOG.md", import.meta.url);
const changelog = readFileSync(changelogUrl, "utf8");
const unreleased = changelog.match(/## \[Unreleased\]\n([\s\S]*?)(?=\n## |$)/);
if (!unreleased) {
  fail("CHANGELOG.md is missing its '## [Unreleased]' section");
}
if (!/\S/.test(unreleased[1])) {
  fail("nothing recorded under CHANGELOG '## [Unreleased]' — run /release-prep before releasing");
}
const today = new Date().toISOString().slice(0, 10);
writeFileSync(
  changelogUrl,
  changelog.replace("## [Unreleased]\n", `## [Unreleased]\n\n## [${version}] - ${today}\n`),
);

run("pnpm test"); // typechecks every package (incl. web svelte-check), then runs unit tests
run("pnpm build");

// The binary must report the version we are about to publish.
verifyBuild(version);

run(`git commit -am "Release v${version}"`);
run(`git tag v${version}`);
run(`npm publish${otp ? ` --otp=${otp}` : ""}`, { cwd: cliDir });
run("git push --follow-tags");

console.log(`\nDone: kalamu v${version} is on npm and main is pushed.`);
console.log(`Global installs are frozen snapshots — update each machine with: npm i -g kalamu`);
