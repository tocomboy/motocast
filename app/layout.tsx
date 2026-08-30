import type { Metadata, Viewport } from "next";

import { ServiceWorkerRegistration } from "@/components/service-worker-registration";

import "./globals.css";

export const metadata: Metadata = {
  title: "MOTOCAST — 라이딩 날씨 플래너",
  description: "오토바이 경로의 예상 통과 시각과 구간별 날씨를 함께 계획합니다.",
  applicationName: "MOTOCAST",
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
  themeColor: "#18221d",
  colorScheme: "light",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body>
        {children}
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
