'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft, KeyRound, Loader2, ShieldCheck, Trash2, Upload, User as UserIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { createClient } from '@/lib/supabase/client';
import { useAppStore } from '@/store/app-store';
import { initialsOf, formatDateTime } from '@/lib/format';
import { toast } from 'sonner';

/**
 * Your own account.
 *
 * Everything here acts on the signed-in user through `/api/auth/profile` and
 * `/api/auth/change-password`, neither of which takes a user id — so this page
 * cannot be pointed at anyone else, whatever the caller's role.
 *
 * Reachable while a temporary password is still in force, which is why it is
 * a page of its own rather than a module: the module routes all answer 403
 * until the password has been changed.
 */

interface Profile {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  fullName: string | null;
  avatarUrl: string | null;
  phone: string | null;
  jobTitle: string | null;
  bio: string | null;
  timezone: string | null;
  forcePasswordChange: boolean;
  passwordChangedAt: string | null;
}

export default function SettingsPage() {
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    firstName: '', lastName: '', phone: '', jobTitle: '', bio: '', avatarUrl: '',
  });
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const organizationId = useAppStore(st => st.organization?.id ?? null);

  /**
   * A photograph, uploaded once and used everywhere.
   *
   * -- Why this replaced a URL field ---------------------------------------
   *
   * The control here was "Profile photo URL": a text box asking somebody to
   * go and host an image somewhere else first. The `avatars` bucket has
   * existed since the first storage migration, is public, and carries a read
   * policy - and nothing in the product had ever written an object to it. So
   * the identity every screen in the application renders was, in practice,
   * always initials, and the promise that a photo appears everywhere had no
   * first step.
   *
   * -- The path is the security model --------------------------------------
   *
   * `storage_org_id()` reads the first path segment and the upload policy
   * checks it against the caller's memberships, so an object has to begin
   * with an organisation id. The user id is the second segment, which is what
   * keeps one person's photographs together.
   *
   * The profile row is written immediately rather than on Save: a photograph
   * that previews and then disappears because somebody navigated away is the
   * behaviour people read as "it did not upload".
   */
  const uploadAvatar = useCallback(async (file: File) => {
    if (!organizationId) {
      toast.error('Your workspace is still loading. Try again in a moment.');
      return;
    }
    if (!file.type.startsWith('image/')) {
      toast.error('That file is not an image.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error('Profile photos are limited to 5MB.');
      return;
    }

    setUploading(true);
    try {
      const supabase = createClient();
      const ext = (file.name.split('.').pop() ?? 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '');
      const path = `${organizationId}/${profile?.id ?? 'me'}/avatar-${Date.now()}.${ext || 'jpg'}`;

      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(path, file, { contentType: file.type, upsert: true });
      if (uploadError) throw new Error(uploadError.message);

      const { data: pub } = supabase.storage.from('avatars').getPublicUrl(path);
      const url = pub?.publicUrl;
      if (!url) throw new Error('The photo uploaded but could not be addressed.');

      const res = await fetch('/api/auth/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ avatarUrl: url }),
      });
      const json = await res.json().catch(() => null);
      if (json?.error) throw new Error(json.error.message);

      setForm(prev => ({ ...prev, avatarUrl: url }));
      toast.success('Photo updated', {
        description: 'It now appears wherever you do across NextMav.',
      });
    } catch (e: any) {
      toast.error(e.message || 'That photo could not be uploaded');
    } finally {
      setUploading(false);
    }
  }, [organizationId, profile?.id]);
  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/profile');
      const json = await res.json();
      if (res.status === 401) {
        router.replace('/login');
        return;
      }
      if (!res.ok) {
        toast.error(json.error?.message || 'Could not load your profile');
        return;
      }
      const p: Profile = json.data;
      setProfile(p);
      setForm({
        firstName: p.firstName ?? '',
        lastName: p.lastName ?? '',
        phone: p.phone ?? '',
        jobTitle: p.jobTitle ?? '',
        bio: p.bio ?? '',
        avatarUrl: p.avatarUrl ?? '',
      });
    } catch {
      toast.error('Network error while loading your profile');
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => { load(); }, [load]);

  async function saveProfile(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch('/api/auth/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error?.message || 'Could not save your profile');
        return;
      }
      toast.success('Profile updated');
      load();
    } catch {
      toast.error('Network error. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="bg-background flex min-h-screen items-center justify-center">
        <Loader2 className="size-6 animate-spin text-emerald-500" />
      </div>
    );
  }

  return (
    <div className="bg-background min-h-screen p-4 sm:p-8">
      <div className="mx-auto flex max-w-2xl flex-col gap-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => router.push('/dashboard')} aria-label="Back to dashboard">
            <ArrowLeft className="size-4" />
          </Button>
          <div>
            <h1 className="text-xl font-semibold">Your account</h1>
            <p className="text-muted-foreground text-sm">{profile?.email}</p>
          </div>
        </div>

        {profile?.forcePasswordChange && (
          <div
            role="alert"
            className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200"
          >
            Your account is still using a temporary password. Until you change it,
            the rest of the workspace stays locked.{' '}
            <Link href="/change-password" className="font-medium underline">
              Change it now
            </Link>
            .
          </div>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <UserIcon className="size-4 text-emerald-600" />
              Personal information
            </CardTitle>
            <CardDescription>
              Your email address is managed by your administrator and cannot be
              changed here.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={saveProfile} className="flex flex-col gap-4">
              <div className="flex items-start gap-4">
                <Avatar className="size-16 shrink-0">
                  <AvatarImage src={form.avatarUrl || undefined} alt="" />
                  <AvatarFallback className="text-sm font-medium">
                    {initialsOf(profile?.fullName ?? `${form.firstName} ${form.lastName}`)}
                  </AvatarFallback>
                </Avatar>

                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">Profile photo</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Used everywhere you appear: messages, meetings, mentions,
                    projects and the client portal.
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <input
                      ref={fileRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        e.target.value = '';
                        if (file) void uploadAvatar(file);
                      }}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="gap-1.5"
                      disabled={uploading}
                      onClick={() => fileRef.current?.click()}
                    >
                      {uploading
                        ? <Loader2 className="size-3.5 animate-spin" />
                        : <Upload className="size-3.5" />}
                      {form.avatarUrl ? 'Replace photo' : 'Upload a photo'}
                    </Button>
                    {form.avatarUrl && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="gap-1.5 text-muted-foreground"
                        disabled={uploading}
                        onClick={() => setForm((p) => ({ ...p, avatarUrl: '' }))}
                      >
                        <Trash2 className="size-3.5" /> Remove
                      </Button>
                    )}
                    <span className="text-xs text-muted-foreground">
                      JPG or PNG, up to 5MB.
                    </span>
                  </div>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="firstName">First name</Label>
                  <Input id="firstName" value={form.firstName}
                    onChange={(e) => setForm((p) => ({ ...p, firstName: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="lastName">Last name</Label>
                  <Input id="lastName" value={form.lastName}
                    onChange={(e) => setForm((p) => ({ ...p, lastName: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="phone">Phone</Label>
                  <Input id="phone" value={form.phone}
                    onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="jobTitle">Job title</Label>
                  <Input id="jobTitle" value={form.jobTitle}
                    onChange={(e) => setForm((p) => ({ ...p, jobTitle: e.target.value }))} />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="bio">About</Label>
                <Textarea id="bio" rows={3} value={form.bio}
                  onChange={(e) => setForm((p) => ({ ...p, bio: e.target.value }))} />
              </div>

              <div>
                <Button type="submit" disabled={saving}
                  className="bg-emerald-600 text-white hover:bg-emerald-700">
                  {saving && <Loader2 className="mr-2 size-4 animate-spin" />}
                  Save changes
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <KeyRound className="size-4 text-emerald-600" />
              Password
            </CardTitle>
            <CardDescription>
              {profile?.passwordChangedAt
                ? `Last changed ${formatDateTime(profile.passwordChangedAt)}.`
                : 'You have not set your own password yet.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" onClick={() => router.push('/change-password')}>
              Change password
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldCheck className="size-4 text-emerald-600" />
              Two-factor authentication
            </CardTitle>
            <CardDescription>
              Not available yet. When it is, it will be set up from here.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" disabled>Set up two-factor</Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
