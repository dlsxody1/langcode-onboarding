/**
 * 평가: data/eval.jsonl 을 색인으로 검색해 채점한다. DB 를 쓰지 않으므로 CI 에서도 돈다.
 * 검색 순서는 서버(lib/rag/search.ts)와 같다: 용어 사전 → BM25 상위 20 → 리랭크 → 상위 k
 * 리랭크에는 청크 원문·절 경로가 필요해서 generated/chunks.json 을 읽는다 (npm run lab:index 로 만든다).
 *
 * 지표
 *   Recall@k  정답 문서의 청크가 상위 k 안에 있나 (문서 단위)
 *   MRR       첫 정답의 순위 역수 평균
 *   절 단위   정답 절까지 맞혔나 (참고용)
 *   권한 누출 전 문항을 고객으로 검색했을 때 임직원 전용 청크가 나온 횟수. 0 이어야 한다
 *
 * 실행
 *   npm run lab:eval                          지금 설정(용어 사전 + 리랭커)으로 요약 + 놓친 질문
 *   npm run lab:eval -- --compare             기준선(BM25 만)과 비교 + 좋아진·나빠진 질문
 *   npm run lab:eval -- --no-synonyms --no-rerank   신호를 하나씩 꺼 보기
 *   npm run lab:eval -- --all                 문항별 결과 전부
 *   npm run lab:eval -- --no-prefilter        1차 권한 필터를 끈 실험
 *   npm run lab:eval -- --ci --min-recall3 0.85
 */
import fs from "node:fs";
import path from "node:path";
import { searchBm25, type Audience, type Bm25Index } from "../../../lib/rag/bm25.ts";
import { rerank } from "../../../lib/rag/rerank.ts";
import { buildSynonymTable, expandQuery } from "../../../lib/rag/synonyms.ts";
import { assess } from "../../../lib/rag/answer.ts";

const LAB = path.resolve(import.meta.dirname, "..");
const ROOT = path.resolve(LAB, "../..");
const args = process.argv.slice(2);
const has = (f: string) => args.includes(f);
const opt = (f: string) => (args.includes(f) ? args[args.indexOf(f) + 1] : undefined);
const MIN_R3 = opt("--min-recall3") ? Number(opt("--min-recall3")) : null;
const DEPTH = 10;
const CANDIDATES = 20;

type Config = { synonyms: boolean; rerank: boolean; prefilter: boolean; label: string };
type Item = { id: string; kind: string; audience: Audience; expect: "found" | "none"; question: string; gold: { doc: string; section?: string }[]; trap?: string };
type Hit = { chunkId: string; doc: string; score: number };
type Row = Item & { hits: Hit[]; rank: number | null; sectionRank: number | null; format: string; applied: string[]; answered: boolean };

const readJson = (p: string) => JSON.parse(fs.readFileSync(p, "utf8"));
const index: Bm25Index = readJson(path.join(LAB, "generated/index.json"));
const items: Item[] = fs.readFileSync(path.join(LAB, "data/eval.jsonl"), "utf8").split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));
const manifest = readJson(path.join(LAB, "corpus-internal/manifest.json"));
const synonyms = buildSynonymTable(readJson(path.join(LAB, "data/synonyms.json")).entries, readJson(path.join(ROOT, "data/glossary.json")));
const chunksPath = path.join(LAB, "generated/chunks.json");
if (!fs.existsSync(chunksPath)) {
  console.error("generated/chunks.json 이 없습니다. npm run lab:index 를 먼저 실행하세요.");
  process.exit(1);
}
const chunkById = new Map<string, any>(readJson(chunksPath).map((c: any) => [c.chunkId, c]));
const formatOf = (doc: string) => manifest.documents.find((d: any) => `internal/${d.slug}` === doc)?.format ?? "md";
const audOf = new Map(index.chunks.map((c) => [c.id, c.aud]));

function retrieve(question: string, audience: Audience, cfg: Config) {
  const { query, applied } = cfg.synonyms ? expandQuery(question, synonyms) : { query: question, applied: [] };
  const hits = searchBm25(index, query, { audience, k: cfg.rerank ? CANDIDATES : DEPTH, unsafeSkipAudienceFilter: !cfg.prefilter });
  const sourcesOf = (ids: string[]) => ids.map((id) => chunkById.get(id)).map((c) => ({ chunkId: c.chunkId, title: c.title, headingPath: c.headingPath, text: c.text, kind: c.kind }));
  if (!cfg.rerank) return { hits, applied, verdict: assess(index, question, sourcesOf(hits.slice(0, 5).map((h) => h.chunkId)), applied) };
  const ranked = rerank(
    query,
    hits.map((h) => {
      const c = chunkById.get(h.chunkId);
      return { chunkId: h.chunkId, doc: h.doc, bm25: h.score, title: c.title, headingPath: c.headingPath, text: c.text, status: c.status, source: c.source };
    }),
  );
  const top = ranked.slice(0, DEPTH).map((r) => ({ chunkId: r.chunkId, doc: r.doc, score: r.score }));
  return { hits: top, applied, verdict: assess(index, question, sourcesOf(top.slice(0, 5).map((h) => h.chunkId)), applied) };
}

function run(cfg: Config): { rows: Row[]; leaks: { id: string; chunkId: string }[] } {
  const rows = items.map((it) => {
    const { hits, applied, verdict } = retrieve(it.question, it.audience, cfg);
    const golds = new Set(it.gold.map((g) => g.doc));
    const idx = hits.findIndex((h) => golds.has(h.doc));
    const withSection = it.gold.filter((g) => g.section);
    const s = withSection.length
      ? hits.findIndex((h) => withSection.some((g) => g.doc === h.doc && (chunkById.get(h.chunkId)?.headingPath ?? []).some((p: string) => p.includes(g.section!))))
      : -1;
    return {
      ...it,
      hits,
      rank: idx >= 0 ? idx + 1 : null,
      sectionRank: s >= 0 ? s + 1 : null,
      format: it.gold[0] ? formatOf(it.gold[0].doc) : "-",
      applied: applied.map((a) => `${a.variant}→${a.canonical}`),
      answered: verdict.found,
    };
  });
  const leaks: { id: string; chunkId: string }[] = [];
  for (const it of items) for (const h of retrieve(it.question, "customer", cfg).hits) if (!audOf.get(h.chunkId)?.includes("customer")) leaks.push({ id: it.id, chunkId: h.chunkId });
  return { rows, leaks };
}

const metrics = (rs: Row[]) => {
  const n = rs.length || 1;
  const at = (k: number) => rs.filter((r) => r.rank !== null && r.rank <= k).length / n;
  return { n: rs.length, r1: at(1), r3: at(3), r5: at(5), mrr: rs.reduce((s, r) => s + (r.rank ? 1 / r.rank : 0), 0) / n };
};
const f = (x: number) => x.toFixed(3);
const d = (x: number) => (Math.abs(x) < 0.0005 ? "      " : `${x > 0 ? "+" : ""}${x.toFixed(3)}`);
const groups = (rows: Row[]) => {
  const found = rows.filter((r) => r.expect === "found");
  const out: [string, Row[]][] = [["전체", found]];
  const add = (prefix: string, key: (r: Row) => string | undefined) => {
    const g = new Map<string, Row[]>();
    for (const r of found) {
      const k = key(r);
      if (k) g.set(k, [...(g.get(k) ?? []), r]);
    }
    for (const [k, rs] of g) out.push([`${prefix}${k}`, rs]);
  };
  add("종류: ", (r) => r.kind);
  add("형식: ", (r) => r.format);
  add("함정: ", (r) => r.trap);
  return out;
};

const current: Config = { synonyms: !has("--no-synonyms"), rerank: !has("--no-rerank"), prefilter: !has("--no-prefilter"), label: "" };
current.label = [current.synonyms ? "synonyms" : "", current.rerank ? "rerank" : "", current.synonyms || current.rerank ? "" : "bm25"].filter(Boolean).join("+");
const result = run(current);
const found = result.rows.filter((r) => r.expect === "found");

console.log(`\n평가셋 ${items.length}문항 · 청크 ${index.meta.n}개 · 설정: ${current.label}${current.prefilter ? "" : " · ⚠ 1차 권한 필터 꺼짐"}`);

if (has("--compare")) {
  // ── 기준선과 나란히 ──────────────────────────────────────────
  const base = run({ synonyms: false, rerank: false, prefilter: current.prefilter, label: "bm25" });
  const syn = run({ synonyms: true, rerank: false, prefilter: current.prefilter, label: "synonyms" });
  const bg = new Map(groups(base.rows));
  const sg = new Map(groups(syn.rows));
  console.log(`\n  ${"구분".padEnd(18)} 문항   R@1 bm25 → +사전 → +리랭크        R@3 bm25 → 지금           MRR bm25 → 지금`);
  for (const [label, rs] of groups(result.rows)) {
    const b = metrics(bg.get(label) ?? []);
    const s = metrics(sg.get(label) ?? []);
    const m = metrics(rs);
    console.log(`  ${label.padEnd(18)} ${String(m.n).padStart(4)}   ${f(b.r1)} → ${f(s.r1)} → ${f(m.r1)} ${d(m.r1 - b.r1)}   ${f(b.r3)} → ${f(m.r3)} ${d(m.r3 - b.r3)}   ${f(b.mrr)} → ${f(m.mrr)} ${d(m.mrr - b.mrr)}`);
  }
  const byId = new Map(base.rows.map((r) => [r.id, r]));
  const rankText = (r: number | null) => (r === null ? "밖" : `${r}위`);
  const better = found.filter((r) => (r.rank ?? 99) < (byId.get(r.id)!.rank ?? 99));
  const worse = found.filter((r) => (r.rank ?? 99) > (byId.get(r.id)!.rank ?? 99));
  console.log(`\n좋아진 질문 ${better.length}개 · 나빠진 질문 ${worse.length}개 (정답 문서 순위 기준)`);
  for (const r of better) console.log(`  ↑ ${r.id.padEnd(10)} ${rankText(byId.get(r.id)!.rank)} → ${rankText(r.rank)}  ${r.question.slice(0, 40)}${r.applied.length ? `  [사전 ${r.applied.join(", ")}]` : ""}`);
  for (const r of worse) {
    console.log(`  ↓ ${r.id.padEnd(10)} ${rankText(byId.get(r.id)!.rank)} → ${rankText(r.rank)}  ${r.question.slice(0, 40)}${r.applied.length ? `  [사전 ${r.applied.join(", ")}]` : ""}`);
    console.log(`      지금 1등 ${r.hits[0]?.chunkId ?? "-"}`);
  }
  console.log(`\n권한 누출: bm25 ${base.leaks.length}건 · 지금 ${result.leaks.length}건`);
} else {
  console.log(`\n  ${"구분".padEnd(18)} ${"문항".padStart(4)}   R@1     R@3     R@5     MRR`);
  for (const [label, rs] of groups(result.rows)) {
    const m = metrics(rs);
    console.log(`  ${label.padEnd(18)} ${String(m.n).padStart(4)}   ${f(m.r1)}   ${f(m.r3)}   ${f(m.r5)}   ${f(m.mrr)}`);
  }
  const sec = found.filter((r) => r.gold.some((g) => g.section));
  console.log(`\n절 단위 R@3 (정답 절이 있는 ${sec.length}문항): ${f(sec.filter((r) => r.sectionRank !== null && r.sectionRank <= 3).length / (sec.length || 1))}`);

  const top1 = (rs: Row[]) => rs.map((r) => r.hits[0]?.score ?? 0).sort((a, b) => a - b);
  const desc = (xs: number[]) => (xs.length ? `최소 ${xs[0].toFixed(2)} · 중앙 ${xs[Math.floor(xs.length / 2)].toFixed(2)} · 최대 ${xs[xs.length - 1].toFixed(2)}` : "-");
  console.log(`\n1등 점수  맞힌 질문(R@1): ${desc(top1(found.filter((r) => r.rank === 1)))}`);
  console.log(`          찾지 못함이 정답: ${desc(top1(result.rows.filter((r) => r.expect === "none")))}`);
  // 6단계 "문서에서 찾지 못했어요" 판정 (lib/rag/answer.ts 의 assess)
  const none = result.rows.filter((r) => r.expect === "none");
  const okFound = found.filter((r) => r.rank !== null && r.rank <= 3);
  const wrongNo = okFound.filter((r) => !r.answered);
  console.log(`\n답변 판정  찾지 못함이 정답 ${none.length}문항 중 "못 찾음"으로 거름 ${none.filter((r) => !r.answered).length}  (${none.map((r) => `${r.id}${r.answered ? "✗" : "✓"}`).join(" ")})`);
  console.log(`           정답을 찾은(R@3) ${okFound.length}문항 중 잘못 "못 찾음" ${wrongNo.length}  ${wrongNo.map((r) => r.id).join(" ")}`);

  console.log(`\n권한 누출 (전 ${items.length}문항을 고객으로, 상위 ${DEPTH}개): ${result.leaks.length}건 ${result.leaks.length ? "✗" : "✓"}`);
  for (const l of result.leaks.slice(0, 5)) console.log(`  ${l.id} → ${l.chunkId}`);

  const misses = found.filter((r) => r.rank === null || r.rank > 3);
  const showAll = has("--all");
  console.log(`\n놓친 질문 (R@3 실패) ${misses.length}개${showAll ? "" : " — 앞 15개"}`);
  for (const r of showAll ? misses : misses.slice(0, 15)) {
    console.log(`  ✗ ${r.id.padEnd(10)} ${r.question.slice(0, 48)}${r.applied.length ? `  [사전 ${r.applied.join(", ")}]` : ""}`);
    console.log(`      정답 ${r.gold.map((g) => g.doc).join(", ")} · 순위 ${r.rank ?? "10위 밖"}`);
    console.log(`      가져온 것 ${r.hits.slice(0, 3).map((h) => `${h.doc}(${h.score.toFixed(2)})`).join(", ") || "없음"}`);
  }
  if (showAll) {
    console.log("\n찾지 못함이 정답인 문항 (6단계 임계값 전까지는 무엇이든 가져온다)");
    for (const r of result.rows.filter((x) => x.expect === "none")) console.log(`  · ${r.id.padEnd(4)} [${r.audience}] ${r.question} → ${r.hits[0] ? `${r.hits[0].doc} (${r.hits[0].score.toFixed(2)})` : "없음"}`);
  }
}

if (has("--ci")) {
  const r3 = metrics(found).r3;
  const failR3 = MIN_R3 !== null && r3 < MIN_R3;
  if (failR3) console.error(`\n✗ R@3 ${f(r3)} < 기준 ${MIN_R3}`);
  if (result.leaks.length) console.error(`\n✗ 권한 누출 ${result.leaks.length}건`);
  process.exit(failR3 || result.leaks.length ? 1 : 0);
}
