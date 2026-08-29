import { authorize } from '@/lib/auth-context';
import { success, error, serverError } from '@/lib/api-response';
import { readSheet, SheetError, MAX_ROWS } from '@/lib/import/sheet';
import { suggestMapping } from '@/lib/import/mapping';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Step one: read the file and say what is in it
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  ── Why the raw bytes, and not a multipart form ──────────────────────────
 *
 *  There is exactly one file and no other fields, so a multipart envelope
 *  would be a boundary parser and a `FormData` round trip to carry a single
 *  value. The browser posts the `File` object as the body, the filename rides
 *  in a header, and `req.arrayBuffer()` is the whole of the server side.
 *
 *  ── Why nothing is stored ────────────────────────────────────────────────
 *
 *  The parsed rows go back to the browser and come back with the confirmation.
 *  No upload lands in storage, no batch row is written, and an import that is
 *  abandoned halfway leaves nothing behind - which is the correct behaviour for
 *  a file somebody dragged in to see what would happen.
 *
 *  The cost is that the rows travel twice. For the sizes this accepts that is
 *  a megabyte, and it buys a workflow with no orphaned state and no cleanup
 *  job.
 *
 *  ── Permission ───────────────────────────────────────────────────────────
 *
 *  `crm.create`. Reading a file changes nothing, but there is no reason to
 *  offer the first step of a workflow to somebody who cannot finish it.
 */

/** Node, not edge: `zlib` is how the XLSX reader inflates the archive. */
export const runtime = 'nodejs';

const MAX_BODY = 8 * 1024 * 1024;

export async function POST(req: Request) {
  const ctx = await authorize('crm', 'create');
  if (ctx instanceof Response) return ctx;

  const declared = Number(req.headers.get('content-length') ?? 0);
  if (declared > MAX_BODY) {
    return error('That file is too large to import. The limit is 8MB.', 413, 'FILE_TOO_LARGE');
  }

  const filename = (req.headers.get('x-filename') ?? 'upload.csv').slice(0, 200);

  try {
    const bytes = Buffer.from(await req.arrayBuffer());
    if (bytes.length > MAX_BODY) {
      return error('That file is too large to import. The limit is 8MB.', 413, 'FILE_TOO_LARGE');
    }

    const sheet = readSheet(bytes, filename);
    const columns = suggestMapping(sheet.columns, sheet.rows);

    return success({
      filename,
      format: sheet.format,
      sheetName: sheet.sheetName ?? null,
      columns,
      rows: sheet.rows,
      rowCount: sheet.rows.length,
      /**
       * Rows past the cap, reported rather than dropped in silence.
       *
       * A twelve-thousand-row file that imports five thousand records without
       * saying so is the quiet wrong answer this whole feature is built to
       * avoid. The screen says what was read and what was not.
       */
      truncated: sheet.truncated,
      maxRows: MAX_ROWS,
    });
  } catch (e: any) {
    if (e instanceof SheetError) return error(e.message, 422, 'UNREADABLE_FILE');
    return serverError(e, 'That file could not be read.');
  }
}
