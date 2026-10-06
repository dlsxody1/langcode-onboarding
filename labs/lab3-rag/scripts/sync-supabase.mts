/**
 * 3단계 동기화: generated/chunks.json → Supabase (documents · chunks · originals 버킷)
 *
 * ⚠ secret(service_role) 키를 쓴다. RLS 를 건너뛰는 관리자 키라 로컬·CI 에서만 돌린다.
 *   Vercel 빌드에서 돌리지 않는다 — 배포 환경에 이 키를 둘 이유를 만들지 않기 위해서다.
 *
 * - 해시가 같은 청크는 건너뛴다. 바뀐 청크만 upsert, 로컬에 없는 청크는 삭제
 * - 문서별로 "+추가 ~변경 -삭제 =그대로" 를 찍는다
 *
 * 실행:
 *   npm run lab:sync               동기화
 *   npm run lab:sync -- --check    쓰지 않고 차이만 본다. 차이가 있으면 exit 1 (색인 ↔ DB 어긋남 감지)
 */
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import type { Chunk } from "./chunk.mts";

const ROOT = path.resolve(import.meta.dirname, "../../..");
const LAB = path.join(ROOT, "labs/lab3-rag");
const CHECK = process.argv.includes("--check");

if (fs.existsSync(path.join(ROOT, ".env.local"))) process.loadEnvFile(path.join(ROOT, ".env.local"));
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secret = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !secret) {
  console.error("NEXT_PUBLIC_SUPABASE_URL 과 SUPABASE_SECRET_KEY 가 .env.local 에 필요합니다.");
  process.exit(1);
}
const db = createClient(url, secret, { auth: { persistSession: false } });

const chunks: Chunk[] = JSON.parse(fs.readFileSync(path.join(LAB, "generated/chunks.json"), "utf8"));
const manifest = JSON.parse(fs.readFileSync(path.join(LAB, "corpus-internal/manifest.json"), "utf8"));
const fileOf = new Map<string, string>(manifest.documents.map((d: any) => [`internal/${d.slug}`, d.file]));

// ── 문서 행 ─────────────────────────────────────────────────────
const docRows = [...new Map(chunks.map((c) => [c.docId, c])).values()].map((c) => ({
  doc_id: c.docId,
  title: c.title,
  source: c.source,
  format: fileOf.get(c.docId)?.split(".").pop() ?? "md",
  route: c.route,
  version: c.version ?? null,
  effective_date: c.effectiveDate ?? null,
  status: c.status ?? "current",
  audience: c.audience,
  storage_path: fileOf.has(c.docId) ? `internal/${fileOf.get(c.docId)}` : null,
}));

// ── 지금 DB 에 있는 것 ──────────────────────────────────────────
async function fetchAll<T>(table: string, columns: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from(table).select(columns).range(from, from + 999);
    if (error) throw new Error(`${table} 조회 실패: ${error.message}`);
    out.push(...(data as T[]));
    if (!data || data.length < 1000) return out;
  }
}
const remote = new Map((await fetchAll<{ chunk_id: string; doc_id: string; content_hash: string }>("chunks", "chunk_id, doc_id, content_hash")).map((r) => [r.chunk_id, r]));
const remoteDocs = new Set((await fetchAll<{ doc_id: string }>("documents", "doc_id")).map((r) => r.doc_id));

// ── 차이 계산 ───────────────────────────────────────────────────
const local = new Map(chunks.map((c) => [c.chunkId, c]));
const toUpsert = chunks.filter((c) => remote.get(c.chunkId)?.content_hash !== c.contentHash);
const toDelete = [...remote.values()].filter((r) => !local.has(r.chunk_id));
const docsToDelete = [...remoteDocs].filter((id) => !docRows.some((d) => d.doc_id === id));

type Stat = { add: number; change: number; del: number; same: number };
const stats = new Map<string, Stat>();
const stat = (doc: string) => stats.get(doc) ?? stats.set(doc, { add: 0, change: 0, del: 0, same: 0 }).get(doc)!;
for (const c of chunks) {
  const r = remote.get(c.chunkId);
  stat(c.docId)[!r ? "add" : r.content_hash !== c.contentHash ? "change" : "same"]++;
}
for (const r of toDelete) stat(r.doc_id).del++;

const changed = [...stats.entries()].filter(([, s]) => s.add || s.change || s.del);
for (const [doc, s] of changed) console.log(`  ${doc.padEnd(48)} +${s.add} ~${s.change} -${s.del} =${s.same}`);
const total = [...stats.values()].reduce((a, s) => ({ add: a.add + s.add, change: a.change + s.change, del: a.del + s.del, same: a.same + s.same }), { add: 0, change: 0, del: 0, same: 0 });
console.log(`청크 +${total.add} ~${total.change} -${total.del} =${total.same} (그대로 건너뜀) · 바뀐 문서 ${changed.length}/${stats.size}${docsToDelete.length ? ` · 삭제할 문서 ${docsToDelete.length}` : ""}`);

if (CHECK) {
  const drift = toUpsert.length + toDelete.length + docsToDelete.length;
  console.log(drift ? "✗ 색인과 DB 가 어긋났습니다. npm run lab:sync 로 맞추세요." : "✓ 색인과 DB 가 같습니다.");
  process.exit(drift ? 1 : 0);
}

// ── 쓰기 ────────────────────────────────────────────────────────
const fail = (what: string, e: { message: string } | null) => {
  if (e) throw new Error(`${what} 실패: ${e.message}`);
};

// 원본 파일 먼저 (문서 행의 storage_path 가 가리킬 대상)
for (const d of docRows.filter((d) => d.storage_path)) {
  const file = path.join(LAB, "corpus-internal", fileOf.get(d.doc_id)!);
  const type = { pdf: "application/pdf", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", md: "text/markdown" }[d.format] ?? "application/octet-stream";
  const { error } = await db.storage.from("originals").upload(d.storage_path!, fs.readFileSync(file), { upsert: true, contentType: type });
  fail(`원본 업로드 ${d.storage_path}`, error);
}

const now = new Date().toISOString();
fail("documents upsert", (await db.from("documents").upsert(docRows.map((d) => ({ ...d, updated_at: now })))).error);

for (let i = 0; i < toUpsert.length; i += 500) {
  const rows = toUpsert.slice(i, i + 500).map((c) => ({
    chunk_id: c.chunkId,
    doc_id: c.docId,
    kind: c.kind,
    heading_path: c.headingPath,
    anchor: c.anchor,
    page: c.page ?? null,
    text: c.text,
    audience: c.audience,
    content_hash: c.contentHash,
    updated_at: now,
  }));
  fail("chunks upsert", (await db.from("chunks").upsert(rows)).error);
}

for (let i = 0; i < toDelete.length; i += 200) {
  fail("chunks delete", (await db.from("chunks").delete().in("chunk_id", toDelete.slice(i, i + 200).map((r) => r.chunk_id))).error);
}
if (docsToDelete.length) fail("documents delete", (await db.from("documents").delete().in("doc_id", docsToDelete)).error);

console.log(`✓ 동기화 완료 (원본 ${docRows.filter((d) => d.storage_path).length}개 업로드)`);
