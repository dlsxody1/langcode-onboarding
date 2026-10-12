import type { Metadata } from "next";
import { Masthead } from "@/app/components/Masthead";
import { QUESTIONS } from "@/data/questions";
import { StudyPlan } from "./StudyPlan";
import { PLAN } from "./plan";

export const metadata: Metadata = { title: "공부 계획" };

export default function StudyPage() {
  // 퀴즈 항목이 가리키는 주제의 문항 id 만 클라이언트로 넘긴다
  const topics: Record<string, string[]> = {};
  for (const it of PLAN.flatMap((d) => d.items)) {
    if (it.kind === "quiz" && it.topic) {
      topics[it.topic] = QUESTIONS.filter((q) => q.topic === it.topic).map((q) => q.id);
    }
  }

  return (
    <>
      <Masthead />
      <main className="quiz study">
        <header className="quiz__head">
          <span className="qcount">10/12 – 10/16</span>
          <h1>금요일 테스트 공부 계획</h1>
          <p>Web API · C# 문법 · LINQ 가 중심이고 SignalR 은 개념만 본다. 하루에 한 주제씩, 읽고 바로 풀기.</p>
        </header>

        <StudyPlan topics={topics} />
      </main>
    </>
  );
}
