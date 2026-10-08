"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

export type GlossaryItem = {
  id: string;
  term: string;
  aliases: string[];
  def: string;
  initial: string;
  docHref: string | null;
  docLabel: string | null;
};

const CHOSEONG = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ";
const JAMO_ONLY = /^[ㄱ-ㅎ]+$/;

/** "클린 아키텍처" → "ㅋㄹ ㅇㅋㅌㅊ" 처럼 초성만 뽑는다 (공백 무시) */
function choseongOf(s: string) {
  let out = "";
  for (const c of s) {
    const code = c.charCodeAt(0);
    if (code >= 0xac00 && code <= 0xd7a3) out += CHOSEONG[Math.floor((code - 0xac00) / 588)];
    else if (/\S/.test(c)) out += c.toLowerCase();
  }
  return out;
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, "");

export function GlossarySearch({ items }: { items: GlossaryItem[] }) {
  const [q, setQ] = useState("");
  const [initial, setInitial] = useState<string | null>(null);

  // 본문 툴팁의 "용어 사전 →" 링크(/glossary#id)로 들어오면 그 용어를 바로 띄운다
  useEffect(() => {
    const id = decodeURIComponent(window.location.hash.slice(1));
    const hit = items.find((g) => g.id === id);
    if (hit) setQ(hit.term);
  }, [items]);

  const initials = useMemo(() => {
    const set = new Set(items.map((g) => g.initial));
    return [...set].sort((a, b) => {
      const rank = (k: string) => (/[ㄱ-ㅎ]/.test(k) ? 0 : /[A-Z]/.test(k) ? 1 : 2);
      return rank(a) - rank(b) || a.localeCompare(b, "ko");
    });
  }, [items]);

  const results = useMemo(() => {
    const query = q.trim();
    if (!query && !initial) return [];

    const nq = norm(query);
    const jamo = JAMO_ONLY.test(nq);
    const matched = items.filter((g) => {
      if (initial && g.initial !== initial) return false;
      if (!query) return true;
      if (jamo) return choseongOf(g.term).startsWith(nq);
      return (
        norm(g.term).includes(nq) ||
        g.aliases.some((a) => norm(a).includes(nq)) ||
        norm(g.def).includes(nq)
      );
    });

    // 용어 이름에 바로 걸리는 것을 위로
    const rank = (g: GlossaryItem) => (query && norm(g.term).includes(nq) ? 0 : 1);
    return matched.sort((a, b) => rank(a) - rank(b));
  }, [items, q, initial]);

  const active = q.trim() || initial;

  return (
    <>
      <div className="glossary__search">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="용어, 설명, 초성(예: ㅋㄹ) 으로 검색"
          aria-label="용어 검색"
          autoComplete="off"
          spellCheck={false}
        />
        {(q || initial) && (
          <button
            type="button"
            onClick={() => {
              setQ("");
              setInitial(null);
            }}
          >
            지우기
          </button>
        )}
      </div>

      <nav className="glossary__index" aria-label="초성으로 보기">
        {initials.map((k) => (
          <button
            key={k}
            type="button"
            aria-pressed={initial === k}
            className={initial === k ? "is-on" : undefined}
            onClick={() => {
              setQ("");
              setInitial(initial === k ? null : k);
            }}
          >
            {k}
          </button>
        ))}
      </nav>

      {!active && (
        <p className="glossary__hint">검색어를 입력하거나 초성을 누르면 해당 용어가 나온다.</p>
      )}

      {active && results.length === 0 && (
        <p className="glossary__hint">&lsquo;{active}&rsquo; 에 해당하는 용어가 없다.</p>
      )}

      {results.length > 0 && (
        <p className="glossary__count">{results.length} 개</p>
      )}

      <dl className="glossary__list">
        {results.map((g) => (
          <div key={g.id} id={g.id} className="glossary__item">
            <dt>{g.term}</dt>
            <dd>
              {g.def}
              {g.docHref && (
                <Link href={g.docHref}>{g.docLabel} →</Link>
              )}
            </dd>
          </div>
        ))}
      </dl>
    </>
  );
}
