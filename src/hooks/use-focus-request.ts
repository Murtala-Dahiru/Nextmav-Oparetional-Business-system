'use client';

import { useEffect, useRef } from 'react';
import { useAppStore } from '@/store/app-store';
import type { ModuleId } from '@/lib/constants';

/**
 * Receive a request to open one record, made from another module.
 *
 * A module calls this once and opens whatever it is handed — the command
 * palette's search results, a client-360 panel linking to a project, a
 * dashboard row linking to its ticket. The request is cleared as soon as it
 * is delivered, so a module that remounts does not reopen the same record and
 * trap the user on it.
 *
 * The handler is held in a ref rather than being a dependency: callers would
 * otherwise need `useCallback` at every call site, and the version of this
 * that reruns on every render re-opens the record in a loop.
 */
export function useFocusRequest(
  module: ModuleId,
  handler: (request: { type: string; id: string }) => void,
): void {
  const focusRequest = useAppStore(s => s.focusRequest);
  const clear = useAppStore(s => s.clearFocusRequest);

  const latest = useRef(handler);
  // Updated in an effect, not during render: a ref written while rendering is
  // a tear in concurrent React, and this one only has to be current by the
  // time the effect below runs.
  useEffect(() => { latest.current = handler; });

  useEffect(() => {
    if (!focusRequest || focusRequest.module !== module) return;
    latest.current({ type: focusRequest.type, id: focusRequest.id });
    clear();
  }, [focusRequest, module, clear]);
}
