import type { Metadata, Viewport } from "next";
import "./globals.css";
import { PwaRegister } from "./components/PwaRegister";
import { CHAPTERS } from "@/lib/chapters";
import { TOPICS } from "@/data/questions";

export const metadata: Metadata = {
  title: { default: "랭코드 온보딩", template: "%s · 랭코드 온보딩" },
  description: "입사 전 9일. 백엔드 · C# · RAG.",
  robots: { index: false, follow: false },
  applicationName: "랭코드 온보딩",
  icons: { icon: "/icons/icon-192.png", apple: "/icons/apple-touch-icon.png" },
  appleWebApp: { capable: true, title: "랭코드", statusBarStyle: "default" },
};

// viewportFit: cover — 노치가 있는 폰에서 safe-area 여백을 CSS 로 직접 챙긴다
export const viewport: Viewport = {
  themeColor: "#f7f3ec",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

/** 오프라인용으로 미리 받아 둘 페이지. 로그인이 필요한 /lab 은 뺀다 */
const OFFLINE_URLS = [
  "/",
  "/study",
  "/study/mock",
  "/docs",
  "/quiz",
  "/review",
  "/glossary",
  ...CHAPTERS.flatMap((c) => c.docs.map((d) => `/docs/${c.id}/${d.slug}`)),
  ...TOPICS.map((t) => `/quiz/${t.id}`),
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <head>
        {/* 배포 보호(Vercel 로그인) 뒤에서도 매니페스트를 받도록 쿠키를 같이 보낸다 */}
        <link rel="manifest" href="/manifest.webmanifest" crossOrigin="use-credentials" />
      </head>
      <body>
        <div id="shell">{children}</div>
        <PwaRegister urls={OFFLINE_URLS} />
      </body>
    </html>
  );
}
