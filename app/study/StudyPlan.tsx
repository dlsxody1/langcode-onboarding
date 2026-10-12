"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { load, type Store } from "@/lib/progress";
import { PLAN, TEST_DATE, type PlanItem } from "./plan";

const KEY = "lc-study-plan-v1";

function loadManual(): Record<string, true> {
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Record<string, true>) : {};
  } catch {
    return {}; // 비공개 창에서도 화면은 떠야 한다
  }
}

function saveManual(m: Record<string, true>) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(m));
  } catch {
    /* 저장 실패는 조용히 넘긴다 */
  }
}

/** 로컬 날짜를 YYYY-MM-DD 로 */
function ymd(d: Date) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function dayDiff(from: string, to: string) {
  const a = new Date(`${from}T00:00:00`);
  const b = new Date(`${to}T00:00:00`);
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

export function StudyPlan({ topics }: { topics: Record<string, string[]> }) {
  // 서버 렌더와 어긋나지 않게 진도와 날짜는 마운트 후에 채운다
  const [store, setStore] = useState<Store | null>(null);
  const [manual, setManual] = useState<Record<string, true>>({});
  const [today, setToday] = useState<string | null>(null);

  useEffect(() => {
    setStore(load());
    setManual(loadManual());
    setToday(ymd(new Date()));
  }, []);

  function quizStat(topic: string) {
    const ids = topics[topic] ?? [];
    const att = store?.attempts ?? {};
    const tried = ids.filter((id) => att[id]).length;
    const right = ids.filter((id) => att[id]?.correct).length;
    return { total: ids.length, tried, right };
  }

  function autoDone(it: PlanItem) {
    if (!store) return false;
    if (it.kind === "doc") return Boolean(it.doc && store.read[it.doc]);
    if (it.kind === "quiz" && it.topic) {
      const s = quizStat(it.topic);
      return s.total > 0 && s.tried === s.total;
    }
    return false;
  }

  function isDone(it: PlanItem) {
    return Boolean(manual[it.id]) || autoDone(it);
  }

  function toggle(it: PlanItem) {
    if (autoDone(it)) return;
    const next = { ...manual };
    if (next[it.id]) delete next[it.id];
    else next[it.id] = true;
    setManual(next);
    saveManual(next);
  }

  const all = PLAN.flatMap((d) => d.items);
  const doneCount = all.filter(isDone).length;
  const left = today ? dayDiff(today, TEST_DATE) : null;

  return (
    <>
      <div className="plan-sum">
        <div className="plan-dday">
          <span>시험까지</span>
          <b className="pen">{left === null ? "—" : left > 0 ? `D-${left}` : left === 0 ? "D-day" : "끝"}</b>
        </div>
        <div className="plan-bar">
          <progress max={all.length} value={store ? doneCount : 0} aria-label="계획 진행률" />
          <span>{store ? `${doneCount} / ${all.length} 완료` : "—"}</span>
        </div>
      </div>

      <Link className="plan-mock" href="/study/mock">
        <strong>전 범위 모의고사</strong>
        <span>C# · LINQ · Web API · SignalR 문제를 섞어서 푼다 →</span>
      </Link>

      <ol className="plan-days">
        {PLAN.map((day) => {
          const isToday = day.date === today;
          const past = today !== null && day.date < today;
          const dayDone = day.items.filter(isDone).length;
          return (
            <li className="plan-day" key={day.date} data-today={isToday || undefined} data-past={past || undefined}>
              <header className="plan-day__head">
                <span className="plan-day__date">
                  {day.date.slice(5).replace("-", "/")} ({day.dow})
                </span>
                <h2>{day.title}</h2>
                {isToday && <span className="plan-day__tag">오늘</span>}
                <span className="plan-day__count">{store ? `${dayDone}/${day.items.length}` : ""}</span>
              </header>
              <p className="plan-day__focus">{day.focus}</p>
              <ul className="plan-items">
                {day.items.map((it) => {
                  const auto = autoDone(it);
                  const done = isDone(it);
                  const qs = it.kind === "quiz" && it.topic ? quizStat(it.topic) : null;
                  const meta = [
                    it.note,
                    qs && store ? `${qs.total}문항 중 ${qs.tried} 풀이 · 정답 ${qs.right}` : qs ? `${qs.total}문항` : null,
                    auto ? "자동 체크됨" : null,
                  ]
                    .filter(Boolean)
                    .join(" · ");
                  return (
                    <li className="plan-item" key={it.id} data-done={done || undefined}>
                      <label className="plan-check">
                        <input
                          type="checkbox"
                          checked={done}
                          disabled={auto}
                          onChange={() => toggle(it)}
                          aria-label={`${it.label} 완료`}
                        />
                        <span className="plan-box" aria-hidden />
                      </label>
                      <div className="plan-body">
                        <Link href={it.href}>{it.label}</Link>
                        {meta && <small>{meta}</small>}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </li>
          );
        })}
      </ol>

      <p className="note">
        문서를 열면 읽음으로, 주제 문제를 끝까지 풀면 완료로 자동 체크된다. 나머지는 직접 체크한다.
        기록은 이 기기의 브라우저에만 남는다.
      </p>
    </>
  );
}
