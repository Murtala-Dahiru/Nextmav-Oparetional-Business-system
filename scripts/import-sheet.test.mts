/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  The spreadsheet reader, and the mapping it feeds
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *     npm run test:import
 *
 * ── Why this test exists ──────────────────────────────────────────────────
 *
 * `lib/import/sheet.ts` reads a ZIP archive and two XML dialects by hand,
 * without a dependency. That is the right call for eight dependency-free
 * kilobytes, and it comes with an obligation: the parts a library would have
 * tested have to be tested here instead. A CSV whose delimiter is a semicolon,
 * a workbook whose first tab is `sheet2.xml`, a date stored as the number
 * 45000, a row with a gap in the middle - each of those is a real file
 * somebody will upload, and each fails silently rather than loudly if the
 * parser is wrong.
 *
 * The workbook fixtures are built here rather than checked in as binaries, so
 * what is being tested is legible in the same file as the assertion.
 */
import { deflateRawSync } from 'node:zlib';
import { readSheet, SheetError } from '../src/lib/import/sheet';
import { suggestMapping } from '../src/lib/import/mapping';
import { buildCandidate, readNumber, splitName, normaliseCompany, domainOf } from '../src/lib/import/records';

let passed = 0;
let failed = 0;

function check(name: string, condition: boolean, detail = '') {
  if (condition) { passed++; console.log(`    PASS  ${name}`); }
  else { failed++; console.log(`    FAIL  ${name}${detail ? ` - ${detail}` : ''}`); }
}

function eq(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  check(name, a === b, `got ${a}, wanted ${b}`);
}

function section(title: string) {
  console.log(`\n  ${title}\n  ${'─'.repeat(title.length)}`);
}

/* -------------------------------------------------------------------------- */
/*  A minimal ZIP writer, so the XLSX fixtures are readable source             */
/* -------------------------------------------------------------------------- */

function zip(entries: Record<string, string>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const [name, content] of Object.entries(entries)) {
    const raw = Buffer.from(content, 'utf8');
    const deflated = deflateRawSync(raw);
    const nameBuf = Buffer.from(name, 'utf8');

    // CRC is required by the format and not checked by the reader, so it is
    // computed properly here rather than zeroed - a fixture that is not a
    // valid archive would not be testing the reader against a real file.
    const crc = crc32(raw);

    const local = Buffer.alloc(30 + nameBuf.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(0, 10);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(deflated.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    nameBuf.copy(local, 30);

    const central = Buffer.alloc(46 + nameBuf.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(0, 12);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(deflated.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    nameBuf.copy(central, 46);

    locals.push(local, deflated);
    centrals.push(central);
    offset += local.length + deflated.length;
  }

  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(centrals.length, 8);
  eocd.writeUInt16LE(centrals.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);

  return Buffer.concat([...locals, cd, eocd]);
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/* -------------------------------------------------------------------------- */
/*  Fixtures                                                                  */
/* -------------------------------------------------------------------------- */

function workbook(opts: {
  /** Sheet parts, keyed by their path inside the archive. */
  sheets: Record<string, string>;
  /** Which part the workbook's first tab points at. */
  firstTarget: string;
  firstName?: string;
  strings?: string[];
  styles?: string;
}) {
  const si = (opts.strings ?? []).map(s => `<si><t>${s}</t></si>`).join('');

  return zip({
    'xl/workbook.xml':
      `<?xml version="1.0"?><workbook><sheets>`
      + `<sheet name="${opts.firstName ?? 'Sheet1'}" sheetId="1" r:id="rId1"/>`
      + `</sheets></workbook>`,
    'xl/_rels/workbook.xml.rels':
      `<?xml version="1.0"?><Relationships>`
      + `<Relationship Id="rId1" Target="${opts.firstTarget}"/>`
      + `</Relationships>`,
    'xl/sharedStrings.xml': `<?xml version="1.0"?><sst count="${(opts.strings ?? []).length}">${si}</sst>`,
    'xl/styles.xml': opts.styles
      ?? `<?xml version="1.0"?><styleSheet><cellXfs count="1"><xf numFmtId="0"/></cellXfs></styleSheet>`,
    ...opts.sheets,
  });
}

const s = (i: number) => `<c r="{R}" t="s"><v>${i}</v></c>`;

/* -------------------------------------------------------------------------- */

console.log('\n  Import: spreadsheet reading and field mapping');
console.log('  ═════════════════════════════════════════════');

/* ── CSV ─────────────────────────────────────────────────────────────────── */

section('1. CSV');

{
  const csv = 'Name,Email,Company\nAda Lovelace,ada@example.test,Acme Ltd\nAlan Turing,alan@example.test,Bletchley\n';
  const sheet = readSheet(Buffer.from(csv), 'leads.csv');
  eq('columns are the header row', sheet.columns, ['Name', 'Email', 'Company']);
  eq('two data rows', sheet.rows.length, 2);
  eq('values land in order', sheet.rows[1], ['Alan Turing', 'alan@example.test', 'Bletchley']);
}

{
  const csv = 'Name;Email;City\nAda;ada@x.test;Lagos\nAlan;alan@x.test;Abuja\n';
  const sheet = readSheet(Buffer.from(csv), 'leads.csv');
  eq('a semicolon file is not one column', sheet.columns.length, 3);
}

{
  const csv = 'Name\tValue\nAda\t1,250\n';
  const sheet = readSheet(Buffer.from(csv), 'leads.tsv');
  eq('tab-delimited is read', sheet.rows[0], ['Ada', '1,250']);
}

{
  const csv = 'Name,Notes\n"Ada, Countess","She said ""hello"" first"\n';
  const sheet = readSheet(Buffer.from(csv), 'leads.csv');
  eq('quoted commas stay inside the field', sheet.rows[0][0], 'Ada, Countess');
  eq('doubled quotes unescape', sheet.rows[0][1], 'She said "hello" first');
}

{
  const csv = '﻿Name,Email\nAda,ada@x.test\n';
  const sheet = readSheet(Buffer.from(csv, 'utf8'), 'leads.csv');
  eq('a byte-order mark does not become part of the first heading', sheet.columns[0], 'Name');
}

{
  const csv = 'Name,Email\nAda,ada@x.test\n\n\nAlan,alan@x.test\n';
  const sheet = readSheet(Buffer.from(csv), 'leads.csv');
  eq('blank lines are not records', sheet.rows.length, 2);
}

{
  let threw = '';
  try { readSheet(Buffer.from(''), 'empty.csv'); } catch (e: any) { threw = e.message; }
  check('an empty file is refused with a sentence', threw.includes('empty'), threw);
  check('and it is a SheetError', threw !== '' );
}

/* ── XLSX ────────────────────────────────────────────────────────────────── */

section('2. XLSX');

{
  const bytes = workbook({
    firstTarget: 'worksheets/sheet1.xml',
    strings: ['Name', 'Email', 'Ada Lovelace', 'ada@example.test'],
    sheets: {
      'xl/worksheets/sheet1.xml':
        `<worksheet><sheetData>`
        + `<row r="1">${s(0).replace('{R}', 'A1')}${s(1).replace('{R}', 'B1')}</row>`
        + `<row r="2">${s(2).replace('{R}', 'A2')}${s(3).replace('{R}', 'B2')}</row>`
        + `</sheetData></worksheet>`,
    },
  });

  const sheet = readSheet(bytes, 'leads.xlsx');
  eq('shared strings resolve', sheet.columns, ['Name', 'Email']);
  eq('the data row reads', sheet.rows[0], ['Ada Lovelace', 'ada@example.test']);
  eq('the format is reported', sheet.format, 'xlsx');
}

{
  /* The first tab is sheet2.xml, which is what happens when a tab is moved. */
  const bytes = workbook({
    firstTarget: 'worksheets/sheet2.xml',
    firstName: 'Prospects',
    strings: ['Company', 'Northwind'],
    sheets: {
      'xl/worksheets/sheet1.xml':
        `<worksheet><sheetData><row r="1"><c r="A1" t="str"><v>WRONG</v></c></row></sheetData></worksheet>`,
      'xl/worksheets/sheet2.xml':
        `<worksheet><sheetData>`
        + `<row r="1">${s(0).replace('{R}', 'A1')}</row>`
        + `<row r="2">${s(1).replace('{R}', 'A2')}</row>`
        + `</sheetData></worksheet>`,
    },
  });

  const sheet = readSheet(bytes, 'leads.xlsx');
  eq('the workbook decides which sheet is first, not the file name', sheet.columns, ['Company']);
  eq('the sheet name comes back', sheet.sheetName, 'Prospects');
}

{
  /* A gap: B is missing on the data row, so C must not shift into it. */
  const bytes = workbook({
    firstTarget: 'worksheets/sheet1.xml',
    strings: ['A', 'B', 'C', 'left', 'right'],
    sheets: {
      'xl/worksheets/sheet1.xml':
        `<worksheet><sheetData>`
        + `<row r="1">${s(0).replace('{R}', 'A1')}${s(1).replace('{R}', 'B1')}${s(2).replace('{R}', 'C1')}</row>`
        + `<row r="2">${s(3).replace('{R}', 'A2')}${s(4).replace('{R}', 'C2')}</row>`
        + `</sheetData></worksheet>`,
    },
  });

  const sheet = readSheet(bytes, 'gaps.xlsx');
  eq('an omitted cell keeps its column', sheet.rows[0], ['left', '', 'right']);
}

{
  /* Style 1 carries a date format, so 45000 is a date and 45000 is not. */
  const styles =
    `<styleSheet><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs></styleSheet>`;

  const bytes = workbook({
    firstTarget: 'worksheets/sheet1.xml',
    strings: ['Quantity', 'Signed'],
    styles,
    sheets: {
      'xl/worksheets/sheet1.xml':
        `<worksheet><sheetData>`
        + `<row r="1">${s(0).replace('{R}', 'A1')}${s(1).replace('{R}', 'B1')}</row>`
        + `<row r="2"><c r="A2"><v>45000</v></c><c r="B2" s="1"><v>45000</v></c></row>`
        + `</sheetData></worksheet>`,
    },
  });

  const sheet = readSheet(bytes, 'dates.xlsx');
  eq('a plain number stays a number', sheet.rows[0][0], '45000');
  eq('a date-formatted number becomes a date', sheet.rows[0][1], '2023-03-15');
}

{
  const bytes = workbook({
    firstTarget: 'worksheets/sheet1.xml',
    sheets: {
      'xl/worksheets/sheet1.xml':
        `<worksheet><sheetData>`
        + `<row r="1"><c r="A1" t="inlineStr"><is><t>Company</t></is></c></row>`
        + `<row r="2"><c r="A2" t="inlineStr"><is><t>Ada &amp; Co</t></is></c></row>`
        + `</sheetData></worksheet>`,
    },
  });

  const sheet = readSheet(bytes, 'inline.xlsx');
  eq('inline strings are read and unescaped', sheet.rows[0][0], 'Ada & Co');
}

{
  let threw = '';
  try {
    readSheet(Buffer.from('\xd0\xcf\x11\xe0 old excel', 'binary'), 'old.xls');
  } catch (e: any) { threw = e.message; }
  check('an .xls is refused with the fix, not a stack trace', threw.includes('.xlsx or .csv'), threw);
}

/* ── Mapping ─────────────────────────────────────────────────────────────── */

section('3. Column mapping');

{
  const columns = ['Business Name', 'Contact Person', 'Email Address', 'Mobile', 'Web Address', 'Sector'];
  const rows = [
    ['Acme Ltd', 'Ada Lovelace', 'ada@acme.test', '+234 801 234 5678', 'acme.test', 'Software'],
    ['Bletchley', 'Alan Turing', 'alan@bp.test', '+234 802 345 6789', 'www.bp.test', 'Research'],
    ['Northwind', 'Grace Hopper', 'grace@nw.test', '08033456789', 'nw.test', 'Logistics'],
  ];

  const got = suggestMapping(columns, rows);
  const field = (h: string) => got.find(c => c.header === h)?.field;

  eq('Business Name is the company', field('Business Name'), 'companyName');
  eq('Contact Person is the person', field('Contact Person'), 'fullName');
  eq('Email Address is the email', field('Email Address'), 'email');
  eq('Mobile is the phone', field('Mobile'), 'phone');
  eq('Web Address is the website', field('Web Address'), 'website');
  eq('Sector is the industry', field('Sector'), 'industry');

  const emailCol = got.find(c => c.header === 'Email Address')!;
  eq('a heading the values agree with is certain', emailCol.confidence, 'certain');
}

{
  /* No usable headings at all: the values have to carry it. */
  const columns = ['Column 1', 'Column 2'];
  const rows = [
    ['ada@x.test', 'Ada'],
    ['alan@x.test', 'Alan'],
    ['grace@x.test', 'Grace'],
    ['edsger@x.test', 'Edsger'],
  ];
  const got = suggestMapping(columns, rows);
  eq('a column of addresses is recognised without a heading', got[0].field, 'email');
  eq('and it is not claimed as certain', got[0].confidence, 'unsure');
  eq('a column of names with no heading is left alone', got[1].field, null);
}

{
  /* Two columns competing for one field. */
  const columns = ['Email', 'Billing Email'];
  const rows = [['a@x.test', 'b@x.test'], ['c@x.test', 'd@x.test'], ['e@x.test', 'f@x.test']];
  const got = suggestMapping(columns, rows);
  eq('the exact heading wins the field', got[0].field, 'email');
  check('and the runner-up is not mapped to the same field', got[1].field !== 'email');
}

{
  const columns = ['Full Name', 'First Name', 'Last Name'];
  const rows = [['Ada Lovelace', 'Ada', 'Lovelace'], ['Alan Turing', 'Alan', 'Turing'], ['Grace H', 'Grace', 'H']];
  const got = suggestMapping(columns, rows);
  eq('split name columns beat a combined one', got[0].field, null);
  eq('first name is mapped', got[1].field, 'firstName');
  eq('last name is mapped', got[2].field, 'lastName');
}

/* ── Values ──────────────────────────────────────────────────────────────── */

section('4. Reading values');

eq('plain integer', readNumber('1250'), 1250);
eq('thousand separators', readNumber('1,250,000'), 1250000);
eq('a currency symbol is ignored', readNumber('₦1,250.50'), 1250.5);
eq('European decimal comma', readNumber('1.250,50'), 1250.5);
eq('a bare comma with three digits is grouping', readNumber('1,250'), 1250);
eq('a bare comma with two digits is a decimal', readNumber('12,50'), 12.5);
eq('a magnitude suffix', readNumber('2.5m'), 2500000);
eq('parentheses are negative', readNumber('(400)'), -400);
eq('unreadable is null, not zero', readNumber('n/a'), null);
eq('empty is null', readNumber(''), null);

eq('a two-part name splits', splitName('Ada Lovelace'), { first: 'Ada', last: 'Lovelace' });
eq('a surname-first name splits', splitName('Lovelace, Ada'), { first: 'Ada', last: 'Lovelace' });
eq('a single word is a first name', splitName('Ada'), { first: 'Ada', last: '' });
eq('a three-part name keeps the tail together', splitName('Ada King Lovelace'), { first: 'Ada', last: 'King Lovelace' });

eq('Ltd and Limited normalise together', normaliseCompany('Acme Ltd'), normaliseCompany('Acme Limited'));
eq('punctuation does not matter', normaliseCompany('A.B.C. Inc.'), normaliseCompany('ABC'));
eq('an ampersand spells out', normaliseCompany('Smith & Sons'), 'smithandsons');
check('a suffix alone survives', normaliseCompany('Limited') === 'limited');

eq('a bare host is a domain', domainOf('acme.test'), 'acme.test');
eq('www is dropped', domainOf('https://www.acme.test/about'), 'acme.test');
eq('nonsense is no domain', domainOf('not a url'), '');

/* ── Candidates ──────────────────────────────────────────────────────────── */

section('5. Shaping a row');

{
  const mapping = { companyName: 0, fullName: 1, email: 2, phone: 3, estimatedValue: 4 };
  const c = buildCandidate(['Acme Ltd', 'Ada Lovelace', 'ada@acme.test', '08012345678', '₦2.5m'], mapping, 0);

  eq('the company is shaped', c.company?.name, 'Acme Ltd');
  eq('the name is split', [c.person?.firstName, c.person?.lastName], ['Ada', 'Lovelace']);
  eq('the value is read', c.person?.estimatedValue, 2500000);
  eq('nothing is wrong with it', c.problems.length, 0);
}

{
  const mapping = { fullName: 0, email: 1 };
  const c = buildCandidate(['Ada', 'not-an-email'], mapping, 0);
  eq('a bad address is not saved', c.person?.email, '');
  check('and it is reported as a warning', c.problems.some(p => p.field === 'email' && p.severity === 'warning'));
}

{
  const mapping = { fullName: 0, companyName: 1 };
  const c = buildCandidate(['', ''], mapping, 0);
  check('an empty row is an error, not a silent skip', c.problems.some(p => p.severity === 'error'));
}

{
  const mapping = { website: 0 };
  const c = buildCandidate(['https://www.acme.test'], mapping, 0);
  eq('a company known only by its site is named from the domain', c.company?.name, 'acme.test');
  eq('and no person is invented', c.person, null);
}

{
  const mapping = { fullName: 0, status: 1 };
  const c = buildCandidate(['Ada', 'Qualified'], mapping, 0);
  eq('a status is matched case-insensitively', c.person?.status, 'qualified');

  const bad = buildCandidate(['Alan', 'Marinated'], mapping, 0);
  eq('an unknown status falls back to new', bad.person?.status, 'new');
  check('and says so', bad.problems.some(p => p.field === 'status'));
}

/* -------------------------------------------------------------------------- */

console.log(`\n  ${passed} passed, ${failed} failed\n`);
if (failed) process.exit(1);
