"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import type { Question } from "@/data/questions";
import { recordAttempt } from "@/lib/progress";
import { Grade } from "./Grade";
import { Hint } from "./Hint";

const LABELS = ["가", "나", "다", "라", "마"];

type Log = { picked: number; correct: boolean };

export function QuizRunner({
  questions,
  topicTitle,
  nextTopic,
}: {
  questions: Question[];
  topicTitle: string;
  nextTopic: { id: string; title: string } | null;
}) {
  const [i, setI] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [log, setLog] = useState<Log[]>([]);

  const q = questions[i];
  const done = i >= questions.length;
  const score = useMemo(() => log.filter((l) => l.correct).length, [log]);

  const choose = useCallback(
    (idx: number) => {
      if (picked !== null) return;
      const correct = idx === q.answer;
      setPicked(idx);
      setLog((prev) => [...prev, { picked: idx, correct }]);
      recordAttempt({ qid: q.id, picked: idx, correct, at: Date.now() });
    },
    [picked, q],
  );

  const next = useCallback(() => {
    setPicked(null);
    setI((n) => n + 1);
  }, []);

  const restart = useCallback(() => {
    setI(0);
    setPicked(null);
    setLog([]);
  }, []);

  if (done) {
    const wrong = questions.filter((_, n) => log[n] && !log[n].correct);
    const pct = Math.round((score / questions.length) * 100);
    return (
      <>
        <div className="score">
          <div className="score__label">채 점 결 과</div>
          <span className="score__n">{score}</span>
          <span className="score__d"> / {questions.length}</span>
          <p className="score__note">
            {pct === 100
              ? "전부 맞혔다. 이 주제는 넘어가도 된다."
              : pct >= 60
                ? "대체로 잡혀 있다. 틀린 문항만 해당 절로 돌아가 확인해라."
                : "이 주제는 문서를 한 번 더 읽는 게 낫다. 틀린 문항의 해설부터 보고."}
          </p>
        </div>

        {wrong.length > 0 && (
          <>
            <h2 className="score__sub">틀린 문항 {wrong.length}개</h2>
            <ul className="wrong-list">
              {wrong.map((w) => {
                const n = questions.indexOf(w);
                return (
                  <li key={w.id}>
                    <p className="wrong-list__q">{w.q}</p>
                    <p className="wrong-list__a">
                      고른 답 {LABELS[log[n].picked]} · 정답 <b>{LABELS[w.answer]}</b> — {w.choices[w.answer]}
                    </p>
                    <p className="wrong-list__src">
                      <Link href={`/docs/${w.chapter}/${w.doc}`}>
                        {w.section ? `${w.section} 으로` : "해당 문서로"} 돌아가기 →
                      </Link>
                    </p>
                  </li>
                );
              })}
            </ul>
          </>
        )}

        <div className="quiz__nav">
          <button className="btn" onClick={restart}>
            다시 풀기
          </button>
          {nextTopic && (
            <Link className="btn btn--ghost" href={`/quiz/${nextTopic.id}`}>
              다음 주제 · {nextTopic.title}
            </Link>
          )}
          <Link className="btn btn--ghost" href="/quiz">
            주제 목록
          </Link>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="ticks" aria-hidden="true">
        {questions.map((_, n) => (
          <span
            key={n}
            className="tick"
            data-v={n < log.length ? (log[n].correct ? "o" : "x") : n === i ? "now" : undefined}
          />
        ))}
      </div>

      <p className="qcount" style={{ marginTop: "1.3rem" }}>
        {topicTitle} · {i + 1} / {questions.length}
      </p>

      <div className="question">
        <div className="question__row">
          <p className="question__stem">
            <span className="question__no">{i + 1}.</span>
            <span>{q.q}</span>
          </p>
          {q.hint && <Hint text={q.hint} />}
        </div>

        <ul className="choices">
          {q.choices.map((c, idx) => {
            let state: string | undefined;
            if (picked !== null) {
              if (idx === q.answer) state = "correct";
              else if (idx === picked) state = "wrong";
              else state = "muted";
            }
            return (
              <li key={idx}>
                <button
                  className="choice"
                  data-state={state}
                  disabled={picked !== null}
                  onClick={() => choose(idx)}
                >
                  <span className="choice__mark">{LABELS[idx]}</span>
                  <span className="choice__text">{c}</span>
                  {picked !== null && idx === q.answer && <Grade ok />}
                  {picked !== null && idx === picked && idx !== q.answer && <Grade ok={false} />}
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      {picked !== null && (
        <div className="explain">
          <span className="explain__label">해 설</span>
          {q.why}{" "}
          <Link href={`/docs/${q.chapter}/${q.doc}`}>— {q.section ?? "문서에서 확인"}</Link>
        </div>
      )}

      <div className="quiz__nav">
        <button className="btn" onClick={next} disabled={picked === null}>
          {i === questions.length - 1 ? "채점 결과" : "다음 문항"}
        </button>
        {picked === null && <span className="note">답을 고르면 바로 채점된다.</span>}
      </div>
    </>
  );
}
