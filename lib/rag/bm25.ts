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

export type SearchHit = { chunkId: string; doc: string; score: number };

export type SearchOptions = {
  /** 이 사용자의 열람 범위. 범위 밖 청크는 점수를 매기기 전에 뺀다 (1차 필터) */
  audience: Audience;
  k: number;
  /** 실험용: 1차 필터를 끈다. RLS(2차)만 남았을 때 무슨 일이 생기는지 보려는 것 — 운영에서 쓰지 않는다 */
  unsafeSkipAudienceFilter?: boolean;
};

/**
 * BM25 검색. 공식은 labs/lab2-mini-rag/minirag.py 의 BM25.score 와 같다.
 *   idf   = ln(1 + (N - df + 0.5) / (df + 0.5))
 *   score = Σ idf × tf × (k1 + 1) / (tf + k1 × (1 - b + b × len / avgLen))
 *
 * 질의 토큰은 중복을 뺀다 ("휴가 휴가" 라고 두 번 써도 점수가 두 배가 되지 않게).
 * IDF 의 N 과 df 는 전체 코퍼스 기준이다. 권한으로 걸러도 점수의 척도는 그대로 둔다.
 */
export function searchBm25(index: Bm25Index, query: string, opts: SearchOptions): SearchHit[] {
  const { k1, b, n, avgLen } = index.meta;
  const allowed = (i: number) => opts.unsafeSkipAudienceFilter || index.chunks[i].aud.includes(opts.audience);
  const scores = new Map<number, number>();

  for (const term of new Set(tokenize(query))) {
    // 일반 객체라서 "constructor" 같은 질의어는 프로토타입 함수가 나온다. 자기 속성만 본다
    if (!Object.hasOwn(index.postings, term)) continue;
    const list = index.postings[term];
    const df = list.length / 2;
    const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
    for (let j = 0; j < list.length; j += 2) {
      const i = list[j];
      if (!allowed(i)) continue; // 1차 필터: 후보 단계에서 제외
      const tf = list[j + 1];
      const norm = tf + k1 * (1 - b + (b * index.chunks[i].len) / (avgLen || 1));
      scores.set(i, (scores.get(i) ?? 0) + (idf * tf * (k1 + 1)) / norm);
    }
  }

  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, opts.k)
    .map(([i, score]) => ({ chunkId: index.chunks[i].id, doc: index.chunks[i].doc, score }));
}
