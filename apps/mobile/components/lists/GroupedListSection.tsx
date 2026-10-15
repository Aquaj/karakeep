import { ActivityIndicator, FlatList, Pressable, View } from "react-native";
import { Link } from "expo-router";
import BookmarkTile from "@/components/bookmarks/BookmarkTile";
import ChevronRight from "@/components/ui/ChevronRight";
import { Text } from "@/components/ui/Text";
import { useArchiveFilter } from "@/lib/hooks";
import useAppSettings from "@/lib/settings";
import { useQuery } from "@tanstack/react-query";

import type { ZGetBookmarksRequest } from "@karakeep/shared/types/bookmarks";
import { useTRPC } from "@karakeep/shared-react/trpc";
import { BookmarkTypes } from "@karakeep/shared/types/bookmarks";

/** Bookmarks previewed per section; the rest is one tap away */
const PREVIEW_COUNT = 10;

interface GroupedListSectionProps {
  title: string;
  href: string;
  /** Which bookmarks the section shows, e.g. `{ listId }` */
  filter: Pick<ZGetBookmarksRequest, "listId" | "favourited">;
  numBookmarks?: number;
}

/** A list's header and a horizontal row of its first bookmarks */
export default function GroupedListSection({
  title,
  href,
  filter,
  numBookmarks,
}: GroupedListSectionProps) {
  const api = useTRPC();
  const { settings } = useAppSettings();
  const { archived, isLoading: isArchiveFilterLoading } = useArchiveFilter();
  const { data, isPending, error } = useQuery({
    ...api.bookmarks.getBookmarks.queryOptions({
      ...filter,
      archived,
      limit: PREVIEW_COUNT,
      sortOrder: settings.bookmarkSortOrder,
      sortBy: settings.bookmarkSortBy,
      favouritesFirst: settings.bookmarkFavouritesFirst,
      useCursorV2: true,
      includeContent: false,
    }),
    enabled: !isArchiveFilterLoading,
  });
  const bookmarks = data?.bookmarks.filter(
    (b) => b.content.type !== BookmarkTypes.UNKNOWN,
  );

  return (
    <View className="gap-2">
      <Link asChild href={href}>
        <Pressable className="flex flex-row items-center justify-between px-4">
          <Text className="mr-2 flex-1 font-semibold" numberOfLines={1}>
            {title}
          </Text>
          <View className="flex flex-row items-center">
            {numBookmarks !== undefined && (
              <Text className="mr-2 text-xs text-muted-foreground">
                {numBookmarks}
              </Text>
            )}
            <ChevronRight />
          </View>
        </Pressable>
      </Link>
      {bookmarks && bookmarks.length > 0 ? (
        <FlatList
          horizontal
          showsHorizontalScrollIndicator={false}
          data={bookmarks}
          keyExtractor={(b) => b.id}
          renderItem={({ item }) => <BookmarkTile bookmark={item} />}
          contentContainerStyle={{ gap: 12, paddingHorizontal: 16 }}
        />
      ) : (
        <View className="h-10 justify-center px-4">
          {isPending && !error ? (
            <ActivityIndicator />
          ) : (
            <Text className="text-sm text-muted-foreground">
              {error ? "Failed to load bookmarks" : "No bookmarks"}
            </Text>
          )}
        </View>
      )}
    </View>
  );
}
