import { StyleSheet, Text, View } from "react-native";

import { designTokens } from "./design-tokens";
import { ReleaseDate } from "./release-date";

export type ReleaseNote = {
  version: string;
  date: string;
  title: string;
  summary: string;
  bullets: readonly string[];
};

export type ReleaseHistoryProps = {
  releases: readonly ReleaseNote[];
  currentVersion: string;
  fontFamily?: string;
  numberFontFamily?: string;
};

/** Content only: the platform host owns navigation and scrolling. */
export function ReleaseHistory({ releases, currentVersion, fontFamily, numberFontFamily }: ReleaseHistoryProps) {
  const font = fontFamily ? { fontFamily } : undefined;
  const numberFont = numberFontFamily ? { fontFamily: numberFontFamily } : font;

  return (
    <View style={styles.history}>
      {releases.map((release) => (
        <View
          key={release.version}
          role="article"
          style={[styles.card, release.version === currentVersion && styles.currentCard]}
        >
          <View style={styles.meta}>
            <Text style={[styles.version, numberFont]}>v{release.version}</Text>
            <ReleaseDate date={release.date} style={[styles.date, numberFont]} />
            {release.version === currentVersion ? (
              <Text style={[styles.currentBadge, font]}>현재 버전</Text>
            ) : null}
          </View>
          <Text role="heading" aria-level={2} style={[styles.title, font]}>{release.title}</Text>
          <Text style={[styles.summary, font]}>{release.summary}</Text>
          <View role="list" style={styles.bullets}>
            {release.bullets.map((bullet, index) => (
              <View key={`${index}-${bullet}`} role="listitem" style={styles.bullet}>
                <View aria-hidden style={styles.bulletMark} />
                <Text style={[styles.bulletText, font]}>{bullet}</Text>
              </View>
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  history: { gap: 16, minWidth: 0 },
  card: {
    backgroundColor: designTokens["surface-card"],
    borderColor: designTokens["border-default"],
    borderRadius: 20,
    borderWidth: 1,
    gap: 8,
    minWidth: 0,
    padding: 24,
  },
  currentCard: { borderColor: designTokens["signal-tint-border"] },
  meta: { alignItems: "center", flexDirection: "row", flexWrap: "wrap", gap: 8 },
  version: { color: designTokens["signal-text"], fontSize: 13, fontWeight: "700", lineHeight: 20 },
  date: { color: designTokens["text-secondary"], fontSize: 13, fontWeight: "700", lineHeight: 20 },
  currentBadge: {
    backgroundColor: designTokens["signal-tint"],
    borderRadius: 20,
    color: designTokens["signal-text"],
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 20,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  title: { color: designTokens["text-primary"], fontSize: 20, fontWeight: "700", lineHeight: 30 },
  summary: { color: designTokens["text-secondary"], fontSize: 16, lineHeight: 24 },
  bullets: { gap: 8, marginTop: 8 },
  bullet: { alignItems: "flex-start", flexDirection: "row", gap: 8, minWidth: 0 },
  bulletMark: {
    backgroundColor: designTokens["signal-text"],
    borderRadius: 3,
    height: 6,
    marginTop: 9,
    width: 6,
  },
  bulletText: { color: designTokens["text-primary"], flex: 1, fontSize: 16, lineHeight: 24 },
});
