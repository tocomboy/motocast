import { Text } from "react-native";

import type { ReleaseDateProps } from "./release-date";

// Preserve the web's machine-readable date without changing the native view.
export function ReleaseDate({ date, style }: ReleaseDateProps) {
  return <Text style={style}><time dateTime={date}>{date}</time></Text>;
}
