/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  A real .xlsx, built in memory
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Used by `import-sheet.test.mts` (against the reader directly) and by
 * `crm-verify.mjs` (against the running endpoint). Shared rather than written
 * twice, because the whole value of the fixture is that both are testing the
 * *same* bytes: a unit test passing on a workbook the endpoint would reject is
 * worse than no test.
 *
 * It writes a genuine archive - deflated entries, correct CRC32s, a real
 * central directory - so what is under test is the reader, not a convenient
 * approximation of one.
 */
import { deflateRawSync } from 'node:zlib';

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** A ZIP archive from `{ path: contents }`. */
export function zip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const [name, content] of Object.entries(entries)) {
    const raw = Buffer.from(content, 'utf8');
    const deflated = deflateRawSync(raw);
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = crc32(raw);

    const local = Buffer.alloc(30 + nameBuf.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(deflated.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    nameBuf.copy(local, 30);

    const central = Buffer.alloc(46 + nameBuf.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(deflated.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
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

const xml = s => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** A column letter from a zero-based index: 0 -> A, 26 -> AA. */
export function columnLetter(index) {
  let n = index + 1;
  let out = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

/**
 * A single-sheet workbook from a grid of JavaScript values.
 *
 * Strings go into the shared string table (which is what Excel does and what
 * the reader has to resolve); numbers are written bare; a `Date` is written as
 * a serial with a date-formatted style, which is the case that cannot be
 * tested any other way. `null` writes no cell at all, leaving a genuine hole
 * in the row.
 */
export function workbook(grid, { sheetName = 'Sheet1', target = 'worksheets/sheet1.xml' } = {}) {
  const strings = [];
  const indexOf = value => {
    const i = strings.indexOf(value);
    if (i >= 0) return i;
    strings.push(value);
    return strings.length - 1;
  };

  const rows = grid.map((row, r) => {
    const cells = row.map((value, c) => {
      if (value === null || value === undefined || value === '') return '';
      const ref = `${columnLetter(c)}${r + 1}`;

      if (value instanceof Date) {
        // Excel's epoch is 1899-12-30; style 1 below carries numFmtId 14.
        const serial = value.getTime() / 86_400_000 + 25569;
        return `<c r="${ref}" s="1"><v>${serial}</v></c>`;
      }
      if (typeof value === 'number') return `<c r="${ref}"><v>${value}</v></c>`;
      if (typeof value === 'boolean') return `<c r="${ref}" t="b"><v>${value ? 1 : 0}</v></c>`;
      return `<c r="${ref}" t="s"><v>${indexOf(String(value))}</v></c>`;
    }).join('');

    return `<row r="${r + 1}">${cells}</row>`;
  }).join('');

  const sst = strings.map(s => `<si><t xml:space="preserve">${xml(s)}</t></si>`).join('');

  return zip({
    '[Content_Types].xml':
      '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
    'xl/workbook.xml':
      `<?xml version="1.0"?><workbook><sheets>`
      + `<sheet name="${xml(sheetName)}" sheetId="1" r:id="rId1"/>`
      + `</sheets></workbook>`,
    'xl/_rels/workbook.xml.rels':
      `<?xml version="1.0"?><Relationships>`
      + `<Relationship Id="rId1" Target="${target}"/>`
      + `</Relationships>`,
    'xl/sharedStrings.xml':
      `<?xml version="1.0"?><sst count="${strings.length}">${sst}</sst>`,
    'xl/styles.xml':
      `<?xml version="1.0"?><styleSheet>`
      + `<cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs>`
      + `</styleSheet>`,
    [`xl/${target}`]: `<worksheet><sheetData>${rows}</sheetData></worksheet>`,
  });
}
