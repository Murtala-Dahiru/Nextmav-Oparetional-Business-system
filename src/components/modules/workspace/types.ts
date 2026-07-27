/**
 * The shapes the workspace endpoints actually return.
 *
 * Kept in their own module because the tree, the sheet grid, the file browser
 * and the share dialog all read them, and four copies of an interface that
 * describes one response is precisely how a screen comes to declare a field
 * the endpoint has never sent.
 */

export interface WorkspaceNode {
  id: string;
  organizationId: string;
  spaceId: string | null;
  parentId: string | null;
  title: string;
  icon: string | null;
  /** Spelled `colour` on the wire, to match the schema. */
  colour: string;
  kind: 'document' | 'sheet';
  isFolder: boolean;
  isTemplate: boolean;
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
  createdAt: string;
  updatedAt: string;
  /** What this caller may do here, resolved server-side by walking the tree. */
  permission: 'view' | 'edit' | 'manage' | null;
  childCount: number;
  fileCount: number;
  shareCount: number;
}

export interface SheetColumn {
  id: string;
  pageId: string;
  name: string;
  type: 'text' | 'number' | 'currency' | 'date' | 'select' | 'checkbox' | 'member' | 'url';
  options: string[];
  width: number;
  position: number;
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
}

/** A page opened in the editor: the tree node plus everything inside it. */
export interface OpenPage extends WorkspaceNode {
  content: string;
  columns: SheetColumn[];
  rows: SheetRow[];
  files: WorkspaceFile[];
  shares: PageShare[];
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

export const VISIBILITY_LABELS: Record<WorkspaceNode['visibility'], string> = {
  inherit: 'Same as parent folder',
  organization: 'Everyone in the company',
  department: 'One department',
  private: 'Only me and people I share with',
};
