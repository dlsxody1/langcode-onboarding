/**
 * 용어 사전으로 질의 넓히기 (5단계). 회사 스택의 "사내 용어 사전"에 해당한다.
 *
 * 질의에 다른 표현("MFA", "호텔비")이 있으면 대표어("다중 인증", "숙박비")를 질의 끝에 덧붙인다.
 * 원래 표현을 지우지 않고 덧붙이는 이유: 문서에 원래 표현이 쓰인 경우도 있어서다 (MFA 는 본문에 그대로 나온다).
 *
 * 색인은 건드리지 않는다. 검색 직전에 앱이 질의 문자열만 바꾼다 — 재색인 없이 사전만 고치면 된다.
 * Node 스크립트와 서버가 함께 쓰므로 의존성 없이 둔다. 사전 파일은 호출하는 쪽이 읽어서 넘긴다.
 */

export type SynonymEntry = { canonical: string; variants: string[] };
export type SynonymTable = { variant: string; canonical: string; pattern: RegExp }[];
export type Expansion = { query: string; applied: { variant: string; canonical: string }[] };

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * 손으로 쓴 사전 + 학습 사이트 용어집(glossary.json)의 별칭을 합친다.
 * 용어집 대표어의 괄호 설명은 뗀다: "RU (Request Unit)" → "RU"
 */
export function buildSynonymTable(entries: SynonymEntry[], glossary: { term: string; aliases?: string[] }[] = []): SynonymTable {
  const all: SynonymEntry[] = [
    ...entries,
    ...glossary.filter((g) => g.aliases?.length).map((g) => ({ canonical: g.term.replace(/\s*\(.*\)\s*$/, "").trim(), variants: g.aliases! })),
  ];
  const table: SynonymTable = [];
  for (const e of all) {
    for (const v of e.variants) {
      if (!v.trim() || v.toLowerCase() === e.canonical.toLowerCase()) continue;
      // 영문 약어는 단어 경계가 있어야 한다 ("DI" 가 "DIfferent" 안에서 걸리지 않게). 한글은 조사가 붙으므로 부분 일치
      const latin = /^[\x20-\x7e]+$/.test(v);
      const pattern = latin ? new RegExp(`(?<![a-z0-9])${escape(v.toLowerCase())}(?![a-z0-9])`) : new RegExp(escape(v.toLowerCase()));
      table.push({ variant: v, canonical: e.canonical, pattern });
    }
  }
  // 긴 표현부터: "두 시간 휴가" 가 "두 시간" 보다 먼저 걸리게
  return table.sort((a, b) => b.variant.length - a.variant.length);
}

export function expandQuery(query: string, table: SynonymTable): Expansion {
  const lower = query.toLowerCase();
  const applied: Expansion["applied"] = [];
  const added = new Set<string>();
  for (const s of table) {
    if (added.has(s.canonical) || lower.includes(s.canonical.toLowerCase())) continue;
    if (s.pattern.test(lower)) {
      applied.push({ variant: s.variant, canonical: s.canonical });
      added.add(s.canonical);
    }
  }
  return { query: applied.length ? `${query} ${[...added].join(" ")}` : query, applied };
}
