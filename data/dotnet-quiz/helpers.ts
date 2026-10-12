import type { Question } from "../questions";

const CHAPTER = "02-csharp-dotnet";

/** id 에서 만드는 결정적 해시 — 서버 렌더와 클라이언트가 같은 순서를 얻어야 한다 */
function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** 버전·상태코드·숫자처럼 순서 자체에 뜻이 있는 선택지는 그대로 둔다 */
function hasNaturalOrder(choices: string[]) {
  const numeric = choices.filter((c) => c.length <= 9 && /\d/.test(c)).length;
  return numeric >= Math.ceil(choices.length / 2) || choices.every((c) => /^(true|false)$/i.test(c));
}

/**
 * 정답을 쓰는 쪽은 편하게 앞쪽에 쓰기 쉬워서 정답 위치가 한쪽으로 쏠린다.
 * 정답 선택지를 id 로 정한 자리로 옮겨 찍기가 통하지 않게 한다.
 */
function placeAnswer(id: string, choices: string[], answer: number) {
  if (hasNaturalOrder(choices)) return { choices, answer };
  const target = hash(id) % choices.length;
  const next = [...choices];
  [next[answer], next[target]] = [next[target], next[answer]];
  return { choices: next, answer: target };
}

/** 객관식. answer 는 choices 의 0-based 위치 (섞기 전 기준으로 써도 된다) */
export function mc(
  id: string, topic: string, doc: string, section: string,
  hint: string, q: string, choices: string[], answer: number, why: string,
): Question {
  const placed = placeAnswer(id, choices, answer);
  return { id, topic, chapter: CHAPTER, doc, section, hint, q, choices: placed.choices, answer: placed.answer, why };
}

/** 서술형. 개념 묶음(keys) 중 need 개 이상 쓰면 통과 */
export function sa(
  id: string, topic: string, doc: string, section: string,
  hint: string, q: string, keys: string[][], need: number, why: string,
): Question {
  return { id, topic, chapter: CHAPTER, doc, section, hint, q, kind: "short", choices: [], answer: -1, keys, need, why };
}
