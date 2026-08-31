/**
 * ===========================================================================
 *  The workspace, end to end, against the running application
 * ===========================================================================
 *
 *     APP_URL=http://localhost:3100 node scripts/workspace-verify.mjs
 *
 *  -- Why a harness of its own --------------------------------------------
 *
 *  `app:verify` proves the shared route factories work, and the workspace
 *  barely uses them: the page read is composed by hand, the sheet endpoint
 *  dispatches on a `target`, and the write path now carries an optimistic
 *  concurrency check. Phase 13 also turned on six things that fail *quietly*,
 *  which is this repository's dominant defect class:
 *
 *    - version history coalesces, so autosave must not fill it with keystrokes;
 *    - a stale write must be refused rather than silently overwriting a
 *      colleague's paragraph;
 *    - a comment on a private page must not be readable by somebody who
 *      cannot open the page (the leak 0035 closes);
 *    - a template copy must re-key its cells, or the grid renders columns with
 *      an empty body and the values are unreachable in the database;
 *    - a formula column must store nothing;
 *    - a link must read in both directions.
 *
 *  It signs in as the seeded demo owner and drives the real HTTP API, so the
 *  path under test is cookie session -> route -> RLS -> Postgres -> trigger.
 *  Everything it creates, it deletes.
 */

const BASE = process.env.APP_URL ?? 'http://localhost:3100';
const EMAIL = process.env.WORKSPACE_USER ?? 'dash-demo-owner@example.com';
const PASSWORD = process.env.WORKSPACE_PASS ?? 'Passw0rd!dashdemo';
/** An employee, for the checks that need a second, less privileged reader. */
const OTHER_EMAIL = process.env.WORKSPACE_OTHER ?? 'dash-demo-tobi@example.com';
const OTHER_PASSWORD = process.env.WORKSPACE_OTHER_PASS ?? PASSWORD;

let pass = 0, fail = 0;
const failed = [];

const check = (ok, label, detail = '') => {
  if (ok) { pass++; console.log(`    PASS  ${label}`); }
  else { fail++; failed.push(label); console.log(`    FAIL  ${label}${detail ? `  - ${detail}` : ''}`); }
  return ok;
};
const skip = label => console.log(`    SKIP  ${label}`);
const section = t => console.log(`\n  ${t}\n  ${'-'.repeat(t.length)}`);

function client() {
  const jar = new Map();
  return async function call(path, init = {}) {
    const cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
    const res = await fetch(BASE + path, {
      ...init,
      redirect: 'manual',
      headers: {
        'Content-Type': 'application/json',
        ...(cookie ? { cookie } : {}),
        ...(init.headers ?? {}),
      },
    });
    for (const raw of res.headers.getSetCookie?.() ?? []) {
      const [pair] = raw.split(';');
      const i = pair.indexOf('=');
      const name = pair.slice(0, i).trim();
      const value = pair.slice(i + 1).trim();
      if (value === '') jar.delete(name); else jar.set(name, value);
    }
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not every response is JSON */ }
    return { status: res.status, json, text };
  };
}

const call = client();
const bin = { pages: [] };

console.log('\n  Workspace verification');
console.log('  ======================');
console.log(`  ${BASE} as ${EMAIL}\n`);

/* -- 1. Session ----------------------------------------------------------- */

section('1. Session');
{
  const res = await call('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!check(res.status === 200, 'signed in', res.json?.error?.message ?? res.status)) {
    console.log('\n  Cannot continue without a session.\n');
    process.exit(1);
  }
}

/* -- 2. Home reads one population -------------------------------------- */

section('2. Workspace Home');
{
  const res = await call('/api/workspace/overview');
  check(res.status === 200, 'GET /api/workspace/overview', res.json?.error?.message);
  const d = res.json?.data;

  if (d) {
    check(Array.isArray(d.recent), 'recent is a list');
    check(d.recent.every(p => !p.isFolder), 'recent excludes folders');
    check(d.recent.every(p => !p.isTemplate), 'recent excludes templates');
    check(d.areas.every(a => a.isFolder && !a.parentId), 'areas are top-level folders');
    check(d.starred.every(p => p.isStarred), 'everything under starred is starred');
    check(d.sharedWithMe.every(p => p.isSharedWithMe),
      'shared with me means an explicit share, not merely readable');
    check(d.templates.every(p => p.isTemplate), 'the template list holds only templates');
    check(typeof d.counts.documents === 'number' && typeof d.counts.trash === 'number',
      'the counts are numbers');

    /**
     * The counts are their own reads and the lists are capped, so the counts
     * must be at least as large as what is shown. The reverse - counts derived
     * from a truncated list - is the defect the Executive Overview shipped
     * once and what this asserts cannot recur here.
     */
    check(d.counts.documents + d.counts.sheets >= d.recent.length,
      'the counts are not smaller than the list they head',
      `${d.counts.documents}+${d.counts.sheets} vs ${d.recent.length}`);
  }
}

/* -- 3. Creating, autosaving, and the history that survives it ---------- */

section('3. Documents, autosave and version history');

let page = null;
{
  const created = await call('/api/workspace/pages', {
    method: 'POST',
    body: JSON.stringify({
      title: `Verify ${Date.now()}`,
      summary: 'Written by workspace-verify.',
      content: '# One\n\nfirst\n',
    }),
  });
  check(created.status === 201, 'a document is created', created.json?.error?.message);
  page = created.json?.data;
  if (page) bin.pages.push(page.id);

  check(page?.summary === 'Written by workspace-verify.',
    'the create response carries the summary it was given');
  check(page?.permission === 'manage', 'the creator holds manage on it');
  check(page?.commentCount === 0 && page?.linkCount === 0,
    'the tree shape carries the new counters');
}

if (page) {
  /**
   * Five saves by one person inside a minute.
   *
   * This is what autosave looks like, and before 0035 it produced five
   * revisions - after which `prune_page_versions` would eventually discard the
   * one somebody actually wanted. The first opens a revision because the
   * previous editor was somebody else (or nobody); the rest extend it.
   */
  let version = page.version;
  for (let i = 0; i < 5; i++) {
    const res = await call(`/api/workspace/pages/${page.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ content: `# One\n\nedit ${i}\n`, baseVersion: version }),
    });
    if (res.status !== 200) { check(false, `save ${i} succeeded`, res.json?.error?.message); break; }
    version = res.json.data.version;
  }

  check(version === page.version + 5, 'five saves advanced the version five times',
    `${page.version} -> ${version}`);

  const history = await call(`/api/workspace/pages/${page.id}/versions`);
  const revisions = history.json?.data ?? [];
  check(revisions.length <= 1,
    'five consecutive saves by one person are one revision, not five',
    `${revisions.length} revisions`);

  /* The stale write. */
  const stale = await call(`/api/workspace/pages/${page.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ content: 'overwrite', baseVersion: page.version }),
  });
  check(stale.status === 409, 'a save against a stale version is refused', String(stale.status));
  check(stale.json?.error?.code === 'VERSION_CONFLICT', 'and says why');
  check(stale.json?.error?.details?.latestVersion === version,
    'and hands back the version that is actually stored');

  const unchanged = await call(`/api/workspace/pages/${page.id}`);
  check(unchanged.json?.data?.content !== 'overwrite',
    'the refused write changed nothing');

  /* An unguarded field is not blocked by a stale body version. */
  const starred = await call(`/api/workspace/pages/${page.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ isStarred: true }),
  });
  check(starred.status === 200, 'starring is not subject to the content guard');

  /* Reading one revision back, which is what "preview before restore" needs. */
  if (revisions.length) {
    const one = await call(`/api/workspace/pages/${page.id}/versions?version=${revisions[0].version}`);
    check(one.status === 200 && typeof one.json?.data?.content === 'string',
      'a single revision comes back with its body');
    check(!('content' in (revisions[0] ?? {})),
      'and the list deliberately does not carry every body');
  } else {
    skip('a single revision comes back with its body - no revisions yet');
  }
}

/* -- 4. Deep search --------------------------------------------------- */

section('4. Search inside documents');
if (page) {
  const phrase = `needle${Date.now()}`;
  const current = await call(`/api/workspace/pages/${page.id}`);
  await call(`/api/workspace/pages/${page.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ content: `# One\n\n${phrase}\n` , baseVersion: current.json.data.version }),
  });

  const byTitle = await call(`/api/workspace/pages?search=${phrase}`);
  check((byTitle.json?.data ?? []).length === 0,
    'the tree filter matches titles only, so a body phrase is not in it');

  const deep = await call(`/api/workspace/pages?q=${phrase}`);
  check((deep.json?.data ?? []).some(p => p.id === page.id),
    'and ?q= finds the page by a phrase inside it');

  const palette = await call(`/api/search?q=${phrase}`);
  check((palette.json?.data?.results ?? []).some(r => r.id === page.id),
    'the command palette finds it too');
}

/* -- 5. Spreadsheets --------------------------------------------------- */

section('5. Spreadsheets');

let sheet = null;
{
  const created = await call('/api/workspace/pages', {
    method: 'POST',
    body: JSON.stringify({ title: `Verify sheet ${Date.now()}`, kind: 'sheet' }),
  });
  sheet = created.json?.data;
  if (sheet) bin.pages.push(sheet.id);
  check(created.status === 201 && sheet?.kind === 'sheet', 'a spreadsheet is created');

  if (sheet) {
    const starters = await call(`/api/workspace/pages/${sheet.id}/sheet`);
    check((starters.json?.data?.columns ?? []).length === 3,
      'and arrives with starter columns rather than an empty grid');

    const qty = await call(`/api/workspace/pages/${sheet.id}/sheet`, {
      method: 'POST',
      body: JSON.stringify({ target: 'column', name: 'Qty', type: 'number', align: 'right' }),
    });
    const price = await call(`/api/workspace/pages/${sheet.id}/sheet`, {
      method: 'POST',
      body: JSON.stringify({
        target: 'column', name: 'Price', type: 'currency', decimals: 0, aggregate: 'sum',
      }),
    });
    const total = await call(`/api/workspace/pages/${sheet.id}/sheet`, {
      method: 'POST',
      body: JSON.stringify({
        target: 'column', name: 'Total', type: 'currency',
        formula: '=Qty * Price', aggregate: 'sum',
      }),
    });

    check(qty.json?.data?.align === 'right', 'a column keeps its alignment');
    check(price.json?.data?.decimals === 0 && price.json?.data?.aggregate === 'sum',
      'and its decimals and its total');
    check(total.json?.data?.formula === '=Qty * Price', 'and its formula');

    const bad = await call(`/api/workspace/pages/${sheet.id}/sheet`, {
      method: 'POST',
      body: JSON.stringify({ target: 'column', name: 'Nope', aggregate: 'median' }),
    });
    check(bad.status === 422, 'an aggregate that does not exist is refused');

    const row = await call(`/api/workspace/pages/${sheet.id}/sheet`, {
      method: 'POST', body: JSON.stringify({ target: 'row' }),
    });
    const rowId = row.json?.data?.id;
    check(row.status === 201, 'a row is added');

    if (rowId && qty.json?.data && price.json?.data) {
      await call(`/api/workspace/pages/${sheet.id}/sheet`, {
        method: 'PATCH',
        body: JSON.stringify({
          target: 'row', rowId,
          cells: { [qty.json.data.id]: 4, [price.json.data.id]: 250 },
        }),
      });
      const back = await call(`/api/workspace/pages/${sheet.id}/sheet`);
      const stored = (back.json?.data?.rows ?? []).find(r => r.id === rowId);

      check(stored?.cells?.[qty.json.data.id] === 4, 'a cell is written and read back');

      /**
       * A formula column stores nothing.
       *
       * A stored result is a second copy that goes stale the moment an input
       * changes. The value is worked out in the browser from the columns to
       * the formula's left, so its key must never appear in the row.
       */
      check(!(total.json.data.id in (stored?.cells ?? {})),
        'and a formula column holds no cells of its own');

      /* Emptying a cell removes the key rather than storing "". */
      await call(`/api/workspace/pages/${sheet.id}/sheet`, {
        method: 'PATCH',
        body: JSON.stringify({ target: 'row', rowId, cells: { [qty.json.data.id]: '' } }),
      });
      const after = await call(`/api/workspace/pages/${sheet.id}/sheet`);
      const emptied = (after.json?.data?.rows ?? []).find(r => r.id === rowId);
      check(!(qty.json.data.id in (emptied?.cells ?? {})),
        'an emptied cell is removed, not stored as an empty string');
      check(price.json.data.id in (emptied?.cells ?? {}),
        'and the other columns in the row survive it');
    }
  }
}

/* -- 6. Templates ------------------------------------------------------ */

section('6. Templates');
{
  const list = await call('/api/workspace/templates');
  const templates = list.json?.data ?? [];
  check(list.status === 200 && templates.length > 0, 'the gallery answers');
  check(templates.some(t => t.source === 'builtin'), 'the shipped library is in it');
  check(templates.every(t => t.title && t.summary),
    'every template says what it is for');

  const fromBuiltin = await call('/api/workspace/templates', {
    method: 'POST',
    body: JSON.stringify({ source: 'builtin', templateId: 'sop', title: `SOP ${Date.now()}` }),
  });
  const made = fromBuiltin.json?.data;
  if (made) bin.pages.push(made.id);
  check(fromBuiltin.status === 201, 'a page is created from a built-in template');
  check(made?.isTemplate === false,
    'and the copy is a document, not another template');

  if (made) {
    const body = await call(`/api/workspace/pages/${made.id}`);
    check((body.json?.data?.content ?? '').includes('## Steps'),
      'the template body was copied into it');
  }

  const missing = await call('/api/workspace/templates', {
    method: 'POST',
    body: JSON.stringify({ source: 'builtin', templateId: 'no-such-template' }),
  });
  check(missing.status === 404, 'a template that does not exist is refused');

  /**
   * The organisation's own template, which is the case that can silently lose
   * everything: cells are keyed by column id, so a copy that does not re-key
   * them renders a full set of columns above an entirely empty body.
   */
  if (sheet) {
    await call(`/api/workspace/pages/${sheet.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ isTemplate: true, templateCategory: 'Planning' }),
    });
    const copy = await call('/api/workspace/templates', {
      method: 'POST',
      body: JSON.stringify({
        source: 'organization', templateId: sheet.id, title: `Copy ${Date.now()}`,
      }),
    });
    const copied = copy.json?.data;
    if (copied) bin.pages.push(copied.id);
    check(copy.status === 201, 'a page is created from the organisation\'s own template');

    if (copied) {
      const full = await call(`/api/workspace/pages/${copied.id}`);
      const columns = full.json?.data?.columns ?? [];
      const rows = full.json?.data?.rows ?? [];
      const ids = new Set(columns.map(c => c.id));
      check(columns.length > 0 && rows.length > 0, 'with its columns and its rows');
      check(rows.every(r => Object.keys(r.cells ?? {}).every(k => ids.has(k))),
        'and every cell is keyed to a column that exists on the copy');
      check(columns.some(c => c.formula), 'the formula column came with it');
    }

    await call(`/api/workspace/pages/${sheet.id}`, {
      method: 'PATCH', body: JSON.stringify({ isTemplate: false }),
    });
  }
}

/* -- 7. Business record links, in both directions ---------------------- */

section('7. Business record links');
{
  const projects = await call('/api/projects/projects?pageSize=1');
  const project = (projects.json?.data ?? [])[0];

  if (!project || !page) {
    skip('links - no project to link to');
  } else {
    const made = await call(`/api/workspace/pages/${page.id}/links`, {
      method: 'POST',
      body: JSON.stringify({ entityType: 'project', entityId: project.id }),
    });
    check(made.status === 201, 'a page is linked to a project', made.json?.error?.message);
    check(made.json?.data?.label === project.name,
      'and the link resolves the record\'s current name');
    check(made.json?.data?.readable === true, 'and says the reader can open it');

    const again = await call(`/api/workspace/pages/${page.id}/links`, {
      method: 'POST',
      body: JSON.stringify({ entityType: 'project', entityId: project.id }),
    });
    check(again.status === 409, 'the same record cannot be linked twice');

    const nonsense = await call(`/api/workspace/pages/${page.id}/links`, {
      method: 'POST',
      body: JSON.stringify({ entityType: 'unicorn', entityId: project.id }),
    });
    check(nonsense.status === 422, 'a record type that does not exist is refused');

    const ghost = await call(`/api/workspace/pages/${page.id}/links`, {
      method: 'POST',
      body: JSON.stringify({
        entityType: 'project', entityId: '00000000-0000-0000-0000-000000000000',
      }),
    });
    check(ghost.status === 404, 'and a record that does not exist is refused');

    /* The reverse read: what has been written about this project. */
    const reverse = await call(`/api/workspace/links?entityType=project&entityId=${project.id}`);
    check(reverse.status === 200, 'the reverse lookup answers');
    check((reverse.json?.data ?? []).some(p => p.id === page.id),
      'and the page appears on the record it names');

    const detail = await call(`/api/workspace/pages/${page.id}`);
    check((detail.json?.data?.links ?? []).length === 1,
      'the page read ships its links with it');

    const linkId = made.json?.data?.id;
    const removed = await call(`/api/workspace/pages/${page.id}/links?linkId=${linkId}`, {
      method: 'DELETE',
    });
    check(removed.status === 200, 'a link can be removed');
  }
}

/* -- 8. Discussion ----------------------------------------------------- */

section('8. Discussion');
let comment = null;
if (page) {
  const posted = await call('/api/workspace/comments', {
    method: 'POST',
    body: JSON.stringify({ pageId: page.id, body: 'Is this still current?' }),
  });
  comment = posted.json?.data;
  check(posted.status === 201, 'a comment is posted on a page', posted.json?.error?.message);

  const reply = await call('/api/workspace/comments', {
    method: 'POST',
    body: JSON.stringify({ pageId: page.id, body: 'Yes.', parentId: comment?.id }),
  });
  check(reply.status === 201, 'and a reply is threaded under it');
  check(reply.json?.data?.parentId === comment?.id, 'with its parent on the row');

  const deeper = await call('/api/workspace/comments', {
    method: 'POST',
    body: JSON.stringify({ pageId: page.id, body: 'And again.', parentId: reply.json?.data?.id }),
  });
  check(deeper.status === 422, 'a reply to a reply is refused');

  const strayMention = await call('/api/workspace/comments', {
    method: 'POST',
    body: JSON.stringify({
      pageId: page.id, body: 'Hello', mentions: ['00000000-0000-0000-0000-000000000000'],
    }),
  });
  check(strayMention.status === 422, 'a mention of somebody who is not a colleague is refused');

  const empty = await call('/api/workspace/comments', {
    method: 'POST', body: JSON.stringify({ pageId: page.id, body: '   ' }),
  });
  check(empty.status === 422, 'an empty comment is refused');

  const thread = await call(`/api/workspace/comments?pageId=${page.id}`);
  check((thread.json?.data ?? []).length === 2, 'the thread reads back');

  if (comment) {
    const edited = await call(`/api/workspace/comments/${comment.id}`, {
      method: 'PATCH', body: JSON.stringify({ body: 'Is this current?' }),
    });
    check(edited.status === 200 && !!edited.json?.data?.editedAt,
      'an edit is marked rather than hidden');
  }

  const node = await call(`/api/workspace/pages/${page.id}`);
  check(node.json?.data?.commentCount === 2, 'and the page carries the count');
}

/* -- 9. Files and links ------------------------------------------------ */

section('9. Files and external links');
if (page) {
  const link = await call('/api/workspace/files', {
    method: 'POST',
    body: JSON.stringify({
      pageId: page.id,
      externalUrl: 'figma.com/file/verify',
      filename: 'Design (Figma)',
    }),
  });
  check(link.status === 201, 'a link is filed like an upload', link.json?.error?.message);
  check(link.json?.data?.externalUrl === 'https://figma.com/file/verify',
    'and a bare host is normalised to https');
  check(link.json?.data?.bucket === 'link', 'and it is discriminated by its bucket');

  const dangerous = await call('/api/workspace/files', {
    method: 'POST',
    body: JSON.stringify({
      pageId: page.id, externalUrl: 'javascript:alert(1)', filename: 'Bad',
    }),
  });
  check(dangerous.status === 422, 'a javascript: scheme is refused');

  const listed = await call(`/api/workspace/files?pageId=${page.id}`);
  check((listed.json?.data ?? []).some(f => f.externalUrl),
    'the view carries external_url, so a link is not a row with no address');

  const fileId = link.json?.data?.id;
  if (fileId) {
    const read = await call(`/api/workspace/files/${fileId}`);
    check(read.json?.data?.isLink === true && read.json?.data?.url,
      'opening a link returns its address rather than trying to sign it');
    await call(`/api/workspace/files/${fileId}`, { method: 'DELETE' });
  }
}

/* -- 10. Trash --------------------------------------------------------- */

section('10. Trash and restore');
{
  const folder = await call('/api/workspace/pages', {
    method: 'POST', body: JSON.stringify({ title: `Verify folder ${Date.now()}`, isFolder: true }),
  });
  const folderId = folder.json?.data?.id;
  const inside = await call('/api/workspace/pages', {
    method: 'POST',
    body: JSON.stringify({ title: 'Inside', parentId: folderId }),
  });
  const insideId = inside.json?.data?.id;

  await call(`/api/workspace/pages/${folderId}`, { method: 'DELETE' });

  const tree = await call('/api/workspace/pages?pageSize=500');
  const live = new Set((tree.json?.data ?? []).map(p => p.id));
  check(!live.has(folderId) && !live.has(insideId),
    'deleting a folder takes its contents out of the tree with it');

  const trash = await call('/api/workspace/trash');
  check((trash.json?.data ?? []).some(p => p.id === folderId), 'and both are in the trash');

  const restored = await call('/api/workspace/trash', {
    method: 'POST', body: JSON.stringify({ id: folderId }),
  });
  check(restored.json?.data?.restored >= 2,
    'restoring the folder brings back what was inside it',
    `restored ${restored.json?.data?.restored}`);

  bin.pages.push(folderId);
}

/* -- 11. The leak 0035 closes ------------------------------------------ */

section('11. A comment on a private page');
{
  const privatePage = await call('/api/workspace/pages', {
    method: 'POST',
    body: JSON.stringify({ title: `Private ${Date.now()}`, visibility: 'private' }),
  });
  const secret = privatePage.json?.data;
  if (secret) bin.pages.push(secret.id);
  check(privatePage.status === 201 && secret?.visibility === 'private',
    'a private page is created');

  if (secret) {
    const posted = await call('/api/workspace/comments', {
      method: 'POST',
      body: JSON.stringify({ pageId: secret.id, body: 'Salary review numbers are attached.' }),
    });
    check(posted.status === 201, 'and a comment is posted on it');

    const other = client();
    const signIn = await other('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: OTHER_EMAIL, password: OTHER_PASSWORD }),
    });

    if (signIn.status !== 200) {
      skip(`a colleague cannot read it - could not sign in as ${OTHER_EMAIL}`);
    } else {
      const page404 = await other(`/api/workspace/pages/${secret.id}`);
      check(page404.status === 404, 'a colleague cannot open the page');

      /**
       * The check this section exists for.
       *
       * `comments_select` used to ask only for the workspace module when a
       * comment carried a `page_id`, so the HR folder's contents were private
       * and the discussion attached to them was not. Nothing had ever written
       * a page comment, so it had never leaked - which is exactly why it had
       * to be fixed before this phase gave it a consumer.
       */
      const thread = await other(`/api/workspace/comments?pageId=${secret.id}`);
      check((thread.json?.data ?? []).length === 0,
        'and cannot read the discussion on it either',
        `${(thread.json?.data ?? []).length} comments visible`);

      const intruding = await other('/api/workspace/comments', {
        method: 'POST',
        body: JSON.stringify({ pageId: secret.id, body: 'Who is this about?' }),
      });
      check(intruding.status >= 400, 'and cannot post into it');
    }
  }
}

/* -- 12. Clean up ------------------------------------------------------ */

section('12. Clean up');
{
  let removed = 0;
  for (const id of bin.pages) {
    const res = await call(`/api/workspace/pages/${id}`, { method: 'DELETE' });
    if (res.status === 200) removed++;
  }
  check(removed === bin.pages.length,
    'everything this run created has been deleted',
    `${removed} of ${bin.pages.length}`);
}

/* -- Report ------------------------------------------------------------ */

console.log(`\n  ${pass} passed, ${fail} failed\n`);
if (fail) {
  console.log('  Failed checks:');
  for (const label of failed) console.log(`    - ${label}`);
  console.log('');
  process.exit(1);
}
