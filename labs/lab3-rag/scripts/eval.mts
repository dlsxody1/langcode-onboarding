/**
 * 4단계 평가: data/eval.jsonl 을 색인(generated/index.json)으로 검색해 채점한다.
 * DB 를 쓰지 않으므로 CI 에서도 돈다 (색인과 평가셋은 커밋돼 있다).
 *
 * 지표
 *   Recall@k  정답 문서의 청크가 상위 k 안에 있나 (문서 단위)
 *   MRR       첫 정답의 순위 역수 평균. Recall 이 같아도 1등과 3등을 구분한다
 *   절 단위   정답 절까지 맞혔나 (generated/chunks.json 이 있을 때만, 참고용)
 *   권한 누출 전 문항을 고객 audience 로 검색했을 때 임직원 전용 청크가 나온 횟수. 0 이어야 한다
 *
 * 실행
 *   npm run lab:eval                      요약 + 놓친 질문
 *   npm run lab:eval -- --all             문항별 결과 전부
 *   npm run lab:eval -- --no-prefilter    1차 권한 필터를 끈 채로 (실험: 누출이 어떻게 보이나)
 *   npm run lab:eval -- --ci --min-recall3 0.6   기준 미달 또는 누출 시 exit 1
 */
import fs from "node:fs";
import path from "node:path";
import { searchBm25, type Audience, type Bm25Index, type SearchHit } from "../../../lib/rag/bm25.ts";

const LAB = path.resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const SHOW_ALL = args.includes("--all");
const NO_PREFILTER = args.includes("--no-prefilter");
const CI = args.includes("--ci");
const MIN_R3 = opt("--min-recall3") ? Number(opt("--min-recall3")) : null;
const DEPTH = 10;

type Item = {
  id: string;
  kind: string;
  audience: Audience;
  expect: "found" | "none";
  question: string;
  gold: { doc: string; section?: string }[];
  trap?: string;
};

const index: Bm25Index = JSON.parse(fs.readFileSync(path.join(LAB, "generated/index.json"), "utf8"));
const items: Item[] = fs.readFileSync(path.join(LAB, "data/eval.jsonl"), "utf8").split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));
const manifest = JSON.parse(fs.readFileSync(path.join(LAB, "corpus-internal/manifest.json"), "utf8"));
const formatOf = (doc: string) => manifest.documents.find((d: any) => `internal/${d.slug}` === doc)?.format ?? "md";
const chunksPath = path.join(LAB, "generated/chunks.json");
const headingOf = fs.existsSync(chunksPath)
  ? new Map<string, string[]>(JSON.parse(fs.readFileSync(chunksPath, "utf8")).map((c: any) => [c.chunkId, c.headingPath]))
  : null;
const audOf = new Map(index.chunks.map((c) => [c.id, c.aud]));

const search = (q: string, audience: Audience): SearchHit[] =>
  searchBm25(index, q, { audience, k: DEPTH, unsafeSkipAudienceFilter: NO_PREFILTER });

// ── 문항별 채점 ─────────────────────────────────────────────────
type Row = Item & { hits: SearchHit[]; rank: number | null; sectionRank: number | null; format: string };
const rows: Row[] = items.map((it) => {
  const hits = search(it.question, it.audience);
  const golds = new Set(it.gold.map((g) => g.doc));
  const idx = hits.findIndex((h) => golds.has(h.doc));
  const withSection = it.gold.filter((g) => g.section);
  let sectionRank: number | null = null;
  if (headingOf && withSection.length) {
    const s = hits.findIndex((h) => withSection.some((g) => g.doc === h.doc && (headingOf.get(h.chunkId) ?? []).some((p) => p.includes(g.section!))));
    sectionRank = s >= 0 ? s + 1 : null;
  }
  return { ...it, hits, rank: idx >= 0 ? idx + 1 : null, sectionRank, format: it.gold[0] ? formatOf(it.gold[0].doc) : "-" };
});

const found = rows.filter((r) => r.expect === "found");
const metrics = (rs: Row[]) => {
  const n = rs.length || 1;
  const at = (k: number) => rs.filter((r) => r.rank !== null && r.rank <= k).length / n;
  return { n: rs.length, r1: at(1), r3: at(3), r5: at(5), mrr: rs.reduce((s, r) => s + (r.rank ? 1 / r.rank : 0), 0) / n };
};
const f = (x: number) => x.toFixed(3);
const line = (label: string, rs: Row[]) => {
  const m = metrics(rs);
  return `  ${label.padEnd(22)} ${String(m.n).padStart(4)}   ${f(m.r1)}   ${f(m.r3)}   ${f(m.r5)}   ${f(m.mrr)}`;
};
const groupBy = (key: (r: Row) => string | undefined) => {
  const g = new Map<string, Row[]>();
  for (const r of found) {
    const k = key(r);
    if (k) g.set(k, [...(g.get(k) ?? []), r]);
  }
  return [...g.entries()];
};

// ── 권한 누출: 전 문항을 고객으로 검색 ──────────────────────────
const leaks: { id: string; chunkId: string }[] = [];
for (const it of items) {
  for (const h of search(it.question, "customer")) {
    if (!audOf.get(h.chunkId)?.includes("customer")) leaks.push({ id: it.id, chunkId: h.chunkId });
  }
}

// ── 출력 ────────────────────────────────────────────────────────
const all = metrics(found);
console.log(`\n평가셋 ${items.length}문항 (정답 있음 ${found.length} · 찾지 못함이 정답 ${items.length - found.length}) · 청크 ${index.meta.n}개`);
console.log(`k/전체 청크: k=3 → ${((3 / index.meta.n) * 100).toFixed(2)}%  (1% 를 넘으면 평가가 쉬워진다)`);
if (NO_PREFILTER) console.log("⚠ --no-prefilter: 1차 권한 필터를 끈 실험 모드");
console.log(`\n  ${"구분".padEnd(22)} ${"문항".padStart(4)}   R@1     R@3     R@5     MRR`);
console.log(line("전체", found));
console.log("  ── 종류");
for (const [k, rs] of groupBy((r) => r.kind)) console.log(line(k, rs));
console.log("  ── 정답 문서 형식");
for (const [k, rs] of groupBy((r) => r.format)) console.log(line(k, rs));
console.log("  ── audience");
for (const [k, rs] of groupBy((r) => r.audience)) console.log(line(k, rs));
console.log("  ── 함정");
for (const [k, rs] of groupBy((r) => r.trap)) console.log(line(k, rs));

const sec = found.filter((r) => r.gold.some((g) => g.section));
if (headingOf && sec.length) {
  const s3 = sec.filter((r) => r.sectionRank !== null && r.sectionRank <= 3).length / sec.length;
  console.log(`\n절 단위 R@3 (정답 절이 있는 ${sec.length}문항): ${f(s3)}  ← 문서는 맞혔는데 다른 절을 가져온 경우가 이 차이`);
}

// 6단계 "문서에서 찾지 못했어요" 임계값의 재료: 1등 점수 분포
const top1 = (rs: Row[]) => rs.map((r) => r.hits[0]?.score ?? 0).sort((a, b) => a - b);
const desc = (xs: number[]) => (xs.length ? `최소 ${xs[0].toFixed(1)} · 중앙 ${xs[Math.floor(xs.length / 2)].toFixed(1)} · 최대 ${xs[xs.length - 1].toFixed(1)}` : "-");
console.log(`\n1등 BM25 점수  맞힌 질문(R@1): ${desc(top1(found.filter((r) => r.rank === 1)))}`);
console.log(`               찾지 못함이 정답: ${desc(top1(rows.filter((r) => r.expect === "none")))}`);

console.log(`\n권한 누출 (전 ${items.length}문항을 고객으로 검색, 상위 ${DEPTH}개): ${leaks.length}건 ${leaks.length ? "✗" : "✓"}`);
for (const l of leaks.slice(0, 5)) console.log(`  ${l.id} → ${l.chunkId}`);

const misses = found.filter((r) => r.rank === null || r.rank > 3);
console.log(`\n놓친 질문 (R@3 실패) ${misses.length}개${SHOW_ALL ? "" : " — 앞 15개"}`);
for (const r of SHOW_ALL ? misses : misses.slice(0, 15)) {
  console.log(`  ✗ ${r.id.padEnd(10)} ${r.question.slice(0, 48)}`);
  console.log(`      정답 ${r.gold.map((g) => g.doc).join(", ")} · 순위 ${r.rank ?? "10위 밖"}`);
  console.log(`      가져온 것 ${r.hits.slice(0, 3).map((h) => `${h.doc}(${h.score.toFixed(1)})`).join(", ") || "없음"}`);
}

if (SHOW_ALL) {
  console.log("\n찾지 못함이 정답인 문항 (6단계 임계값 전까지는 무엇이든 가져온다)");
  for (const r of rows.filter((x) => x.expect === "none")) {
    console.log(`  · ${r.id.padEnd(4)} [${r.audience}] ${r.question} → ${r.hits[0] ? `${r.hits[0].doc} (${r.hits[0].score.toFixed(1)})` : "없음"}`);
  }
}

if (CI) {
  const failR3 = MIN_R3 !== null && all.r3 < MIN_R3;
  if (failR3) console.error(`\n✗ R@3 ${f(all.r3)} < 기준 ${MIN_R3}`);
  if (leaks.length) console.error(`\n✗ 권한 누출 ${leaks.length}건`);
  process.exit(failR3 || leaks.length ? 1 : 0);
}
