import { useCallback, useEffect, useRef } from 'react';
import { useBeforeUnload, useBlocker, type BlockerFunction } from 'react-router';
import { useConfirm } from '@/ui/feedback';
import { LEAVE_UNSAVED } from './labels';

export type UnsavedGuard = {
  /**
   * Let the next navigation through without asking: call it right before navigating away after a successful save
   * (`guard.release(); navigate(...)`). It stays released until the form is clean again (then it re-arms).
   */
  release: () => void;
};

/**
 * Guards a page with a form against losing typed input. While `dirty` is true:
 * - leaving the page inside the app (a link, the tab bar, Back) asks "לצאת בלי לשמור?" (useConfirm); "חזרה" stays;
 * - closing or reloading the tab gets the browser's own "leave site?" prompt.
 * Search-parameter changes on the same page (tabs, filters) are not blocked. One guard per screen (the router supports
 * one blocker at a time). For a dialog with a form, use <Dialog dismissible={!dirty}> instead.
 *
 *   const guard = useUnsavedGuard(dirty);
 *   const save = useMutation({ …, onSuccess: (id) => { guard.release(); navigate(`/app/events/${id}`); } });
 */
export function useUnsavedGuard(dirty: boolean): UnsavedGuard {
  const dirtyRef = useRef(dirty);
  const released = useRef(false);
  useEffect(() => {
    dirtyRef.current = dirty;
    if (!dirty) released.current = false;
  }, [dirty]);
  const shouldBlock = useCallback<BlockerFunction>(
    ({ currentLocation, nextLocation }) => dirtyRef.current && !released.current && currentLocation.pathname !== nextLocation.pathname,
    [],
  );
  const blocker = useBlocker(shouldBlock);
  const confirm = useConfirm();
  const asking = useRef(false);
  useEffect(() => {
    if (blocker.state !== 'blocked' || asking.current) return;
    asking.current = true;
    void confirm({ title: LEAVE_UNSAVED.title, body: LEAVE_UNSAVED.body, confirm: LEAVE_UNSAVED.confirm, danger: true }).then((leave) => {
      asking.current = false;
      if (leave) blocker.proceed?.();
      else blocker.reset?.();
    });
  }, [blocker, confirm]);

  useBeforeUnload(
    useCallback((e: BeforeUnloadEvent) => {
      if (!dirtyRef.current || released.current) return;
      e.preventDefault();
      // older browsers need a returnValue to show the prompt
      e.returnValue = '';
    }, []),
  );

  return { release: useCallback(() => { released.current = true; }, []) };
}
