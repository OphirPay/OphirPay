import { parseCSV, serializeCSV } from '../../src/lib/csv-core';

describe('CSV core property tests', () => {
  test('round‑trip preserves data', () => {
    const rows = [
      ['a', 'b', 'c'],
      ['1', '2', '3'],
      ['foo,bar', 'baz', 'qux'],
      ['"quoted"', 'simple', ''],
      ['multi\nline', 'test', 'end'],
    ];
    const csv = serializeCSV(rows);
    const parsed = parseCSV(csv);
    expect(parsed).toEqual(rows);
  });

  test('quoted field with comma, quote and CRLF round‑trips', () => {
    const rows = [
      ['field1', 'field, with, commas', 'field "with" quotes', 'field\r\nwith\nnewlines'],
    ];
    const csv = serializeCSV(rows);
    const parsed = parseCSV(csv);
    expect(parsed).toEqual(rows);
  });

  test('handles BOM on parse', () => {
    const csv = '\uFEFF"a","b","c"\r\n"1","2","3"';
    const parsed = parseCSV(csv);
    expect(parsed).toEqual([['a', 'b', 'c'], ['1', '2', '3']]);
  });

  test('serialises with BOM when requested', () => {
    const rows = [['a', 'b', 'c']];
    const csv = serializeCSV(rows, { prependBom: true });
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toBe('\uFEFF"a","b","c"');
  });
});
