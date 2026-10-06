/**
 * 수제 리랭커 v1 (5단계). 회사 스택의 "시맨틱 리랭커" 자리를 규칙으로 흉내 낸다.
 *
 * BM25 상위 20개를 받아 아래 신호를 섞어 다시 줄 세운다.
 *   bm25       후보 안에서 1등 대비 비율 (0~1). 기본 점수
 *   heading    질의어가 [문서 제목 > 절 경로] 에 얼마나 들어 있나 (0~1). "제5조 (다중 인증)" 같은 제목이 강한 신호다
 *   proximity  질의어들이 본문에서 얼마나 가까이 모여 있나 (0~1). 흩어진 흔한 말 여러 개보다 한 문장 안의 질의어가 낫다
 *   superseded 폐지된 버전이면 감점. 최신 문서와 같은 내용을 다르게 말할 때 구버전이 이기지 않게
 *
 * 가중치는 손으로 정한 둥근 숫자다. 평가셋에 맞춰 소수점까지 깎으면 시험지를 외우는 셈이 된다.
 * 크로스 인코더와의 차이: 이 규칙은 "글자가 어디에 있나"만 보고 뜻은 모른다.
 */
import { tokenize } from "./tokenizer.ts";

export type Candidate = {
  chunkId: string;
  bm25: number;
  title: string;
  headingPath: string[];
  text: string;
  status?: "current" | "superseded" | null;
};

export type Signals = { bm25: number; heading: number; proximity: number; superseded: boolean };
export type Reranked<T extends Candidate> = T & { score: number; signals: Signals };

export const RERANK_WEIGHTS = { bm25: 0.6, heading: 0.25, proximity: 0.15, superseded: 0.25 };

// 신호 계산에서만 빼는 흔한 말. BM25 자체는 건드리지 않는다
const STOP = new Set([
  "해", "돼", "뭐", "왜", "꼭", "좀", "거", "것", "수", "더", "잘", "뭘", "때", "등",
  "있어", "있나", "있나요", "되나요", "돼요", "해요", "해야", "하는", "하면", "어떻게", "얼마", "얼마야", "얼마나", "까지",
  "거야", "건가", "정확히", "그럼", "그건", "나와", "써야", "되는", "무엇", "무엇이", "언제", "어디", "the", "a", "is",
]);

/** 질의 토큰 (bigram 포함, 흔한 말 제외) — 제목 일치에 쓴다 */
function contentTokens(text: string) {
  return [...new Set(tokenize(text))].filter((t) => !STOP.has(t));
}

/** 질의 단어 (어절 단위, 흔한 말 제외) — 근접도에 쓴다 */
function contentWords(text: string) {
  return [...new Set((text.toLowerCase().match(/[a-z0-9]+|[가-힣]+/g) ?? []).filter((w) => !STOP.has(w) && w.length >= 2))];
}

function headingSignal(queryTokens: string[], c: Candidate) {
  if (!queryTokens.length) return 0;
  const head = new Set(tokenize([c.title, ...c.headingPath].join(" ")));
  return queryTokens.filter((t) => head.has(t)).length / queryTokens.length;
}

/**
 * 본문에서 질의 단어가 가장 많이 들어간 가장 짧은 구간을 찾는다.
 * 한국어 조사 때문에 "비밀번호는" 도 "비밀번호" 로 친다 (앞부분 일치).
 * 점수 = (찾은 단어 수 / 질의 단어 수) × (찾은 단어 수 / 구간 길이)
 */
function proximitySignal(queryWords: string[], c: Candidate) {
  if (!queryWords.length) return 0;
  const words = c.text.toLowerCase().match(/[a-z0-9]+|[가-힣]+/g) ?? [];
  const hits: { pos: number; q: number }[] = [];
  words.forEach((w, pos) => {
    const q = queryWords.findIndex((qw) => w.startsWith(qw));
    if (q >= 0) hits.push({ pos, q });
  });
  const distinct = new Set(hits.map((h) => h.q)).size;
  if (distinct === 0) return 0;
  if (distinct === 1) return 1 / queryWords.length;

  // 슬라이딩 윈도: 서로 다른 단어 distinct 개를 모두 품는 가장 짧은 구간
  let best = Infinity;
  const count = new Map<number, number>();
  let left = 0;
  for (let right = 0; right < hits.length; right++) {
    count.set(hits[right].q, (count.get(hits[right].q) ?? 0) + 1);
    while (count.size === distinct) {
      best = Math.min(best, hits[right].pos - hits[left].pos + 1);
      const q = hits[left].q;
      const n = count.get(q)! - 1;
      if (n) count.set(q, n);
      else count.delete(q);
      left++;
    }
  }
  return (distinct / queryWords.length) * Math.min(1, distinct / best);
}

export function rerank<T extends Candidate>(query: string, candidates: T[], w = RERANK_WEIGHTS): Reranked<T>[] {
  const max = Math.max(...candidates.map((c) => c.bm25), 1e-9);
  const qTokens = contentTokens(query);
  const qWords = contentWords(query);
  return candidates
    .map((c) => {
      const signals: Signals = {
        bm25: c.bm25 / max,
        heading: headingSignal(qTokens, c),
        proximity: proximitySignal(qWords, c),
        superseded: c.status === "superseded",
      };
      const score = w.bm25 * signals.bm25 + w.heading * signals.heading + w.proximity * signals.proximity - (signals.superseded ? w.superseded : 0);
      return { ...c, score, signals };
    })
    .sort((a, b) => b.score - a.score);
}
