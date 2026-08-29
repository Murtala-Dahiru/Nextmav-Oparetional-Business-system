import { inflateRawSync } from 'node:zlib';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Reading a spreadsheet, without a spreadsheet library
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── Why this is hand-written ──────────────────────────────────────────────
 *
 * The Import Center needs CSV and XLSX. CSV is eighty lines of scanner and
 * nobody would reach for a dependency for it. XLSX looks like it needs one -
 * and the usual answers are a megabyte of code, a large dependency tree and a
 * parser far more capable than a lead list requires.
 *
 * An `.xlsx` is a ZIP of XML. Node ships the only hard part of that in its
 * standard library: `zlib.inflateRawSync`. What remains is a central-directory
 * walk and two small XML scans, which is what this file is. Zero dependencies,
 * every line auditable, and it runs on the server where the untrusted bytes
 * belong.
 *
 * ── What it deliberately does not do ──────────────────────────────────────
 *
 * Formulas are read as their cached value, which is what the file already
 * carries and what the author saw. Charts, images, pivot tables, macros,
 * conditional formatting and multiple sheets beyond the first are ignored: a
 * list of leads has none of them, and a parser that tried would be a parser
 * with more failure modes than features. Encrypted workbooks are refused with
 * a sentence rather than a stack trace.
 *
 * ── On trusting the input ─────────────────────────────────────────────────
 *
 * Every length read out of the file is checked against the buffer before it is
 * used, and the inflated size is capped. A ZIP is a format that invites the
 * decompression bomb, and "the library handles it" is not something this file
 * gets to say.
 */

/** Nothing larger is accepted, compressed or decompressed. */
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_ENTRY_BYTES = 64 * 1024 * 1024;

/** The most rows one import will look at. */
export const MAX_ROWS = 5000;

export interface Sheet {
  /** Header names, in file order, trimmed. Blank headers become `Column N`. */
  columns: string[];
  /** One array of cell strings per row, padded to `columns.length`. */
  rows: string[][];
  /** How the file was read, for the message the screen shows. */
  format: 'csv' | 'xlsx';
  /** Rows present in the file beyond `MAX_ROWS`, which were not read. */
  truncated: number;
  /** The sheet the data came from, where the format has a name for it. */
  sheetName?: string;
}

export class SheetError extends Error {}

/* -------------------------------------------------------------------------- */
/*  Entry point                                                               */
/* -------------------------------------------------------------------------- */

export function readSheet(bytes: Buffer, filename: string): Sheet {
  if (bytes.length === 0) throw new SheetError('That file is empty.');
  if (bytes.length > MAX_FILE_BYTES) {
    throw new SheetError(
      `That file is ${Math.round(bytes.length / 1024 / 1024)}MB. The limit is ${MAX_FILE_BYTES / 1024 / 1024}MB - split it and import in parts.`,
    );
  }

  /**
   * The magic number decides, not the extension.
   *
   * People rename files, and a `.csv` that is really a workbook is a common
   * enough mistake that failing on it with "no columns found" would be a
   * support conversation. `PK\x03\x04` is a ZIP, and every `.xlsx` is one.
   */
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;

  if (isZip) return readXlsx(bytes);

  if (/\.xlsx?$/i.test(filename) && !isZip) {
    /**
     * `.xls` is a completely different format - OLE2 compound document, not a
     * ZIP - and pretending to read it would produce nonsense rather than an
     * error. Said plainly, with the fix.
     */
    throw new SheetError(
      'That looks like an older .xls workbook. Open it in Excel or Sheets and save as .xlsx or .csv, then try again.',
    );
  }

  return readCsv(bytes);
}

/* -------------------------------------------------------------------------- */
/*  CSV                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Which single character separates the fields.
 *
 * Sniffed from the first few lines rather than assumed, because a comma is not
 * the separator in most of Europe - Excel writes semicolons under a locale
 * whose decimal mark is a comma, and a "CSV" exported there has one column
 * when read naively. Tabs are included because "save as tab-delimited" is what
 * people do when their data contains commas.
 *
 * The winner is the candidate that appears the same number of times on every
 * one of the first lines, which is what a real delimiter does and what a
 * comma inside prose does not.
 */
function sniffDelimiter(text: string): string {
  const lines = text.split(/\r?\n/).filter(l => l.trim()).slice(0, 5);
  if (!lines.length) return ',';

  let best = ',';
  let bestScore = -1;

  for (const candidate of [',', ';', '\t', '|']) {
    const counts = lines.map(l => countOutsideQuotes(l, candidate));
    const first = counts[0];
    if (!first) continue;
    const consistent = counts.every(c => c === first);
    const score = first * (consistent ? 10 : 1);
    if (score > bestScore) { bestScore = score; best = candidate; }
  }

  return best;
}

function countOutsideQuotes(line: string, ch: string): number {
  let n = 0;
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') quoted = !quoted;
    else if (!quoted && c === ch) n++;
  }
  return n;
}

/**
 * RFC 4180, plus the two things real files do that it does not describe:
 * a UTF-8 byte-order mark, and bare `\r` line endings from very old exports.
 */
function readCsv(bytes: Buffer): Sheet {
  let text = bytes.toString('utf8');
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  const delimiter = sniffDelimiter(text);
  const grid: string[][] = [];

  let row: string[] = [];
  let field = '';
  let quoted = false;
  let i = 0;

  const endField = () => { row.push(field); field = ''; };
  const endRow = () => {
    endField();
    // A trailing newline produces one empty row; so does a blank line in the
    // middle of a file people have edited by hand. Neither is a record.
    if (row.some(c => c.trim() !== '')) grid.push(row);
    row = [];
  };

  while (i < text.length) {
    const c = text[i];

    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        quoted = false; i++; continue;
      }
      field += c; i++; continue;
    }

    if (c === '"' && field === '') { quoted = true; i++; continue; }
    if (c === delimiter) { endField(); i++; continue; }
    if (c === '\r') { if (text[i + 1] === '\n') i++; endRow(); i++; continue; }
    if (c === '\n') { endRow(); i++; continue; }

    field += c; i++;
  }
  if (field !== '' || row.length) endRow();

  return shape(grid, 'csv');
}

/* -------------------------------------------------------------------------- */
/*  ZIP                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * The files inside a ZIP archive, by name.
 *
 * Walks the central directory rather than scanning for local headers: the
 * central directory is the archive's own index, it is what every ZIP writer
 * agrees on, and reading it means a corrupt or hostile local header cannot
 * make this loop run away.
 */
function unzip(bytes: Buffer): Map<string, Buffer> {
  const EOCD = 0x06054b50;
  const CEN = 0x02014b50;

  // The end-of-central-directory record is the last 22 bytes unless the
  // archive carries a comment, which Excel's do not - but scanning back the
  // permitted 64KB costs nothing and is what the format actually specifies.
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) {
    if (bytes.readUInt32LE(i) === EOCD) { eocd = i; break; }
  }
  if (eocd < 0) throw new SheetError('That workbook could not be read - the file looks damaged.');

  const count = bytes.readUInt16LE(eocd + 10);
  const cenOffset = bytes.readUInt32LE(eocd + 16);

  if (count === 0xffff || cenOffset === 0xffffffff) {
    throw new SheetError('That workbook uses ZIP64, which usually means it is enormous. Export the sheet as CSV instead.');
  }

  const files = new Map<string, Buffer>();
  let p = cenOffset;

  for (let n = 0; n < count; n++) {
    if (p + 46 > bytes.length || bytes.readUInt32LE(p) !== CEN) break;

    const method = bytes.readUInt16LE(p + 10);
    const compressed = bytes.readUInt32LE(p + 20);
    const uncompressed = bytes.readUInt32LE(p + 24);
    const nameLen = bytes.readUInt16LE(p + 28);
    const extraLen = bytes.readUInt16LE(p + 30);
    const commentLen = bytes.readUInt16LE(p + 32);
    const localOffset = bytes.readUInt32LE(p + 42);
    const name = bytes.toString('utf8', p + 46, p + 46 + nameLen);

    p += 46 + nameLen + extraLen + commentLen;

    // Only the four parts a lead list needs. Skipping the rest is not an
    // optimisation, it is the difference between inflating a 40KB worksheet
    // and inflating every embedded image in somebody's branded template.
    if (!/^(xl\/worksheets\/|xl\/sharedStrings\.xml|xl\/workbook\.xml$|xl\/styles\.xml$|xl\/_rels\/workbook\.xml\.rels$)/.test(name)) {
      continue;
    }

    if (uncompressed > MAX_ENTRY_BYTES) {
      throw new SheetError('That workbook expands to more than this import can handle. Export the sheet as CSV instead.');
    }

    // The local header repeats the name and extra-field lengths, and they are
    // allowed to differ from the central directory's. The data starts after
    // whatever the *local* header says.
    if (localOffset + 30 > bytes.length || bytes.readUInt32LE(localOffset) !== 0x04034b50) continue;
    const lNameLen = bytes.readUInt16LE(localOffset + 26);
    const lExtraLen = bytes.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + lNameLen + lExtraLen;
    const end = start + compressed;
    if (end > bytes.length) continue;

    const raw = bytes.subarray(start, end);

    try {
      if (method === 0) files.set(name, Buffer.from(raw));
      else if (method === 8) files.set(name, inflateRawSync(raw, { maxOutputLength: MAX_ENTRY_BYTES }));
      // Any other method is one Excel does not write. Silently skipped rather
      // than failing the import: the sheet may still be readable without it.
    } catch {
      throw new SheetError('That workbook could not be unpacked. It may be password protected.');
    }
  }

  return files;
}

/* -------------------------------------------------------------------------- */
/*  XLSX                                                                      */
/* -------------------------------------------------------------------------- */

/** `&amp;` and friends. The five XML predefined entities plus numeric ones. */
function unescapeXml(s: string): string {
  if (!s.includes('&')) return s;
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&');
}

/**
 * The shared string table.
 *
 * Excel stores every distinct string once and refers to it by index, which is
 * why a cell reading "Acme Ltd" contains `<v>4</v>`. A string can be split
 * across several `<r>` runs when part of it is formatted differently, so the
 * text of an entry is every `<t>` inside it concatenated - taking only the
 * first would silently truncate any cell somebody had bolded half of.
 */
function sharedStrings(xml: string | undefined): string[] {
  if (!xml) return [];
  const out: string[] = [];
  const items = xml.split(/<si\b/).slice(1);
  for (const item of items) {
    const body = item.slice(0, item.indexOf('</si>') + 1);
    let text = '';
    const re = /<t[^>]*>([\s\S]*?)<\/t>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(body))) text += m[1];
    out.push(unescapeXml(text));
  }
  return out;
}

/** Built-in number formats that mean "this is a date". */
const DATE_FORMAT_IDS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);

/**
 * Which cell styles render as a date.
 *
 * A date in a workbook is a number - days since 1899-12-30 - and the only
 * thing that distinguishes 45000 the quantity from 45000 the date is the
 * number format attached to its style. Without reading `styles.xml`, every
 * date column in an imported file arrives as a five-digit integer, which is
 * exactly the sort of quietly-wrong import this feature exists to prevent.
 */
function dateStyles(xml: string | undefined): Set<number> {
  const dates = new Set<number>();
  if (!xml) return dates;

  const custom = new Set<number>();
  const fmtRe = /<numFmt[^>]*numFmtId="(\d+)"[^>]*formatCode="([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = fmtRe.exec(xml))) {
    const code = unescapeXml(m[2]);
    // A format with a day, month or year token and no currency or percent.
    if (/[dmy]/i.test(code) && !/[$%]/.test(code)) custom.add(Number(m[1]));
  }

  const cellXfs = xml.slice(xml.indexOf('<cellXfs'), xml.indexOf('</cellXfs>'));
  const xfRe = /<xf\b[^>]*>/g;
  let index = 0;
  while ((m = xfRe.exec(cellXfs))) {
    const id = /numFmtId="(\d+)"/.exec(m[0]);
    const fmt = id ? Number(id[1]) : 0;
    if (DATE_FORMAT_IDS.has(fmt) || custom.has(fmt)) dates.add(index);
    index++;
  }

  return dates;
}

/**
 * An Excel serial date as `YYYY-MM-DD`.
 *
 * The epoch is 1899-12-30, not 1900-01-01, because Lotus 1-2-3 believed 1900
 * was a leap year and Excel has faithfully reproduced the mistake for forty
 * years. Off-by-one here would date every imported record one day early.
 */
function serialToDate(serial: number): string {
  const ms = Math.round((serial - 25569) * 86_400_000);
  const d = new Date(ms);
  if (!Number.isFinite(d.getTime())) return String(serial);
  return d.toISOString().slice(0, 10);
}

/** `BC12` to its zero-based column index. */
function columnIndex(ref: string): number {
  let n = 0;
  for (const ch of ref) {
    const code = ch.charCodeAt(0);
    if (code < 65 || code > 90) break;
    n = n * 26 + (code - 64);
  }
  return n - 1;
}

function readXlsx(bytes: Buffer): Sheet {
  const files = unzip(bytes);

  /**
   * Which worksheet is "the first one".
   *
   * `xl/worksheets/sheet1.xml` is usually right and is not reliably right: the
   * file names follow creation order, not tab order, so a workbook whose first
   * tab was added second has its data in `sheet2.xml`. The workbook's own
   * `<sheets>` list is in tab order, and the relationship id points at the
   * part - which is the only correct way to answer this.
   */
  const workbook = files.get('xl/workbook.xml')?.toString('utf8');
  const rels = files.get('xl/_rels/workbook.xml.rels')?.toString('utf8');

  let target: string | null = null;
  let sheetName: string | undefined;

  const firstSheet = workbook ? /<sheet\b[^>]*>/.exec(workbook) : null;
  if (firstSheet) {
    sheetName = unescapeXml(/name="([^"]*)"/.exec(firstSheet[0])?.[1] ?? '') || undefined;
    const rid = /r:id="([^"]*)"/.exec(firstSheet[0])?.[1];
    if (rid && rels) {
      const rel = new RegExp(`<Relationship[^>]*Id="${rid}"[^>]*>`).exec(rels)?.[0];
      const t = rel ? /Target="([^"]*)"/.exec(rel)?.[1] : null;
      if (t) target = 'xl/' + t.replace(/^\/?xl\//, '').replace(/^\.\//, '');
    }
  }

  const sheetXml =
    (target ? files.get(target) : undefined)
    ?? files.get('xl/worksheets/sheet1.xml')
    ?? [...files.entries()].find(([k]) => k.startsWith('xl/worksheets/'))?.[1];

  if (!sheetXml) throw new SheetError('That workbook has no readable sheet in it.');

  const strings = sharedStrings(files.get('xl/sharedStrings.xml')?.toString('utf8'));
  const dates = dateStyles(files.get('xl/styles.xml')?.toString('utf8'));

  const xml = sheetXml.toString('utf8');
  const grid: string[][] = [];
  let truncated = 0;

  const rowRe = /<row\b[^>]*>([\s\S]*?)<\/row>/g;
  let rowMatch: RegExpExecArray | null;

  while ((rowMatch = rowRe.exec(xml))) {
    if (grid.length >= MAX_ROWS + 1) { truncated++; continue; }

    const cells: string[] = [];
    const cellRe = /<c\b([^>]*)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let cellMatch: RegExpExecArray | null;

    while ((cellMatch = cellRe.exec(rowMatch[1]))) {
      const attrs = cellMatch[1];
      const body = cellMatch[2] ?? '';

      const ref = /r="([A-Z]+)\d+"/.exec(attrs)?.[1];
      const at = ref ? columnIndex(ref) : cells.length;
      // Empty cells are omitted from the XML entirely, so a row's cells have
      // to be placed by their reference or every value after a gap shifts left.
      while (cells.length < at) cells.push('');

      const type = /t="([^"]*)"/.exec(attrs)?.[1] ?? 'n';
      const style = Number(/s="(\d+)"/.exec(attrs)?.[1] ?? NaN);
      const raw = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];

      let value = '';
      if (type === 's') {
        value = strings[Number(raw)] ?? '';
      } else if (type === 'inlineStr') {
        const parts = body.match(/<t[^>]*>([\s\S]*?)<\/t>/g) ?? [];
        value = unescapeXml(parts.map(p => p.replace(/<[^>]*>/g, '')).join(''));
      } else if (type === 'str') {
        value = unescapeXml(raw ?? '');
      } else if (type === 'b') {
        value = raw === '1' ? 'TRUE' : 'FALSE';
      } else if (type === 'e') {
        // A formula error cell. Empty is more honest than "#REF!" in a lead's
        // phone number.
        value = '';
      } else if (raw != null && raw !== '') {
        const n = Number(raw);
        value = Number.isFinite(n) && dates.has(style) ? serialToDate(n) : unescapeXml(raw);
      }

      cells[at] = value;
    }

    if (cells.some(c => c.trim() !== '')) grid.push(cells);
  }

  const sheet = shape(grid, 'xlsx');
  sheet.truncated = truncated;
  sheet.sheetName = sheetName;
  return sheet;
}

/* -------------------------------------------------------------------------- */
/*  Header row and padding                                                    */
/* -------------------------------------------------------------------------- */

function shape(grid: string[][], format: 'csv' | 'xlsx'): Sheet {
  if (!grid.length) {
    throw new SheetError('There are no rows in that file.');
  }

  const header = grid[0].map(h => h.trim());
  const width = Math.max(header.length, ...grid.map(r => r.length));

  const columns: string[] = [];
  for (let i = 0; i < width; i++) {
    const name = (header[i] ?? '').trim();
    // A column with no heading still holds data somebody may want to map, so
    // it is named rather than dropped.
    columns.push(name || `Column ${i + 1}`);
  }

  const body = grid.slice(1, MAX_ROWS + 1).map(r => {
    const out = new Array<string>(width);
    for (let i = 0; i < width; i++) out[i] = (r[i] ?? '').trim();
    return out;
  });

  return {
    columns,
    rows: body,
    format,
    truncated: Math.max(0, grid.length - 1 - body.length),
  };
}
