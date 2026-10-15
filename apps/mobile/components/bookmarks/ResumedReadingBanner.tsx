import { useEffect } from "react";
import { TouchableOpacity, View } from "react-native";
import { Text } from "@/components/ui/Text";
import { BookOpen, X } from "lucide-react-native";

/** The offer to start over is only useful right after opening */
const AUTO_HIDE_DELAY_MS = 8000;

interface ResumedReadingBannerProps {
  percent: number | null;
  onRestart: () => void;
  onDismiss: () => void;
}

/** Shown after the reader reopened at the saved position */
export function ResumedReadingBanner({
  percent,
  onRestart,
  onDismiss,
}: ResumedReadingBannerProps) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, AUTO_HIDE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [onDismiss]);

  return (
    <View className="flex-row items-center gap-2 border-b border-border bg-background px-4 py-2">
      <BookOpen size={16} className="text-muted-foreground" />
      <Text className="flex-1 text-sm text-muted-foreground">
        {percent && percent > 0
          ? `Resumed where you left off (${percent}%)`
          : "Resumed where you left off"}
      </Text>
      <TouchableOpacity
        onPress={onRestart}
        className="rounded-md border border-border px-3 py-1"
      >
        <Text className="text-xs font-medium">Start over</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={onDismiss} className="p-2" hitSlop={8}>
        <X size={16} className="text-muted-foreground" />
      </TouchableOpacity>
    </View>
  );
}
