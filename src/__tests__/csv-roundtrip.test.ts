import { parseCSV, serializeCSV } from '../../src/lib/csv-core';

describe('CSV round‑trip', () => {
  it('should preserve a quoted field containing comma, quote and CRLF', () => {
    const rows = [
      ['simple', 'comma, inside', 'quote "inside"', 'CRLF\r\ninside'],
    ];
    const csv = serializeCSV(rows);
    const parsed = parseCSV(csv);
    expect(parsed).toEqual(rows);
  });
});
