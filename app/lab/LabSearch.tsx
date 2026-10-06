"use client";

import { useState } from "react";
import type { Evidence } from "@/lib/rag/search";

type Audience = "employee" | "customer";
type Result = { query: string; audience: Audience; evidence: Evidence[]; warnings: string[]; ms: number };

// 예시 질문은 열람 범위에 따라 다르다. 고객 예시의 마지막 둘은 임직원 문서에만 답이 있다 → 권한 확인용
const EXAMPLES: Record<Audience, string[]> = {
  employee: ["서울 출장 가면 호텔비 얼마까지 나와?", "비밀번호 몇 달마다 바꿔야 해?", "병원 때문에 두 시간만 비우고 싶은데", "권한 필터는 검색 전에 걸어야 해?"],
  customer: ["SSE 랑 WebSocket 차이", "코사인 유사도는 왜 각도를 봐?", "서울 출장 숙박비 상한이 얼마야?", "USB 메모리 써도 되나요?"],
};
const AUDIENCE_LABEL: Record<Audience, string> = { employee: "임직원", customer: "고객" };

function sourceLink(e: Evidence) {
  // 01–07 은 기존 문서 페이지의 헤딩 id 로 바로 간다. 가상 사내 문서 뷰어는 7단계에서 만든다
  if (e.source === "onboarding") return e.anchor ? `${e.route}#${e.anchor}` : e.route;
  return null;
}

export function LabSearch({ audience }: { audience: Audience }) {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function ask(q: string) {
    const text = q.trim();
    if (!text || pending) return;
    setQuery(text);
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/lab/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: text }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setResult(body);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setResult(null);
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <form
        className="lab-ask"
        onSubmit={(e) => {
          e.preventDefault();
          ask(query);
        }}
      >
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="온보딩 문서나 사내 규정에 대해 물어보세요"
          maxLength={300}
          aria-label="질문"
        />
        <button className="btn" type="submit" disabled={pending || !query.trim()}>
          {pending ? "찾는 중…" : "보내기"}
        </button>
      </form>

      <div className="lab-examples" aria-label="예시 질문">
        {EXAMPLES[audience].map((q) => (
          <button key={q} type="button" onClick={() => ask(q)} disabled={pending}>
            {q}
          </button>
        ))}
      </div>

      {error && <p className="lab-login__error" role="alert">{error}</p>}

      {result && (
        <section className="lab-results" aria-live="polite">
          <p className="note">
            「{result.query}」 · {AUDIENCE_LABEL[result.audience]} 열람 범위에서 BM25 상위 {result.evidence.length}개 · {result.ms}ms ·
            답변 생성은 6단계
          </p>
          {result.warnings.map((w) => (
            <p key={w} className="lab-warn">{w}</p>
          ))}
          {result.evidence.length === 0 && (
            <p className="empty">
              <strong>문서에서 찾지 못했어요</strong>
              질문의 단어가 볼 수 있는 문서 어디에도 없습니다. 다른 표현으로 물어보세요.
            </p>
          )}
          <ol className="lab-cards">
            {result.evidence.map((e) => {
              const href = sourceLink(e);
              return (
                <li key={e.chunkId} className="lab-card">
                  <div className="lab-card__head">
                    <span className="lab-card__rank">[{e.rank}]</span>
                    <strong>{e.title}</strong>
                    {e.status === "superseded" && <span className="lab-card__flag">폐지된 버전</span>}
                    <span className="lab-card__score" title="BM25 점수">BM25 {e.score.toFixed(2)}</span>
                  </div>
                  <p className="lab-card__path">
                    {e.headingPath.join(" > ") || "(머리말)"}
                    {e.page ? ` · p.${e.page}` : ""}
                    {e.kind === "table" ? " · 표" : ""}
                  </p>
                  <p className="lab-card__meta">
                    {e.version ? `v${e.version} · ` : ""}
                    {e.effectiveDate ? `시행 ${e.effectiveDate} · ` : ""}
                    열람 {e.audience.map((a) => AUDIENCE_LABEL[a]).join("·")} · <code>{e.chunkId}</code>
                  </p>
                  <pre className="lab-card__text">{e.text}</pre>
                  {href ? <a href={href}>원문 보기 →</a> : <span className="note">원문 보기는 7단계 (권한 확인 뷰어)</span>}
                </li>
              );
            })}
          </ol>
        </section>
      )}
    </>
  );
}
