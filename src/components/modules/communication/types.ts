import { type ModuleId } from '@/lib/constants';

/**
 * ===========================================================================
 *  What the communication module is made of.
 * ===========================================================================
 *
 *  One definition per shape, imported by the shell, the home view, the
 *  timeline, the composer and the meeting room. The module was a single
 *  2,100-line file; splitting it is what every other deep module here already
 *  does (crm, projects, mywork, workspace), and this file is the seam:
 *  anything two of those need lives here, and nothing else does.
 */

// --- Conversations --------------------------------------------------------

/** A row of `channel_overview()`. */
export interface ChannelRow {
  channelId: string;
  name: string;
  displayName: string | null;
  description: string;
  topic: string;
  type: 'public' | 'private' | 'direct' | 'announcement';
  postPolicy: 'everyone' | 'members' | 'admins';
  joinPolicy: 'open' | 'invite';
  isArchived: boolean;
  createdBy: string | null;
  memberCount: number;
  messageCount: number;
  unreadCount: number;
  pinnedCount: number;
  isMember: boolean;
  isAdmin: boolean;
  /** Whether the caller has silenced this conversation. */
  isMuted: boolean;
  /**
   * Whether the caller has starred it. New in 0036, and the other half of
   * muting: it changes where the conversation sits, never what it counts.
   */
  isFavourite: boolean;
  myRole: string | null;
  lastMessage: string | null;
  lastMessageAt: string | null;
  lastSender: string | null;
  counterpartId: string | null;
  counterpartName: string | null;
  counterpartAvatar: string | null;
  /** What the conversation is about. All four are from 0023. */
  projectId: string | null;
  projectName: string | null;
  companyId: string | null;
  companyName: string | null;
  departmentId: string | null;
  departmentName: string | null;
  /** A meeting running in this channel right now, if there is one. */
  liveMeetingId: string | null;
  /** Unread messages that named the caller. Never suppressed by muting. */
  mentionCount: number;
}

// --- Messages -------------------------------------------------------------

/**
 * The message author, as the endpoint returns them.
 *
 * The sender is a membership with the name on its joined profile. A flat
 * `firstName`/`lastName` was never carried, which is how every message once
 * rendered its author as "undefined undefined".
 */
export interface Sender {
  id: string;
  profiles?: { fullName: string; avatarUrl: string | null };
}

/** A file posted in a conversation. A `files` row, joined onto the message. */
export interface MessageFile {
  id: string;
  filename: string;
  mimeType: string | null;
  sizeBytes: number;
  bucket: string;
  path: string;
  createdAt: string;
}

/**
 * A link to something elsewhere in the business.
 *
 * Stored in `messages.attachments`, which since 0023 holds references rather
 * than files. See section 9 of that migration for why the two could not share
 * a column.
 */
export interface RecordReference {
  kind: 'task' | 'page' | 'project' | 'invoice' | 'ticket' | 'company' | 'deal' | 'meeting';
  id: string;
  label: string;
}

export interface Message {
  id: string;
  body: string;
  senderId: string;
  channelId: string;
  parentId: string | null;
  isPinned: boolean;
  editedAt: string | null;
  createdAt: string;
  sender: Sender;
  mentions?: string[];
  reactions?: { emoji: string; memberId: string }[];
  files?: MessageFile[];
  attachments?: RecordReference[];
}

/**
 * A thread, described without opening it. A row of `channel_threads()` (0036).
 *
 * Fetched once per channel and keyed by `rootId`, because forty bubbles must
 * not be forty requests. Before this the timeline could not know that a
 * message had replies at all, so a discussion that had moved into a thread was
 * invisible to anybody who had not been there when it moved.
 */
export interface ThreadSummary {
  rootId: string;
  replyCount: number;
  lastReplyAt: string;
  lastSenderName: string | null;
  participants: string[];
  /** Whether the caller has said anything in it. This is what "following" means. */
  iReplied: boolean;
}

export interface ChannelMember {
  id: string;
  channelId: string;
  memberId: string;
  role: 'owner' | 'admin' | 'member';
  /**
   * How far this member has read.
   *
   * The same marker `channel_overview()` computes the unread badge from, which
   * is why a read receipt derived from it can never disagree with the count.
   */
  lastReadAt: string | null;
  fullName: string;
  avatarUrl: string | null;
  email: string;
  jobTitle: string | null;
  lastSeenAt: string | null;
  lastActiveAt: string | null;
  /** Derived by `v_channel_members` through `presence_of()`. */
  presence: 'online' | 'away' | 'offline';
  orgRole: string;
  departmentName: string | null;
}

export interface DirectoryMember {
  memberId: string;
  fullName: string;
  email: string;
  jobTitle: string | null;
  departmentName: string | null;
  /**
   * Both returned by `/api/directory` all along, and neither was declared
   * here - so every people picker in this module drew initials for somebody
   * whose photograph the endpoint had already sent.
   */
  avatarUrl: string | null;
  presence: 'online' | 'away' | 'offline' | null;
}

/** A row of `message_receipts()`, fetched only when the sender asks. */
export interface Receipt {
  memberId: string;
  fullName: string;
  avatarUrl: string | null;
  jobTitle: string | null;
  readAt: string | null;
  hasRead: boolean;
}

/** A hit from `/api/communication/search`. */
export interface SearchHit {
  messageId: string;
  channelId: string;
  channelLabel: string;
  channelType: ChannelRow['type'];
  parentId: string | null;
  body: string;
  senderId: string;
  senderName: string;
  senderAvatar: string | null;
  createdAt: string;
}

/**
 * A row of `communication_inbox()` (0036).
 *
 * The three things that name a person: they were mentioned, they were
 * answered, or they were written to directly. Everything else that is unread
 * is the sidebar's job, and an inbox that repeated it would be a second copy
 * of the product with no editorial judgement in it.
 */
export interface InboxItem {
  kind: 'mention' | 'reply' | 'direct' | 'announcement';
  messageId: string;
  channelId: string;
  channelLabel: string;
  channelType: ChannelRow['type'];
  parentId: string | null;
  body: string;
  senderId: string;
  senderName: string | null;
  senderAvatar: string | null;
  createdAt: string;
  isUnread: boolean;
  hasFiles: boolean;
}

/** A row of `saved_messages()` (0036). One person's shelf. */
export interface SavedMessage {
  saveId: string;
  note: string;
  savedAt: string;
  messageId: string;
  channelId: string;
  channelLabel: string;
  channelType: ChannelRow['type'];
  parentId: string | null;
  body: string;
  senderId: string;
  senderName: string | null;
  senderAvatar: string | null;
  createdAt: string;
  hasFiles: boolean;
}

/** A file posted in a conversation, as `/api/communication/files` lists it. */
export interface ChannelFile {
  id: string;
  filename: string;
  mimeType: string | null;
  sizeBytes: number;
  bucket: string;
  path: string;
  channelId: string;
  messageId: string | null;
  createdAt: string;
  uploader?: { id: string; profiles?: { fullName: string; avatarUrl: string | null } } | null;
}

// --- Meetings -------------------------------------------------------------

/** A row of `meeting_overview()`. */
export interface MeetingRow {
  meetingId: string;
  title: string;
  agenda: string;
  status: 'scheduled' | 'live' | 'ended' | 'cancelled';
  mode: 'video' | 'audio';
  scheduledAt: string | null;
  durationMinutes: number;
  startedAt: string | null;
  endedAt: string | null;
  isLocked: boolean;
  waitingRoom: boolean;
  allowGuests: boolean;
  notes: string;
  hostId: string;
  hostName: string | null;
  channelId: string | null;
  channelLabel: string | null;
  projectId: string | null;
  projectName: string | null;
  eventId: string | null;
  invitedCount: number;
  presentCount: number;
  knockingCount: number;
  myRole: 'host' | 'cohost' | 'attendee' | null;
  myState: MeetingParticipant['state'] | null;
  amHost: boolean;
}

export interface MeetingParticipant {
  id: string;
  meetingId: string;
  memberId: string;
  role: 'host' | 'cohost' | 'attendee';
  /**
   * Where this person stands.
   *
   * Their answer to the invitation before the meeting, and where they are in
   * the room during it. One field because it is one question: somebody who
   * has joined has self-evidently accepted. `accepted` and `tentative` were
   * added in 0038 - before that an invitation could be refused and not
   * accepted, so everybody intending to come sat in `invited`, which is the
   * same value as somebody who had never looked at it.
   */
  state: 'invited' | 'accepted' | 'tentative' | 'declined'
    | 'knocking' | 'admitted' | 'joined' | 'left' | 'removed';
  invitedAt: string;
  knockedAt: string | null;
  admittedAt: string | null;
  joinedAt: string | null;
  leftAt: string | null;
  isMuted: boolean;
  cameraOn: boolean;
  isSharing: boolean;
  handRaisedAt: string | null;
  fullName: string;
  avatarUrl: string | null;
  email: string;
  jobTitle: string | null;
  orgRole: string;
  departmentName: string | null;
}

// --- Presentation helpers -------------------------------------------------

/**
 * The avatar helpers now live in `lib/avatar.ts`.
 *
 * They were written here, and a person is the same person in every module: two
 * modules deriving the fallback colour differently means Ada is green in
 * Projects and violet here, which works against recognition rather than for
 * it. Re-exported so this module's own imports read as they always did.
 *
 * Prefer `components/shared/person-avatar` over calling these directly - it is
 * the component that also remembers the photograph, which is the half this
 * module had been missing on all forty-two of its avatar call sites.
 */
export { avatarTint, avatarStyle } from '@/lib/avatar';

/**
 * What a conversation is called on screen.
 *
 * A direct message has no name of its own: the row's `name` is a stable slug
 * built from two membership ids, which is exactly what should never be shown
 * to anybody. The other participant's name comes back on the overview row.
 */
export function channelLabel(channel: ChannelRow): string {
  if (channel.type === 'direct') return channel.counterpartName || 'Direct message';
  return channel.displayName || `#${channel.name}`;
}

export const QUICK_REACTIONS = ['👍', '🎉', '👀', '✅', '❤️', '🙏'];

/**
 * Where a record reference goes when it is clicked.
 *
 * There are no per-record routes in this product (modules are swapped by id
 * inside one page), so opening one goes through `openRecord(module, type, id)`.
 * This map is the reference kind's half of that call; the module it names has
 * to be one that handles a focus request, or the click lands somebody on a
 * landing tab with nothing selected.
 */
export const REFERENCE_TARGETS: Record<
  RecordReference['kind'],
  { module: ModuleId; type: string; label: string }
> = {
  task:    { module: 'projects',  type: 'task',    label: 'Task' },
  project: { module: 'projects',  type: 'project', label: 'Project' },
  page:    { module: 'workspace', type: 'page',    label: 'Document' },
  invoice: { module: 'finance',   type: 'invoice', label: 'Invoice' },
  ticket:  { module: 'support',   type: 'ticket',  label: 'Ticket' },
  company: { module: 'crm',       type: 'company', label: 'Client' },
  deal:    { module: 'crm',       type: 'deal',    label: 'Deal' },
  // A meeting has no other module to open. It is opened in this one.
  meeting: { module: 'communication', type: 'meeting', label: 'Meeting' },
};

/** Whether this is something a browser will render inline. */
export function isImage(mime: string | null): boolean {
  return !!mime && mime.startsWith('image/');
}

/**
 * A file name that storage will accept.
 *
 * Object keys are a path, so a name carrying a slash creates a directory and a
 * name carrying a `#` truncates the key at the fragment. Both produce an
 * object at a path the metadata row does not describe, which is unreachable
 * rather than broken: the worse of the two.
 */
export function safeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80);
}

/** The day a timestamp falls on, for the separators in a timeline. */
export function dayKey(iso: string): string {
  return new Date(iso).toDateString();
}

export function dayLabel(iso: string, locale = 'en-GB'): string {
  const date = new Date(iso);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86_400_000);
  if (date.toDateString() === today.toDateString()) return 'Today';
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return date.toLocaleDateString(locale, {
    weekday: 'long', day: 'numeric', month: 'long',
    // The year only when it is not this one. "Tuesday, 4 March 2026" on every
    // separator in a conversation started last week is noise.
    ...(date.getFullYear() === today.getFullYear() ? {} : { year: 'numeric' }),
  });
}

export function clockTime(iso: string, locale = 'en-GB'): string {
  return new Date(iso).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
}

/**
 * The one fetch wrapper this module uses.
 *
 * Throws the endpoint's own message, which is the whole reason it exists: the
 * API answers refusals with an explanation ("this organisation does not allow
 * messages to be edited after they are sent") and a client that reported
 * "Request failed" would be throwing that away at exactly the moment it
 * matters.
 */
export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...init });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || 'Request failed');
  return json.data as T;
}

/** The same, when the response's `meta` is wanted too. */
export async function apiWithMeta<T>(
  url: string, init?: RequestInit,
): Promise<{ data: T; meta: Record<string, any> }> {
  const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...init });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || 'Request failed');
  return { data: json.data as T, meta: json.meta ?? {} };
}
