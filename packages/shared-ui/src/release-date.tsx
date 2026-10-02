import { Text, type StyleProp, type TextStyle } from "react-native";

export type ReleaseDateProps = { date: string; style: StyleProp<TextStyle> };

export function ReleaseDate({ date, style }: ReleaseDateProps) {
  return <Text style={style}>{date}</Text>;
}
