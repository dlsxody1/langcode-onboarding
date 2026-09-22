"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { questionsForTopic } from "@/data/questions";
import { load } from "@/lib/progress";

type T = { id: string; title: string; blurb: string; count: number };
type C = { id: string; no: string; title: string; firstDoc: string; topics: T[] };

export function TopicList({ chapters }: { chapters: C[] }) {
  const [done, setDone] = useState<Record<string, { ok: number; n: number }> | null>(null);

  useEffect(() => {
    const s = load();
    const map: Record<string, { ok: number; n: number }> = {};
    for (const c of chapters) {
      for (const t of c.topics) {
        const qs = questionsForTopic(t.id);
        const tried = qs.filter((q) => s.attempts[q.id]);
        map[t.id] = { ok: tried.filter((q) => s.attempts[q.id].correct).length, n: tried.length };
      }
    }
    setDone(map);
  }, [chapters]);

  return (
    <div className="topics">
      {chapters.map((c) => (
        <section className="topics__chapter" key={c.id}>
          <h2 className="topics__head">
            <span className="topics__no">{c.no}</span>
            {c.title}
            <Link className="topics__study" href={`/docs/${c.id}/${c.firstDoc}`}>
              공부하러 →
            </Link>
          </h2>
          <ul className="topics__list">
            {c.topics.map((t) => {
              const d = done?.[t.id];
              return (
                <li key={t.id}>
                  <Link className="topic-row" href={`/quiz/${t.id}`}>
                    <span className="topic-row__main">
                      <span className="topic-row__title">{t.title}</span>
                      <span className="topic-row__blurb">{t.blurb}</span>
                    </span>
                    <span className="topic-row__meta">
                      {d && d.n > 0 ? (
                        <b data-all={d.ok === t.count || undefined}>
                          {d.ok}/{t.count}
                        </b>
                      ) : (
                        <span className="topic-row__n">{t.count}문항</span>
                      )}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
