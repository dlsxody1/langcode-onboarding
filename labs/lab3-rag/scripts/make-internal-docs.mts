/**
 * 가상 사내 문서의 PDF · DOCX 원본을 만든다.
 *   src/travel-expense.html → travel-expense.pdf  (Edge/Chrome headless 인쇄)
 *   src/benefits.md         → benefits.docx       (docx 라이브러리)
 *
 * 원본은 사람이 고치기 쉬운 html/md 로 두고, 파서(2단계)가 읽을 파일은 이 스크립트로 만든다.
 * 생성물도 커밋한다 — 파서 실습은 "이미 있는 PDF/DOCX 를 읽는" 상황을 흉내 내야 하기 때문이다.
 *
 * 실행: npm run lab:docs
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";

const DIR = path.resolve(import.meta.dirname, "../corpus-internal");
const SRC = path.join(DIR, "src");

// ── PDF ─────────────────────────────────────────────────────

function findBrowser(): string {
  const candidates = [
    process.env.CHROME_PATH,
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
  ];
  const found = candidates.find((p) => p && fs.existsSync(p));
  if (!found) throw new Error("Edge/Chrome 을 찾지 못했습니다. CHROME_PATH 환경 변수로 경로를 지정하세요.");
  return found;
}

/** Edge 는 이미 떠 있는 프로세스에 일을 넘기고 먼저 끝날 수 있다. 파일이 다 써질 때까지 기다린다 */
async function waitForFile(file: string, timeoutMs = 15_000) {
  let last = -1;
  for (const start = Date.now(); Date.now() - start < timeoutMs; ) {
    const size = fs.existsSync(file) ? fs.statSync(file).size : -1;
    if (size > 0 && size === last) return;
    last = size;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`PDF 가 만들어지지 않았습니다: ${file}`);
}

async function makePdf(name: string) {
  const html = path.join(SRC, `${name}.html`);
  const pdf = path.join(DIR, `${name}.pdf`);
  fs.rmSync(pdf, { force: true });
  execFileSync(findBrowser(), [
    "--headless=new",
    "--disable-gpu",
    "--no-pdf-header-footer",
    `--print-to-pdf=${pdf}`,
    pathToFileURL(html).href,
  ], { stdio: "ignore" });
  await waitForFile(pdf);
  console.log(`PDF  ${path.relative(process.cwd(), pdf)}  ${fs.statSync(pdf).size} bytes`);
}

// ── DOCX ────────────────────────────────────────────────────

/** **굵게** 만 지원하는 인라인 변환 */
function runs(text: string): TextRun[] {
  return text.split(/(\*\*[^*]+\*\*)/).filter(Boolean).map((part) =>
    part.startsWith("**") ? new TextRun({ text: part.slice(2, -2), bold: true }) : new TextRun(part),
  );
}

/** 이 안내문에 필요한 만큼만 지원하는 마크다운 → DOCX 변환: 제목 1~3, 글머리표 2단, 문단 */
function mdToDocx(md: string): Document {
  const heading = [HeadingLevel.TITLE, HeadingLevel.HEADING_1, HeadingLevel.HEADING_2];
  const children: Paragraph[] = [];

  for (const line of md.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const h = /^(#{1,3}) (.*)$/.exec(line);
    const li = /^( *)- (.*)$/.exec(line);
    if (h) {
      // # → Title, ## → Heading 1, ### → Heading 2 (Word 문서의 일반적인 구조)
      children.push(new Paragraph({ heading: heading[h[1].length - 1], children: runs(h[2]) }));
    } else if (li) {
      children.push(new Paragraph({ bullet: { level: li[1].length >= 2 ? 1 : 0 }, children: runs(li[2]) }));
    } else {
      children.push(new Paragraph({ children: runs(line) }));
    }
  }

  return new Document({
    creator: "랭코드 가상법인 인사팀",
    title: "복리후생 안내 2026",
    styles: { default: { document: { run: { font: "Malgun Gothic", size: 21 } } } },
    sections: [{ children }],
  });
}

async function makeDocx(name: string) {
  const md = fs.readFileSync(path.join(SRC, `${name}.md`), "utf8");
  const out = path.join(DIR, `${name}.docx`);
  fs.writeFileSync(out, await Packer.toBuffer(mdToDocx(md)));
  console.log(`DOCX ${path.relative(process.cwd(), out)}  ${fs.statSync(out).size} bytes`);
}

await makePdf("travel-expense");
await makeDocx("benefits");
