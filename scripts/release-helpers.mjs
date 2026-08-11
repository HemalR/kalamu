export function parseReleaseArgs(args) {
  const remaining = [...args];
  let otp;
  let publishOnly = false;

  for (let index = 0; index < remaining.length; ) {
    const arg = remaining[index];

    if (arg === "--publish-only") {
      if (publishOnly) throw new Error("--publish-only was given more than once");
      publishOnly = true;
      remaining.splice(index, 1);
      continue;
    }

    if (arg === "--otp" || arg.startsWith("--otp=")) {
      if (otp !== undefined) throw new Error("--otp was given more than once");
      otp = arg.includes("=") ? arg.slice("--otp=".length) : remaining[index + 1];
      remaining.splice(index, arg.includes("=") ? 1 : 2);
      if (!otp) throw new Error("--otp was given without a code");
      continue;
    }

    index += 1;
  }

  if (remaining.length > 1) {
    throw new Error(`expected one version argument — got ${remaining.map((arg) => `"${arg}"`).join(", ")}`);
  }

  const bump = remaining[0] ?? "patch";
  if (!/^(patch|minor|major|\d+\.\d+\.\d+)$/.test(bump)) {
    throw new Error(`expected patch, minor, major, or x.y.z — got "${bump}"`);
  }
  if (publishOnly && remaining.length > 0) {
    throw new Error("--publish-only cannot be combined with a version bump");
  }

  return { bump, otp, publishOnly };
}

export function recoverableVersion(packageVersion, tagAtHead) {
  return tagAtHead === `v${packageVersion}` ? packageVersion : undefined;
}

export function confirmed(answer) {
  return answer.trim() === "" || /^y(?:es)?$/i.test(answer.trim());
}
