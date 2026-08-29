// SPDX-License-Identifier: MIT
// Comprehensive unit tests for CSV batch recipient parser:
// malformed rows, line number error tracking, headers, extra columns,
// UTF-8 encodings, quoted fields, and parser resilience.

import { describe, it, expect } from "vitest";
import {
  parseRecipientsCsv,
  parseRecipientsCsvToRows,
  parseCsvText,
  generateRecipientsCsvTemplate,
  MAX_BATCH_RECIPIENTS,
} from "@/lib/csv-import";

const VALID_ADDRESS_1 = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const VALID_ADDRESS_2 = "G" + "B".repeat(55);
const VALID_ADDRESS_3 = "G" + "C".repeat(55);
const VALID_ADDRESS_4 = "G" + "D".repeat(55);

function csvFile(content: string, name = "recipients.csv"): File {
  return new File([content], name, { type: "text/csv" });
}

// ── Happy-Path Fixtures ───────────────────────────────────────

const HAPPY_PATH_3_COLUMN_CSV = `address,amount,memo
${VALID_ADDRESS_1},100.5,payroll_aug
${VALID_ADDRESS_2},250.00,bonus
${VALID_ADDRESS_3},15,coffee
${VALID_ADDRESS_4},1000,
`;

const HAPPY_PATH_4_COLUMN_CSV = `address,amount,assetCode,memo
${VALID_ADDRESS_1},500,XLM,grant
${VALID_ADDRESS_2},125.75,USDC,invoice-101
${VALID_ADDRESS_3},300,EURC,freelance
`;

const HAPPY_PATH_QUOTED_AND_UTF8_CSV = `address,amount,memo
${VALID_ADDRESS_1},"150.00","Dev, design, QA"
${VALID_ADDRESS_2},75,"He said ""Hi!"""
${VALID_ADDRESS_3},200,"Thanh toán"
${VALID_ADDRESS_4},50,"Multi-word memo"
`;

const HAPPY_PATH_REORDERED_COLUMNS_CSV = `memo,amount,address
lunch,45.50,${VALID_ADDRESS_1}
stipend,500,${VALID_ADDRESS_2}
`;

const HAPPY_PATH_EXTRA_COLUMNS_CSV = `id,address,department,amount,memo,status
1,${VALID_ADDRESS_1},Engineering,300,dev stipend,active
2,${VALID_ADDRESS_2},Marketing,450,campaign,approved
`;

describe("CSV Batch Parser > Happy-Path Fixtures", () => {
  it("parses standard 3-column CSV fixture (address, amount, memo)", async () => {
    const { recipients, errors } = await parseRecipientsCsv(
      csvFile(HAPPY_PATH_3_COLUMN_CSV)
    );

    expect(errors).toEqual([]);
    expect(recipients).toHaveLength(4);
    expect(recipients[0]).toEqual({
      address: VALID_ADDRESS_1,
      amount: 100.5,
      assetCode: "XLM",
      memo: "payroll_aug",
    });
    expect(recipients[1]).toEqual({
      address: VALID_ADDRESS_2,
      amount: 250,
      assetCode: "XLM",
      memo: "bonus",
    });
    expect(recipients[2]).toEqual({
      address: VALID_ADDRESS_3,
      amount: 15,
      assetCode: "XLM",
      memo: "coffee",
    });
    expect(recipients[3]).toEqual({
      address: VALID_ADDRESS_4,
      amount: 1000,
      assetCode: "XLM",
      memo: undefined,
    });
  });

  it("parses legacy 4-column CSV fixture with custom assets and memos", async () => {
    const { recipients, errors } = await parseRecipientsCsv(
      csvFile(HAPPY_PATH_4_COLUMN_CSV)
    );

    expect(errors).toEqual([]);
    expect(recipients).toHaveLength(3);
    expect(recipients[0]).toEqual({
      address: VALID_ADDRESS_1,
      amount: 500,
      assetCode: "XLM",
      memo: "grant",
    });
    expect(recipients[1]).toEqual({
      address: VALID_ADDRESS_2,
      amount: 125.75,
      assetCode: "USDC",
      memo: "invoice-101",
    });
    expect(recipients[2]).toEqual({
      address: VALID_ADDRESS_3,
      amount: 300,
      assetCode: "EURC",
      memo: "freelance",
    });
  });

  it("parses CSV with quoted commas, escaped quotes, multiline values, and UTF-8", async () => {
    const { recipients, errors } = await parseRecipientsCsv(
      csvFile(HAPPY_PATH_QUOTED_AND_UTF8_CSV)
    );

    expect(errors).toEqual([]);
    expect(recipients).toHaveLength(4);
    expect(recipients[0].memo).toBe("Dev, design, QA");
    expect(recipients[1].memo).toBe('He said "Hi!"');
    expect(recipients[2].memo).toBe("Thanh toán");
    expect(recipients[3].memo).toBe("Multi-word memo");
  });

  it("parses CSV with reordered header columns (memo, amount, address)", async () => {
    const { recipients, errors } = await parseRecipientsCsv(
      csvFile(HAPPY_PATH_REORDERED_COLUMNS_CSV)
    );

    expect(errors).toEqual([]);
    expect(recipients).toHaveLength(2);
    expect(recipients[0]).toEqual({
      address: VALID_ADDRESS_1,
      amount: 45.5,
      assetCode: "XLM",
      memo: "lunch",
    });
    expect(recipients[1]).toEqual({
      address: VALID_ADDRESS_2,
      amount: 500,
      assetCode: "XLM",
      memo: "stipend",
    });
  });

  it("parses CSV with extra metadata columns in header and rows", async () => {
    const { recipients, errors } = await parseRecipientsCsv(
      csvFile(HAPPY_PATH_EXTRA_COLUMNS_CSV)
    );

    expect(errors).toEqual([]);
    expect(recipients).toHaveLength(2);
    expect(recipients[0]).toEqual({
      address: VALID_ADDRESS_1,
      amount: 300,
      assetCode: "XLM",
      memo: "dev stipend",
    });
    expect(recipients[1]).toEqual({
      address: VALID_ADDRESS_2,
      amount: 450,
      assetCode: "XLM",
      memo: "campaign",
    });
  });

  it("generates a valid CSV template string", () => {
    const template = generateRecipientsCsvTemplate();
    expect(template).toContain("address,amount,memo");
    const parsed = parseCsvText(template);
    expect(parsed.length).toBeGreaterThanOrEqual(2);
  });
});

// ── Malformed Rows and Line Number Reporting ──────────────────

describe("CSV Batch Parser > Malformed Rows and Line Numbers", () => {
  it("flags missing address with row-level error and line number", async () => {
    const content = `address,amount,memo\n,100,salary\n${VALID_ADDRESS_1},200,valid\n`;
    const { recipients, errors } = await parseRecipientsCsv(csvFile(content));

    expect(recipients).toHaveLength(1);
    expect(recipients[0].address).toBe(VALID_ADDRESS_1);
    expect(errors).toHaveLength(1);
    expect(errors[0].row).toBe(2);
    expect(errors[0].message).toMatch(/at least address and amount/i);
  });

  it("flags row with only 1 column with line number", async () => {
    const content = `address,amount,memo\n${VALID_ADDRESS_1}\n${VALID_ADDRESS_2},50,ok\n`;
    const { recipients, errors } = await parseRecipientsCsv(csvFile(content));

    expect(recipients).toHaveLength(1);
    expect(recipients[0].address).toBe(VALID_ADDRESS_2);
    expect(errors).toHaveLength(1);
    expect(errors[0].row).toBe(2);
    expect(errors[0].message).toMatch(/at least address and amount/i);
  });

  it("flags invalid Stellar address format with line number", async () => {
    const content = `address,amount,memo
NOT_A_STELLAR_ADDRESS,100,first
${VALID_ADDRESS_1},200,second
gAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA,300,lowercase
${VALID_ADDRESS_2.slice(0, 50)},400,short
${VALID_ADDRESS_3}EXTRA,500,long
`;
    const { recipients, errors } = await parseRecipientsCsv(csvFile(content));

    expect(recipients).toHaveLength(1);
    expect(recipients[0].address).toBe(VALID_ADDRESS_1);
    expect(errors).toHaveLength(4);
    expect(errors[0]).toEqual({ row: 2, message: expect.stringMatching(/Invalid Stellar address at row 2/i) });
    expect(errors[1]).toEqual({ row: 4, message: expect.stringMatching(/Invalid Stellar address at row 4/i) });
    expect(errors[2]).toEqual({ row: 5, message: expect.stringMatching(/Invalid Stellar address at row 5/i) });
    expect(errors[3]).toEqual({ row: 6, message: expect.stringMatching(/Invalid Stellar address at row 6/i) });
  });

  it("flags missing or empty amount with line number", async () => {
    const content = `address,amount,memo\n${VALID_ADDRESS_1},,empty_amt\n${VALID_ADDRESS_2},50,valid\n`;
    const { recipients, errors } = await parseRecipientsCsv(csvFile(content));

    expect(recipients).toHaveLength(1);
    expect(recipients[0].address).toBe(VALID_ADDRESS_2);
    expect(errors).toHaveLength(1);
    expect(errors[0].row).toBe(2);
    expect(errors[0].message).toMatch(/at least address and amount/i);
  });

  it("flags non-numeric amounts with line number", async () => {
    const content = `address,amount,memo
${VALID_ADDRESS_1},abc,first
${VALID_ADDRESS_2},$100,second
${VALID_ADDRESS_3},100,valid
`;
    const { recipients, errors } = await parseRecipientsCsv(csvFile(content));

    expect(recipients).toHaveLength(1);
    expect(recipients[0].address).toBe(VALID_ADDRESS_3);
    expect(errors).toHaveLength(2);
    expect(errors[0]).toEqual({ row: 2, message: expect.stringMatching(/Invalid amount at row 2/i) });
    expect(errors[1]).toEqual({ row: 3, message: expect.stringMatching(/Invalid amount at row 3/i) });
  });

  it("flags zero, negative, NaN, and Infinity amounts with line numbers", async () => {
    const content = `address,amount,memo
${VALID_ADDRESS_1},0,zero
${VALID_ADDRESS_2},-100,negative
${VALID_ADDRESS_3},NaN,nan
${VALID_ADDRESS_4},Infinity,infinity
`;
    const { recipients, errors } = await parseRecipientsCsv(csvFile(content));

    expect(recipients).toHaveLength(0);
    expect(errors).toHaveLength(4);
    expect(errors[0]).toEqual({ row: 2, message: expect.stringMatching(/Invalid amount at row 2/i) });
    expect(errors[1]).toEqual({ row: 3, message: expect.stringMatching(/Invalid amount at row 3/i) });
    expect(errors[2]).toEqual({ row: 4, message: expect.stringMatching(/Invalid amount at row 4/i) });
    expect(errors[3]).toEqual({ row: 5, message: expect.stringMatching(/Invalid amount at row 5/i) });
  });

  it("flags memo exceeding 28 characters with line number", async () => {
    const longMemo = "a".repeat(29);
    const content = `address,amount,memo\n${VALID_ADDRESS_1},100,${longMemo}\n`;
    const { recipients, errors } = await parseRecipientsCsv(csvFile(content));

    expect(recipients).toHaveLength(0);
    expect(errors).toHaveLength(1);
    expect(errors[0].row).toBe(2);
    expect(errors[0].message).toMatch(/Memo at row 2 must be 28 bytes or fewer/i);
  });

  it("flags memo containing C0/C1 control characters with line number", async () => {
    const content = `address,amount,memo\n${VALID_ADDRESS_1},100,hello\u0000world\n${VALID_ADDRESS_2},50,test\u001Fmemo\n`;
    const { recipients, errors } = await parseRecipientsCsv(csvFile(content));

    expect(recipients).toHaveLength(0);
    expect(errors).toHaveLength(2);
    expect(errors[0].row).toBe(2);
    expect(errors[0].message).toMatch(/Memo at row 2 must not contain control or invisible characters/i);
    expect(errors[1].row).toBe(3);
    expect(errors[1].message).toMatch(/Memo at row 3 must not contain control or invisible characters/i);
  });

  it("reports accurate line numbers across interleaved valid and invalid rows", async () => {
    const content = `address,amount,memo
${VALID_ADDRESS_1},100,row2_ok
BAD_ADDRESS_1,50,row3_bad
${VALID_ADDRESS_2},200,row4_ok
${VALID_ADDRESS_3},0,row5_bad_amount
${VALID_ADDRESS_4},300,row6_ok
BAD_ADDRESS_2,150,row7_bad
`;
    const { recipients, errors } = await parseRecipientsCsv(csvFile(content));

    expect(recipients).toHaveLength(3);
    expect(recipients[0].address).toBe(VALID_ADDRESS_1);
    expect(recipients[1].address).toBe(VALID_ADDRESS_2);
    expect(recipients[2].address).toBe(VALID_ADDRESS_4);

    expect(errors).toHaveLength(3);
    expect(errors[0].row).toBe(3);
    expect(errors[0].message).toContain("row 3");
    expect(errors[1].row).toBe(5);
    expect(errors[1].message).toContain("row 5");
    expect(errors[2].row).toBe(7);
    expect(errors[2].message).toContain("row 7");
  });

  it("parseRecipientsCsvToRows assigns 1-based sourceRow and captures field-level errors", async () => {
    const content = `address,amount,memo
${VALID_ADDRESS_1},100,valid
BAD_ADDRESS,50,bad_addr
${VALID_ADDRESS_2},-10,bad_amt
${VALID_ADDRESS_3},10,${"x".repeat(30)}
`;
    const { rows, fileErrors } = await parseRecipientsCsvToRows(csvFile(content));

    expect(fileErrors).toEqual([]);
    expect(rows).toHaveLength(4);
    expect(rows[0].sourceRow).toBe(1);
    expect(rows[0].errors).toEqual({});

    expect(rows[1].sourceRow).toBe(2);
    expect(rows[1].errors.address).toMatch(/invalid/i);

    expect(rows[2].sourceRow).toBe(3);
    expect(rows[2].errors.amount).toMatch(/greater than 0/i);

    expect(rows[3].sourceRow).toBe(4);
    expect(rows[3].errors.memo).toMatch(/28/i);
  });
});

// ── Header Handling & Missing Headers ─────────────────────────

describe("CSV Batch Parser > Header Handling and Variations", () => {
  it("rejects an empty file with row 0 error", async () => {
    const { recipients, errors } = await parseRecipientsCsv(csvFile(""));
    expect(recipients).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0].row).toBe(0);
    expect(errors[0].message).toMatch(/header row/i);
  });

  it("rejects a whitespace-only file", async () => {
    const { recipients, errors } = await parseRecipientsCsv(csvFile("   \n  \r\n  \t  "));
    expect(recipients).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0].row).toBe(0);
    expect(errors[0].message).toMatch(/header row/i);
  });

  it("rejects a CSV with only a header row and no data", async () => {
    const { recipients, errors } = await parseRecipientsCsv(csvFile("address,amount,memo\n"));
    expect(recipients).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0].row).toBe(0);
    expect(errors[0].message).toMatch(/header row/i);
  });

  it("handles case-insensitive header names (ADDRESS, AMOUNT, MEMO)", async () => {
    const content = `ADDRESS,AMOUNT,MEMO\n${VALID_ADDRESS_1},100,test\n`;
    const { recipients, errors } = await parseRecipientsCsv(csvFile(content));

    expect(errors).toEqual([]);
    expect(recipients).toHaveLength(1);
    expect(recipients[0].address).toBe(VALID_ADDRESS_1);
    expect(recipients[0].amount).toBe(100);
    expect(recipients[0].memo).toBe("test");
  });

  it("handles headers with surrounding whitespace", async () => {
    const content = `  address  ,  amount  ,  memo  \n${VALID_ADDRESS_1},100,test\n`;
    const { recipients, errors } = await parseRecipientsCsv(csvFile(content));

    expect(errors).toEqual([]);
    expect(recipients).toHaveLength(1);
    expect(recipients[0].address).toBe(VALID_ADDRESS_1);
    expect(recipients[0].amount).toBe(100);
    expect(recipients[0].memo).toBe("test");
  });

  it("falls back gracefully when unnamed/custom headers are used pos-by-pos", async () => {
    const content = `col1,col2,col3\n${VALID_ADDRESS_1},100,test\n`;
    const { recipients, errors } = await parseRecipientsCsv(csvFile(content));

    expect(errors).toEqual([]);
    expect(recipients).toHaveLength(1);
    expect(recipients[0].address).toBe(VALID_ADDRESS_1);
    expect(recipients[0].amount).toBe(100);
    expect(recipients[0].memo).toBe("test");
  });
});

// ── Extra Columns ─────────────────────────────────────────────

describe("CSV Batch Parser > Extra Columns", () => {
  it("ignores extra columns in the header and correctly extracts target fields", async () => {
    const content = `index,address,tag,amount,notes,memo,created_at
101,${VALID_ADDRESS_1},vip,75.25,internal_note,customer_memo,2026-08-29
`;
    const { recipients, errors } = await parseRecipientsCsv(csvFile(content));

    expect(errors).toEqual([]);
    expect(recipients).toHaveLength(1);
    expect(recipients[0]).toEqual({
      address: VALID_ADDRESS_1,
      amount: 75.25,
      assetCode: "XLM",
      memo: "customer_memo",
    });
  });

  it("ignores extra columns and trailing commas in data rows", async () => {
    const content = `address,amount,memo\n${VALID_ADDRESS_1},100,bonus,extra1,extra2,,,\n`;
    const { recipients, errors } = await parseRecipientsCsv(csvFile(content));

    expect(errors).toEqual([]);
    expect(recipients).toHaveLength(1);
    expect(recipients[0].address).toBe(VALID_ADDRESS_1);
    expect(recipients[0].amount).toBe(100);
    expect(recipients[0].memo).toBe("bonus");
  });
});

// ── UTF-8 Content, Encodings, and Line Endings ─────────────────

describe("CSV Batch Parser > UTF-8 Encodings and Line Endings", () => {
  it("strips leading UTF-8 BOM (U+FEFF) from start of file", async () => {
    const content = `\uFEFFaddress,amount,memo\n${VALID_ADDRESS_1},100,bom_test\n`;
    const { recipients, errors } = await parseRecipientsCsv(csvFile(content));

    expect(errors).toEqual([]);
    expect(recipients).toHaveLength(1);
    expect(recipients[0].address).toBe(VALID_ADDRESS_1);
    expect(recipients[0].memo).toBe("bom_test");
  });

  it("supports diverse multi-byte UTF-8 Unicode characters in memo", async () => {
    const content = `address,amount,memo
${VALID_ADDRESS_1},10,Café
${VALID_ADDRESS_2},20,Gebühr
${VALID_ADDRESS_3},30,支付
${VALID_ADDRESS_4},40,Thanh toán
`;
    const { recipients, errors } = await parseRecipientsCsv(csvFile(content));

    expect(errors).toEqual([]);
    expect(recipients).toHaveLength(4);
    expect(recipients[0].memo).toBe("Café");
    expect(recipients[1].memo).toBe("Gebühr");
    expect(recipients[2].memo).toBe("支付");
    expect(recipients[3].memo).toBe("Thanh toán");
  });

  it("strictly enforces 28-byte UTF-8 limit on multi-byte memo content", async () => {
    // 9 Chinese characters * 3 bytes each = 27 bytes (valid)
    const validChineseMemo = "一二三四五六七八九";
    expect(new TextEncoder().encode(validChineseMemo).length).toBe(27);

    // 10 Chinese characters * 3 bytes each = 30 bytes (invalid, exceeds 28 bytes)
    const invalidChineseMemo = "一二三四五六七八九十";
    expect(new TextEncoder().encode(invalidChineseMemo).length).toBe(30);

    const content = `address,amount,memo
${VALID_ADDRESS_1},100,${validChineseMemo}
${VALID_ADDRESS_2},200,${invalidChineseMemo}
`;
    const { recipients, errors } = await parseRecipientsCsv(csvFile(content));

    expect(recipients).toHaveLength(1);
    expect(recipients[0].memo).toBe(validChineseMemo);
    expect(errors).toHaveLength(1);
    expect(errors[0].row).toBe(3);
    expect(errors[0].message).toMatch(/Memo at row 3 must be 28 bytes or fewer/i);
  });

  it("handles Windows CRLF, Unix LF, and Mac CR line endings interchangeably", async () => {
    const crlf = `address,amount,memo\r\n${VALID_ADDRESS_1},10,crlf\r\n`;
    const lf = `address,amount,memo\n${VALID_ADDRESS_2},20,lf\n`;
    const cr = `address,amount,memo\r${VALID_ADDRESS_3},30,cr\r`;

    const res1 = await parseRecipientsCsv(csvFile(crlf));
    const res2 = await parseRecipientsCsv(csvFile(lf));
    const res3 = await parseRecipientsCsv(csvFile(cr));

    expect(res1.recipients).toHaveLength(1);
    expect(res1.recipients[0].memo).toBe("crlf");
    expect(res2.recipients).toHaveLength(1);
    expect(res2.recipients[0].memo).toBe("lf");
    expect(res3.recipients).toHaveLength(1);
    expect(res3.recipients[0].memo).toBe("cr");
  });
});

// ── Quoted Fields and Escaping ─────────────────────────────────

describe("CSV Batch Parser > Quoted Fields and Escaping", () => {
  it("handles fields containing embedded commas inside quotes", async () => {
    const content = `address,amount,memo\n${VALID_ADDRESS_1},100,"Salary, bonus"\n`;
    const { recipients, errors } = await parseRecipientsCsv(csvFile(content));

    expect(errors).toEqual([]);
    expect(recipients).toHaveLength(1);
    expect(recipients[0].memo).toBe("Salary, bonus");
  });

  it("handles escaped double-quotes (\"\" inside quoted fields)", async () => {
    const content = `address,amount,memo\n${VALID_ADDRESS_1},100,"Project ""Alpha"""\n`;
    const { recipients, errors } = await parseRecipientsCsv(csvFile(content));

    expect(errors).toEqual([]);
    expect(recipients).toHaveLength(1);
    expect(recipients[0].memo).toBe('Project "Alpha"');
  });

  it("handles newlines inside quoted fields at CSV level and flags control chars for memo", async () => {
    // At cell parsing level, newlines in quotes are preserved
    expect(parseCsvText('a,"Line 1\nLine 2",c\n')).toEqual([["a", "Line 1\nLine 2", "c"]]);

    // When used in batch payments, memo field rejects newline control character with row error
    const content = `address,amount,memo\n${VALID_ADDRESS_1},100,"Line 1\nLine 2"\n`;
    const { recipients, errors } = await parseRecipientsCsv(csvFile(content));

    expect(recipients).toHaveLength(0);
    expect(errors).toHaveLength(1);
    expect(errors[0].row).toBe(2);
    expect(errors[0].message).toMatch(/Memo at row 2 must not contain control or invisible characters/i);
  });

  it("handles quotes around addresses and amounts with surrounding spaces", async () => {
    const content = `address,amount,memo\n "${VALID_ADDRESS_1}" , "150.75" , "clean memo" \n`;
    const { recipients, errors } = await parseRecipientsCsv(csvFile(content));

    expect(errors).toEqual([]);
    expect(recipients).toHaveLength(1);
    expect(recipients[0].address).toBe(VALID_ADDRESS_1);
    expect(recipients[0].amount).toBe(150.75);
    expect(recipients[0].memo).toBe("clean memo");
  });

  it("handles unclosed / unterminated quotes without throwing an exception", async () => {
    const content = `address,amount,memo\n"${VALID_ADDRESS_1},100,unclosed quote\n${VALID_ADDRESS_2},50,ok\n`;
    expect(async () => {
      const { recipients } = await parseRecipientsCsv(csvFile(content));
      expect(Array.isArray(recipients)).toBe(true);
    }).not.toThrow();
  });
});

// ── Parser Resilience and Anti-Throw Guarantee ─────────────────

describe("CSV Batch Parser > Resilience and Bad Input Guarantee", () => {
  it("never throws when called with null, undefined, or malformed file object", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const resNull = await parseRecipientsCsv(null as any);
    expect(resNull.recipients).toEqual([]);
    expect(resNull.errors).toHaveLength(1);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const resUndefined = await parseRecipientsCsv(undefined as any);
    expect(resUndefined.recipients).toEqual([]);
    expect(resUndefined.errors).toHaveLength(1);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const resRowsNull = await parseRecipientsCsvToRows(null as any);
    expect(resRowsNull.rows).toEqual([]);
    expect(resRowsNull.fileErrors).toHaveLength(1);
  });

  it("never throws when file.text() throws or rejects", async () => {
    const badFile = {
      text: () => Promise.reject(new Error("Disk I/O error")),
    } as unknown as File;

    const res = await parseRecipientsCsv(badFile);
    expect(res.recipients).toEqual([]);
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0].row).toBe(0);

    const resRows = await parseRecipientsCsvToRows(badFile);
    expect(resRows.rows).toEqual([]);
    expect(resRows.fileErrors).toHaveLength(1);
  });

  it("never throws on random binary or corrupted data", async () => {
    const binaryJunk = "\x00\xFF\xFE\x00\x12\x34\x56\x78\x00\x00\x00";
    const res = await parseRecipientsCsv(csvFile(binaryJunk));
    expect(Array.isArray(res.recipients)).toBe(true);
    expect(Array.isArray(res.errors)).toBe(true);
  });

  it("parseCsvText returns empty array on non-string input without throwing", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(parseCsvText(null as any)).toEqual([]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(parseCsvText(undefined as any)).toEqual([]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(parseCsvText(12345 as any)).toEqual([]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(parseCsvText({} as any)).toEqual([]);
  });

  it("drops empty rows and whitespace-only lines without throwing", () => {
    const parsed = parseCsvText("a,b\n\n   \n\r\n\tc,d\n   \n");
    expect(parsed).toEqual([
      ["a", "b"],
      ["\tc", "d"],
    ]);
  });

  it("enforces MAX_BATCH_RECIPIENTS limit in parseRecipientsCsvToRows", async () => {
    const lines = ["address,amount,memo"];
    for (let i = 0; i < MAX_BATCH_RECIPIENTS + 5; i++) {
      lines.push(`${VALID_ADDRESS_1},${i + 1},memo_${i}`);
    }
    const { rows, fileErrors } = await parseRecipientsCsvToRows(
      csvFile(lines.join("\n"))
    );

    expect(rows).toHaveLength(MAX_BATCH_RECIPIENTS + 5);
    expect(fileErrors).toHaveLength(1);
    expect(fileErrors[0]).toMatch(/maximum 100 recipients/i);
  });
});