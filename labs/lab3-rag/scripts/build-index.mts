/**
 * 3단계 색인: generated/parsed.json → 청크 → BM25 역색인
 *
 *   generated/chunks.json   청크 전체 (원문 포함). sync-supabase 가 읽는다. 커밋하지 않는다
 *   generated/index.json    역색인 (원문 없음). 서버리스 함수가 읽는다. 커밋한다
 *
 * index.json 을 커밋하는 이유: 사이트 빌드가 실습 도구(unpdf·mammoth)에 의존하지 않게 하려는 것.
 * 실습 탭 때문에 학습 사이트 배포가 깨지면 안 된다 (PLAN.md 원칙 7).
 * 대신 색인과 DB 가 어긋날 수 있으므로 `npm run lab:sync -- --check` 로 확인한다.
 *
 * 실행: npm run lab:index   (lab:parse 를 먼저 돌린다)
 */
import fs from "node:fs";
import path from "node:path";
import { buildBm25Index } from "../../../lib/rag/bm25.ts";
import { chunkDocs, MAX_CHARS } from "./chunk.mts";
import type { ParsedDoc } from "./parse.mts";

const GEN = path.resolve(import.meta.dirname, "../generated");
const docs: ParsedDoc[] = JSON.parse(fs.readFileSync(path.join(GEN, "parsed.json"), "utf8"));

const chunks = chunkDocs(docs);
const dup = chunks.map((c) => c.chunkId).filter((id, i, a) => a.indexOf(id) !== i);
if (dup.length) throw new Error(`chunkId 중복: ${dup.slice(0, 5).join(", ")}`);

const index = buildBm25Index(chunks.map((c) => ({ id: c.chunkId, doc: c.docId, searchText: c.searchText, audience: c.audience, hash: c.contentHash })));

fs.writeFileSync(path.join(GEN, "chunks.json"), JSON.stringify(chunks, null, 1));
fs.writeFileSync(path.join(GEN, "index.json"), JSON.stringify(index));

// ── 요약 ────────────────────────────────────────────────────────
const lens = chunks.map((c) => c.text.length).sort((a, b) => a - b);
const pct = (p: number) => lens[Math.min(lens.length - 1, Math.floor(lens.length * p))];
const over = chunks.filter((c) => c.text.length > MAX_CHARS);
const kb = (f: string) => (fs.statSync(path.join(GEN, f)).size / 1024).toFixed(0);
console.log(`청크 ${chunks.length}개 (표 ${chunks.filter((c) => c.kind === "table").length}) · 문서 ${docs.length}개`);
console.log(`  길이(자)  중앙값 ${pct(0.5)} · 90% ${pct(0.9)} · 최대 ${lens[lens.length - 1]} · ${MAX_CHARS}자 초과 ${over.length}개`);
if (over.length) console.log(`  초과 예: ${over.slice(0, 3).map((c) => `${c.chunkId} (${c.text.length}자)`).join(", ")}`);
console.log(`  audience  공개 ${chunks.filter((c) => c.audience.includes("customer")).length} · 임직원 전용 ${chunks.filter((c) => !c.audience.includes("customer")).length}`);
console.log(`  색인 용어 ${Object.keys(index.postings).length}개 · 평균 토큰 ${index.meta.avgLen.toFixed(1)}`);
console.log(`  generated/index.json ${kb("index.json")}KB (원문 없음) · generated/chunks.json ${kb("chunks.json")}KB`);
