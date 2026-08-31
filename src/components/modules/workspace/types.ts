/**
 * The shapes the workspace endpoints actually return.
 *
 * Kept in their own module because the library tree, the editor, the sheet
 * grid, the file panel, the share dialog and Home all read them, and six
 * copies of an interface that describes one response is precisely how a screen
 * comes to declare a field the endpoint has never sent. `contract:check`
 * compares `WorkspaceNode` against a real create, so a field added here that
 * the API does not send fails the build rather than rendering blank.
 */

export interface WorkspaceNode {
  id: string;
  organizationId: string;
  spaceId: string | null;
  parentId: string | null;
  title: string;
  /** One line saying what the page is for. Added in 0035. */
  summary: string;
  icon: string | null;
  /** Spelled `colour` on the wire, to match the schema. */
  colour: string;
  kind: 'document' | 'sheet';
  isFolder: boolean;
  isTemplate: boolean;
  templateCategory: string | null;
  isStarred: boolean;
  visibility: 'inherit' | 'organization' | 'department' | 'private';
  departmentId: string | null;
  departmentName: string | null;
  sortOrder: number;
  version: number;
  createdBy: string | null;
  createdByName: string | null;
  lastEditedBy: string | null;
  lastEditedByName: string | null;
  lastEditedByAvatar: string | null;
  createdAt: string;
  updatedAt: string;
  /** What this caller may do here, resolved server-side by walking the tree. */
  permission: 'view' | 'edit' | 'manage' | null;
  childCount: number;
  fileCount: number;
  shareCount: number;
  commentCount: number;
  linkCount: number;
  /**
   * True when an explicit share is what gives this caller access.
   *
   * Not the same as "I can read it": every organisation-visible page is
   * readable by everybody, so a "Shared with me" list built on readability
   * would be the whole workspace.
   */
  isSharedWithMe: boolean;
}

export interface SheetColumn {
  id: string;
  pageId: string;
  name: string;
  type: 'text' | 'number' | 'currency' | 'date' | 'select' | 'checkbox' | 'member' | 'url';
  options: string[];
  width: number;
  position: number;
  /** null means "whatever the type implies". */
  align: 'left' | 'center' | 'right' | null;
  decimals: number | null;
  /** `=Quantity * Price`. A column with one is computed and not editable. */
  formula: string | null;
  aggregate: 'none' | 'sum' | 'avg' | 'min' | 'max' | 'count' | 'filled';
  isFrozen: boolean;
  isHidden: boolean;
}

export interface SheetRow {
  id: string;
  pageId: string;
  /** Keyed by column id, so renaming a column does not rewrite every row. */
  cells: Record<string, unknown>;
  position: number;
}

export interface WorkspaceFile {
  id: string;
  filename: string;
  mimeType: string | null;
  sizeBytes: number;
  bucket: string;
  path: string;
  description: string;
  version: number;
  pageId: string | null;
  folderTitle: string | null;
  /** Set when this row is a link rather than an upload. Added to the view in 0035. */
  externalUrl: string | null;
  uploadedBy: string | null;
  uploadedByName: string | null;
  uploadedByAvatar: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PageShare {
  id: string;
  pageId: string;
  memberId: string | null;
  departmentId: string | null;
  permission: 'view' | 'edit' | 'manage';
  createdAt: string;
  member?: { id: string; profiles?: { fullName: string; avatarUrl: string | null } } | null;
  department?: { id: string; name: string } | null;
}

export interface PageVersion {
  id: string;
  version: number;
  title: string;
  createdAt: string;
  editedBy: string | null;
  editor?: { id: string; profiles?: { fullName: string } } | null;
  /** Only present when one revision was asked for by number. */
  content?: string;
}

/** A business record a page has been linked to. */
export interface PageLink {
  id: string;
  pageId: string;
  entityType:
    | 'company' | 'contact' | 'deal' | 'lead'
    | 'project' | 'task' | 'employee' | 'invoice' | 'ticket' | 'department';
  entityId: string;
  label: string;
  detail: string;
  /** False means the record exists and this reader cannot open it. */
  readable: boolean;
  createdAt: string;
}

export interface PageComment {
  id: string;
  body: string;
  mentions: string[];
  parentId: string | null;
  pageId: string;
  createdAt: string;
  editedAt: string | null;
  author?: {
    id: string;
    profiles?: { fullName: string; avatarUrl: string | null; jobTitle: string | null };
  } | null;
}

/** A page opened in the editor: the tree node plus everything inside it. */
export interface OpenPage extends WorkspaceNode {
  content: string;
  columns: SheetColumn[];
  rows: SheetRow[];
  files: WorkspaceFile[];
  shares: PageShare[];
  links: PageLink[];
}

export interface DirectoryMember {
  memberId: string;
  fullName: string;
  email: string;
  avatarUrl: string | null;
  jobTitle: string | null;
  departmentId: string | null;
  departmentName: string | null;
}

export interface Department {
  id: string;
  name: string;
}

/** A row in the template gallery: either shipped with the product or the org's own. */
export interface TemplateEntry {
  source: 'builtin' | 'organization';
  id: string;
  title: string;
  summary: string;
  category: string;
  kind: 'document' | 'sheet';
  icon: string;
  colour: string | null;
  updatedAt: string | null;
  authorName: string | null;
  permission: 'view' | 'edit' | 'manage' | null;
}

/** Everything Workspace Home shows, answered in one read. */
export interface WorkspaceOverview {
  recent: WorkspaceNode[];
  starred: WorkspaceNode[];
  sharedWithMe: WorkspaceNode[];
  mine: WorkspaceNode[];
  areas: WorkspaceNode[];
  templates: WorkspaceNode[];
  files: WorkspaceFile[];
  activity: WorkspaceActivity[];
  counts: {
    documents: number;
    sheets: number;
    folders: number;
    starred: number;
    templates: number;
    trash: number;
  };
}

export interface WorkspaceActivity {
  id: number;
  action: string;
  title: string;
  description: string;
  entityType: string | null;
  entityId: string | null;
  createdAt: string;
  member?: { id: string; profiles?: { fullName: string; avatarUrl: string | null } } | null;
}

export const VISIBILITY_LABELS: Record<WorkspaceNode['visibility'], string> = {
  inherit: 'Same as the folder above',
  organization: 'Everyone in the company',
  department: 'One department',
  private: 'Only me and people I share with',
};

/**
 * A page in the trash.
 *
 * -- Why this is not just `WorkspaceNode` with an optional field ------------
 *
 * `deletedAt` was first added to `WorkspaceNode` as optional, and
 * `contract:check` was right to reject it: that interface describes what
 * `v_workspace_tree` returns, the tree view returns only live pages, and a
 * field the endpoint never sends is exactly the drift that check exists to
 * catch. Marking it optional would have silenced the checker without making the
 * declaration true.
 *
 * A trashed page is a different shape from a tree node: no resolved
 * permission, no children, no ordering. So it gets its own type.
 * `/api/workspace/trash` is the only thing that returns it.
 */
export interface TrashedPage {
  id: string;
  title: string;
  icon: string | null;
  colour: string;
  kind: 'document' | 'sheet';
  isFolder: boolean;
  parentId: string | null;
  deletedAt: string;
  updatedAt: string;
  createdBy: string | null;
  lastEditedBy: string | null;
}

/** The module's own sections. Held in local state, like every other module's. */
export type Section = 'home' | 'library' | 'templates';
