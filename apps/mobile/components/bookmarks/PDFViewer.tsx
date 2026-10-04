import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import ReactNativeBlobUtil from "react-native-blob-util";
import Pdf from "react-native-pdf";
import { Text } from "@/components/ui/Text";
import { useQuery } from "@tanstack/react-query";
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

interface PDFViewerProps {
  source: string;
  headers?: Record<string, string>;
  /** 1-based page to jump to; changing it scrolls the viewer */
  page?: number;
  onPageChanged?: (page: number, numberOfPages: number) => void;
}

export function PDFViewer({
  source,
  headers,
  page,
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

  const {
    data: localPath,
    isLoading,
    error: downloadError,
  } = useQuery({
    queryKey: ["pdf", source],
    queryFn: async () => {
      // One stable file per document in the OS-purgeable cache dir. Reopening
      // a PDF reuses it instead of re-downloading (and React Query's cached
      // path always points at a file that exists).
      const path = `${PDF_CACHE_DIR}/${hashString(source)}.pdf`;
      const fs = ReactNativeBlobUtil.fs;
      if (await fs.exists(path)) {
        const stat = await fs.stat(path);
        if (Number(stat.size) > 0) {
          return path;
        }
        await fs.unlink(path).catch(() => ({}));
      }
      if (!(await fs.exists(PDF_CACHE_DIR))) {
        await fs.mkdir(PDF_CACHE_DIR).catch(() => ({}));
      }

      const response = await ReactNativeBlobUtil.config({
        fileCache: true,
        path,
      }).fetch("GET", source, headers ?? {});
      const status = response.info().status;
      if (status >= 400) {
        // Don't leave an error page behind masquerading as a PDF
        await fs.unlink(path).catch(() => ({}));
        throw new Error(`Failed to download PDF: ${status}`);
      }
      return response.path();
    },
    staleTime: Infinity,
    enabled: !!source,
  });

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
        style={StyleSheet.absoluteFill}
        source={{ uri: `file://${localPath}`, cache: true }}
        spacing={16}
        maxScale={3}
        page={page}
        onPageChanged={onPageChanged}
        onLoadComplete={() => ({})}
        onError={() => setPdfRenderError("Failed to render PDF")}
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
