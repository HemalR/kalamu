import assert from "node:assert/strict";
import test from "node:test";

import { confirmed, parseReleaseArgs, recoverableVersion } from "./release-helpers.mjs";

test("parses a normal release and publish-only recovery", () => {
  assert.deepEqual(parseReleaseArgs(["minor", "--otp", "123456"]), {
    bump: "minor",
    otp: "123456",
    publishOnly: false,
  });
  assert.deepEqual(parseReleaseArgs(["--publish-only", "--otp=654321"]), {
    bump: "patch",
    otp: "654321",
    publishOnly: true,
  });
});

test("publish-only rejects a version bump", () => {
  assert.throws(
    () => parseReleaseArgs(["minor", "--publish-only"]),
    /cannot be combined with a version bump/,
  );
});

test("only an exact current-version tag at HEAD is recoverable", () => {
  assert.equal(recoverableVersion("0.12.0", "v0.12.0"), "0.12.0");
  assert.equal(recoverableVersion("0.12.0", "v0.11.0"), undefined);
  assert.equal(recoverableVersion("0.12.0", undefined), undefined);
});

test("the recovery prompt defaults to yes", () => {
  assert.equal(confirmed(""), true);
  assert.equal(confirmed("yes"), true);
  assert.equal(confirmed("Y"), true);
  assert.equal(confirmed("no"), false);
});
