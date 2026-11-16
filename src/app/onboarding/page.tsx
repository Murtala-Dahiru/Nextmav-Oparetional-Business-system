"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { AuthShell, AuthLoading } from "@/components/auth/auth-shell";
import { AuthField, AuthInput, AuthSubmit } from "@/components/auth/fields";
import { Notice } from "@/components/auth/notice";
import { useAppStore } from "@/store/app-store";
import { toast } from "sonner";

/**
 * The step between having an account and having somewhere to work.
 *
 * A user reaches this state whenever they are authenticated but belong to no
 * organization — after confirming their email (signup with confirmation on
 * returns no session, so the organization cannot be created inline), or after
 * being removed from the last organization they belonged to.
 *
 * Without this screen such a user was sent to /dashboard, where every module
 * request failed `authorize()` and the shell showed "Authentication required"
 * with a Try again button that could never succeed — authenticated, but with
 * no route forward and no way to understand why.
 *
 * ── The three arrivals it now tells apart ─────────────────────────────────
 *
 * "Belongs to no organization" turned out to be four situations wearing one
 * label, and this screen offered the same answer to all of them. For a new
 * signup that answer is right. For someone holding an invitation it is the
 * wrong screen — the workspace they want already exists. And for a suspended
 * or terminated employee it was a way back onto the platform as the owner of a
 * tenant of their own, which is the defect this whole pass exists to close.
 *
 * `mayCreateOrganization` comes from the server and is enforced there twice
 * over: `POST /api/organizations` refuses, and so does `create_organization()`
 * itself, so a REST client that skips this page gets nowhere either.
 */
export default function OnboardingPage() {
  const router = useRouter();
  const { logout } = useAppStore();
  const [name, setName] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [checking, setChecking] = useState(true);
  const [blocked, setBlocked] = useState<string | null>(null);
  const [invitationWaiting, setInvitationWaiting] = useState(false);

  // Someone who already has an organization has no business here — most often
  // a stale tab, or the back button after onboarding completed.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/auth/session");
        const json = await res.json();
        if (cancelled) return;

        const payload = json?.data ?? {};
        const user = payload.user;

        /**
         * Access withdrawn. The session endpoint returns no user for these,
         * and sending them to /login would be a loop: their password is
         * perfectly good, so they would sign in and arrive straight back here.
         * The reason is shown instead, with the sign-out that actually helps.
         */
        if (!user && payload.accessMessage) {
          setBlocked(payload.accessMessage);
          setChecking(false);
          return;
        }

        if (!user) {
          router.replace("/login");
          return;
        }
        if (!payload.needsOrganization) {
          router.replace("/dashboard");
          return;
        }
        if (payload.pendingInvitations > 0) setInvitationWaiting(true);
        if (payload.mayCreateOrganization === false) {
          setBlocked(
            payload.pendingInvitations > 0
              ? null
              : "This account cannot create a workspace. Ask an administrator at your organization to invite you.",
          );
        }
        // The organization name typed during signup, carried through the
        // confirmation email in user metadata. Email confirmation means the
        // signup request cannot create the organization itself, and without
        // this the very first thing the product asks after confirming is a
        // question it already asked.
        const pending = json?.data?.user?.pendingOrganizationName;
        if (pending) setName(pending);
        setChecking(false);
      } catch {
        // Treat an unreachable session endpoint as "still needs onboarding"
        // rather than spinning: the form below is safe to show, and creating
        // an organization will surface the real error.
        if (!cancelled) setChecking(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFormError(null);
    setIsSubmitting(true);

    try {
      const res = await fetch("/api/organizations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await res.json();

      if (!res.ok) {
        setFormError(
          data.error?.message || "Could not create the organization.",
        );
        return;
      }

      toast.success(`${name.trim()} is ready.`);
      // Full document navigation so the dashboard loads with a fresh request:
      // the membership this call just created changes what every subsequent
      // query is permitted to return.
      window.location.assign("/dashboard");
    } catch {
      setFormError("Network error. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  if (checking) return <AuthLoading />;

  const workspaceAside = {
    eyebrow: "Your shared foundation",
    title: "A place for your team to work together.",
    body: "Name your organization to create the existing workspace. You can start organizing your work and invite your team once inside.",
    points: [
      {
        title: "One organization",
        desc: "Customer records, people and work share the same workspace.",
      },
      {
        title: "You are the owner",
        desc: "Invite your team and manage access from the platform.",
      },
      {
        title: "Start with existing capabilities",
        desc: "Industry configuration is planned; this step does not provision an industry preset.",
      },
    ],
  };

  if (blocked)
    return (
      <AuthShell
        title="No workspace access"
        titleSize="compact"
        description={blocked}
        aside={workspaceAside}
      >
        <div className="nm-auth-form">
          <AuthSubmit type="button" onClick={() => logout()}>
            Sign out
          </AuthSubmit>
        </div>
      </AuthShell>
    );

  return (
    <AuthShell
      title="Name your workspace"
      description="Your account is ready. Give your organization a name to finish setting up."
      aside={workspaceAside}
      eyebrow="Workspace setup"
      footer={
        <button
          type="button"
          className="nm-link nm-auth-standalone-link"
          onClick={() => logout()}
          disabled={isSubmitting}
        >
          Sign out
        </button>
      }
    >
      <div className="nm-auth-form">
        <div className="nm-onboarding-progress" aria-label="Setup progress">
          <span>01 Account ready</span>
          <span aria-current="step">02 Workspace</span>
        </div>
        {invitationWaiting && (
          <Notice title="You have an invitation waiting">
            Open the link in your invitation email to join that workspace. You
            do not need to create one of your own.
          </Notice>
        )}
        {formError && (
          <Notice tone="warning" title="Workspace could not be created">
            {formError}
          </Notice>
        )}
        <form
          onSubmit={handleSubmit}
          className="nm-auth-form"
          style={{ marginTop: 0 }}
        >
          <AuthField
            id="name"
            label="Organization name"
            hint="Use the name your team knows. You can change it later."
          >
            <AuthInput
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="organization"
              placeholder="Your organization"
              required
              autoFocus
              disabled={isSubmitting}
            />
          </AuthField>
          <AuthSubmit
            type="submit"
            busy={isSubmitting}
            busyLabel="Creating workspace…"
            disabled={!name.trim()}
          >
            Create workspace
          </AuthSubmit>
        </form>
        <p className="nm-auth-legal">
          Joining an existing company? Use the invitation link from your email
          to join its workspace.
        </p>
      </div>
    </AuthShell>
  );
}
