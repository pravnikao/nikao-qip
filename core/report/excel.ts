import ExcelJS from 'exceljs';

/** Shared workbook styling so every QIP output looks like one product. */
export const COLORS = {
  header: 'FF1F3A5F',
  headerText: 'FFFFFFFF',
  pass: 'FFDFF3E4',
  known: 'FFFDE2E1',
  fail: 'FFF8D7DA',
  infra: 'FFEFEDFF',
  skip: 'FFEEEEEE',
  warn: 'FFFFF1C2',
  info: 'FFDCEBFA',
  muted: 'FF555555',
};

export function outcomeFill(outcome: string): string {
  if (outcome === 'Pass') return COLORS.pass;
  if (outcome.startsWith('Pass')) return COLORS.pass;
  if (outcome === 'Fail – known defect') return COLORS.known;
  if (outcome === 'Fail – infrastructure' || outcome === 'Fail – setup') return COLORS.infra;
  if (outcome.startsWith('Fail')) return COLORS.fail;
  if (outcome === 'Flaky') return COLORS.warn;
  return COLORS.skip;
}

export function title(ws: ExcelJS.Worksheet, text: string, sub?: string): void {
  ws.getCell('A1').value = text;
  ws.getCell('A1').font = { name: 'Arial', bold: true, size: 14 };
  if (sub) {
    ws.getCell('A2').value = sub;
    ws.getCell('A2').font = { name: 'Arial', italic: true, size: 9, color: { argb: COLORS.muted } };
  }
}

export interface Column {
  header: string;
  width: number;
  wrap?: boolean;
}

/** Writes a header row and data rows from `row`, starting at `startRow`. Returns the next free row. */
export function table(ws: ExcelJS.Worksheet, startRow: number, cols: Column[], rows: (string | number | undefined | null)[][], opts: { freeze?: boolean; filter?: boolean } = {}): number {
  cols.forEach((c, i) => {
    const cell = ws.getRow(startRow).getCell(i + 1);
    cell.value = c.header;
    cell.font = { name: 'Arial', bold: true, color: { argb: COLORS.headerText }, size: 10 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.header } };
    cell.alignment = { wrapText: true, vertical: 'middle' };
    if (ws.getColumn(i + 1).width === undefined || (ws.getColumn(i + 1).width ?? 0) < c.width) ws.getColumn(i + 1).width = c.width;
  });
  rows.forEach((r, ri) => {
    const row = ws.getRow(startRow + 1 + ri);
    r.forEach((v, ci) => {
      const cell = row.getCell(ci + 1);
      cell.value = v === undefined || v === null ? '' : v;
      cell.font = { name: 'Arial', size: 10 };
      cell.alignment = { wrapText: cols[ci]?.wrap ?? false, vertical: 'top' };
      cell.border = { top: { style: 'thin', color: { argb: 'FFC8CED6' } }, bottom: { style: 'thin', color: { argb: 'FFC8CED6' } }, left: { style: 'thin', color: { argb: 'FFC8CED6' } }, right: { style: 'thin', color: { argb: 'FFC8CED6' } } };
    });
  });
  if (opts.freeze) ws.views = [{ state: 'frozen', ySplit: startRow, xSplit: 0 }];
  if (opts.filter && rows.length) ws.autoFilter = { from: { row: startRow, column: 1 }, to: { row: startRow + rows.length, column: cols.length } };
  return startRow + rows.length + 2;
}

export function fillCell(ws: ExcelJS.Worksheet, row: number, col: number, argb: string): void {
  ws.getRow(row).getCell(col).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb } };
}

/** A drop-down list for a decision column (BAU decision etc.). */
export function dropdown(ws: ExcelJS.Worksheet, col: number, fromRow: number, toRow: number, options: string[]): void {
  for (let r = fromRow; r <= toRow; r++) {
    ws.getRow(r).getCell(col).dataValidation = { type: 'list', allowBlank: true, formulae: [`"${options.join(',')}"`] };
  }
}

export function pct(n: number, d: number): string {
  return d ? `${((n / d) * 100).toFixed(1)}%` : '–';
}
