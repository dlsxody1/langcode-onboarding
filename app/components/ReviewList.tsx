"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { QUESTIONS } from "@/data/questions";
import { CHAPTERS } from "@/lib/chapters";
import { load, reset, type Store } from "@/lib/progress";

const LABELS = ["가", "나", "다", "라", "마"];
const CHAPTER_TITLE = Object.fromEntries(CHAPTERS.map((c) => [c.id, `${c.no} ${c.title}`]));

export function ReviewList() {
  const [store, setStore] = useState<Store | null>(null);
  useEffect(() => setStore(load()), []);

  if (store === null) return <p className="note">불러오는 중…</p>;

  const attempts = Object.values(store.attempts);
  const wrongIds = new Set(attempts.filter((a) => !a.correct).map((a) => a.qid));
  const wrong = QUESTIONS.filter((q) => wrongIds.has(q.id));

  if (attempts.length === 0) {
    return (
      <div className="empty">
        <strong>아직 푼 문항이 없다</strong>
        챕터를 하나 읽고 마지막 문서 아래의 <b>채점하기</b> 로 들어가면 된다.
        <br />
        <Link href="/" style={{ display: "inline-block", marginTop: "1rem" }}>
          표지로 →
        </Link>
      </div>
    );
  }

  if (wrong.length === 0) {
    return (
      <div className="empty">
        <strong>틀린 문항이 없다</strong>
        지금까지 {attempts.length}문항을 풀었고 전부 맞혔다.
      </div>
    );
  }

  // 챕터 순서대로 묶는다
  const grouped = CHAPTERS.map((c) => ({
    chapter: c,
    items: wrong.filter((q) => q.chapter === c.id),
  })).filter((g) => g.items.length > 0);

  return (
    <>
      <p className="note" style={{ marginBottom: "1.6rem" }}>
        {attempts.length}문항 중 <b style={{ color: "var(--pen)" }}>{wrong.length}문항</b> 오답.
      </p>

      {grouped.map(({ chapter, items }) => (
        <section key={chapter.id} style={{ marginBottom: "2.6rem" }}>
          <h2
            style={{
              fontFamily: "var(--serif)",
              fontSize: "var(--step-1)",
              margin: "0 0 0.8rem",
            }}
          >
            {CHAPTER_TITLE[chapter.id]}
          </h2>
          <ul className="wrong-list">
            {items.map((q) => (
              <li key={q.id}>
                <p className="wrong-list__q">{q.q}</p>
                <p className="wrong-list__a">
                  정답 <b>{LABELS[q.answer]}</b> — {q.choices[q.answer]}
                </p>
                <p className="wrong-list__a" style={{ color: "var(--ink-soft)" }}>
                  {q.why}
                </p>
                <p className="wrong-list__src">
                  <Link href={`/docs/${q.chapter}/${q.doc}`}>
                    {q.section ?? "해당 문서"} 로 돌아가기 →
                  </Link>
                  {"  ·  "}
                  <Link href={`/quiz/${q.chapter}`}>이 챕터 다시 풀기 →</Link>
                </p>
              </li>
            ))}
          </ul>
        </section>
      ))}

      <button
        className="btn btn--ghost"
        onClick={() => {
          reset();
          setStore(load());
        }}
      >
        기록 전부 지우기
      </button>
    </>
  );
}
