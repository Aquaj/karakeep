import type { Page } from "playwright/test";
import { expect } from "playwright/test";

import { BookmarkTypes } from "@karakeep/shared/types/bookmarks";

import { createWebTestUser, it, signIn } from "../../utils/browser";

async function seedBookmark(page: Page) {
  const { trpc, email } = await createWebTestUser();
  await trpc.bookmarks.createBookmark.mutate({
    type: BookmarkTypes.TEXT,
    text: "A bookmark for the weekend",
  });
  await signIn(page, email);
  const bookmark = page.locator("[data-bookmark-index]");
  await expect(bookmark).toHaveCount(1);
  return bookmark;
}

// Sign-in, the queued crawl and search indexing each get their own budget,
// which together exceed the default 60s test timeout.
it(
  "saves a link and finds it through search",
  { timeout: 150000 },
  async ({ page }) => {
    const { trpc, email } = await createWebTestUser();
    await signIn(page, email);
    await page
      .getByPlaceholder("Paste a link, write a note or drop an image…")
      .fill("http://nginx/hello.html");
    await page.getByRole("button", { name: /^Save/ }).click();
    const cards = page.locator("[data-bookmark-index]");
    await expect(cards).toHaveCount(1);

    // Crawling and search indexing happen asynchronously in the workers, so
    // wait for each stage on its own. The crawl shares the crawler queue with
    // the worker and API test files running in parallel, so it gets the same
    // budget as the crawler tests, and a failed crawl fails right away.
    const {
      bookmarks: [saved],
    } = await trpc.bookmarks.getBookmarks.query({});
    await expect
      .poll(
        async () => {
          const { content } = await trpc.bookmarks.getBookmark.query({
            bookmarkId: saved.id,
          });
          return content.type === BookmarkTypes.LINK
            ? content.crawlStatus
            : content.type;
        },
        { message: "Saved bookmark is crawled", timeout: 60000 },
      )
      .not.toBe("pending");
    const crawled = await trpc.bookmarks.getBookmark.query({
      bookmarkId: saved.id,
    });
    expect(crawled.content).toMatchObject({
      type: BookmarkTypes.LINK,
      crawlStatus: "success",
    });

    // The crawler enqueues a reindex once it has stored the page title.
    await expect
      .poll(
        async () => {
          const result = await trpc.bookmarks.searchBookmarks.query({
            text: "My test title",
          });
          return result.bookmarks.map((bookmark) => bookmark.id);
        },
        { message: "Crawled bookmark is searchable", timeout: 30000 },
      )
      .toContain(saved.id);

    const search = page.getByPlaceholder(
      "Search titles, text, URLs, and tags…",
    );
    await search.fill("My test title");
    await search.press("Enter");
    await expect(page).toHaveURL(/\/dashboard\/search\?/);
    await expect(cards.filter({ hasText: "My test title" })).toBeVisible();
    await expect(cards).toHaveCount(1);
  },
);

it("favorites a bookmark and shows it in Favourites", async ({ page }) => {
  const bookmark = await seedBookmark(page);
  await bookmark.hover();
  await bookmark.getByRole("button", { name: "Favorite", exact: true }).click();
  await expect(
    bookmark.getByRole("button", { name: "Unfavorite", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: /Favourites/ }).click();
  await expect(page).toHaveURL(/\/dashboard\/favourites$/);
  await expect(bookmark).toHaveText(/A bookmark for the weekend/);
  await page.reload();
  await bookmark.hover();
  await expect(
    bookmark.getByRole("button", { name: "Unfavorite", exact: true }),
  ).toBeVisible();
});

it("archives a bookmark and shows it in Archive", async ({ page }) => {
  const bookmark = await seedBookmark(page);
  await bookmark.hover();
  await bookmark.getByRole("button", { name: "Archive", exact: true }).click();
  await expect(bookmark).toHaveCount(0);
  await page.getByRole("link", { name: "Archive", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard\/archive$/);
  await expect(bookmark).toHaveText(/A bookmark for the weekend/);
  await page.reload();
  await bookmark.hover();
  await expect(
    bookmark.getByRole("button", { name: "Un-archive", exact: true }),
  ).toBeVisible();
});

it("deletes a bookmark after confirmation", async ({ page }) => {
  const bookmark = await seedBookmark(page);
  await bookmark.locator('button[aria-haspopup="menu"]').click();
  await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Delete Bookmark?" })
    .getByRole("button", { name: "Delete", exact: true })
    .click();
  await expect(bookmark).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByPlaceholder("Paste a link, write a note or drop an image…"),
  ).toBeVisible();
  await expect(bookmark).toHaveCount(0);
});
