import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, TouchableOpacity, View } from "react-native";
import ImageView from "react-native-image-viewing";
import BookmarkAssetImage from "@/components/bookmarks/BookmarkAssetImage";
import { PDFViewer } from "@/components/bookmarks/PDFViewer";
import { Text } from "@/components/ui/Text";
import { useAssetUrl } from "@/lib/hooks";
import { BookOpen, X } from "lucide-react-native";

import { useReadingProgress } from "@karakeep/shared-react/hooks/reading-progress";
import { BookmarkTypes, ZBookmark } from "@karakeep/shared/types/bookmarks";

interface BookmarkAssetViewProps {
  bookmark: ZBookmark;
}

/** How long the reading progress bar stays visible after a page change */
const PROGRESS_BAR_HIDE_DELAY_MS = 2000;

/**
 * PDF reading progress is page-based: the saved offset is the current page,
 * the percentage is page / page count.
 */
function PdfAssetView({
  bookmarkId,
  assetId,
}: {
  bookmarkId: string;
  assetId: string;
}) {
  const assetSource = useAssetUrl(assetId);
  const {
    showBanner,
    bannerPercent,
    onContinue,
    onDismiss,
    restorePosition,
    readingProgressOffset,
    onSavePosition,
    onScrollPositionChange,
  } = useReadingProgress({
    bookmarkId,
    // Page-based: a few pages into a long book is well under 10%
    bannerMinPercent: 0,
    bannerMinOffset: 2,
  });

  const [targetPage, setTargetPage] = useState<number | undefined>(undefined);
  const [progressPercent, setProgressPercent] = useState(0);
  const [progressBarVisible, setProgressBarVisible] = useState(false);
  const hideBarTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (hideBarTimer.current) clearTimeout(hideBarTimer.current);
    };
  }, []);

  useEffect(() => {
    if (restorePosition && readingProgressOffset && readingProgressOffset > 0) {
      setTargetPage(readingProgressOffset);
    }
  }, [restorePosition, readingProgressOffset]);

  const handlePageChanged = useCallback(
    (page: number, numberOfPages: number) => {
      const position = {
        offset: page,
        anchor: "",
        percent:
          numberOfPages > 0
            ? Math.min(100, Math.round((page / numberOfPages) * 100))
            : 0,
      };
      setProgressPercent(position.percent);
      setProgressBarVisible(true);
      if (hideBarTimer.current) clearTimeout(hideBarTimer.current);
      hideBarTimer.current = setTimeout(
        () => setProgressBarVisible(false),
        PROGRESS_BAR_HIDE_DELAY_MS,
      );
      onScrollPositionChange(position);
      onSavePosition(position);
    },
    [onSavePosition, onScrollPositionChange],
  );

  return (
    <View className="flex flex-1">
      {showBanner && (
        <View className="flex-row items-center gap-2 border-b border-border bg-background px-4 py-2">
          <BookOpen size={16} className="text-muted-foreground" />
          <Text className="flex-1 text-sm text-muted-foreground">
            {bannerPercent && bannerPercent > 0
              ? `Continue where you left off (${bannerPercent}%)`
              : "Continue where you left off"}
          </Text>
          <TouchableOpacity
            onPress={onContinue}
            className="rounded-md bg-primary px-3 py-1"
          >
            <Text className="text-xs font-medium text-primary-foreground">
              Continue
            </Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={onDismiss} className="p-1">
            <X size={14} className="text-muted-foreground" />
          </TouchableOpacity>
        </View>
      )}
      <View className="relative flex-1">
        <PDFViewer
          source={assetSource.uri ?? ""}
          headers={assetSource.headers}
          page={targetPage}
          onPageChanged={handlePageChanged}
        />
        {progressBarVisible && (
          <View
            pointerEvents="none"
            className="absolute left-0 right-0 top-0 h-[3px]"
          >
            <View
              className="h-full bg-orange-500"
              style={{ width: `${progressPercent}%` }}
            />
          </View>
        )}
      </View>
    </View>
  );
}

export default function BookmarkAssetView({
  bookmark,
}: BookmarkAssetViewProps) {
  const [imageZoom, setImageZoom] = useState(false);

  if (bookmark.content.type !== BookmarkTypes.ASSET) {
    throw new Error("Wrong content type rendered");
  }

  const assetSource = useAssetUrl(bookmark.content.assetId);

  // Check if this is a PDF asset
  if (bookmark.content.assetType === "pdf") {
    return (
      <PdfAssetView
        bookmarkId={bookmark.id}
        assetId={bookmark.content.assetId}
      />
    );
  }

  // Handle image assets as before
  return (
    <View className="flex flex-1 gap-2">
      <ImageView
        visible={imageZoom}
        imageIndex={0}
        onRequestClose={() => setImageZoom(false)}
        doubleTapToZoomEnabled={true}
        images={[assetSource]}
      />

      <Pressable className="flex-1" onPress={() => setImageZoom(true)}>
        <BookmarkAssetImage
          assetId={bookmark.content.assetId}
          className="h-full w-full"
          contentFit="contain"
        />
      </Pressable>
    </View>
  );
}
