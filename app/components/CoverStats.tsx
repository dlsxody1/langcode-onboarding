"use client";

import { useEffect, useState } from "react";
import { QUESTIONS } from "@/data/questions";
import { ALL_DOCS } from "@/lib/chapters";
import { load } from "@/lib/progress";

const START = new Date("2026-10-01T00:00:00+09:00");

export function CoverStats() {
  // 서버 렌더와 어긋나지 않게, 진도는 마운트 후에 채운다
  const [solved, setSolved] = useState<number | null>(null);
  const [correct, setCorrect] = useState(0);

  useEffect(() => {
    const s = load();
    const list = Object.values(s.attempts);
    setSolved(list.length);
    setCorrect(list.filter((a) => a.correct).length);
  }, []);

  const days = Math.max(0, Math.ceil((START.getTime() - Date.now()) / 86_400_000));

  return (
    <dl className="fields">
      <div className="field">
        <dt>과목</dt>
        <dd>백엔드 · C# · RAG</dd>
      </div>
      <div className="field">
        <dt>분량</dt>
        <dd>
          {ALL_DOCS.length}편 · {QUESTIONS.length}문항
        </dd>
      </div>
      <div className="field">
        <dt>남은 날</dt>
        <dd className="pen">{days > 0 ? `D-${days}` : "D-day"}</dd>
      </div>
      <div className="field">
        <dt>채점</dt>
        <dd>{solved === null ? "—" : solved === 0 ? "아직" : `${correct} / ${solved}`}</dd>
      </div>
    </dl>
  );
}
