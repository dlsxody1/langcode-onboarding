"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Chapter } from "@/lib/chapters";

export function Toc({ chapters }: { chapters: Chapter[] }) {
  const path = usePathname();
  return (
    <nav className="toc" aria-label="목차">
      <div className="toc__label">목 차</div>
      {chapters.map((c) => (
        <div className="toc__group" key={c.id} data-current={path.includes(`/${c.id}/`) || undefined}>
          <div className="toc__chapter">
            <span className="toc__no">{c.no}</span>
            {c.title}
          </div>
          <ul className="toc__list">
            {c.docs.map((d) => {
              const href = `/docs/${c.id}/${d.slug}`;
              return (
                <li key={d.slug}>
                  <Link href={href} aria-current={path === href ? "page" : undefined}>
                    {d.title}
                  </Link>
                </li>
              );
            })}
          </ul>
          <div className="toc__quiz">
            <Link href={`/quiz/${c.id}`}>채점하기 →</Link>
          </div>
        </div>
      ))}
      <Link className="toc__all" href="/">
        전체 목차 →
      </Link>
    </nav>
  );
}
