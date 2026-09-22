import type { Metadata } from "next";
import { Masthead } from "@/app/components/Masthead";
import { ReviewList } from "@/app/components/ReviewList";

export const metadata: Metadata = { title: "오답" };

export default function ReviewPage() {
  return (
    <>
      <Masthead />
      <main className="quiz">
        <header className="quiz__head">
          <span className="qcount">전 체</span>
          <h1>오답</h1>
          <p>틀린 문항만 모았다. 정답을 맞히면 목록에서 빠진다.</p>
        </header>
        <ReviewList />
      </main>
    </>
  );
}
