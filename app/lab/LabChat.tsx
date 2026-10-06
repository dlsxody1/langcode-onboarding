"use client";

import { useEffect, useRef, useState } from "react";
import type { Evidence } from "@/lib/rag/search";

type Audience = "employee" | "customer";

type Turn =
  | { id: number; role: "user"; text: string }
  | {
      id: number;
      role: "bot";
      text: string;
      status: string | null;
      streaming: boolean;
      found?: boolean;
      applied?: { variant: string; canonical: string }[];
      warnings?: string[];
      sources?: Evidence[];
      cited?: number[];
      ms?: number;
      error?: string;
    };

// 고객 예시의 마지막 둘은 임직원 문서에만 답이 있다 → 권한 확인용
const EXAMPLES: Record<Audience, string[]> = {
  employee: ["서울 출장 가면 호텔비 얼마까지 나와?", "비밀번호 몇 달마다 바꿔야 해?", "병원 때문에 두 시간만 비우고 싶은데", "권한 필터는 검색 전에 걸어야 해?"],
  customer: ["SSE 랑 WebSocket 차이", "권한 필터는 검색 전에 걸어야 해?", "서울 출장 숙박비 상한이 얼마야?", "USB 메모리 써도 되나요?"],
};
const AUDIENCE_LABEL: Record<Audience, string> = { employee: "임직원", customer: "고객" };

/** 원문 위치로 가는 링크. 01–07 은 기존 문서 페이지의 헤딩 id, 사내 문서는 권한 확인 뷰어 */
function sourceHref(e: Evidence) {
  if (e.source === "onboarding") return e.anchor ? `${e.route}#${e.anchor}` : e.route;
  return `${e.route}?hl=${encodeURIComponent(e.chunkId)}${e.anchor ? `#${e.anchor}` : ""}`;
}

/** SSE 블록 하나("event: x\ndata: {...}") → { event, data } */
function parseEvent(block: string) {
  let event = "message";
  let data = "";
  for (const line of block.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) data += line.slice(5).trim();
  }
  return { event, data: data ? JSON.parse(data) : null };
}

/** 답변 글자 → 문단과 [n] 칩. 스트리밍 중 끝에 잘려 들어온 "[1" 은 숨긴다 (다음 조각에서 "]" 가 오면 칩이 된다) */
function AnswerText({ text, streaming, onCite }: { text: string; streaming: boolean; onCite: (n: number) => void }) {
  const shown = streaming ? text.replace(/\[\d*$/, "") : text;
  const lines = shown.split("\n");
  return (
    <div className="msg__text">
      {lines.map((line, li) => (
        <p key={li}>
          {line.split(/(\[\d+\])/).map((part, pi) => {
            const m = /^\[(\d+)\]$/.exec(part);
            return m ? (
              <button key={pi} type="button" className="cite" onClick={() => onCite(Number(m[1]))} aria-label={`근거 ${m[1]} 보기`}>
                {m[1]}
              </button>
            ) : (
              <span key={pi}>{part}</span>
            );
          })}
          {streaming && li === lines.length - 1 && <span className="caret" aria-hidden />}
        </p>
      ))}
    </div>
  );
}

function SourceCard({ e, n, active }: { e: Evidence; n: number; active: boolean }) {
  return (
    <li className="source" id={`src-${e.chunkId}`} data-active={active}>
      <div className="source__head">
        <span className="source__n">{n}</span>
        <strong>{e.title}</strong>
        {e.status === "superseded" && <span className="source__flag">폐지된 버전</span>}
      </div>
      <p className="source__path">
        {e.headingPath.join(" › ") || "(머리말)"}
        {e.page ? ` · p.${e.page}` : ""}
        {e.version ? ` · v${e.version}` : ""}
        {e.effectiveDate ? ` · 시행 ${e.effectiveDate}` : ""}
      </p>
      <p className="source__links">
        <a href={sourceHref(e)}>원문 보기 →</a>
        {e.source === "internal" && <a href={`${e.route}/download`}>원본 파일 ↓</a>}
        <span className="source__score" title={`제목 일치 ${e.signals.heading.toFixed(2)} · 근접도 ${e.signals.proximity.toFixed(2)}${e.signals.superseded ? " · 폐지 버전 감점" : ""}`}>
          BM25 {e.bm25.toFixed(1)} ({e.bm25Rank}위) → {e.score.toFixed(2)}
        </span>
      </p>
    </li>
  );
}

function BotTurn({ t }: { t: Extract<Turn, { role: "bot" }> }) {
  const [active, setActive] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const sources = t.sources ?? [];
  const cited = t.cited ?? [];

  const onCite = (n: number) => {
    setActive(n);
    const e = sources[n - 1];
    if (e) document.getElementById(`src-${e.chunkId}`)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };

  return (
    <li className="msg msg--bot">
      {t.status && !t.text && <p className="msg__status">{t.status}</p>}
      {t.error && <p className="lab-login__error" role="alert">{t.error}</p>}
      {t.text && <AnswerText text={t.text} streaming={t.streaming} onCite={onCite} />}

      {!t.streaming && !t.error && (
        <>
          <div className="msg__actions">
            <button
              type="button"
              onClick={async () => {
                await navigator.clipboard.writeText(t.text);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
            >
              {copied ? "복사됨" : "복사"}
            </button>
            <span>추출형 요약 (LLM 없음)</span>
            {t.applied && t.applied.length > 0 && <span>용어 사전: {t.applied.map((a) => `${a.variant}→${a.canonical}`).join(", ")}</span>}
            {t.ms !== undefined && <span>{t.ms}ms</span>}
          </div>
          {t.warnings?.map((w) => (
            <p key={w} className="lab-warn">{w}</p>
          ))}

          {cited.length > 0 && (
            <ol className="sources" aria-label="근거">
              {cited.map((n) => sources[n - 1] && <SourceCard key={n} e={sources[n - 1]} n={n} active={active === n} />)}
            </ol>
          )}
          {sources.length > 0 && (
            <details className="sources__all">
              <summary>{t.found ? `검색된 근거 ${sources.length}개 모두 보기` : `무엇을 찾아봤는지 보기 (${sources.length}개)`}</summary>
              <ol className="sources">
                {sources.map((e, i) => (
                  <SourceCard key={e.chunkId} e={e} n={i + 1} active={active === i + 1} />
                ))}
              </ol>
            </details>
          )}
        </>
      )}
    </li>
  );
}

export function LabChat({ audience }: { audience: Audience }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const busy = turns.some((t) => t.role === "bot" && t.streaming);
  const nextId = useRef(1);
  // 사용자가 위로 스크롤해 읽고 있으면 따라 내려가지 않는다 (05-realtime-ui/02 자동 스크롤 규칙)
  const stick = useRef(true);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onScroll = () => {
      stick.current = window.innerHeight + window.scrollY >= document.body.scrollHeight - 120;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (stick.current && turns.length) window.scrollTo({ top: document.body.scrollHeight });
  }, [turns]);

  const patchBot = (id: number, patch: Partial<Extract<Turn, { role: "bot" }>> | ((t: Extract<Turn, { role: "bot" }>) => Partial<Extract<Turn, { role: "bot" }>>)) =>
    setTurns((ts) => ts.map((t) => (t.id === id && t.role === "bot" ? { ...t, ...(typeof patch === "function" ? patch(t) : patch) } : t)));

  async function ask(q: string) {
    const question = q.trim();
    if (!question || busy) return;
    setInput("");
    stick.current = true;
    const userId = nextId.current++;
    const botId = nextId.current++;
    setTurns((ts) => [...ts, { id: userId, role: "user", text: question }, { id: botId, role: "bot", text: "", status: "질문을 보내는 중…", streaming: true }]);

    try {
      const res = await fetch("/api/lab/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: question }),
      });
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        // 이벤트는 빈 줄로 끝난다. 네트워크 조각이 이벤트 중간에서 끊길 수 있으니 완성된 것만 처리한다
        let cut: number;
        while ((cut = buffer.indexOf("\n\n")) >= 0) {
          const { event, data } = parseEvent(buffer.slice(0, cut));
          buffer = buffer.slice(cut + 2);
          if (event === "status") patchBot(botId, { status: data.text });
          else if (event === "meta") patchBot(botId, { found: data.found, applied: data.applied, warnings: data.warnings, status: data.found ? "답을 정리하는 중…" : null });
          else if (event === "delta") patchBot(botId, (t) => ({ text: t.text + data.text }));
          else if (event === "citations") patchBot(botId, { sources: data.sources, cited: data.cited });
          else if (event === "done") patchBot(botId, { ms: data.ms });
          else if (event === "error") throw new Error(data.message);
        }
      }
      patchBot(botId, { streaming: false, status: null });
    } catch (e) {
      patchBot(botId, { streaming: false, status: null, error: e instanceof Error ? e.message : String(e) });
    } finally {
      inputRef.current?.focus();
    }
  }

  const composer = (
    <form
      className="composer"
      onSubmit={(e) => {
        e.preventDefault();
        ask(input);
      }}
    >
      <input
        ref={inputRef}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="사내 도우미에게 물어보세요"
        maxLength={300}
        aria-label="질문"
        autoFocus
      />
      <button type="submit" disabled={busy || !input.trim()} aria-label="보내기">
        ↑
      </button>
    </form>
  );

  if (turns.length === 0) {
    return (
      <div className="chat__empty">
        <h1>무엇이 궁금하세요?</h1>
        {composer}
        <div className="lab-examples" aria-label="예시 질문">
          {EXAMPLES[audience].map((q) => (
            <button key={q} type="button" onClick={() => ask(q)}>
              {q}
            </button>
          ))}
        </div>
        <p className="note">온보딩 문서 01–07{audience === "employee" ? "과 사내 규정(가상)" : ""}에서 찾아 근거와 함께 답합니다.</p>
      </div>
    );
  }

  return (
    <>
      <ol className="chat__log">
        {turns.map((t) =>
          t.role === "user" ? (
            <li key={t.id} className="msg msg--user">
              <p>{t.text}</p>
            </li>
          ) : (
            <BotTurn key={t.id} t={t} />
          ),
        )}
      </ol>
      <div className="chat__dock">{composer}</div>
    </>
  );
}
