/**
 * Refuse to operate on production from a stale checkout.
 *
 * Every one of these scripts trusts a local file — schema.prisma, or the
 * generated tenant-template.ts — and then does something irreversible-ish to a
 * real database. When the checkout is on the wrong branch, or simply behind,
 * they read an internally-consistent older world, report a confident success,
 * and change nothing. That failure is silent by construction: there is no error
 * to catch, because nothing went wrong except the inputs.
 *
 * This compares the exact files a script depends on against origin, and stops
 * before any of that can happen.
 *
 * Escape hatches, because a guard that can't be turned off gets deleted:
 *   ALLOW_STALE_CHECKOUT=1   deliberate — a feature branch, a hotfix, offline
 *   --allow-stale            same, as a flag
 *   CI                       skipped entirely; CI checks out what it was told to
 */
import { execFileSync } from "node:child_process";

const REF = process.env.STALE_CHECK_REF || "origin/main";

function git(args, opts = {}) {
  return execFileSync("git", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...opts,
  }).trim();
}

/** Best-effort — never let the guard itself be the thing that breaks a run. */
function tryGit(args) {
  try {
    return git(args);
  } catch {
    return null;
  }
}

/**
 * @param {string[]} paths Files whose contents the caller is about to trust.
 * @param {string} what    Human name for the operation, used in the message.
 */
export function assertCheckoutCurrent(paths, what = "This script") {
  if (process.env.CI) return;
  if (process.env.ALLOW_STALE_CHECKOUT === "1") return;
  if (process.argv.includes("--allow-stale")) return;
  if (!tryGit(["rev-parse", "--is-inside-work-tree"])) return;

  // A detached HEAD is a deliberate checkout of something specific; comparing
  // it to a branch tip would be noise.
  const branch = tryGit(["rev-parse", "--abbrev-ref", "HEAD"]);
  if (!branch || branch === "HEAD") return;

  const [remote, remoteBranch] = REF.split("/");
  // Explicitly null, not falsy: a successful --quiet fetch prints nothing and
  // returns "", which an `if (!...)` would read as failure.
  if (tryGit(["fetch", remote, remoteBranch, "--quiet"]) === null) {
    console.warn(
      `[stale-check] Could not reach ${remote} — continuing without verifying the checkout is current.`
    );
    return;
  }

  const stale = [];
  for (const path of paths) {
    const mine = tryGit(["hash-object", path]);
    const theirs = tryGit(["rev-parse", `${REF}:${path}`]);
    // Absent on the ref = a file this branch adds. Nothing to compare.
    if (mine === null || theirs === null) continue;
    if (mine !== theirs) stale.push(path);
  }
  if (stale.length === 0) return;

  const behind = tryGit(["rev-list", "--count", `HEAD..${REF}`]) || "?";

  console.error(
    [
      "",
      `  ${what} reads files that differ from ${REF}:`,
      ...stale.map((p) => `    ${p}`),
      "",
      `  You are on "${branch}", ${behind} commit(s) behind ${REF}.`,
      "",
      "  It would run against the wrong definition of your schema and most likely",
      "  report success while changing nothing — so it has stopped instead.",
      "",
      "    git checkout main",
      "    git pull origin main",
      "",
      "  If the difference is deliberate — a feature branch, a hotfix — re-run with",
      "  --allow-stale (or ALLOW_STALE_CHECKOUT=1).",
      "",
    ].join("\n")
  );
  process.exit(1);
}
