// SPDX-License-Identifier: MIT
//
// Content tests for the demo mode guide (issue #777). These guard the
// acceptance criteria: the guide must list the flag's behavioural effects
// (including the safeguards it does *not* disable today), document seeding and
// teardown steps, document the screenshot and video capture workflows end to
// end, and state that a demo must not point at mainnet. It must also be linked
// from README.md and ROADMAP.md.

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "../..");
const docPath = path.join(root, "docs", "DEMO_MODE.md");
const readmePath = path.join(root, "README.md");
const roadmapPath = path.join(root, "ROADMAP.md");

describe("docs/DEMO_MODE.md (demo mode guide)", () => {
  it("exists", () => {
    expect(existsSync(docPath)).toBe(true);
  });

  const doc = existsSync(docPath) ? readFileSync(docPath, "utf8") : "";

  it("documents the flag and its wiring status", () => {
    expect(doc).toMatch(/NEXT_PUBLIC_DEMO_MODE/);
    expect(doc).toMatch(/src\/lib\/demo-mode\.ts/);
    expect(doc).toMatch(/vitest\.config\.ts/);
    expect(doc).toMatch(/imported anywhere/);
    expect(doc).toMatch(/dead code/);
  });

  it("states that no safeguards are disabled by the flag", () => {
    expect(doc).toMatch(/no safeguards are\s+disabled/i);
    expect(doc).toMatch(/does not bypass wallet authentication/);
    expect(doc).toMatch(/does not skip\s+transaction signing/);
  });

  it("documents that demo-seed.sh does not seed and names the real seed command", () => {
    expect(doc).toMatch(/scripts\/demo-seed\.sh/);
    expect(doc).toMatch(/npx prisma db seed/);
    expect(doc).toMatch(/[Nn]o-op/);
    expect(doc).toMatch(/prisma\.seed/);
    expect(doc).toMatch(/npm run db:seed/);
  });

  it("documents what the seed script creates", () => {
    expect(doc).toMatch(/seed-user-1/);
    expect(doc).toMatch(/5 payments/);
    expect(doc).toMatch(/1 batch/);
    expect(doc).toMatch(/4 refunds/);
    expect(doc).toMatch(/3 notification hooks/);
    expect(doc).toMatch(/Seeded: 1 user, 5 payments, 1 batch, 4 refunds, 3 hooks/);
  });

  it("documents teardown and reset steps", () => {
    expect(doc).toMatch(/## 4\. Teardown/);
    expect(doc).toMatch(/rm -f \.env\.local/);
    expect(doc).toMatch(/rm -f prisma\/dev\.db/);
    expect(doc).toMatch(/TRUNCATE/);
    expect(doc).toMatch(/\.demo-frames/);
  });

  it("documents the screenshot capture workflow end to end", () => {
    expect(doc).toMatch(/scripts\/capture-screenshots\.js/);
    expect(doc).toMatch(/public\/screenshots\//);
    expect(doc).toMatch(/dashboard\.png/);
    expect(doc).toMatch(/payments\.png/);
    expect(doc).toMatch(/send-payment\.png/);
    expect(doc).toMatch(/batches\.png/);
    expect(doc).toMatch(/batch-new\.png/);
  });

  it("documents the demo video workflow end to end", () => {
    expect(doc).toMatch(/scripts\/create-demo-video\.js/);
    expect(doc).toMatch(/ffmpeg/);
    expect(doc).toMatch(/ophirpay\.vercel\.app/);
    expect(doc).toMatch(/public\/demo\.mp4/);
    expect(doc).toMatch(/\.demo-frames/);
  });

  it("forbids pointing a demo at mainnet", () => {
    expect(doc).toMatch(/never point at Stellar Mainnet/i);
    expect(doc).toMatch(/NEXT_PUBLIC_STELLAR_NETWORK=TESTNET/);
    expect(doc).toMatch(/deployment-mainnet\.md/);
  });

  it("notes the non-sensitive demo credentials and keys", () => {
    expect(doc).toMatch(
      /GACZ7ZELCUC5YGJ6JHIVLEZNR3XKYKOVUWD6H3IRFPRZMALNUYJZQM2U/,
    );
    expect(doc).toMatch(/not sensitive/i);
    expect(doc).toMatch(/AUTH_SECRET/);
    expect(doc).toMatch(/unfunded/);
  });

  it("documents the demo smoke test and its current limitation", () => {
    expect(doc).toMatch(/scripts\/demo-test\.sh/);
    expect(doc).toMatch(/aborts after the first check/i);
    expect(doc).toMatch(/\(\(PASS\+\+\)\)/);
  });
});

describe("README.md and ROADMAP.md demo mode links", () => {
  const readme = existsSync(readmePath)
    ? readFileSync(readmePath, "utf8")
    : "";
  const roadmap = existsSync(roadmapPath)
    ? readFileSync(roadmapPath, "utf8")
    : "";

  it("links to the demo mode guide from README.md", () => {
    expect(readme).toMatch(/docs\/DEMO_MODE\.md/);
  });

  it("links to the demo mode guide from ROADMAP.md", () => {
    expect(roadmap).toMatch(/docs\/DEMO_MODE\.md/);
  });
});
