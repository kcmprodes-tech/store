import { describe, expect, it } from 'vitest';
import { generateInvoiceNo, INVOICE_PATTERN } from '../src/lib/invoice.js';

describe('nomor invoice', () => {
  it('berformat SKC-YYMMDD-XXXXXX dengan tanggal WIB', () => {
    // 13 Okt 2026 20:00 UTC = 14 Okt 2026 03:00 WIB
    const no = generateInvoiceNo(new Date('2026-10-13T20:00:00Z'), () => 0);
    expect(no).toBe('SKC-261014-AAAAAA');
    expect(no).toMatch(INVOICE_PATTERN);
  });

  it('tidak memakai karakter yang mudah tertukar (O, 0, I, 1)', () => {
    for (let i = 0; i < 200; i++) {
      const no = generateInvoiceNo();
      expect(no).toMatch(INVOICE_PATTERN);
      expect(no.slice(11)).not.toMatch(/[O0I1]/);
    }
  });
});
