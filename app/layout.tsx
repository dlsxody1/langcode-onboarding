import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "랭코드 온보딩", template: "%s · 랭코드 온보딩" },
  description: "입사 전 9일. 백엔드 · C# · RAG.",
  robots: { index: false, follow: false },
};

// viewportFit: cover — 노치가 있는 폰에서 safe-area 여백을 CSS 로 직접 챙긴다
export const viewport: Viewport = {
  themeColor: "#f7f3ec",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>
        <div id="shell">{children}</div>
      </body>
    </html>
  );
}
