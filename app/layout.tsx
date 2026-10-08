import type { Metadata, Viewport } from "next";
import "@fontsource-variable/noto-sans-kr";
import "@fontsource/barlow-semi-condensed/600.css";
import "@fontsource/barlow-semi-condensed/700.css";
import { designTokens } from "@/packages/shared-ui/src/design-tokens";

import { ReleaseFooter } from "@/components/release-footer";
import { ServiceWorkerRegistration } from "@/components/service-worker-registration";
import { InviteTokenSweeper } from "@/components/invite-token-sweeper";

import "./globals.css";

export const metadata: Metadata = {
  title: "MOTOCAST — 라이딩 날씨 플래너",
  description: "오토바이 경로의 예상 통과 시각과 구간별 날씨를 함께 계획합니다.",
  applicationName: "MOTOCAST",
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
  themeColor: designTokens["surface-ground"],
  colorScheme: "light",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body>
        {children}
        <ReleaseFooter />
        <ServiceWorkerRegistration />
        <InviteTokenSweeper />
      </body>
    </html>
  );
}
