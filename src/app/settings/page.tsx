'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, KeyRound, Loader2, ShieldCheck, User as UserIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
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
              <div className="flex items-center gap-4">
                <Avatar className="size-14">
                  <AvatarImage src={form.avatarUrl || undefined} alt={profile?.fullName ?? ''} />
                  <AvatarFallback className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                    {initialsOf(profile?.fullName ?? `${form.firstName} ${form.lastName}`)}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 space-y-1.5">
                  <Label htmlFor="avatarUrl">Profile photo URL</Label>
                  <Input
                    id="avatarUrl"
                    value={form.avatarUrl}
                    onChange={(e) => setForm((p) => ({ ...p, avatarUrl: e.target.value }))}
                    placeholder="https://…"
                  />
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
