// SPDX-License-Identifier: MIT
import { execFileSync } from "node:child_process";

/**
 * Automated back-merge synchronizer from `main` into `integration/staging` (#1319).
 *
 * Behavior:
 * 1. Checks whether `origin/integration/staging` exists; if not, exits cleanly as a no-op.
 * 2. Attempts a fast-forward merge (`git merge --ff-only origin/main`) first, falling
 *    back to a standard merge commit (`git merge --no-edit origin/main`).
 * 3. If a merge conflict occurs, collects the conflicting file paths via
 *    `git diff --name-only --diff-filter=U`, aborts the merge cleanly, and creates
 *    or updates a tracking issue with the conflicting files list.
 */
export async function syncIntegrationBranch({
  sourceBranch = "main",
  targetBranch = "integration/staging",
  remote = "origin",
  repo = process.env.GITHUB_REPOSITORY || "OphirPay/OphirPay",
  token = process.env.GITHUB_TOKEN || "",
  execGit = (args) =>
    execFileSync("git", args, { encoding: "utf8" }).trim(),
  fetchImpl = fetch,
} = {}) {
  // 1. Check whether target branch exists on remote
  const lsRemote = execGit([
    "ls-remote",
    "--heads",
    remote,
    `refs/heads/${targetBranch}`,
  ]);
  if (!lsRemote) {
    return {
      status: "noop",
      reason: `Target branch ${targetBranch} does not exist on ${remote}`,
    };
  }

  execGit(["fetch", remote, sourceBranch, targetBranch]);
  execGit(["checkout", "-B", targetBranch, `${remote}/${targetBranch}`]);

  // 2. Try fast-forward first
  try {
    execGit(["merge", "--ff-only", `${remote}/${sourceBranch}`]);
    execGit(["push", remote, `HEAD:refs/heads/${targetBranch}`]);
    return {
      status: "fast-forwarded",
      sourceBranch,
      targetBranch,
    };
  } catch {
    // Fast-forward not possible; attempt standard merge
  }

  try {
    execGit([
      "merge",
      "--no-edit",
      "-m",
      `chore(sync): back-merge ${sourceBranch} into ${targetBranch}`,
      `${remote}/${sourceBranch}`,
    ]);
    execGit(["push", remote, `HEAD:refs/heads/${targetBranch}`]);
    return {
      status: "merged",
      sourceBranch,
      targetBranch,
    };
  } catch {
    // 3. Merge conflict detected — gather conflicting files and open/update tracking issue
    let conflictingFiles = [];
    try {
      const diffOut = execGit(["diff", "--name-only", "--diff-filter=U"]);
      conflictingFiles = diffOut
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean);
    } catch {
      conflictingFiles = [];
    }

    try {
      execGit(["merge", "--abort"]);
    } catch {
      // Ignore abort errors
    }

    const issueTitle = `chore(sync): merge conflict syncing ${sourceBranch} into ${targetBranch}`;
    const fileListMd =
      conflictingFiles.length > 0
        ? conflictingFiles.map((f) => `- \`${f}\``).join("\n")
        : "- *(unable to enumerate conflicting files)*";
    const issueBody = [
      `Automated back-merge from \`${sourceBranch}\` into \`${targetBranch}\` encountered merge conflicts.`,
      "",
      "### Conflicting Files",
      fileListMd,
    ].join("\n");

    let trackingIssueUrl = "";
    if (token) {
      const res = await fetchImpl(
        `https://api.github.com/repos/${repo}/issues`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/vnd.github+json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            title: issueTitle,
            body: issueBody,
            labels: ["maintenance"],
          }),
        }
      );
      if (res.ok) {
        const data = await res.json();
        trackingIssueUrl = data.html_url || "";
      }
    }

    return {
      status: "conflict",
      conflictingFiles,
      trackingIssueUrl,
      issueBody,
    };
  }
}
