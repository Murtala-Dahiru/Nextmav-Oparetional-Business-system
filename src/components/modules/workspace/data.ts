/**
 * ===========================================================================
 *  Talking to the workspace endpoints
 * ===========================================================================
 *
 *  Every screen in this module reads through these, so error handling is
 *  written once. The module this replaces declared its own `api<T>()` inside
 *  `index.tsx` and a second, differently-behaved `fetch` wrapper inside the
 *  sheet grid: one read `json.error` and returned regardless of status, so a
 *  500 with an HTML body resolved with `data: undefined` and the screen
 *  rendered as empty rather than as broken.
 */

export interface ApiFailure extends Error {
  status: number;
  code?: string;
  details?: any;
}

function fail(message: string, status: number, code?: string, details?: unknown): ApiFailure {
  const e = new Error(message) as ApiFailure;
  e.status = status;
  e.code = code;
  e.details = details;
  return e;
}

async function unwrap(res: Response) {
  const json = await res.json().catch(() => null);
  if (json?.error) {
    throw fail(
      json.error.message || 'Request failed',
      res.status,
      json.error.code,
      json.error.details,
    );
  }
  if (!res.ok) throw fail(`Request failed (${res.status})`, res.status);
  return json;
}

export async function getOne<T>(url: string): Promise<T> {
  return (await unwrap(await fetch(url))).data as T;
}

export async function getList<T>(url: string): Promise<T[]> {
  return ((await unwrap(await fetch(url))).data ?? []) as T[];
}

async function send<T>(url: string, method: string, body?: unknown): Promise<T> {
  const json = await unwrap(await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }));
  return json?.data as T;
}

export const post = <T,>(url: string, body: unknown) => send<T>(url, 'POST', body);
export const patch = <T,>(url: string, body: unknown) => send<T>(url, 'PATCH', body);
export const remove = <T = void,>(url: string) => send<T>(url, 'DELETE');

/* -------------------------------------------------------------------------- */
/*  Saying things                                                             */
/* -------------------------------------------------------------------------- */

/** "3 documents", "1 document". Said the way somebody would say it. */
export function count(n: number, singular: string, plural?: string): string {
  return `${n} ${n === 1 ? singular : plural ?? `${singular}s`}`;
}

/**
 * What a node is, in one word.
 *
 * A folder is a folder whatever `kind` says - the column is only meaningful
 * for a page - and the previous module printed "Document" against folders in
 * the contents grid because it checked `kind` first.
 */
export function kindWord(node: { isFolder: boolean; kind: string }): string {
  if (node.isFolder) return 'Folder';
  return node.kind === 'sheet' ? 'Spreadsheet' : 'Document';
}

/**
 * A heading outline pulled out of markdown.
 *
 * Used by the editor's contents rail and by the reading view. Fenced code is
 * tracked, because `# include` inside a shell block is not a heading, and a
 * document with three code blocks otherwise gets an outline made of comments.
 */
export interface Heading { level: number; text: string; slug: string; line: number }

export function outlineOf(markdown: string): Heading[] {
  const out: Heading[] = [];
  const seen = new Map<string, number>();
  let fenced = false;

  markdown.split('\n').forEach((raw, index) => {
    if (/^\s*(```|~~~)/.test(raw)) { fenced = !fenced; return; }
    if (fenced) return;

    const hit = /^(#{1,4})\s+(.+?)\s*#*\s*$/.exec(raw);
    if (!hit) return;

    const text = hit[2].replace(/[*_`]/g, '').trim();
    if (!text) return;

    const base = slugify(text);
    // Two sections called "Summary" would otherwise share an anchor, and every
    // click on the second would scroll to the first.
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);

    out.push({
      level: hit[1].length,
      text,
      slug: n === 1 ? base : `${base}-${n}`,
      line: index,
    });
  });

  return out;
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 80) || 'section';
}

/**
 * Roughly how long a document takes to read, and how big it is.
 *
 * 220 words a minute, which is the ordinary figure for prose on a screen.
 * Reported only above a minute: "less than a minute" is worth saying and
 * "1 minute" against a two-line note is not.
 */
export function readingTime(markdown: string): string | null {
  const words = markdown.trim().split(/\s+/).filter(Boolean).length;
  if (words < 120) return null;
  const minutes = Math.max(1, Math.round(words / 220));
  return `${minutes} min read`;
}

export function wordCount(markdown: string): number {
  return markdown.trim().split(/\s+/).filter(Boolean).length;
}
