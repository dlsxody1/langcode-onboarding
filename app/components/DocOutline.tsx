"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";

type Heading = { depth: number; text: string; id: string };
type Sibling = { slug: string; title: string };

/**
 * 좁은 화면 전용: 본문 위에 붙는 접이식 목차.
 * 긴 문서에서 한 손으로 절을 건너뛰고, 같은 챕터의 다른 문서로 옮겨 간다.
 * 넓은 화면(≥56rem)에서는 왼쪽 사이드바가 같은 일을 하므로 CSS 로 숨긴다.
 */
export function DocOutline({
  headings,
  chapterId,
  siblings,
  current,
}: {
  headings: Heading[];
  chapterId: string;
  siblings: Sibling[];
  current: string;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  const close = () => ref.current?.removeAttribute("open");

  // 바깥(본문)을 누르면 접는다
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const el = ref.current;
      if (el?.open && !el.contains(e.target as Node)) close();
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, []);

  const h2 = headings.filter((h) => h.depth === 2);
  if (h2.length === 0 && siblings.length === 0) return null;

  return (
    <details className="outline" ref={ref}>
      <summary>
        <span>이 문서 목차</span>
        <em>{h2.length}개 절</em>
      </summary>
      <div className="outline__panel">
        <ol className="outline__sections">
          {h2.map((h) => (
            <li key={h.id}>
              <a href={`#${h.id}`} onClick={close}>
                {h.text}
              </a>
            </li>
          ))}
        </ol>
        <p className="outline__label">같은 챕터의 다른 문서</p>
        <ul className="outline__docs">
          {siblings.map((s) => (
            <li key={s.slug}>
              <Link href={`/docs/${chapterId}/${s.slug}`} aria-current={s.slug === current ? "page" : undefined}>
                {s.title}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </details>
  );
}
