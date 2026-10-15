import { useEffect, useMemo, useState } from "react";
import {
  FlatList,
  Platform,
  PlatformColor,
  Pressable,
  View,
} from "react-native";
import * as Haptics from "expo-haptics";
import { Link, router, Stack } from "expo-router";
import GroupedListSection from "@/components/lists/GroupedListSection";
import { PendingListInvitations } from "@/components/lists/pending-list-invitations";
import QueryPageState from "@/components/QueryPageState";
import ChevronRight from "@/components/ui/ChevronRight";
import { FAB } from "@/components/ui/FAB";
import { Text } from "@/components/ui/Text";
import { READABLE_CONTENT_MAX_WIDTH } from "@/lib/responsive";
import useAppSettings from "@/lib/settings";
import { useColorScheme } from "@/lib/useColorScheme";
import { condProps } from "@/lib/utils";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ListTree, Plus, Rows3 } from "lucide-react-native";

import { useBookmarkLists } from "@karakeep/shared-react/hooks/lists";
import { useTRPC } from "@karakeep/shared-react/trpc";
import { ZBookmarkListTreeNode } from "@karakeep/shared/utils/listUtils";

interface ListLink {
  id: string;
  logo: string;
  name: string;
  href: string;
  level: number;
  parent?: string;
  numChildren: number;
  collapsed: boolean;
  isSharedSection?: boolean;
  numBookmarks?: number;
}

function byName(a: ZBookmarkListTreeNode, b: ZBookmarkListTreeNode) {
  return a.item.name.localeCompare(b.item.name);
}

function traverseTree(
  node: ZBookmarkListTreeNode,
  links: ListLink[],
  showChildrenOf: Record<string, boolean>,
  listStats?: Map<string, number>,
  parent?: string,
  level = 0,
) {
  links.push({
    id: node.item.id,
    logo: node.item.icon,
    name: node.item.name,
    href: `/dashboard/lists/${node.item.id}`,
    level,
    parent,
    numChildren: node.children?.length ?? 0,
    collapsed: !showChildrenOf[node.item.id],
    numBookmarks: listStats?.get(node.item.id),
  });

  if (node.children && showChildrenOf[node.item.id]) {
    [...node.children]
      .sort(byName)
      .forEach((child) =>
        traverseTree(
          child,
          links,
          showChildrenOf,
          listStats,
          node.item.id,
          level + 1,
        ),
      );
  }
}

interface GroupedSection {
  id: string;
  title: string;
  href: string;
  filter: { listId: string } | { favourited: true };
  numBookmarks?: number;
}

/** Every list as a section, in tree order, named with its parents */
function collectSections(
  node: ZBookmarkListTreeNode,
  sections: GroupedSection[],
  listStats?: Map<string, number>,
  parentPath?: string,
) {
  const path = parentPath
    ? `${parentPath} › ${node.item.name}`
    : node.item.name;
  sections.push({
    id: node.item.id,
    title: `${node.item.icon} ${path}`,
    href: `/dashboard/lists/${node.item.id}`,
    filter: { listId: node.item.id },
    numBookmarks: listStats?.get(node.item.id),
  });
  [...(node.children ?? [])]
    .sort(byName)
    .forEach((child) => collectSections(child, sections, listStats, path));
}

function ListsViewToggle() {
  const { settings, setSettings } = useAppSettings();
  const { colors } = useColorScheme();
  const grouped = settings.listsView === "grouped";
  const Icon = grouped ? ListTree : Rows3;
  return (
    <Pressable
      accessibilityLabel={
        grouped ? "Show lists as a tree" : "Group bookmarks by list"
      }
      hitSlop={8}
      onPress={() => {
        Haptics.selectionAsync();
        setSettings({ ...settings, listsView: grouped ? "tree" : "grouped" });
      }}
    >
      <Icon size={22} color={colors.foreground} />
    </Pressable>
  );
}

export default function Lists() {
  const { colors } = useColorScheme();
  const [refreshing, setRefreshing] = useState(false);
  const { data: lists, isPending, error, refetch } = useBookmarkLists();
  const [showChildrenOf, setShowChildrenOf] = useState<Record<string, boolean>>(
    {},
  );
  const api = useTRPC();
  const queryClient = useQueryClient();
  const { data: listStats } = useQuery(api.lists.stats.queryOptions());
  const { settings } = useAppSettings();

  // Check if there are any shared lists
  const hasSharedLists = useMemo(() => {
    return lists?.data.some((list) => list.userRole !== "owner") ?? false;
  }, [lists?.data]);

  // Check if any list has children to determine if we need chevron spacing
  const hasAnyListsWithChildren = useMemo(() => {
    const checkForChildren = (node: ZBookmarkListTreeNode): boolean => {
      if (node.children && node.children.length > 0) return true;
      return false;
    };
    return (
      Object.values(lists?.root ?? {}).some(checkForChildren) || hasSharedLists
    );
  }, [lists?.root, hasSharedLists]);

  useEffect(() => {
    setRefreshing(isPending);
  }, [isPending]);

  if (!lists) {
    return <QueryPageState error={error} onRetry={() => refetch()} />;
  }

  const onRefresh = () => {
    queryClient.invalidateQueries(api.lists.list.pathFilter());
    queryClient.invalidateQueries(api.lists.stats.pathFilter());
    queryClient.invalidateQueries(api.lists.getPendingInvitations.pathFilter());
    if (settings.listsView === "grouped") {
      queryClient.invalidateQueries(api.bookmarks.getBookmarks.pathFilter());
    }
  };

  const header = (
    <Stack.Screen options={{ headerRight: () => <ListsViewToggle /> }} />
  );

  if (settings.listsView === "grouped") {
    const sections: GroupedSection[] = [
      {
        id: "fav",
        title: "⭐️ Favourites",
        href: "/dashboard/favourites",
        filter: { favourited: true },
      },
    ];
    const roots = Object.values(lists.root).sort(byName);
    // Own lists first, then the ones shared with the user
    for (const owned of [true, false]) {
      roots
        .filter((list) => (list.item.userRole === "owner") === owned)
        .forEach((list) => collectSections(list, sections, listStats?.stats));
    }

    return (
      <>
        {header}
        <FlatList
          ListHeaderComponent={PendingListInvitations}
          className="h-full"
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={{
            gap: 20,
            paddingTop: 8,
            paddingBottom: 20,
            width: "100%",
            maxWidth: READABLE_CONTENT_MAX_WIDTH,
            alignSelf: "center",
          }}
          data={sections}
          keyExtractor={(section) => section.id}
          renderItem={({ item }) => (
            <GroupedListSection
              title={item.title}
              href={item.href}
              filter={item.filter}
              numBookmarks={item.numBookmarks}
            />
          )}
          refreshing={refreshing}
          onRefresh={onRefresh}
        />
      </>
    );
  }

  const links: ListLink[] = [
    {
      id: "fav",
      logo: "⭐️",
      name: "Favourites",
      href: "/dashboard/favourites",
      level: 0,
      numChildren: 0,
      collapsed: false,
    },
    {
      id: "arch",
      logo: "🗄️",
      name: "Archive",
      href: "/dashboard/archive",
      level: 0,
      numChildren: 0,
      collapsed: false,
    },
  ];

  // Add shared lists section if there are any
  if (hasSharedLists) {
    // Count shared lists to determine if section has children
    const sharedListsCount = Object.values(lists.root).filter(
      (list) => list.item.userRole !== "owner",
    ).length;

    links.push({
      id: "shared-section",
      logo: "👥",
      name: "Shared Lists",
      href: "#",
      level: 0,
      numChildren: sharedListsCount,
      collapsed: !showChildrenOf["shared-section"],
      isSharedSection: true,
    });

    // Add shared lists as children if section is expanded
    if (showChildrenOf["shared-section"]) {
      Object.values(lists.root)
        .sort(byName)
        .forEach((list) => {
          if (list.item.userRole !== "owner") {
            traverseTree(
              list,
              links,
              showChildrenOf,
              listStats?.stats,
              "shared-section",
              1,
            );
          }
        });
    }
  }

  // Add owned lists only
  Object.values(lists.root)
    .sort(byName)
    .forEach((list) => {
      if (list.item.userRole === "owner") {
        traverseTree(list, links, showChildrenOf, listStats?.stats);
      }
    });

  return (
    <>
      {header}
      <FlatList
        ListHeaderComponent={PendingListInvitations}
        className="h-full"
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{
          gap: 6,
          paddingBottom: 20,
          paddingHorizontal: 15,
          width: "100%",
          maxWidth: READABLE_CONTENT_MAX_WIDTH,
          alignSelf: "center",
          marginBottom: 15,
        }}
        renderItem={(l) => (
          <View
            className="flex flex-row items-center rounded-xl bg-card px-4 py-2"
            style={{
              borderCurve: "continuous",
              ...condProps({
                condition: l.item.level > 0,
                props: { marginLeft: l.item.level * 20 },
              }),
            }}
          >
            {hasAnyListsWithChildren && (
              <View style={{ width: 32 }}>
                {l.item.numChildren > 0 && (
                  <Pressable
                    className="pr-2"
                    onPress={() => {
                      setShowChildrenOf((prev) => ({
                        ...prev,
                        [l.item.id]: !prev[l.item.id],
                      }));
                    }}
                  >
                    {l.item.collapsed ? (
                      <ChevronRight color={colors.foreground} />
                    ) : (
                      <ChevronDown color={colors.foreground} />
                    )}
                  </Pressable>
                )}
              </View>
            )}

            {l.item.isSharedSection ? (
              <Pressable
                className="flex flex-1 flex-row items-center justify-between"
                onPress={() => {
                  setShowChildrenOf((prev) => ({
                    ...prev,
                    [l.item.id]: !prev[l.item.id],
                  }));
                }}
              >
                <Text className="mr-2 flex-1" numberOfLines={1}>
                  {l.item.logo} {l.item.name}
                </Text>
              </Pressable>
            ) : (
              <Link
                asChild
                key={l.item.id}
                href={l.item.href}
                className="flex-1"
              >
                <Pressable className="flex flex-row items-center justify-between">
                  <Text className="mr-2 flex-1" numberOfLines={1}>
                    {l.item.logo} {l.item.name}
                  </Text>
                  <View className="flex flex-row items-center">
                    {l.item.numBookmarks !== undefined && (
                      <Text className="mr-2 text-xs text-muted-foreground">
                        {l.item.numBookmarks}
                      </Text>
                    )}
                    <ChevronRight />
                  </View>
                </Pressable>
              </Link>
            )}
          </View>
        )}
        data={links}
        keyExtractor={(item) => item.id}
        refreshing={refreshing}
        onRefresh={onRefresh}
      />
      <FAB>
        <Pressable
          className="h-full w-full items-center justify-center"
          onPress={() => {
            Haptics.selectionAsync();
            router.push("/dashboard/lists/new");
          }}
        >
          <Plus
            size={24}
            color={Platform.OS === "ios" ? PlatformColor("label") : "white"}
          />
        </Pressable>
      </FAB>
    </>
  );
}
