import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "랭코드 온보딩", template: "%s · 랭코드 온보딩" },
  description: "입사 전 9일. 백엔드 · C# · RAG.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { themeColor: "#f7f3ec" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>
        <div id="shell">{children}</div>
      </body>
    </html>
  );
}
