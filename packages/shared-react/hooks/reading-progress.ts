import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { ReadingPosition } from "@karakeep/shared/utils/reading-progress-dom";

import { useTRPC } from "../trpc";

interface UseReadingProgressOptions {
  bookmarkId: string;
  /** Minimum saved percentage before the "continue reading" banner shows (default 10) */
  bannerMinPercent?: number;
  /** Minimum saved offset before the banner shows (default 1, i.e. any progress) */
  bannerMinOffset?: number;
  /**
   * Scrolling past this percentage dismisses the banner and re-enables saving
   * (default 15). Pass -1 to dismiss on the first reported position change;
   * callers can then gate what they report.
   */
  bannerDismissPercent?: number;
  /**
   * Restore the saved position on open instead of offering to. The banner then
   * offers to start over, and saving is never held back by it.
   */
  autoResume?: boolean;
}

/**
 * Unified reading progress hook for web and mobile.
 *
 * Handles:
 * - Fetching reading progress via its own tRPC query
 * - Capturing initial reading position (stable across query re-fetches)
 * - "Continue reading" banner state and auto-dismiss on scroll past 15%, or
 *   with `autoResume`, restoring right away and offering to start over
 * - Lazy saving via onSavePosition (idle, visibility change, unmount)
 * - Deduplication of save calls by offset
 *
 * Pass the returned `onSavePosition` and `onScrollPositionChange` to ScrollProgressTracker.
 */
export function useReadingProgress({
  bookmarkId,
  bannerMinPercent = 10,
  bannerMinOffset = 1,
  bannerDismissPercent = 15,
  autoResume = false,
}: UseReadingProgressOptions) {
  const api = useTRPC();
  const queryClient = useQueryClient();

  const {
    data: progressData,
    isStale,
    isFetching,
  } = useQuery(api.bookmarks.getReadingProgress.queryOptions({ bookmarkId }));

  const readingProgressOffset = progressData?.readingProgressOffset;
  const readingProgressAnchor = progressData?.readingProgressAnchor;
  const readingProgressPercent = progressData?.readingProgressPercent;

  // Capture initial reading progress on first load — stays stable across re-fetches
  const initialProgressRef = useRef<{
    offset: number | null;
    anchor: string | null;
    percent: number | null;
  } | null>(null);
  const previousBookmarkIdRef = useRef<string | null>(null);
  const lastSavedOffset = useRef<number | null>(null);

  if (previousBookmarkIdRef.current !== bookmarkId) {
    previousBookmarkIdRef.current = bookmarkId;
    initialProgressRef.current = null;
    lastSavedOffset.current = null;
  }

  // Only capture once data has loaded (offset transitions from undefined to a
  // value). Stale cached data is about to be replaced by the refetch already in
  // flight, so wait for it: freezing it would resume at an outdated position
  // and re-save over newer progress. If the refetch fails, the cache is all we
  // have.
  if (
    !initialProgressRef.current &&
    readingProgressOffset !== undefined &&
    (!isStale || !isFetching)
  ) {
    initialProgressRef.current = {
      offset: readingProgressOffset ?? null,
      anchor: readingProgressAnchor ?? null,
      percent: readingProgressPercent ?? null,
    };
  }

  if (
    lastSavedOffset.current === null &&
    initialProgressRef.current?.offset != null
  ) {
    lastSavedOffset.current = initialProgressRef.current.offset;
  }

  const initialOffset = initialProgressRef.current?.offset ?? null;
  const initialAnchor = initialProgressRef.current?.anchor ?? null;
  const initialPercent = initialProgressRef.current?.percent ?? null;

  // Banner state
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [restoreRequested, setRestoreRequested] = useState(false);
  const [restartRequested, setRestartRequested] = useState(false);
  const hasResumableProgress =
    !!initialOffset &&
    initialOffset >= bannerMinOffset &&
    initialPercent != null &&
    initialPercent >= bannerMinPercent &&
    initialPercent < 100;
  const showBanner = hasResumableProgress && !bannerDismissed;
  const restorePosition = autoResume
    ? hasResumableProgress && !restartRequested
    : restoreRequested;

  // Saves are held back while the reader sits at the top and would overwrite
  // the saved position: behind an unanswered "continue?" banner, or, when
  // resuming automatically, until the saved position is known.
  const holdSavesRef = useRef(false);
  holdSavesRef.current = autoResume
    ? !initialProgressRef.current
    : showBanner;
  const showBannerRef = useRef(false);
  showBannerRef.current = showBanner;

  useEffect(() => {
    setBannerDismissed(false);
    setRestoreRequested(false);
    setRestartRequested(false);
  }, [bookmarkId]);

  // Save mutation. Saves often fire on unmount, after which invalidating the
  // query only marks it stale; reopening the bookmark would then read the old
  // position from cache. Writing the new position into the cache up front keeps
  // the next open current even while the request is still in flight.
  const { mutate: updateProgress } = useMutation(
    api.bookmarks.updateReadingProgress.mutationOptions({
      // Serialize saves per bookmark so an older position can't land last
      scope: { id: `reading-progress:${bookmarkId}` },
      onMutate: async (input) => {
        const queryKey = api.bookmarks.getReadingProgress.queryKey({
          bookmarkId: input.bookmarkId,
        });
        await queryClient.cancelQueries({ queryKey });
        queryClient.setQueryData(queryKey, {
          readingProgressOffset: input.readingProgressOffset,
          readingProgressAnchor: input.readingProgressAnchor ?? null,
          readingProgressPercent: input.readingProgressPercent ?? null,
        });
      },
      onError: (_error, input) => {
        // Let the same position be retried instead of being deduplicated away
        if (lastSavedOffset.current === input.readingProgressOffset) {
          lastSavedOffset.current = null;
        }
      },
      onSettled: () => {
        queryClient.invalidateQueries(
          api.bookmarks.getReadingProgress.pathFilter(),
        );
      },
    }),
  );

  // Lazy save — called by ScrollProgressTracker on idle/visibility/beforeunload/unmount
  const onSavePosition = useCallback(
    (position: ReadingPosition) => {
      if (holdSavesRef.current) return;
      if (lastSavedOffset.current === position.offset) return;
      lastSavedOffset.current = position.offset;
      updateProgress({
        bookmarkId,
        readingProgressOffset: position.offset,
        readingProgressAnchor: position.anchor,
        readingProgressPercent: position.percent,
      });
    },
    [bookmarkId, updateProgress],
  );

  // Responsive — called on every throttled scroll for banner dismissal
  const onScrollPositionChange = useCallback(
    (position: ReadingPosition) => {
      if (
        !autoResume &&
        showBannerRef.current &&
        position.percent > bannerDismissPercent
      ) {
        setBannerDismissed(true);
      }
    },
    [autoResume, bannerDismissPercent],
  );

  const onContinue = useCallback(() => {
    setRestoreRequested(true);
    setBannerDismissed(true);
  }, []);

  const onDismiss = useCallback(() => {
    setBannerDismissed(true);
  }, []);

  const onRestart = useCallback(() => {
    setRestartRequested(true);
    setBannerDismissed(true);
  }, []);

  return {
    // Banner
    showBanner,
    bannerPercent: initialPercent,
    onContinue,
    onDismiss,
    onRestart,
    // ScrollProgressTracker props
    restorePosition,
    readingProgressOffset: initialOffset,
    readingProgressAnchor: initialAnchor,
    onSavePosition,
    onScrollPositionChange,
  };
}
