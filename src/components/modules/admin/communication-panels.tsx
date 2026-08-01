'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  MessageSquare, ClipboardList, Loader2, Save, ShieldAlert,
} from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import type { SettingsBundle } from './settings-panels';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Administering communication.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  Two panels: the policy, and the record of what has been moderated. Both
 *  follow the rule the rest of the administration screen follows — a control
 *  only exists if something reads it, and each one below names what.
 */

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...init });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || 'Request failed');
  return json.data as T;
}

function Panel({
  title, description, icon: Icon, children, footer,
}: {
  title: string;
  description: string;
  icon: React.ElementType;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="pb-4">
        <CardTitle className="flex items-center gap-2 text-base">
          <Icon className="size-4 text-emerald-600" /> {title}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">{children}</CardContent>
      {footer && <div className="flex justify-end border-t px-6 py-3">{footer}</div>}
    </Card>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  The policy
// ═══════════════════════════════════════════════════════════════════════════

/**
 * ── What reads each control ──────────────────────────────────────────────
 *
 *   channelCreation      `/api/communication/channels` POST refuses when this
 *                        is 'admins' and the caller is not one.
 *   allowMessageEdit     the message PATCH, and the Edit item in the message
 *   editWindowMinutes    menu, which disappears once the window has passed.
 *   allowMessageDelete   the message DELETE, for the *author's* own delete.
 *                        A channel or organisation administrator can always
 *                        remove a message — that is a responsibility of the
 *                        role, not a setting, and an organisation that could
 *                        switch it off would have no way to deal with
 *                        something posted in error.
 *   retentionDays        `apply_message_retention()`, run from the button
 *                        below and from nowhere else.
 *   allowClientMeetings  the meeting invite endpoint, together with the
 *                        meeting's own "allow guests".
 *   maxAttachmentMb      the composer, before an upload starts, and the
 *                        message endpoint, which refuses anything larger.
 *
 * ── Why retention is a button and not a schedule ─────────────────────────
 *
 * It deletes a company's conversations. That should not happen quietly at
 * three in the morning because a number was typed into a box six weeks ago.
 * The count is shown first, an administrator presses the button, and the act
 * is written into the moderation trail with their name on it.
 */
export function CommunicationPanel({
  bundle, onSaved,
}: { bundle: SettingsBundle; onSaved: () => void }) {
  const stored = bundle.settings?.communicationPolicy ?? {};

  const [form, setForm] = useState({
    channelCreation: stored.channelCreation === 'admins' ? 'admins' : 'everyone',
    allowMessageEdit: stored.allowMessageEdit !== false,
    editWindowMinutes: String(stored.editWindowMinutes ?? 0),
    allowMessageDelete: stored.allowMessageDelete !== false,
    retentionDays: String(stored.retentionDays ?? 0),
    allowClientMeetings: stored.allowClientMeetings === true,
    maxAttachmentMb: String(stored.maxAttachmentMb ?? 25),
  });
  const [saving, setSaving] = useState(false);
  const [retention, setRetention] = useState<{ affected: number; enabled: boolean } | null>(null);
  const [applying, setApplying] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const loadRetention = useCallback(async () => {
    try {
      setRetention(await api<{ affected: number; enabled: boolean }>('/api/communication/retention'));
    } catch {
      setRetention(null);
    }
  }, []);

  useEffect(() => { void loadRetention(); }, [loadRetention]);

  const save = useCallback(async () => {
    setSaving(true);
    try {
      await api('/api/admin/settings', {
        method: 'PATCH',
        body: JSON.stringify({
          settings: {
            communication_policy: {
              channel_creation: form.channelCreation,
              allow_message_edit: form.allowMessageEdit,
              edit_window_minutes: Number(form.editWindowMinutes) || 0,
              allow_message_delete: form.allowMessageDelete,
              retention_days: Number(form.retentionDays) || 0,
              allow_client_meetings: form.allowClientMeetings,
              max_attachment_mb: Number(form.maxAttachmentMb) || 25,
            },
          },
        }),
      });
      toast.success('Communication policy updated');
      onSaved();
      void loadRetention();
    } catch (e: any) {
      toast.error(e.message || 'Could not save');
    } finally {
      setSaving(false);
    }
  }, [form, onSaved, loadRetention]);

  return (
    <>
      <Panel
        title="Communication policy"
        description="How messaging and meetings behave for everybody in this workspace."
        icon={MessageSquare}
        footer={(
          <Button onClick={save} disabled={saving}
            className="gap-2 bg-emerald-600 text-white hover:bg-emerald-700">
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            Save
          </Button>
        )}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Who can create channels</Label>
            <Select value={form.channelCreation}
              onValueChange={(v) => setForm(f => ({ ...f, channelCreation: v }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="everyone">Everyone</SelectItem>
                <SelectItem value="admins">Administrators only</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Direct messages stay available to everybody, whichever this is.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="comm-attach">Largest attachment (MB)</Label>
            <Input id="comm-attach" type="number" min={1} max={25}
              value={form.maxAttachmentMb}
              onChange={(e) => setForm(f => ({ ...f, maxAttachmentMb: e.target.value }))} />
            <p className="text-xs text-muted-foreground">
              Storage refuses anything above 25MB regardless of this.
            </p>
          </div>
        </div>

        <div className="divide-y rounded-lg border">
          <div className="flex items-start justify-between gap-4 p-3.5">
            <div className="min-w-0">
              <p className="text-sm font-medium">Allow editing sent messages</p>
              <p className="text-xs text-muted-foreground">
                An edited message is always marked as edited.
              </p>
            </div>
            <Switch checked={form.allowMessageEdit}
              onCheckedChange={(v) => setForm(f => ({ ...f, allowMessageEdit: v }))} />
          </div>

          {form.allowMessageEdit && (
            <div className="flex items-center justify-between gap-4 p-3.5">
              <div className="min-w-0">
                <p className="text-sm font-medium">Edit window</p>
                <p className="text-xs text-muted-foreground">
                  Minutes after sending. 0 means no time limit.
                </p>
              </div>
              <Input type="number" min={0} max={1440} className="w-24"
                value={form.editWindowMinutes}
                onChange={(e) => setForm(f => ({ ...f, editWindowMinutes: e.target.value }))} />
            </div>
          )}

          <div className="flex items-start justify-between gap-4 p-3.5">
            <div className="min-w-0">
              <p className="text-sm font-medium">Allow authors to delete their own messages</p>
              <p className="text-xs text-muted-foreground">
                Channel and organisation administrators can always remove one.
              </p>
            </div>
            <Switch checked={form.allowMessageDelete}
              onCheckedChange={(v) => setForm(f => ({ ...f, allowMessageDelete: v }))} />
          </div>

          <div className="flex items-start justify-between gap-4 p-3.5">
            <div className="min-w-0">
              <p className="text-sm font-medium">Allow clients in meetings</p>
              <p className="text-xs text-muted-foreground">
                Lets a client account be invited to a meeting that a host has opened to
                guests. Off means never, whatever a host chooses.
              </p>
            </div>
            <Switch checked={form.allowClientMeetings}
              onCheckedChange={(v) => setForm(f => ({ ...f, allowClientMeetings: v }))} />
          </div>
        </div>

        <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3.5">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 text-sm font-medium">
                <ShieldAlert className="size-3.5 text-amber-600" /> Message retention
              </p>
              <p className="text-xs text-muted-foreground">
                Days to keep messages. 0 keeps everything. Nothing is removed until you run
                it — this system does not delete conversations on a timer.
              </p>
            </div>
            <Input type="number" min={0} max={3650} className="w-24"
              value={form.retentionDays}
              onChange={(e) => setForm(f => ({ ...f, retentionDays: e.target.value }))} />
          </div>

          {retention?.enabled && (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-amber-500/30 pt-3">
              <p className="text-xs text-muted-foreground">
                {retention.affected === 0
                  ? 'Nothing is currently older than the retention period.'
                  : `${retention.affected} message${retention.affected === 1 ? ' is' : 's are'} `
                    + 'older than the retention period.'}
              </p>
              <Button size="sm" variant="outline"
                disabled={applying || retention.affected === 0}
                onClick={() => setConfirming(true)}>
                {applying && <Loader2 className="mr-1.5 size-3.5 animate-spin" />}
                Apply retention now
              </Button>
            </div>
          )}
        </div>
      </Panel>

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Apply the retention policy"
        description={
          `This removes ${retention?.affected ?? 0} message`
          + `${retention?.affected === 1 ? '' : 's'} older than ${form.retentionDays} days, `
          + 'from every conversation in this workspace. It is recorded in the moderation '
          + 'trail with your name on it, and cannot be undone.'}
        confirmLabel="Apply retention"
        variant="destructive"
        isLoading={applying}
        onConfirm={async () => {
          setApplying(true);
          try {
            const result = await api<{ removed: number }>(
              '/api/communication/retention', { method: 'POST' });
            toast.success(`${result.removed} message${result.removed === 1 ? '' : 's'} removed`);
            setConfirming(false);
            void loadRetention();
          } catch (e: any) {
            toast.error(e.message || 'Could not apply the retention policy');
          } finally {
            setApplying(false);
          }
        }}
      />
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  The moderation trail
// ═══════════════════════════════════════════════════════════════════════════

const ACTION_LABELS: Record<string, string> = {
  message_deleted: 'Message removed',
  message_edited: 'Message edited',
  message_pinned: 'Message pinned',
  message_unpinned: 'Message unpinned',
  channel_created: 'Channel created',
  channel_archived: 'Channel archived',
  channel_deleted: 'Channel deleted',
  channel_settings_changed: 'Channel settings changed',
  member_added: 'Person added to a channel',
  member_removed: 'Person removed from a channel',
  member_role_changed: 'Channel role changed',
  policy_changed: 'Policy changed',
  retention_applied: 'Retention applied',
  meeting_started: 'Meeting started',
  meeting_ended: 'Meeting ended',
  participant_removed: 'Removed from a meeting',
};

/**
 * What has been moderated.
 *
 * ── What this deliberately cannot show ───────────────────────────────────
 *
 * The text of anything that was removed. The trail records the act, never the
 * words — otherwise a table every administrator can read would hold the
 * contents of the private channels that made moderation necessary in the first
 * place. Direct conversations are never named, only shown as "a direct
 * message".
 */
export function CommunicationAuditPanel() {
  const [rows, setRows] = useState<any[] | null>(null);
  const [filter, setFilter] = useState('all');

  useEffect(() => {
    let cancelled = false;
    void api<any[]>(
      `/api/communication/audit?limit=100${filter === 'all' ? '' : `&action=${filter}`}`,
    )
      .then(r => { if (!cancelled) setRows(r ?? []); })
      .catch(() => { if (!cancelled) setRows([]); });
    return () => { cancelled = true; };
  }, [filter]);

  return (
    <Panel
      title="Moderation trail"
      description="Who did what, and where. Never what was said — the trail records acts, not messages."
      icon={ClipboardList}
    >
      <Select value={filter} onValueChange={setFilter}>
        <SelectTrigger className="w-full sm:w-72"><SelectValue /></SelectTrigger>
        <SelectContent className="max-h-64">
          <SelectItem value="all">Everything</SelectItem>
          {Object.entries(ACTION_LABELS).map(([value, label]) => (
            <SelectItem key={value} value={value}>{label}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      {rows === null && (
        <div className="flex justify-center py-8">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      )}

      {rows !== null && rows.length === 0 && (
        <p className="py-8 text-center text-sm text-muted-foreground">
          Nothing has been recorded yet.
        </p>
      )}

      {!!rows?.length && (
        <div className="divide-y rounded-lg border">
          {rows.map(entry => (
            <div key={entry.id} className="flex items-start justify-between gap-4 p-3">
              <div className="min-w-0">
                <p className="text-sm">
                  <span className="font-medium">{entry.actorName}</span>
                  {' — '}
                  {ACTION_LABELS[entry.action] ?? entry.action}
                  {entry.targetName && (
                    <> · <span className="text-muted-foreground">{entry.targetName}</span></>
                  )}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {[entry.channelLabel, entry.reason].filter(Boolean).join(' · ') || '—'}
                </p>
              </div>
              <span className="shrink-0 text-xs text-muted-foreground">
                {new Date(entry.createdAt).toLocaleString()}
              </span>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}
