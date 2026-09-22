import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Masthead } from "@/app/components/Masthead";
import { QuizRunner } from "@/app/components/QuizRunner";
import { getChapter } from "@/lib/chapters";
import { TOPICS, getTopic, questionsForTopic } from "@/data/questions";

type Params = { topic: string };

export function generateStaticParams() {
  return TOPICS.map((t) => ({ topic: t.id }));
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { topic } = await params;
  const t = getTopic(topic);
  return { title: t ? `${t.title} 문제` : "문제" };
}

export default async function TopicQuizPage({ params }: { params: Promise<Params> }) {
  const { topic } = await params;
  const t = getTopic(topic);
  if (!t) notFound();

  const questions = questionsForTopic(topic);
  const chapter = getChapter(t.chapter);
  const idx = TOPICS.findIndex((x) => x.id === topic);
  const next = TOPICS[idx + 1];

  return (
    <>
      <Masthead />
      <main className="quiz">
        <header className="quiz__head">
          <span className="qcount">
            <Link href="/quiz">문제</Link> · {chapter?.no} {chapter?.title}
          </span>
          <h1>{t.title}</h1>
          <p>
            {questions.length}문항 · {t.blurb}
          </p>
        </header>

        <QuizRunner
          questions={questions}
          topicTitle={t.title}
          nextTopic={next ? { id: next.id, title: next.title } : null}
        />
      </main>
    </>
  );
}
