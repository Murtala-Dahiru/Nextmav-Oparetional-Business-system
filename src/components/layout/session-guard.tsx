'use client';

import { useState } from 'react';
import { Clock, ShieldAlert } from 'lucide-react';
import {
  AlertDialog, AlertDialogAction, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { useSessionTimeout } from '@/hooks/use-session-timeout';
import { useAppStore } from '@/store/app-store';

/**
 * The last two minutes of a session, made visible.
 *
 * ── Why a dialog and not a toast ──────────────────────────────────────────
 *
 * A toast is dismissible, stackable and easy to miss, and what is being said
 * here is "you are about to be signed out and anything unsaved will go with
 * it". That deserves to interrupt. It is not `AlertDialogCancel`-able for the
 * same reason: dismissing it would not stop the clock, so a Cancel button
 * would be a lie about what closing it does.
 *
 * The countdown is honest about which limit is closing. An idle timeout is
 * escapable — that is the whole point of the button. The absolute ceiling is
 * not, and offering "Stay signed in" against it would be a control that
 * visibly does nothing, so that case asks them to save instead.
 */
export function SessionGuard() {
  const isAuthenticated = useAppStore(s => s.isAuthenticated);
  const { warning, secondsRemaining, limitedBy, extend } = useSessionTimeout(isAuthenticated);
  const [extending, setExtending] = useState(false);

  if (!warning) return null;

  const mins = Math.floor(secondsRemaining / 60);
  const secs = secondsRemaining % 60;
  const clock = `${mins}:${String(secs).padStart(2, '0')}`;
  const canExtend = limitedBy === 'idle';

  async function stay() {
    setExtending(true);
    try {
      await extend();
    } finally {
      setExtending(false);
    }
  }

  return (
    <AlertDialog open>
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <div className="flex items-center gap-2">
            {canExtend
              ? <Clock className="size-5 text-amber-500" />
              : <ShieldAlert className="size-5 text-amber-500" />}
            <AlertDialogTitle>
              {canExtend ? 'Still there?' : 'Your session is ending'}
            </AlertDialogTitle>
          </div>
          <AlertDialogDescription>
            {canExtend
              ? 'You have been inactive for a while and will be signed out shortly. Anything you have not saved will be lost.'
              : 'Sessions on this workspace have a maximum length, and this one has reached it. Please save your work — you will be asked to sign in again.'}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="flex items-baseline justify-center gap-2 py-2">
          <span className="font-mono text-3xl font-semibold tabular-nums">{clock}</span>
          <span className="text-muted-foreground text-sm">remaining</span>
        </div>

        <AlertDialogFooter>
          {canExtend ? (
            <Button
              onClick={stay}
              disabled={extending}
              className="w-full bg-emerald-500 text-white hover:bg-emerald-600"
            >
              {extending ? 'Staying signed in…' : 'Stay signed in'}
            </Button>
          ) : (
            // Acknowledgement only. The clock is not affected either way, and
            // the dialog reappears next tick — which is correct: there really
            // is no more time, and hiding that would be worse.
            <AlertDialogAction className="w-full">I understand</AlertDialogAction>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
