/**
 * BM25 역색인의 모양과 만드는 법. 검색(4단계)도 이 파일에 붙는다.
 *
 * 색인에는 원문을 넣지 않는다. 토큰 통계와 chunkId, audience 만 있다.
 * 원문은 Supabase chunks 테이블에 있고, RLS 를 통과해야만 읽힌다 (PLAN.md 3절).
 */
import { tokenize } from "./tokenizer.ts";

export type Audience = "employee" | "customer";

export type IndexedChunk = {
  /** chunkId */
  id: string;
  doc: string;
  /** 토큰 수 (BM25 길이 보정) */
  len: number;
  aud: Audience[];
  /** Supabase chunks.content_hash 와 같다. 색인과 DB 가 어긋났는지 확인하는 데 쓴다 */
  hash: string;
};

export type Bm25Index = {
  meta: { builtAt: string; k1: number; b: number; n: number; avgLen: number; tokenizer: string };
  chunks: IndexedChunk[];
  /** term → [chunk 번호, tf, chunk 번호, tf, ...] (평평한 배열로 JSON 크기를 줄인다). df = 길이 / 2 */
  postings: Record<string, number[]>;
};

export function buildBm25Index(
  items: { id: string; doc: string; searchText: string; audience: Audience[]; hash: string }[],
  { k1 = 1.5, b = 0.75 } = {},
): Bm25Index {
  // 일반 객체 {} 를 쓰면 안 된다. 문서에 "constructor" 같은 단어가 있으면 postings["constructor"] 가
  // Object.prototype 의 함수를 돌려준다. 만들 때는 Map, 읽을 때는 Object.hasOwn 으로 확인한다
  const postings = new Map<string, number[]>();
  const chunks: IndexedChunk[] = [];
  let total = 0;

  items.forEach((it, i) => {
    const tokens = tokenize(it.searchText);
    total += tokens.length;
    chunks.push({ id: it.id, doc: it.doc, len: tokens.length, aud: it.audience, hash: it.hash });
    const tf = new Map<string, number>();
    for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
    for (const [t, c] of tf) {
      const list = postings.get(t);
      if (list) list.push(i, c);
      else postings.set(t, [i, c]);
    }
  });

  return {
    meta: { builtAt: new Date().toISOString(), k1, b, n: items.length, avgLen: items.length ? total / items.length : 0, tokenizer: "word+hangul-bigram/v1" },
    chunks,
    postings: Object.fromEntries(postings),
  };
}
