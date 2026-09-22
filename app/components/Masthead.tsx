"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function Masthead() {
  const path = usePathname();
  const on = (p: string) => (path.startsWith(p) ? "page" : undefined);
  return (
    <header className="masthead">
      <Link href="/" className="masthead__title">
        랭코드 온보딩
      </Link>
      <span className="masthead__sub">입사 2026-10-01</span>
      <span className="masthead__spacer" />
      <nav>
        <Link href="/docs" aria-current={on("/docs")}>
          공부
        </Link>
        <Link href="/quiz" aria-current={on("/quiz")}>
          문제
        </Link>
        <Link href="/review" aria-current={on("/review")}>
          오답
        </Link>
      </nav>
    </header>
  );
}
