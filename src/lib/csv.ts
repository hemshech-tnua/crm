// CSV that opens correctly in Excel (UTF-8 BOM, CRLF), with formula-injection protection.
export type Column<T> = { header: string; value: (row: T) => string | number | boolean | null | undefined };
type Cell = string | number | boolean | null | undefined;

function cell(v: Cell): string {
  if (v == null) return '';
  let s = String(v);
  // a value starting with = + - @ (or tab/CR) would run as a formula in Excel
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  if (/[",\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** `footer`: an optional last row (e.g. totals), one value per column in the same order. */
export function toCsv<T>(rows: T[], columns: Column<T>[], footer?: Cell[]): string {
  const lines = [columns.map((c) => cell(c.header)).join(',')];
  for (const r of rows) lines.push(columns.map((c) => cell(c.value(r))).join(','));
  if (footer) lines.push(columns.map((_, i) => cell(footer[i])).join(','));
  return '﻿' + lines.join('\r\n');
}

/** "2026-11-01" → "01.11.2026" (for file names: no slashes). */
const dotted = (iso: string) => iso.slice(0, 10).split('-').reverse().join('.');

/**
 * A readable Hebrew file name: "כספים 01.11.2026-30.11.2026.csv". Characters a file system refuses are dropped.
 * `range`: the period the file covers; a missing start reads "עד <to>", a missing end "מ־<from>".
 */
export function csvFileName(title: string, range?: { from: string | null; to: string | null } | string): string {
  let when = '';
  if (typeof range === 'string') when = range;
  else if (range && (range.from || range.to)) {
    when = range.from && range.to ? `${dotted(range.from)}-${dotted(range.to)}` : range.from ? `מ־${dotted(range.from)}` : `עד ${dotted(range.to!)}`;
  }
  const name = [title, when].filter(Boolean).join(' ').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();
  return `${name || 'ייצוא'}.csv`;
}

export function downloadFile(filename: string, content: string | Blob, type = 'text/csv;charset=utf-8') {
  const blob = typeof content === 'string' ? new Blob([content], { type }) : content;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
