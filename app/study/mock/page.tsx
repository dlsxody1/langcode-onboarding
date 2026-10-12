import Link from "next/link";
import type { Metadata } from "next";
import { Masthead } from "@/app/components/Masthead";
import { DOTNET_QUESTIONS } from "@/data/dotnet-quiz";
import { MockExam } from "./MockExam";

export const metadata: Metadata = { title: "전 범위 모의고사" };

export default function MockPage() {
  return (
    <>
      <Masthead />
      <main className="quiz">
        <header className="quiz__head">
          <span className="qcount">
            <Link href="/study">공부 계획</Link> · 금요일 테스트
          </span>
          <h1>전 범위 모의고사</h1>
          <p>{DOTNET_QUESTIONS.length}문항. C# 문법 · LINQ · Web API · SignalR 을 섞어서 낸다. 새로고침하면 순서가 바뀐다.</p>
        </header>
        <MockExam questions={DOTNET_QUESTIONS} />
      </main>
    </>
  );
}
