// CSV that opens correctly in Excel (UTF-8 BOM, CRLF), with formula-injection protection.
export type Column<T> = { header: string; value: (row: T) => string | number | boolean | null | undefined };

function cell(v: string | number | boolean | null | undefined): string {
  if (v == null) return '';
  let s = String(v);
  // a value starting with = + - @ (or tab/CR) would run as a formula in Excel
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  if (/[",\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv<T>(rows: T[], columns: Column<T>[]): string {
  const lines = [columns.map((c) => cell(c.header)).join(',')];
  for (const r of rows) lines.push(columns.map((c) => cell(c.value(r))).join(','));
  return '﻿' + lines.join('\r\n');
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
