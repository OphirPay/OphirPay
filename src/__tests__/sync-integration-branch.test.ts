// SPDX-License-Identifier: MIT
import { describe, expect, it, vi } from "vitest";
import { syncIntegrationBranch } from "../../scripts/sync-integration-branch.mjs";

describe("Automated main -> integration/staging back-merge (#1319)", () => {
  it("is a no-op when integration/staging does not exist on the remote", async () => {
    const execGit = vi.fn().mockReturnValue("");
    const result = await syncIntegrationBranch({ execGit });

    expect(result.status).toBe("noop");
    expect(execGit).toHaveBeenCalledTimes(1);
  });

  it("fast-forwards integration/staging when possible and pushes the updated ref", async () => {
    const execGit = vi.fn().mockImplementation((args: string[]) => {
      if (args[0] === "ls-remote") {
        return "98af02c\trefs/heads/integration/staging";
      }
      return "";
    });

    const result = await syncIntegrationBranch({ execGit });
    expect(result.status).toBe("fast-forwarded");
    expect(execGit).toHaveBeenCalledWith([
      "push",
      "origin",
      "HEAD:refs/heads/integration/staging",
    ]);
  });

  it("collects conflicting files and opens a tracking issue when merge conflicts occur", async () => {
    const execGit = vi.fn().mockImplementation((args: string[]) => {
      if (args[0] === "ls-remote") {
        return "98af02c\trefs/heads/integration/staging";
      }
      if (args[0] === "merge" && args[1] !== "--abort") {
        throw new Error("CONFLICT (content): Merge conflict");
      }
      if (args[0] === "diff") {
        return "src/lib/prisma.ts\ncontracts/ophirpay/src/contract.rs";
      }
      return "";
    });

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        html_url: "https://github.com/OphirPay/OphirPay/issues/9999",
      }),
    });

    const result = await syncIntegrationBranch({
      token: "ghs_test_token",
      execGit,
      fetchImpl: fetchMock,
    });

    expect(result.status).toBe("conflict");
    expect(result.conflictingFiles).toEqual([
      "src/lib/prisma.ts",
      "contracts/ophirpay/src/contract.rs",
    ]);
    expect(result.trackingIssueUrl).toBe(
      "https://github.com/OphirPay/OphirPay/issues/9999"
    );
    expect(result.issueBody).toContain("- `src/lib/prisma.ts`");
    expect(result.issueBody).toContain(
      "- `contracts/ophirpay/src/contract.rs`"
    );
  });
});
