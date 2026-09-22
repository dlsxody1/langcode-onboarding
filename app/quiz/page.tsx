import Link from "next/link";
import type { Metadata } from "next";
import { Masthead } from "@/app/components/Masthead";
import { TopicList } from "@/app/components/TopicList";
import { CHAPTERS } from "@/lib/chapters";
import { TOPICS, QUESTIONS } from "@/data/questions";

export const metadata: Metadata = { title: "문제" };

export default function QuizIndex() {
  const chapters = CHAPTERS.map((c) => ({
    id: c.id,
    no: c.no,
    title: c.title,
    firstDoc: c.docs[0].slug,
    topics: TOPICS.filter((t) => t.chapter === c.id).map((t) => ({
      ...t,
      count: QUESTIONS.filter((q) => q.topic === t.id).length,
    })),
  }));

  return (
    <>
      <Masthead />
      <main className="quiz">
        <header className="quiz__head">
          <span className="qcount">문 제</span>
          <h1>주제 고르기</h1>
          <p>
            {TOPICS.length}개 주제 · {QUESTIONS.length}문항. 한 주제는 3~6문항이라 5분이면 끝난다.
          </p>
        </header>
        <TopicList chapters={chapters} />
      </main>
    </>
  );
}
