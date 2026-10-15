import React, { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import ReactNativeBlobUtil from "react-native-blob-util";
import type { PdfRef } from "react-native-pdf";
import Pdf from "react-native-pdf";
import { Text } from "@/components/ui/Text";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useColorScheme } from "nativewind";

/** Small non-cryptographic hash, enough to derive a stable cache file name */
function hashString(value: string): string {
  let hash = 5381;
  for (let i = 0; i < value.length; i++) {
    hash = ((hash << 5) + hash + value.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(16);
}

const PDF_CACHE_DIR = `${ReactNativeBlobUtil.fs.dirs.CacheDir}/pdfs`;

/**
 * Downloads in flight, by destination. A query re-run (refocus, cancelled
 * refetch) joins the running download instead of starting a second one over
 * the same files.
 */
const pendingDownloads = new Map<string, Promise<string>>();

async function downloadPdf(
  source: string,
  headers: Record<string, string> | undefined,
  path: string,
): Promise<string> {
  const fs = ReactNativeBlobUtil.fs;
  if (!(await fs.exists(PDF_CACHE_DIR))) {
    await fs.mkdir(PDF_CACHE_DIR).catch(() => ({}));
  }
  // Download next to the final path and move it into place once complete, so
  // a file at `path` is always a whole document even if the app dies mid-way.
  const partPath = `${path}.part`;
  await fs.unlink(partPath).catch(() => ({}));
  const response = await ReactNativeBlobUtil.config({
    fileCache: true,
    path: partPath,
  }).fetch("GET", source, headers ?? {});
  const status = response.info().status;
  if (status >= 400) {
    // Don't leave an error page behind masquerading as a PDF
    await fs.unlink(partPath).catch(() => ({}));
    throw new Error(`Failed to download PDF: ${status}`);
  }
  await fs.unlink(path).catch(() => ({}));
  await fs.mv(partPath, path);
  return path;
}

interface PDFViewerProps {
  source: string;
  headers?: Record<string, string>;
  /**
   * 1-based page to jump to; changing it scrolls the viewer. Applied once the
   * document has loaded.
   */
  page?: number;
  onLoadComplete?: (numberOfPages: number) => void;
  onPageChanged?: (page: number, numberOfPages: number) => void;
}

export function PDFViewer({
  source,
  headers,
  page,
  onLoadComplete,
  onPageChanged,
}: PDFViewerProps) {
  const [pdfRenderError, setPdfRenderError] = useState<string | null>(null);
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === "dark";
  const colors = {
    background: isDark ? "#000" : "#fff",
    foreground: isDark ? "#fff" : "#000",
    mutedForeground: isDark ? "#888" : "#666",
  };

  const queryClient = useQueryClient();
  // "v2": earlier builds persisted paths to temp files that no longer exist
  // (the query cache survives app updates for a week).
  const pdfQueryKey = ["pdf", "v2", source];
  const {
    data: localPath,
    isLoading,
    error: downloadError,
  } = useQuery({
    queryKey: pdfQueryKey,
    queryFn: async () => {
      // One stable file per document in the OS-purgeable cache dir. Reopening
      // a PDF reuses it instead of re-downloading. The query is always stale
      // so a persisted path gets re-validated against the filesystem.
      const path = `${PDF_CACHE_DIR}/${hashString(source)}.pdf`;
      const fs = ReactNativeBlobUtil.fs;
      if (await fs.exists(path)) {
        const stat = await fs.stat(path);
        if (Number(stat.size) > 0) {
          return path;
        }
        await fs.unlink(path).catch(() => ({}));
      }

      let download = pendingDownloads.get(path);
      if (!download) {
        download = downloadPdf(source, headers, path).finally(() =>
          pendingDownloads.delete(path),
        );
        pendingDownloads.set(path, download);
      }
      return download;
    },
    staleTime: 0,
    enabled: !!source,
  });

  // Jumps go through the imperative command, never the `page` prop: on Android
  // every prop update reloads the whole document, and tearing it down while
  // pages are still rendering crashes natively.
  const pdfRef = useRef<PdfRef>(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (loaded && page !== undefined) {
      pdfRef.current?.setPage(page);
    }
  }, [loaded, page]);

  // A cached file that fails to render (truncated by an older build, say) is
  // discarded and downloaded once more before giving up.
  const renderRetriedRef = useRef(false);
  useEffect(() => {
    renderRetriedRef.current = false;
  }, [source]);

  const handleRenderError = () => {
    setLoaded(false);
    if (renderRetriedRef.current || !localPath) {
      setPdfRenderError("Failed to render PDF");
      return;
    }
    renderRetriedRef.current = true;
    const badPath = localPath;
    void ReactNativeBlobUtil.fs
      .unlink(badPath)
      .catch(() => ({}))
      .then(() => queryClient.resetQueries({ queryKey: pdfQueryKey }));
  };

  // Merge download and render errors
  const error = useMemo(() => {
    if (downloadError) {
      let errorMessage = "Failed to download PDF";
      if (downloadError.message.includes("Network request failed")) {
        errorMessage = "Network error. Please check your connection.";
      } else if (
        downloadError.message.includes("401") ||
        downloadError.message.includes("403")
      ) {
        errorMessage = "Authentication failed. Please sign in again.";
      } else if (downloadError.message.includes("404")) {
        errorMessage = "PDF not found.";
      }
      return errorMessage;
    }
    if (pdfRenderError) {
      return pdfRenderError;
    }
    return null;
  }, [downloadError, pdfRenderError]);

  // A render error belongs to the file it happened on
  useEffect(() => {
    setPdfRenderError(null);
    setLoaded(false);
  }, [localPath]);

  if (error) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <Text style={[styles.errorText, { color: colors.foreground }]}>
          {error}
        </Text>
      </View>
    );
  }

  if (isLoading || !localPath) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.foreground} />
          <Text style={[styles.loadingText, { color: colors.mutedForeground }]}>
            Downloading PDF...
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Pdf
        ref={pdfRef}
        style={StyleSheet.absoluteFill}
        source={{ uri: `file://${localPath}` }}
        spacing={16}
        maxScale={3}
        onPageChanged={onPageChanged}
        onLoadComplete={(numberOfPages) => {
          setLoaded(true);
          onLoadComplete?.(numberOfPages);
        }}
        onError={handleRenderError}
        trustAllCerts={false}
        renderActivityIndicator={() => (
          <ActivityIndicator size="large" color={colors.foreground} />
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingContainer: {
    ...StyleSheet.absoluteFill,
    justifyContent: "center",
    alignItems: "center",
    zIndex: 1,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
  },
  errorText: {
    fontSize: 16,
    textAlign: "center",
    padding: 20,
  },
});
