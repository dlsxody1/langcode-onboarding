import { tokenize } from "./rag/tokenizer.ts";

/**
 * 서술형 자동 채점 — 서버도 LLM 도 없이 브라우저에서 돈다.
 * 두 가지 중 하나라도 넘으면 맞는 것으로 친다.
 *   ① 개념 묶음: 묶음마다 표현 중 하나가 답에 들어 있으면 그 개념을 쓴 것. 필요한 개수 이상이면 통과
 *   ② 모범답안과의 유사도: 어절 + 한글 bigram 집합의 Dice 계수가 0.4 이상이고 개념을 하나라도 썼을 때
 * 완벽하지 않으므로 UI 에서 "내 답도 맞다" 로 직접 뒤집을 수 있다.
 */

export type ShortResult = {
  pass: boolean;
  hits: boolean[];     // keys 와 같은 순서
  need: number;
  similarity: number;  // 0~1
};

const SIM_PASS = 0.4;
const MIN_LEN = 8;

const squash = (s: string) => s.toLowerCase().replace(/[^0-9a-z가-힣]/g, "");

export function dice(a: string, b: string): number {
  const A = new Set(tokenize(a));
  const B = new Set(tokenize(b));
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return (2 * inter) / (A.size + B.size);
}

export function gradeShort(answer: string, model: string, keys: string[][], need?: number): ShortResult {
  const flat = squash(answer);
  const hits = keys.map((variants) => variants.some((v) => flat.includes(squash(v))));
  const hitCount = hits.filter(Boolean).length;
  const required = need ?? Math.max(1, Math.ceil(keys.length * 0.6));
  const similarity = dice(answer, model);
  const longEnough = flat.length >= MIN_LEN;
  const pass = longEnough && (hitCount >= required || (hitCount >= 1 && similarity >= SIM_PASS));
  return { pass, hits, need: required, similarity };
}
