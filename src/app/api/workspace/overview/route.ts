import { authorize, pgError } from '@/lib/auth-context';
import { success } from '@/lib/api-response';

/**
 * ===========================================================================
 *  Everything Workspace Home shows, in one answer.
 * ===========================================================================
 *
 *  -- Why one endpoint --------------------------------------------------
 *
 *  Home shows seven things about the same population: what was edited
 *  recently, what is starred, what has been shared with the reader, the areas
 *  the workspace is organised into, the newest files, the templates available
 *  and what colleagues have been doing. Fetching those separately is seven
 *  requests, seven loading states, and - the reason that actually matters -
 *  seven chances for two panels to disagree, because each read takes its own
 *  snapshot. The Executive Overview shipped that defect once: `active` counted
 *  organisation-wide by one view while `atRisk` counted over whichever six
 *  rows a second query had fetched.
 *
 *  So the tree is read once and every list on the page is derived from that
 *  one array. The counts are arithmetic over the same array, which is what
 *  makes "24 documents" and the list underneath it necessarily agree.
 *
 *  -- What is deliberately not here ---------------------------------------
 *
 *  No statistics that nobody acts on. A workspace does not have a health
 *  figure, a completion rate or a weekly trend, and inventing one would make
 *  this page a worse version of the Executive Overview. The counts that are
 *  here exist to label a section, not to be a dashboard.
 */

/** How much of each list Home has room for. */
const RECENT = 8;
const STARRED = 8;
const SHARED = 6;
const FILES = 6;
const ACTIVITY = 10;

export async function GET(req: Request) {
  const ctx = await authorize('workspace', 'view');
  if (ctx instanceof Response) return ctx;

  const orgId = ctx.org.organizationId;
  const { searchParams } = new URL(req.url);
  // The tree is bounded rather than unbounded: a workspace with ten thousand
  // pages would otherwise send all of them to render eight rows.
  const limit = Math.min(1000, Math.max(50, Number(searchParams.get('limit')) || 600));

  /**
   * The counts are their own reads, and that is deliberate.
   *
   * Deriving them from the tree array would make them describe the most recent
   * `limit` pages rather than the workspace, and a section headed "24
   * documents" that silently means "24 of the last 600" is the kind of figure
   * somebody quotes in a meeting. `head: true` sends no rows.
   */
  const countOf = (apply: (q: any) => any) =>
    apply(
      ctx.supabase.from('workspace_pages')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', orgId)
        .is('deleted_at', null),
    );

  const [tree, files, activity, trash, docCount, sheetCount, folderCount] = await Promise.all([
    ctx.supabase
      .from('v_workspace_tree').select('*')
      .eq('organization_id', orgId)
      .order('updated_at', { ascending: false })
      .limit(limit),

    ctx.supabase
      .from('v_files').select('*')
      .eq('organization_id', orgId)
      .not('page_id', 'is', null)
      .order('created_at', { ascending: false })
      .limit(FILES),

    /**
     * What colleagues have been doing here.
     *
     * Scoped to the workspace module. The activity feed is organisation-wide
     * and shows a lead being converted next to a document being filed, which
     * is right on the dashboard and noise on this page.
     */
    ctx.supabase
      .from('activity_log')
      .select('id, action, title, description, entity_type, entity_id, created_at, ' +
        'member:organization_members!activity_log_member_id_fkey(' +
        'id, profiles!organization_members_user_id_fkey(full_name, avatar_url))')
      .eq('organization_id', orgId)
      .eq('module', 'workspace')
      .order('created_at', { ascending: false })
      .limit(ACTIVITY),

    ctx.supabase
      .from('workspace_pages')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', orgId)
      .not('deleted_at', 'is', null),

    countOf(q => q.eq('is_folder', false).eq('kind', 'document').eq('is_template', false)),
    countOf(q => q.eq('is_folder', false).eq('kind', 'sheet').eq('is_template', false)),
    countOf(q => q.eq('is_folder', true)),
  ]);

  if (tree.error) return pgError(tree.error);

  const nodes = (tree.data ?? []) as any[];
  const me = ctx.org.memberId;

  const pages = nodes.filter(n => !n.is_folder && !n.is_template);
  const folders = nodes.filter(n => n.is_folder);

  /**
   * The areas of the workspace.
   *
   * Top-level folders, which is what a workspace's organisation actually is
   * in this schema. `workspace_spaces` exists as a table and has never had a
   * row: introducing it now would give the product two organisational systems
   * that mean the same thing, and the brief for this phase says not to. A
   * root folder called "Finance" is a space in every respect that matters.
   */
  const areas = folders
    .filter(f => !f.parent_id)
    .sort((a, b) => String(a.title).localeCompare(String(b.title)));

  /**
   * "Shared with me" means an explicit share, not merely a page I can read.
   *
   * Every organisation-visible page is readable by everybody, so a list built
   * on readability would be the whole workspace. `is_shared_with_me` is
   * resolved in the view from the share rows, which is the only definition
   * under which the section is worth having.
   */
  const sharedWithMe = nodes
    .filter(n => n.is_shared_with_me && n.created_by !== me)
    .slice(0, SHARED);

  return success({
    /** Recently edited, folders and templates excluded. */
    recent: pages.slice(0, RECENT),

    /**
     * Starred, newest first.
     *
     * Starring is a property of the page and shared by everyone in the
     * workspace, which is what the control has always meant here (0014 says
     * why). It reads as "pinned for the company", not "my favourites".
     */
    starred: nodes.filter(n => n.is_starred).slice(0, STARRED),

    sharedWithMe,

    /** Things this person created, most recent first. */
    mine: pages.filter(n => n.created_by === me).slice(0, RECENT),

    areas,

    /** The organisation's own templates. The built-in library is static. */
    templates: nodes.filter(n => n.is_template),

    files: files.data ?? [],
    activity: activity.data ?? [],

    counts: {
      documents: docCount.count ?? 0,
      sheets: sheetCount.count ?? 0,
      folders: folderCount.count ?? 0,
      starred: nodes.filter(n => n.is_starred).length,
      templates: nodes.filter(n => n.is_template).length,
      trash: trash.count ?? 0,
    },
  });
}
