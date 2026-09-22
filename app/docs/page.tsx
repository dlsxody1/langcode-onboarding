import Link from "next/link";
import type { Metadata } from "next";
import { Masthead } from "@/app/components/Masthead";
import { CHAPTERS } from "@/lib/chapters";
import { topicsForChapter } from "@/data/questions";

export const metadata: Metadata = { title: "공부" };

export default function DocsIndex() {
  return (
    <>
      <Masthead />
      <main className="quiz">
        <header className="quiz__head">
          <span className="qcount">공 부</span>
          <h1>차례</h1>
          <p>
            순서대로 읽는다. 01 이 02·03 의 전제다. 문제는 <Link href="/quiz">문제 탭</Link> 에 주제별로 따로 있다.
          </p>
        </header>

        <div className="topics">
          {CHAPTERS.map((c) => (
            <section className="topics__chapter" key={c.id}>
              <h2 className="topics__head">
                <span className="topics__no">{c.no}</span>
                {c.title}
              </h2>
              <p className="topics__blurb">{c.blurb}</p>
              <ul className="topics__list">
                {c.docs.map((d) => (
                  <li key={d.slug}>
                    <Link className="topic-row" href={`/docs/${c.id}/${d.slug}`}>
                      <span className="topic-row__main">
                        <span className="topic-row__title">{d.title}</span>
                        {d.kicker && <span className="topic-row__blurb">{d.kicker}</span>}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
              {topicsForChapter(c.id).length > 0 && (
                <p className="topics__foot">
                  문제 {topicsForChapter(c.id).length}주제 ·{" "}
                  {topicsForChapter(c.id).map((t, n) => (
                    <span key={t.id}>
                      {n > 0 && " · "}
                      <Link href={`/quiz/${t.id}`}>{t.title}</Link>
                    </span>
                  ))}
                </p>
              )}
            </section>
          ))}
        </div>
      </main>
    </>
  );
}
