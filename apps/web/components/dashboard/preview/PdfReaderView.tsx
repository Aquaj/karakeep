"use client";

import type { PDFDocumentProxy } from "pdfjs-dist";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { FullPageSpinner } from "@/components/ui/full-page-spinner";
import { useTranslation } from "@/lib/i18n/client";
import { ExternalLink, FileX, ZoomIn, ZoomOut } from "lucide-react";
import { Document, Page, pdfjs } from "react-pdf";

import type { ReadingPositionStrategy } from "@karakeep/shared-react/components/ScrollProgressTracker";
import type { ReadingPosition } from "@karakeep/shared/utils/reading-progress-dom";
import ScrollProgressTracker from "@karakeep/shared-react/components/ScrollProgressTracker";
import { useReadingProgress } from "@karakeep/shared-react/hooks/reading-progress";
import { getAssetUrl } from "@karakeep/shared/utils/assetUtils";
import { findScrollableParent } from "@karakeep/shared/utils/reading-progress-dom";

import ReadingProgressBanner from "./ReadingProgressBanner";

import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

/** Widest a page gets at 100% zoom, so large screens don't blow pages up */
const MAX_PAGE_WIDTH = 900;
const PAGE_GAP = 16;
const CONTAINER_PADDING = 16;
const ZOOM_STEP = 0.25;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3;
/** How far outside the viewport pages are rendered ahead of time */
const RENDER_AHEAD_MARGIN = "150% 0px";
/** Threshold in pixels for detecting "scrolled to bottom" */
const SCROLL_BOTTOM_THRESHOLD = 5;

const PAGE_ATTR = "data-pdf-page";

interface PageSize {
  width: number;
  height: number;
}

/**
 * Reading position for PDFs: the offset is the 1-based number of the page at
 * the top of the viewport, the percentage is how far down the document the
 * viewport is. There is no text anchor.
 */
const PDF_POSITION_STRATEGY: ReadingPositionStrategy = {
  getPosition: (container): ReadingPosition | null => {
    const pages = Array.from(
      container.querySelectorAll<HTMLElement>(`[${PAGE_ATTR}]`),
    );
    if (pages.length === 0) return null;

    const scrollParent = findScrollableParent(container);
    const isWindowScroll = scrollParent === document.documentElement;
    const viewportTop = isWindowScroll
      ? 0
      : scrollParent.getBoundingClientRect().top;
    const scrollTop = isWindowScroll ? window.scrollY : scrollParent.scrollTop;
    const scrollHeight = isWindowScroll
      ? document.body.scrollHeight
      : scrollParent.scrollHeight;
    const clientHeight = isWindowScroll
      ? window.innerHeight
      : scrollParent.clientHeight;

    let currentPage = pages[0];
    for (const page of pages) {
      if (page.getBoundingClientRect().bottom > viewportTop) {
        currentPage = page;
        break;
      }
    }
    const offset = Number(currentPage.getAttribute(PAGE_ATTR));
    if (!Number.isFinite(offset) || offset <= 0) return null;

    const isAtBottom =
      scrollTop + clientHeight >= scrollHeight - SCROLL_BOTTOM_THRESHOLD;
    const maxScroll = Math.max(1, scrollHeight - clientHeight);
    const percent = isAtBottom
      ? 100
      : Math.min(100, Math.max(0, Math.round((scrollTop / maxScroll) * 100)));

    return { offset, anchor: "", percent };
  },
  scrollToPosition: (container, offset) => {
    const page = container.querySelector<HTMLElement>(
      `[${PAGE_ATTR}="${offset}"]`,
    );
    page?.scrollIntoView({ behavior: "smooth", block: "start" });
  },
};

async function loadPageSizes(pdf: PDFDocumentProxy): Promise<PageSize[]> {
  const sizes: PageSize[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 1 });
    sizes.push({ width: viewport.width, height: viewport.height });
  }
  return sizes;
}

function PdfPagePlaceholder({
  pageNumber,
  width,
  height,
  render,
  onMount,
}: {
  pageNumber: number;
  width: number;
  height: number;
  render: boolean;
  onMount: (pageNumber: number, el: HTMLDivElement | null) => void;
}) {
  return (
    <div
      ref={(el) => onMount(pageNumber, el)}
      data-pdf-page={pageNumber}
      className="bg-white shadow-md"
      style={{ width, height }}
    >
      {render && (
        <Page
          pageNumber={pageNumber}
          width={width}
          renderAnnotationLayer
          renderTextLayer
          loading={null}
        />
      )}
    </div>
  );
}

export default function PdfReaderView({
  bookmarkId,
  assetId,
  toolbarLeading,
}: {
  bookmarkId: string;
  assetId: string;
  /** Rendered at the start of the toolbar row (e.g. the section selector) */
  toolbarLeading?: React.ReactNode;
}) {
  const { t } = useTranslation();
  const assetUrl = useMemo(() => getAssetUrl(assetId), [assetId]);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState<number | null>(null);
  const [pageSizes, setPageSizes] = useState<PageSize[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [currentPage, setCurrentPage] = useState(1);
  const [visiblePages, setVisiblePages] = useState<Set<number>>(
    () => new Set([1]),
  );

  // Reset per-document state when the asset changes
  useEffect(() => {
    setPageSizes(null);
    setLoadError(false);
    setCurrentPage(1);
    setVisiblePages(new Set([1]));
  }, [assetUrl]);

  // Track the available width so pages fit the pane
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const update = () => setContainerWidth(el.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const {
    showBanner,
    bannerPercent,
    onContinue,
    onDismiss,
    restorePosition,
    readingProgressOffset,
    readingProgressAnchor,
    onSavePosition,
    onScrollPositionChange,
  } = useReadingProgress({ bookmarkId });

  const handleScrollPositionChange = useCallback(
    (position: ReadingPosition) => {
      setCurrentPage(position.offset);
      onScrollPositionChange(position);
    },
    [onScrollPositionChange],
  );

  const onDocumentLoadSuccess = useCallback((pdf: PDFDocumentProxy) => {
    setLoadError(false);
    void loadPageSizes(pdf).then(setPageSizes);
  }, []);

  // Only render pages near the viewport; placeholders keep the scroll height stable.
  const pageElements = useRef(new Map<number, HTMLDivElement>());
  const onPageMount = useCallback(
    (pageNumber: number, el: HTMLDivElement | null) => {
      if (el) {
        pageElements.current.set(pageNumber, el);
      } else {
        pageElements.current.delete(pageNumber);
      }
    },
    [],
  );
  useEffect(() => {
    if (!pageSizes) return;
    const container = scrollContainerRef.current;
    if (!container) return;
    const observer = new IntersectionObserver(
      (entries) => {
        setVisiblePages((prev) => {
          const next = new Set(prev);
          for (const entry of entries) {
            const pageNumber = Number(
              entry.target.getAttribute(PAGE_ATTR) ?? "0",
            );
            if (entry.isIntersecting) {
              next.add(pageNumber);
            } else {
              next.delete(pageNumber);
            }
          }
          return next;
        });
      },
      { root: container, rootMargin: RENDER_AHEAD_MARGIN },
    );
    for (const el of pageElements.current.values()) {
      observer.observe(el);
    }
    return () => observer.disconnect();
  }, [pageSizes]);

  const pageWidth = useMemo(() => {
    if (containerWidth === null) return null;
    const fitWidth = Math.max(
      100,
      Math.min(containerWidth - 2 * CONTAINER_PADDING, MAX_PAGE_WIDTH),
    );
    return Math.round(fitWidth * zoom);
  }, [containerWidth, zoom]);

  const numPages = pageSizes?.length ?? 0;
  const ready = pageSizes !== null && pageWidth !== null;

  let body: React.ReactNode;
  if (loadError) {
    body = (
      <div className="flex h-full w-full items-center justify-center p-4">
        <div className="max-w-sm space-y-4 text-center">
          <div className="flex justify-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
              <FileX className="h-8 w-8 text-muted-foreground" />
            </div>
          </div>
          <p className="text-sm leading-relaxed text-muted-foreground">
            {t("preview.pdf.load_error")}
          </p>
        </div>
      </div>
    );
  } else {
    body = (
      <ScrollProgressTracker
        strategy={PDF_POSITION_STRATEGY}
        onSavePosition={onSavePosition}
        onScrollPositionChange={handleScrollPositionChange}
        restorePosition={restorePosition}
        readingProgressOffset={readingProgressOffset}
        readingProgressAnchor={readingProgressAnchor}
        showProgressBar
      >
        {showBanner && ready && (
          <ReadingProgressBanner
            percent={bannerPercent}
            onContinue={onContinue}
            onDismiss={onDismiss}
          />
        )}
        <Document
          file={assetUrl}
          onLoadSuccess={onDocumentLoadSuccess}
          onLoadError={() => setLoadError(true)}
          loading={<FullPageSpinner />}
          error={null}
          externalLinkTarget="_blank"
        >
          {pageSizes !== null && pageWidth !== null && (
            <div
              className="flex flex-col items-center"
              style={{ gap: PAGE_GAP, padding: CONTAINER_PADDING }}
            >
              {pageSizes.map((size, idx) => {
                const pageNumber = idx + 1;
                return (
                  <PdfPagePlaceholder
                    key={pageNumber}
                    pageNumber={pageNumber}
                    width={pageWidth}
                    height={Math.round((pageWidth * size.height) / size.width)}
                    render={visiblePages.has(pageNumber)}
                    onMount={onPageMount}
                  />
                );
              })}
            </div>
          )}
        </Document>
      </ScrollProgressTracker>
    );
  }

  return (
    <div className="flex h-full w-full min-w-0 flex-col gap-2">
      <div className="flex w-full flex-wrap items-center justify-center gap-2">
        {toolbarLeading}
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={() =>
              setZoom((z) => Math.max(MIN_ZOOM, +(z - ZOOM_STEP).toFixed(2)))
            }
            disabled={zoom <= MIN_ZOOM}
            aria-label={t("preview.pdf.zoom_out")}
            title={t("preview.pdf.zoom_out")}
          >
            <ZoomOut className="size-4" />
          </Button>
          <span className="w-12 text-center text-xs tabular-nums text-muted-foreground">
            {Math.round(zoom * 100)}%
          </span>
          <Button
            variant="ghost"
            size="icon"
            onClick={() =>
              setZoom((z) => Math.min(MAX_ZOOM, +(z + ZOOM_STEP).toFixed(2)))
            }
            disabled={zoom >= MAX_ZOOM}
            aria-label={t("preview.pdf.zoom_in")}
            title={t("preview.pdf.zoom_in")}
          >
            <ZoomIn className="size-4" />
          </Button>
        </div>
        {numPages > 0 && (
          <span className="text-xs tabular-nums text-muted-foreground">
            {t("preview.pdf.page_indicator", {
              page: Math.min(currentPage, numPages),
              total: numPages,
            })}
          </span>
        )}
        <Button variant="ghost" size="sm" asChild>
          <a href={assetUrl} target="_blank" rel="noreferrer">
            <ExternalLink className="mr-1 size-4" />
            {t("preview.pdf.open_in_browser")}
          </a>
        </Button>
      </div>
      <div
        ref={scrollContainerRef}
        className="min-h-0 w-full flex-1 overflow-auto rounded-md bg-muted/40"
      >
        {body}
      </div>
    </div>
  );
}
