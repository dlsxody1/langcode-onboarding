/**
 * 2단계 파싱: 코퍼스 전체 → generated/parsed.json
 *
 *   01–07 온보딩 문서 (md, 공개)        목록: lib/chapters.ts
 *   가상 사내 문서 (md · pdf · docx)    목록: corpus-internal/manifest.json
 *
 * 실행:
 *   npm run lab:parse                         전체 파싱 + 요약
 *   npm run lab:parse -- --print              문서별 섹션 목록
 *   npm run lab:parse -- --print travel       docId 에 travel 이 든 문서의 섹션 본문까지
 *   npm run lab:parse -- --markdown travel    PDF·DOCX 가 마크다운으로 어떻게 바뀌었는지
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { markdownToSections, type Section } from "./parse/markdown.mts";
import { pdfToMarkdown } from "./parse/pdf.mts";
import { docxToMarkdown } from "./parse/docx.mts";

const ROOT = path.resolve(import.meta.dirname, "../../..");
const LAB = path.join(ROOT, "labs/lab3-rag");
const { CHAPTERS } = await import(pathToFileURL(path.join(ROOT, "lib/chapters.ts")).href);
const manifest = JSON.parse(fs.readFileSync(path.join(LAB, "corpus-internal/manifest.json"), "utf8"));

export type ParsedDoc = {
  /** 평가셋의 gold.doc 과 같은 형식. "03-rag/foundations" | "internal/travel-expense" */
  docId: string;
  title: string;
  source: "onboarding" | "internal";
  format: "md" | "pdf" | "docx";
  /** 원문 보기 경로. 섹션 anchor 를 # 뒤에 붙인다 */
  route: string;
  audience: ("employee" | "customer")[];
  version?: string;
  effectiveDate?: string;
  status?: "current" | "superseded";
  sections: Section[];
};

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i < 0 ? null : (args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : "");
};
const printFilter = flag("--print");
const markdownFilter = flag("--markdown");

const docs: ParsedDoc[] = [];
const intermediate = new Map<string, string>();

// ── 01–07 온보딩 문서 ───────────────────────────────────────────
for (const c of CHAPTERS) {
  for (const d of c.docs) {
    const docId = `${c.id}/${d.slug}`;
    const md = fs.readFileSync(path.join(ROOT, c.dir, d.file), "utf8");
    const { title, sections } = markdownToSections(md, docId);
    docs.push({
      docId,
      title: title ?? d.title,
      source: "onboarding",
      format: "md",
      route: `/docs/${c.id}/${d.slug}`,
      audience: ["employee", "customer"],
      sections,
    });
  }
}

// ── 가상 사내 문서 ──────────────────────────────────────────────
for (const m of manifest.documents) {
  const docId = `internal/${m.slug}`;
  const file = path.join(LAB, "corpus-internal", m.file);
  let md: string;
  if (m.format === "pdf") md = (await pdfToMarkdown(new Uint8Array(fs.readFileSync(file)))).markdown;
  else if (m.format === "docx") {
    const r = await docxToMarkdown(fs.readFileSync(file));
    if (r.warnings.length) console.warn(`[docx] ${m.slug}: ${r.warnings.join(" / ")}`);
    md = r.markdown;
  } else md = fs.readFileSync(file, "utf8");
  intermediate.set(docId, md);

  const { title, sections } = markdownToSections(md, docId);
  docs.push({
    docId,
    title: title ?? m.title,
    source: "internal",
    format: m.format,
    route: `/lab/docs/${m.slug}`,
    audience: m.audience,
    version: m.version,
    effectiveDate: m.effectiveDate,
    status: m.status,
    sections,
  });
}

// ── 저장 ────────────────────────────────────────────────────────
const outDir = path.join(LAB, "generated");
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "parsed.json"), JSON.stringify(docs, null, 1));

// ── 출력 ────────────────────────────────────────────────────────
if (markdownFilter !== null) {
  for (const [id, md] of intermediate) if (id.includes(markdownFilter)) console.log(`\n===== ${id} =====\n${md}`);
  process.exit(0);
}

if (printFilter !== null) {
  for (const d of docs.filter((x) => x.docId.includes(printFilter))) {
    console.log(`\n■ ${d.docId}  「${d.title}」  ${d.format} · ${d.audience.join(",")}${d.status ? ` · ${d.status}` : ""}`);
    for (const s of d.sections) {
      const loc = [s.headingPath.join(" > ") || "(머리말)", s.page ? `p.${s.page}` : "", s.kind === "table" ? "[표]" : ""].filter(Boolean).join("  ");
      console.log(`  ${s.id.split("::")[1].padStart(3)}  ${loc}  #${s.anchor ?? "-"}  (${s.text.length}자)`);
      if (printFilter) console.log(s.text.split("\n").map((l) => `        ${l}`).join("\n"));
    }
  }
  process.exit(0);
}

const all = docs.flatMap((d) => d.sections);
const byFormat = (f: string) => docs.filter((d) => d.format === f);
console.log(`generated/parsed.json  문서 ${docs.length}개 · 섹션 ${all.length}개 (표 ${all.filter((s) => s.kind === "table").length})`);
for (const f of ["md", "pdf", "docx"]) {
  const ds = byFormat(f);
  console.log(`  ${f.padEnd(4)} 문서 ${String(ds.length).padStart(2)} · 섹션 ${ds.reduce((n, d) => n + d.sections.length, 0)}`);
}
const lens = all.map((s) => s.text.length).sort((a, b) => a - b);
console.log(`  섹션 길이(자)  중앙값 ${lens[Math.floor(lens.length / 2)]} · 90% ${lens[Math.floor(lens.length * 0.9)]} · 최대 ${lens[lens.length - 1]}`);
