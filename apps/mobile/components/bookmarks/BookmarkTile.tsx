import { Pressable, View } from "react-native";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { Text } from "@/components/ui/Text";
import useAppSettings from "@/lib/settings";
import { buildApiHeaders } from "@/lib/utils";

import type { ZBookmark } from "@karakeep/shared/types/bookmarks";
import { BookmarkTypes } from "@karakeep/shared/types/bookmarks";
import {
  getBookmarkLinkImageUrl,
  getBookmarkTitle,
} from "@karakeep/shared/utils/bookmarkUtils";

import BookmarkAssetImage from "./BookmarkAssetImage";

const TILE_MEDIA_CLASS = "h-24 w-36 overflow-hidden rounded-lg bg-muted";

function TileMedia({ bookmark }: { bookmark: ZBookmark }) {
  const { settings } = useAppSettings();

  switch (bookmark.content.type) {
    case BookmarkTypes.LINK: {
      const imageUrl = getBookmarkLinkImageUrl(bookmark.content);
      return (
        <View className={TILE_MEDIA_CLASS}>
          <Image
            source={
              imageUrl
                ? imageUrl.localAsset
                  ? {
                      uri: `${settings.address}${imageUrl.url}`,
                      headers: buildApiHeaders(
                        settings.apiKey,
                        settings.customHeaders,
                      ),
                    }
                  : { uri: imageUrl.url }
                : // oxlint-disable-next-line no-require-imports
                  require("@/assets/blur.jpeg")
            }
            style={{ width: "100%", height: "100%" }}
            contentFit="cover"
          />
        </View>
      );
    }
    case BookmarkTypes.ASSET: {
      const assetImage =
        bookmark.assets.find((r) => r.assetType == "assetScreenshot")?.id ??
        bookmark.content.assetId;
      return (
        <BookmarkAssetImage assetId={assetImage} className={TILE_MEDIA_CLASS} />
      );
    }
    case BookmarkTypes.TEXT:
      return (
        <View className={`${TILE_MEDIA_CLASS} p-2`}>
          <Text className="text-xs text-muted-foreground" numberOfLines={5}>
            {bookmark.content.text}
          </Text>
        </View>
      );
    default:
      return <View className={TILE_MEDIA_CLASS} />;
  }
}

/** Compact bookmark preview for horizontal rows */
export default function BookmarkTile({ bookmark }: { bookmark: ZBookmark }) {
  const router = useRouter();
  const title = getBookmarkTitle(bookmark)?.trim() || "Untitled";

  return (
    <Pressable
      className="w-36 gap-1"
      onPress={() => router.push(`/dashboard/bookmarks/${bookmark.id}`)}
    >
      <TileMedia bookmark={bookmark} />
      <Text className="text-sm text-foreground" numberOfLines={2}>
        {title}
      </Text>
    </Pressable>
  );
}
