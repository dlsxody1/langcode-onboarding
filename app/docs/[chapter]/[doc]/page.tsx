import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Masthead } from "@/app/components/Masthead";
import { Toc } from "@/app/components/Toc";
import { MarkRead } from "@/app/components/MarkRead";
import { CHAPTERS, getDoc, getNeighbours, renderDoc } from "@/lib/content";
import { topicsForChapter } from "@/data/questions";

type Params = { chapter: string; doc: string };

export function generateStaticParams() {
  return CHAPTERS.flatMap((c) => c.docs.map((d) => ({ chapter: c.id, doc: d.slug })));
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { chapter, doc } = await params;
  const found = getDoc(chapter, doc);
  return { title: found ? found.doc.title : "문서" };
}

export default async function DocPage({ params }: { params: Promise<Params> }) {
  const { chapter, doc } = await params;
  const found = getDoc(chapter, doc);
  if (!found) notFound();

  const { html } = renderDoc(found.chapter, found.doc);
  const { prev, next } = getNeighbours(chapter, doc);
  const isLast = found.chapter.docs.at(-1)?.slug === doc;
  const topics = topicsForChapter(chapter);

  return (
    <>
      <Masthead />
      <div className="layout">
        <Toc chapters={CHAPTERS} />
        <main className="sheet">
          <MarkRead chapterId={chapter} docSlug={doc} />

          <header className="doc-head">
            <div className="doc-head__meta">
              <span className="doc-head__no">{found.chapter.no}</span>
              <span>{found.chapter.title}</span>
              {found.doc.kicker && <span>· {found.doc.kicker}</span>}
            </div>
            <h1>{found.doc.title}</h1>
          </header>

          <article className="prose" dangerouslySetInnerHTML={{ __html: html }} />

          <footer className="doc-foot">
            {isLast && topics.length > 0 && (
              <div className="quiz-cta">
                <strong>{found.chapter.no} 챕터를 다 읽었다면</strong>
                <ul>
                  {topics.map((t) => (
                    <li key={t.id}>
                      <Link href={`/quiz/${t.id}`}>{t.title} →</Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <nav className="pager">
              {prev ? (
                <Link href={`/docs/${prev.chapter.id}/${prev.doc.slug}`}>
                  <em>이전</em>
                  <strong>{prev.doc.title}</strong>
                </Link>
              ) : (
                <span />
              )}
              {next && (
                <Link className="next" href={`/docs/${next.chapter.id}/${next.doc.slug}`}>
                  <em>다음</em>
                  <strong>{next.doc.title}</strong>
                </Link>
              )}
            </nav>
          </footer>
        </main>
      </div>
    </>
  );
}
