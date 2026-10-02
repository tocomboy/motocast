"use client";

import { ReleaseHistory, type ReleaseHistoryProps } from "@motocast/shared-ui";
import { useServerInsertedHTML } from "next/navigation";
import { useRef, type ReactElement } from "react";
import { AppRegistry } from "react-native";

const appKey = "MOTOCASTReleaseHistory";
AppRegistry.registerComponent(appKey, () => ReleaseHistory);

// getApplication/getStyleElement are documented RNWeb-only server APIs.
const webRegistry = AppRegistry as typeof AppRegistry & {
  getApplication: (key: string, parameters: { initialProps: ReleaseHistoryProps }) => {
    element: ReactElement;
    getStyleElement: () => ReactElement;
  };
};

export function ReleaseHistoryWeb(props: Omit<ReleaseHistoryProps, "fontFamily">) {
  const inserted = useRef(false);
  const application = webRegistry.getApplication(appKey, {
    initialProps: { ...props, fontFamily: '"Noto Sans KR Variable", sans-serif' },
  });

  useServerInsertedHTML(() => {
    if (inserted.current) return null;
    inserted.current = true;
    return application.getStyleElement();
  });

  return application.element;
}
