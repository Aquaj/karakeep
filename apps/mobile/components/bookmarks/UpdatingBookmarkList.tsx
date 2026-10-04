import { useEffect, useRef } from "react";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import useAppSettings from "@/lib/settings";
import QueryPageState from "@/components/QueryPageState";

import type { ZGetBookmarksRequest } from "@karakeep/shared/types/bookmarks";
import { useTRPC } from "@karakeep/shared-react/trpc";
import { BookmarkTypes } from "@karakeep/shared/types/bookmarks";

import BookmarkList from "./BookmarkList";

export default function UpdatingBookmarkList({
  query,
  header,
}: {
  query: Omit<ZGetBookmarksRequest, "sortOrder" | "includeContent">; // Sort order is handled by mobile settings
  header?: React.ReactElement;
}) {
  const api = useTRPC();
  const queryClient = useQueryClient();
  const { settings } = useAppSettings();
  const {
    data,
    isPending,
    isPlaceholderData,
    error,
    dataUpdatedAt,
    fetchNextPage,
    hasNextPage,
    isFetching,
    isFetchingNextPage,
    refetch,
  } = useInfiniteQuery(
    api.bookmarks.getBookmarks.infiniteQueryOptions(
      {
        ...query,
        sortOrder: settings.bookmarkSortOrder,
        useCursorV2: true,
        includeContent: false,
      },
      {
        initialCursor: null,
        getNextPageParam: (lastPage) => lastPage.nextCursor,
      },
    ),
  );

  // Each card renders its own getBookmark query, seeded from the list only on
  // first mount and persisted across restarts, so a list refresh alone never
  // reached it. Push the list's copy into the cards' entries when it's newer.
  // Structural sharing keeps unchanged bookmarks referentially equal across
  // fetches, so only objects not pushed before carry fresh data (loading the
  // next page must not replay page one over fresher card data).
  const pushedBookmarks = useRef(new WeakSet<object>());
  useEffect(() => {
    if (!data) return;
    for (const bookmark of data.pages.flatMap((p) => p.bookmarks)) {
      if (pushedBookmarks.current.has(bookmark)) continue;
      pushedBookmarks.current.add(bookmark);
      const queryKey = api.bookmarks.getBookmark.queryKey({
        bookmarkId: bookmark.id,
      });
      const cached = queryClient.getQueryState(queryKey);
      if (cached && cached.dataUpdatedAt >= dataUpdatedAt) continue;
      queryClient.setQueryData(queryKey, bookmark, {
        updatedAt: dataUpdatedAt,
      });
    }
  }, [api, queryClient, data, dataUpdatedAt]);

  if (!data) {
    return <QueryPageState error={error} onRetry={() => refetch()} />;
  }

  const onRefresh = () => {
    queryClient.invalidateQueries(api.bookmarks.getBookmarks.pathFilter());
    queryClient.invalidateQueries(api.bookmarks.getBookmark.pathFilter());
  };

  const onEndReached = () => {
    if (!hasNextPage || isFetching) {
      return;
    }
    void fetchNextPage({ cancelRefetch: false });
  };

  return (
    <BookmarkList
      bookmarks={data.pages
        .flatMap((p) => p.bookmarks)
        .filter((b) => b.content.type != BookmarkTypes.UNKNOWN)}
      header={header}
      onRefresh={onRefresh}
      fetchNextPage={onEndReached}
      isFetchingNextPage={isFetchingNextPage}
      isRefreshing={isPending || isPlaceholderData}
    />
  );
}
