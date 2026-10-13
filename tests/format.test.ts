import { describe, expect, it } from 'vitest';
import {
  discountPercent,
  formatIndonesianDate,
  formatNumber,
  formatRupiah,
  formatSold,
  parseIndonesianDate,
  parsePrice,
} from '../src/lib/format.js';

describe('format rupiah', () => {
  it('membaca harga string prototipe', () => {
    expect(parsePrice('162.000')).toEqual({ amount: 162000, suffix: null });
    expect(parsePrice('29.000/bulan')).toEqual({ amount: 29000, suffix: '/bulan' });
    expect(parsePrice('')).toEqual({ amount: 0, suffix: null });
  });

  it('memformat angka seperti prototipe', () => {
    expect(formatNumber(162000)).toBe('162.000');
    expect(formatNumber(1250000)).toBe('1.250.000');
    expect(formatNumber(500)).toBe('500');
    expect(formatRupiah(50000)).toBe('Rp 50.000');
  });

  it('menghitung persen diskon dengan pembulatan yang sama dengan data prototipe', () => {
    expect(discountPercent(120000, 162000)).toBe(26);
    expect(discountPercent(29000, 59000)).toBe(51);
    expect(discountPercent(20000, 35000)).toBe(43);
    expect(discountPercent(50000, null)).toBe(0);
    expect(discountPercent(50000, 40000)).toBe(0);
  });

  it('memformat jumlah terjual', () => {
    expect(formatSold(1900)).toBe('1,9 rb');
    expect(formatSold(1000)).toBe('1 rb');
    expect(formatSold(250)).toBe('250');
  });
});

describe('tanggal Indonesia', () => {
  it('membaca dan menulis ulang tanggal video', () => {
    const d = parseIndonesianDate('Rabu, 6 Mei 2026');
    expect(d?.toISOString()).toBe('2026-05-06T00:00:00.000Z');
    expect(formatIndonesianDate(d!)).toBe('Rabu, 6 Mei 2026');
    expect(parseIndonesianDate('bukan tanggal')).toBeNull();
  });
});
