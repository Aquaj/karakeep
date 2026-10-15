import { Platform, View } from "react-native";
import { MenuAction, MenuView } from "@react-native-menu/menu";
import { MoreHorizontal } from "lucide-react-native";

import useAppSettings from "@/lib/settings";
import { useMenuIconColors } from "@/lib/useMenuIconColors";

import type { ZBookmarkSortField } from "@karakeep/shared/types/bookmarks";

const SORT_OPTIONS: {
  sortBy: ZBookmarkSortField;
  sortOrder: "asc" | "desc";
  title: string;
  iosImage: string;
}[] = [
  {
    sortBy: "createdAt",
    sortOrder: "desc",
    title: "Newest First",
    iosImage: "arrow.down",
  },
  {
    sortBy: "createdAt",
    sortOrder: "asc",
    title: "Oldest First",
    iosImage: "arrow.up",
  },
  {
    sortBy: "title",
    sortOrder: "asc",
    title: "Title A–Z",
    iosImage: "textformat",
  },
  {
    sortBy: "title",
    sortOrder: "desc",
    title: "Title Z–A",
    iosImage: "textformat",
  },
  {
    sortBy: "lastRead",
    sortOrder: "desc",
    title: "Recently Read",
    iosImage: "clock",
  },
  {
    sortBy: "readingProgress",
    sortOrder: "desc",
    title: "Most Read",
    iosImage: "book",
  },
  {
    sortBy: "readingProgress",
    sortOrder: "asc",
    title: "Least Read",
    iosImage: "book.closed",
  },
];

const sortActionId = (option: { sortBy: string; sortOrder: string }) =>
  `sort:${option.sortBy}:${option.sortOrder}`;

function useBookmarkListLayoutMenu(): {
  layoutActions: MenuAction[];
  handleLayoutAction: (event: string) => boolean;
  menuIconColor: string;
} {
  const { settings, setSettings } = useAppSettings();
  const { menuIconColor } = useMenuIconColors();

  const layoutModeActions: MenuAction[] = [
    {
      id: "card",
      title: "Card",
      state: settings.bookmarkLayout === "card" ? "on" : "off",
      image: Platform.select({ ios: "rectangle.grid.1x2" }),
      imageColor: Platform.select({ ios: menuIconColor }),
    },
    {
      id: "list",
      title: "List",
      state: settings.bookmarkLayout === "list" ? "on" : "off",
      image: Platform.select({ ios: "list.bullet" }),
      imageColor: Platform.select({ ios: menuIconColor }),
    },
  ];
  const showNotesAction: MenuAction = {
    id: "show_notes",
    title: "Show Notes",
    state: settings.showNotes ? "on" : "off",
    image: Platform.select({ ios: "note.text" }),
    imageColor: Platform.select({ ios: menuIconColor }),
  };

  const layoutActions: MenuAction[] = [
    {
      id: "layout",
      title: "Layout",
      image: Platform.select({ ios: "rectangle.grid.1x2" }),
      imageColor: Platform.select({ ios: menuIconColor }),
      subactions: layoutModeActions,
    },
    showNotesAction,
    {
      id: "sort",
      title: "Sort",
      image: Platform.select({ ios: "arrow.up.arrow.down" }),
      imageColor: Platform.select({ ios: menuIconColor }),
      subactions: [
        ...SORT_OPTIONS.map(
          (option): MenuAction => ({
            id: sortActionId(option),
            title: option.title,
            state:
              settings.bookmarkSortBy === option.sortBy &&
              settings.bookmarkSortOrder === option.sortOrder
                ? "on"
                : "off",
            image: Platform.select({ ios: option.iosImage }),
            imageColor: Platform.select({ ios: menuIconColor }),
          }),
        ),
        {
          id: "sort_favourites_first",
          title: "Favorites First",
          state: settings.bookmarkFavouritesFirst ? "on" : "off",
          image: Platform.select({ ios: "star" }),
          imageColor: Platform.select({ ios: menuIconColor }),
        },
      ],
    },
  ];

  const handleLayoutAction = (event: string) => {
    if (event === "card" || event === "list") {
      setSettings({
        ...settings,
        bookmarkLayout: event,
      });
      return true;
    }

    if (event === "show_notes") {
      setSettings({
        ...settings,
        showNotes: !settings.showNotes,
      });
      return true;
    }

    const sortOption = SORT_OPTIONS.find(
      (option) => sortActionId(option) === event,
    );
    if (sortOption) {
      setSettings({
        ...settings,
        bookmarkSortBy: sortOption.sortBy,
        bookmarkSortOrder: sortOption.sortOrder,
      });
      return true;
    }

    if (event === "sort_favourites_first") {
      setSettings({
        ...settings,
        bookmarkFavouritesFirst: !settings.bookmarkFavouritesFirst,
      });
      return true;
    }

    return false;
  };

  return { layoutActions, handleLayoutAction, menuIconColor };
}

export default function BookmarkListHeader() {
  const { layoutActions, handleLayoutAction, menuIconColor } =
    useBookmarkListLayoutMenu();

  return (
    <MenuView
      onPressAction={({ nativeEvent }) => {
        handleLayoutAction(nativeEvent.event);
      }}
      actions={layoutActions}
      shouldOpenOnLongPress={false}
    >
      <View className="h-9 w-9 items-center justify-center rounded-full bg-card">
        <MoreHorizontal size={20} color={menuIconColor} />
      </View>
    </MenuView>
  );
}

export { useBookmarkListLayoutMenu };
