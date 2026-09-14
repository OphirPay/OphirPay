// SPDX-License-Identifier: MIT
// Robustness tests for the CSV batch parser (issue #389).
//
// Acceptance criteria:
//   1. Each failure mode produces a row-level error with a line number
//      (malformed rows, missing headers, extra columns, bad memos).
//   2. The parser never throws on bad input (garbage, stray quotes, NULs).
//   3. UTF-8 content and quoted fields parse correctly.
//   4. A happy-path fixture is included and parses cleanly end-to-end.

import { describe, it, expect } from "vitest";
import path from "node:path";
import { readFileSync } from "node:fs";
import {
  parseCsvText,
  parseRecipientsCsv,
  parseRecipientsCsvToRows,
  MEMO_MAX_BYTES,
} from "@/lib/csv-import";

const VALID_ADDRESS = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const OTHER_ADDRESS = "G" + "B".repeat(55);
const THIRD_ADDRESS = "G" + "C".repeat(55);

const FIXTURES_DIR = path.resolve(__dirname, "./fixtures/csv");
const HAPPY_PATH_CSV = path.join(FIXTURES_DIR, "happy-path.csv");
const QUOTED_UTF8_CSV = path.join(FIXTURES_DIR, "quoted-utf8.csv");

function csvFile(content: string, name = "recipients.csv"): File {
  return new File([content], name, { type: "text/csv" });
}

function fixtureFile(path: string, name: string): File {
  // Decode the fixture into a UTF-8 string first so parsing matches what the
  // browser's File.text() would produce from an uploaded .csv.
  return csvFile(readFileSync(path, "utf8"), name);
}

// ── Malformed rows produce row-level errors with line numbers ──

describe("csv-import robustness > malformed rows", () => {
  it("reports every malformed row with its exact line number", async () => {
    const { recipients, errors } = await parseRecipientsCsv(
      csvFile(
        [
          "address,amount,assetCode,memo",
          "NOT_AN_ADDRESS,100,XLM,hi", // line 2 — bad address
          `${VALID_ADDRESS},0,XLM,x`, // line 3 — bad amount
          `${OTHER_ADDRESS},20,XLM,${"y".repeat(MEMO_MAX_BYTES + 1)}`, // line 4 — memo too long
          `${THIRD_ADDRESS}`, // line 5 — missing amount column
        ].join("\n")
      )
    );

    expect(errors.map((e) => e.row)).toEqual([2, 3, 4, 5]);
    expect(errors[0].message).toMatch(/invalid stellar address/i);
    expect(errors[1].message).toMatch(/invalid amount/i);
    expect(errors[2].message).toMatch(/28 bytes/i);
    expect(errors[3].message).toMatch(/at least address and amount/i);
    // Valid rows are still imported.
    expect(recipients).toHaveLength(0);
  });

  it("flags a row missing the amount column with its line number", async () => {
    // Row 2 is valid and must be imported; row 3 contains only an address
    // and no amount column at all, so the parser flags it (line 3 because
    // the header is line 1) with a row-level error instead of throwing.
    const { recipients, errors } = await parseRecipientsCsv(
      csvFile(
        `address,amount,assetCode,memo\n${VALID_ADDRESS},100,XLM,ok\n${THIRD_ADDRESS}\n`
      )
    );
    expect(recipients).toHaveLength(1);
    expect(recipients[0].address).toBe(VALID_ADDRESS);
    expect(errors).toHaveLength(1);
    expect(errors[0].row).toBe(3);
    expect(errors[0].message).toMatch(/at least address and amount/i);
  });

  it("reports memos with control/invisible characters with a line number", async () => {
    const memoWithTab = "tab\there";
    const { recipients, errors } = await parseRecipientsCsv(
      csvFile(`address,amount,assetCode,memo\n${VALID_ADDRESS},100,XLM,${memoWithTab}\n`)
    );
    expect(recipients).toHaveLength(0);
    expect(errors).toHaveLength(1);
    expect(errors[0].row).toBe(2);
    expect(errors[0].message).toMatch(/control or invisible/i);
  });

  it("reports a quoted memo containing a newline as a row error, never throws", async () => {
    const { recipients, errors } = await parseRecipientsCsv(
      csvFile(`address,amount,assetCode,memo\n${VALID_ADDRESS},100,XLM,"line1\nline2"\n${OTHER_ADDRESS},50,XLM,ok\n`)
    );
    expect(recipients).toHaveLength(1);
    expect(recipients[0].address).toBe(OTHER_ADDRESS);
    expect(errors).toHaveLength(1);
    expect(errors[0].row).toBe(2);
    expect(errors[0].message).toMatch(/control or invisible/i);
  });

  it("surfaces malformed rows with a line number in the preview parser too", async () => {
    const { rows, fileErrors } = await parseRecipientsCsvToRows(
      csvFile(
        [
          "address,amount,memo",
          "NOT_AN_ADDRESS,abc,too-long-".concat("x".repeat(40)), // row 1 — 2 field errors + memo
          `${VALID_ADDRESS},0,ok`, // row 2 — amount error
        ].join("\n"),
        "malformed.csv"
      )
    );
    expect(fileErrors).toEqual([]);
    expect(rows).toHaveLength(2);
    expect(rows[0].sourceRow).toBe(1);
    expect(rows[0].errors.address).toMatch(/invalid/i);
    expect(rows[0].errors.memo).toMatch(/28 characters/i);
    expect(rows[1].sourceRow).toBe(2);
    expect(rows[1].errors.amount).toMatch(/greater than 0/i);
  });
});

// ── Missing headers ────────────────────────────────────────────

describe("csv-import robustness > missing headers", () => {
  it("rejects a file with only a header row (file-level error, row 0)", async () => {
    const { recipients, errors } = await parseRecipientsCsv(
      csvFile("address,amount,assetCode,memo\n")
    );
    expect(recipients).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0].row).toBe(0);
    expect(errors[0].message).toMatch(/header row/i);
  });

  it("rejects an empty file without throwing", async () => {
    const { recipients, errors } = await parseRecipientsCsv(csvFile(""));
    expect(recipients).toEqual([]);
    expect(errors[0].message).toMatch(/header row/i);
    expect(parseCsvText("")).toEqual([]);

    const { rows, fileErrors } = await parseRecipientsCsvToRows(csvFile(""));
    expect(rows).toEqual([]);
    expect(fileErrors[0]).toMatch(/header row/i);
  });

  it("reports a missing header row through the preview parser", async () => {
    // A single data row with no header at all — the preview parser requires
    // a header plus at least one data row.
    const { rows, fileErrors } = await parseRecipientsCsvToRows(
      csvFile(`${VALID_ADDRESS},100,thanks\n`)
    );
    expect(rows).toEqual([]);
    expect(fileErrors[0]).toMatch(/header row/i);
  });

  it("treats the first row as a header in the legacy parser (skips it)", async () => {
    // No header present; the first data row is consumed as the header by the
    // documented legacy behavior — only the second row is imported.
    const { recipients, errors } = await parseRecipientsCsv(
      csvFile(`${VALID_ADDRESS},100,XLM,first\n${OTHER_ADDRESS},50,XLM,second\n`)
    );
    expect(errors).toEqual([]);
    expect(recipients).toHaveLength(1);
    expect(recipients[0].address).toBe(OTHER_ADDRESS);
    expect(recipients[0].memo).toBe("second");
  });
});

// ── Extra columns ──────────────────────────────────────────────

describe("csv-import robustness > extra columns", () => {
  it("ignores trailing columns beyond the expected schema in the legacy parser", async () => {
    const { recipients, errors } = await parseRecipientsCsv(
      csvFile(
        `address,amount,assetCode,memo,notes\n${VALID_ADDRESS},100,XLM,payroll,urgent\n${OTHER_ADDRESS},50,XLM,,just-in-time\n`
      )
    );
    expect(errors).toEqual([]);
    expect(recipients).toHaveLength(2);
    expect(recipients[0].memo).toBe("payroll");
    expect(recipients[1].memo).toBeUndefined();
  });

  it("keeps header-name columns when the file has extra columns in the preview parser", async () => {
    const { rows, fileErrors } = await parseRecipientsCsvToRows(
      csvFile(
        `address,amount,assetCode,memo,notes\n${VALID_ADDRESS},100,XLM,payroll,urgent\n`
      )
    );
    expect(fileErrors).toEqual([]);
    expect(rows).toHaveLength(1);
    expect(rows[0].values).toEqual({
      address: VALID_ADDRESS,
      amount: "100",
      memo: "payroll",
    });
  });

  it("does not throw when a data row has more cells than the header", async () => {
    const { rows, fileErrors } = await parseRecipientsCsvToRows(
      csvFile(`address,amount,memo\n${VALID_ADDRESS},100,hello,EXTRA,EXTRA2\n`)
    );
    expect(fileErrors).toEqual([]);
    expect(rows[0].values.memo).toBe("hello");
  });
});

// ── UTF-8 content ──────────────────────────────────────────────

describe("csv-import robustness > UTF-8 content", () => {
  it("preserves non-ASCII UTF-8 memo content exactly", async () => {
    const { recipients, errors } = await parseRecipientsCsv(
      csvFile(
        `address,amount,assetCode,memo\n${VALID_ADDRESS},100,XLM,prélude — café\n${OTHER_ADDRESS},200,XLM,日本語\n`
      )
    );
    expect(errors).toEqual([]);
    expect(recipients[0].memo).toBe("prélude — café");
    expect(recipients[1].memo).toBe("日本語");
  });

  it("counts memo length in UTF-8 bytes, not characters", async () => {
    const short = "☕".repeat(8); // 24 bytes — allowed
    const long = "☕".repeat(10); // 30 bytes — rejected
    expect(new TextEncoder().encode(short).length).toBe(24);
    expect(new TextEncoder().encode(long).length).toBe(30);

    const { recipients, errors } = await parseRecipientsCsv(
      csvFile(
        `address,amount,assetCode,memo\n${VALID_ADDRESS},100,XLM,${short}\n${OTHER_ADDRESS},200,XLM,${long}\n`
      )
    );
    expect(recipients).toHaveLength(1);
    expect(recipients[0].memo).toBe(short);
    expect(errors).toHaveLength(1);
    expect(errors[0].row).toBe(3);
    expect(errors[0].message).toMatch(/28 bytes/i);
  });

  it("preserves emoji across the raw cell parser (parseCsvText)", () => {
    expect(parseCsvText("a,日本語,🙂\n")).toEqual([["a", "日本語", "🙂"]]);
  });
});

// ── Quoted fields ──────────────────────────────────────────────

describe("csv-import robustness > quoted fields", () => {
  it("parses quoted memos containing commas", async () => {
    const { recipients, errors } = await parseRecipientsCsv(
      csvFile(`address,amount,assetCode,memo\n${VALID_ADDRESS},100,XLM,"hello, world"\n`)
    );
    expect(errors).toEqual([]);
    expect(recipients[0].memo).toBe("hello, world");
  });

  it("parses escaped quotes inside quoted memos", async () => {
    const { recipients, errors } = await parseRecipientsCsv(
      csvFile(`address,amount,assetCode,memo\n${VALID_ADDRESS},100,XLM,"say ""hi"" 🙂"\n`)
    );
    expect(errors).toEqual([]);
    expect(recipients[0].memo).toBe('say "hi" 🙂');
  });

  it("parses quoted address and amount columns", async () => {
    const { recipients, errors } = await parseRecipientsCsv(
      csvFile(`address,amount,assetCode,memo\n"${VALID_ADDRESS}","100",XLM,thanks\n`)
    );
    expect(errors).toEqual([]);
    expect(recipients[0].address).toBe(VALID_ADDRESS);
    expect(recipients[0].amount).toBe(100);
  });
});

// ── Never throws on bad input ──────────────────────────────────

describe("csv-import robustness > never throws on bad input", () => {
  const garbageInputs: Array<[string, string]> = [
    ["unterminated quote", `address,amount,assetCode,memo\n${VALID_ADDRESS},100,XLM,"unterminated\n`],
    ["NUL and control bytes in memo", `address,amount,assetCode,memo\n${VALID_ADDRESS},100,XLM,\x00\x01\x02\n`],
    ["stray quotes mid-field", `address,amount,assetCode,memo\n${VALID_ADDRESS},1"00,XLM,hel"lo\n`],
    ["only commas", ",,,,\n,,,,\n"],
    ["only newlines", "\n\n\n\n"],
    ["binary-ish byte soup", `\x00\xff\xfe\xfd,address,amount\n${VALID_ADDRESS}\x00,1\xff,XLM\n`],
    ["BOM plus garbage", `\uFEFF\x00\x01,not,a,csv\n`],
  ];

  for (const [label, content] of garbageInputs) {
    it(`does not throw on ${label}`, async () => {
      await expect(parseRecipientsCsv(csvFile(content))).resolves.toBeDefined();
      await expect(parseRecipientsCsvToRows(csvFile(content))).resolves.toBeDefined();
      expect(() => parseCsvText(content)).not.toThrow();
    });
  }

  it("handles a very large file (10k rows) without throwing", async () => {
    const lines = ["address,amount,assetCode,memo"];
    for (let i = 0; i < 10_000; i++) {
      lines.push(`${VALID_ADDRESS},${i + 1},XLM,memo-${i}`);
    }
    const { recipients, errors } = await parseRecipientsCsv(csvFile(lines.join("\n")));
    expect(errors).toEqual([]);
    expect(recipients).toHaveLength(10_000);
  });

  it("turns garbage rows into row-level errors instead of crashing", async () => {
    const { recipients, errors } = await parseRecipientsCsv(
      csvFile(
        `address,amount,assetCode,memo\n\x00\xffbad,xyz,XLM,\x01\n${VALID_ADDRESS},100,XLM,\x02\x03\n`
      )
    );
    expect(recipients).toHaveLength(0);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.every((e) => typeof e.row === "number")).toBe(true);
  });
});

// ── Happy-path fixture ─────────────────────────────────────────

describe("csv-import robustness > happy-path fixture", () => {
  it("parses the happy-path fixture into 3 clean recipients", async () => {
    const { recipients, errors } = await parseRecipientsCsv(
      fixtureFile(HAPPY_PATH_CSV, "happy-path.csv")
    );
    expect(errors).toEqual([]);
    expect(recipients).toHaveLength(3);

    expect(recipients[1].memo).toBe("prélude — café");
    expect(recipients[2].memo).toBe("hello, quoted");

    const expectedAmounts = [100, 250, 50];
    recipients.forEach((recipient, i) => {
      expect(recipient.amount).toBe(expectedAmounts[i]);
      expect(recipient.assetCode).toBe("XLM");
    });
  });

  it("parses the happy-path fixture through the preview parser too", async () => {
    const { rows, fileErrors } = await parseRecipientsCsvToRows(
      fixtureFile(HAPPY_PATH_CSV, "happy-path.csv")
    );
    expect(fileErrors).toEqual([]);
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.sourceRow)).toEqual([1, 2, 3]);
    expect(rows.every((r) => Object.keys(r.errors).length === 0)).toBe(true);
    expect(rows[0].values).toEqual({
      address: VALID_ADDRESS,
      amount: "100",
      memo: "thanks",
    });
    expect(rows[1].values.memo).toBe("prélude — café");
    expect(rows[2].values.memo).toBe("hello, quoted");
  });

  it("parses the quoted/UTF-8 fixture with escaped quotes and emoji", async () => {
    const { recipients, errors } = await parseRecipientsCsv(
      fixtureFile(QUOTED_UTF8_CSV, "quoted-utf8.csv")
    );
    expect(errors).toEqual([]);
    expect(recipients).toHaveLength(3);
    expect(recipients[0].memo).toBe('say "hi" 🙂');
    expect(recipients[1].memo).toBe("日本語");
    expect(recipients[2].memo).toBe("memo,with,commas");
  });
});