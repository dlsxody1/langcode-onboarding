"use client";

import { useEffect, useState } from "react";
import type { Question } from "@/data/questions";
import { QuizRunner } from "@/app/components/QuizRunner";

function shuffle<T>(list: T[]) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** 서버 렌더와 어긋나지 않게 섞기는 마운트 후에 한다 */
export function MockExam({ questions }: { questions: Question[] }) {
  const [list, setList] = useState<Question[] | null>(null);
  useEffect(() => setList(shuffle(questions)), [questions]);

  if (!list) return <p className="note">문제를 섞는 중…</p>;
  return <QuizRunner questions={list} topicTitle="전 범위 모의고사" nextTopic={null} />;
}
