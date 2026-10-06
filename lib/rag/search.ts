import "server-only";

import fs from "node:fs";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { searchBm25, type Audience, type Bm25Index, type SearchHit } from "./bm25.ts";

/**
 * 실습 3 런타임 검색. 두 겹의 권한:
 *   1차 — searchBm25 가 audience 밖의 청크를 후보에서 뺀다 (코드)
 *   2차 — 원문은 사용자 세션으로 chunks 를 읽으므로 RLS 가 다시 막는다 (DB)
 * 1차에 버그가 있어도 2차가 막는다. 대신 개수가 어긋나면 경고를 남겨 버그를 드러낸다.
 */

// 색인은 import 하지 않고 파일로 읽는다. 1.3MB JSON 을 import 하면 TypeScript 가 2만 개 키의 타입을 만든다.
// 배포 번들에 포함되도록 next.config.ts 의 outputFileTracingIncludes 에 경로를 적어 두었다.
const INDEX_PATH = path.join(process.cwd(), "labs/lab3-rag/generated/index.json");
let cached: Bm25Index | null = null;
export function loadIndex(): Bm25Index {
  cached ??= JSON.parse(fs.readFileSync(INDEX_PATH, "utf8")) as Bm25Index;
  return cached;
}

export type Evidence = {
  rank: number;
  chunkId: string;
  score: number;
  docId: string;
  title: string;
  route: string;
  headingPath: string[];
  anchor: string | null;
  page: number | null;
  kind: "text" | "table";
  text: string;
  audience: Audience[];
  version: string | null;
  effectiveDate: string | null;
  status: "current" | "superseded";
  source: "onboarding" | "internal";
};

export const MAX_QUERY_CHARS = 300;

export function normalizeQuery(q: unknown): string | null {
  if (typeof q !== "string") return null;
  const t = q.replace(/\s+/g, " ").trim();
  return t && t.length <= MAX_QUERY_CHARS ? t : null;
}

type ChunkRow = {
  chunk_id: string;
  doc_id: string;
  kind: "text" | "table";
  heading_path: string[];
  anchor: string | null;
  page: number | null;
  text: string;
  audience: Audience[];
  documents: { title: string; route: string; version: string | null; effective_date: string | null; status: "current" | "superseded"; source: "onboarding" | "internal" } | null;
};

/** ChunkStore: 사용자 세션 클라이언트로 원문을 읽는다 → RLS 적용 */
export async function getChunksByIds(supabase: SupabaseClient, hits: SearchHit[]) {
  const warnings: string[] = [];
  if (!hits.length) return { evidence: [] as Evidence[], warnings };

  const { data, error } = await supabase
    .from("chunks")
    .select("chunk_id, doc_id, kind, heading_path, anchor, page, text, audience, documents(title, route, version, effective_date, status, source)")
    .in("chunk_id", hits.map((h) => h.chunkId));
  if (error) throw new Error(`chunks 조회 실패: ${error.message}`);

  const rows = new Map((data as unknown as ChunkRow[]).map((r) => [r.chunk_id, r]));
  if (rows.size !== hits.length) {
    // 1차 필터를 통과했는데 RLS 에 막혔다 = 코드의 권한 필터 버그 신호. 또는 색인과 DB 가 어긋났다
    const missing = hits.filter((h) => !rows.has(h.chunkId)).map((h) => h.chunkId);
    const msg = `요청 ${hits.length}개 중 ${rows.size}개만 조회됨 (RLS 차단 또는 색인↔DB 불일치): ${missing.join(", ")}`;
    console.warn(`[lab3] ${msg}`);
    warnings.push(msg);
  }

  const evidence: Evidence[] = [];
  for (const h of hits) {
    const r = rows.get(h.chunkId);
    if (!r || !r.documents) continue;
    evidence.push({
      rank: evidence.length + 1,
      chunkId: r.chunk_id,
      score: Math.round(h.score * 100) / 100,
      docId: r.doc_id,
      title: r.documents.title,
      route: r.documents.route,
      headingPath: r.heading_path,
      anchor: r.anchor,
      page: r.page,
      kind: r.kind,
      text: r.text,
      audience: r.audience,
      version: r.documents.version,
      effectiveDate: r.documents.effective_date,
      status: r.documents.status,
      source: r.documents.source,
    });
  }
  return { evidence, warnings };
}

/** 실험 스위치: 개발 서버에서만 1차 필터를 끌 수 있다 (PLAN 4단계 "스스로 답해보기") */
export const skipAudienceFilterForExperiment =
  process.env.NODE_ENV !== "production" && process.env.LAB_UNSAFE_SKIP_PREFILTER === "1";

export function search(query: string, audience: Audience, k: number) {
  return searchBm25(loadIndex(), query, { audience, k, unsafeSkipAudienceFilter: skipAudienceFilterForExperiment });
}
