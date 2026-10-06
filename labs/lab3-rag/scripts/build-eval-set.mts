/**
 * 평가셋 만들기: data/questions.ts(퀴즈) + data/eval-extra.jsonl(손으로 쓴 보강 문항) → data/eval.jsonl
 *
 * 정답은 "문서" 단위다. 퀴즈의 section 은 실제 헤딩과 이름이 다른 경우가 많아서(약 1/3),
 * 헤딩과 일치할 때만 gold.section 에 실제 헤딩 문자열을 남긴다. 4단계 평가는 문서 단위로 채점하고
 * 절 단위는 참고 지표로만 쓴다.
 *
 * 실행: npm run lab:eval-set
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = path.resolve(import.meta.dirname, "../../..");
const LAB = path.join(ROOT, "labs/lab3-rag");
const load = (rel: string) => import(pathToFileURL(path.join(ROOT, rel)).href);

const { QUESTIONS } = await load("data/questions.ts");
const { CHAPTERS } = await load("lib/chapters.ts");
const manifest = JSON.parse(fs.readFileSync(path.join(LAB, "corpus-internal/manifest.json"), "utf8"));

type Gold = { doc: string; section?: string };
type EvalItem = {
  id: string;
  kind: "quiz" | "paraphrase" | "internal" | "customer" | "none";
  audience: "employee" | "customer";
  expect: "found" | "none";
  question: string;
  gold: Gold[];
  trap?: string;
  answer?: string;
  note?: string;
};

// ── 문서별 헤딩 목록: 정답 문서·절이 실제로 존재하는지 확인하는 데 쓴다 ─────────
const headings = new Map<string, string[]>();
const headingsOf = (md: string) =>
  md.split(/\r?\n/).filter((l) => /^#{1,4} /.test(l)).map((l) => l.replace(/^#+ /, "").trim());

for (const c of CHAPTERS) {
  for (const d of c.docs) {
    headings.set(`${c.id}/${d.slug}`, headingsOf(fs.readFileSync(path.join(ROOT, c.dir, d.file), "utf8")));
  }
}
for (const d of manifest.documents) {
  const file = path.join(LAB, "corpus-internal", d.format === "md" ? d.file : `src/${d.slug}.${d.format === "pdf" ? "html" : "md"}`);
  const text = fs.readFileSync(file, "utf8");
  // PDF 원본은 html 이라 <h2>/<h3> 를 헤딩으로 본다
  const hs = d.format === "pdf"
    ? [...text.matchAll(/<h[1-3]>(.*?)<\/h[1-3]>/g)].map((m) => m[1].replace(/<[^>]+>/g, ""))
    : headingsOf(text);
  headings.set(`internal/${d.slug}`, hs);
}

const findHeading = (doc: string, section?: string) =>
  section ? headings.get(doc)?.find((h) => h.includes(section)) : undefined;

// ── 퀴즈 → 평가 문항 ────────────────────────────────────────────
const quiz: EvalItem[] = QUESTIONS.map((q: any) => {
  const doc = `${q.chapter}/${q.doc}`;
  const section = findHeading(doc, q.section);
  return {
    id: `quiz-${q.id}`,
    kind: "quiz",
    audience: "employee",
    expect: "found",
    question: q.q,
    gold: [section ? { doc, section } : { doc }],
  };
});

// ── 보강 문항 ───────────────────────────────────────────────────
const extra: EvalItem[] = fs
  .readFileSync(path.join(LAB, "data/eval-extra.jsonl"), "utf8")
  .split(/\r?\n/)
  .filter((l) => l.trim())
  .map((l) => JSON.parse(l));

// ── 검증: 오타로 존재하지 않는 문서·절을 정답으로 잡으면 평가가 조용히 틀린다 ───────
const errors: string[] = [];
for (const item of extra) {
  if (item.expect === "found" && item.gold.length === 0) errors.push(`${item.id}: found 인데 gold 가 비어 있음`);
  if (item.expect === "none" && item.gold.length > 0) errors.push(`${item.id}: none 인데 gold 가 있음`);
  for (const g of item.gold) {
    if (!headings.has(g.doc)) errors.push(`${item.id}: 없는 문서 ${g.doc}`);
    else if (g.section && !findHeading(g.doc, g.section)) errors.push(`${item.id}: ${g.doc} 에 "${g.section}" 헤딩 없음`);
  }
}
const ids = new Set<string>();
for (const item of [...quiz, ...extra]) {
  if (ids.has(item.id)) errors.push(`중복 id: ${item.id}`);
  ids.add(item.id);
}
if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}

const all = [...quiz, ...extra];
fs.writeFileSync(path.join(LAB, "data/eval.jsonl"), all.map((x) => JSON.stringify(x)).join("\n") + "\n");

// ── 요약 ────────────────────────────────────────────────────────
const count = (f: (x: EvalItem) => string | undefined) =>
  Object.entries(all.reduce<Record<string, number>>((m, x) => {
    const k = f(x);
    if (k) m[k] = (m[k] ?? 0) + 1;
    return m;
  }, {})).map(([k, v]) => `${k} ${v}`).join(" · ");

console.log(`data/eval.jsonl  ${all.length}문항`);
console.log(`  종류     ${count((x) => x.kind)}`);
console.log(`  audience ${count((x) => x.audience)}`);
console.log(`  기대     ${count((x) => x.expect)}`);
console.log(`  함정     ${count((x) => x.trap)}`);
console.log(`  퀴즈 중 절까지 특정된 문항 ${quiz.filter((q) => q.gold[0].section).length} / ${quiz.length}`);
