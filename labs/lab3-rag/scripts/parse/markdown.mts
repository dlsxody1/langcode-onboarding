/**
 * 마크다운 → 섹션. 세 형식(md · pdf · docx)이 모두 여기로 모인다.
 * pdf·docx 파서는 각자 마크다운을 만들어 넘기고, 섹션 분리는 이 파일 하나가 맡는다.
 *
 * - 헤딩이 나올 때마다 새 섹션. 헤딩 id 는 사이트와 같은 규칙(lib/slug.ts)
 * - 표는 따로 떼어 "열이름: 값" 문장으로 편다 (kind: "table")
 * - `<!-- page:N -->` 주석은 페이지 번호 표시로만 쓴다 (PDF 파서가 넣는다)
 */
import { Marked, marked, type Tokens } from "marked";
import { HeadingIds, headingPlainText } from "../../../../lib/slug.ts";

export type Section = {
  id: string;
  kind: "text" | "table";
  /** 문서 제목(h1)은 빼고 h2 부터. 예: ["제2장 국내 출장", "제4조 (일비와 숙박비)"] */
  headingPath: string[];
  /** 가장 가까운 헤딩의 id. 원문 링크 #앵커. 첫 헤딩 전이면 null */
  anchor: string | null;
  text: string;
  page?: number;
};

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", nbsp: " " };

export function decodeEntities(s: string) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) => {
    if (e[0] === "#") return String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
    return ENTITIES[e] ?? m;
  });
}

/** 인라인 마크다운(`**굵게**`, `코드`, [링크](...))을 맨 글자로 */
export function inlineToText(md: string) {
  return decodeEntities(headingPlainText(marked.parseInline(md, { async: false }) as string)).trim();
}

/** 표 한 장을 행마다 "열: 값 | 열: 값" 한 줄로 편다. 머리글이 비면 값만 남긴다 */
export function flattenTable(header: string[], rows: string[][]) {
  return rows
    .map((row) => row.map((v, i) => (header[i] ? `${header[i]}: ${v}` : v)).filter((c) => c.trim()).join(" | "))
    .join("\n");
}

/**
 * 헤딩 id 계산용 인라인 렌더러. 사이트(lib/content.ts)는 인라인 코드를 이스케이프하지 않고 `<code>${text}</code>` 로 낸다.
 * 그래서 `<=>` 같은 코드는 태그 제거 단계에서 함께 사라진다. id 가 같아야 링크가 맞으므로 그 동작까지 똑같이 따른다.
 */
const siteInline = new Marked({ renderer: { codespan: ({ text }) => `<code>${text}</code>` } });

export function markdownToSections(md: string, docId: string): { title: string | null; sections: Section[] } {
  const tokens = marked.lexer(md, { gfm: true });
  const ids = new HeadingIds();
  const sections: Section[] = [];

  let title: string | null = null;
  let path: string[] = [];
  let anchor: string | null = null;
  let page: number | undefined;
  let buffer: string[] = [];
  let bufferPage: number | undefined;

  const push = (kind: Section["kind"], text: string, p = page) => {
    if (!text.trim()) return;
    sections.push({ id: `${docId}::${sections.length}`, kind, headingPath: [...path], anchor, text: text.trim(), ...(p ? { page: p } : {}) });
  };
  const flush = () => {
    push("text", buffer.join("\n\n"), bufferPage);
    buffer = [];
    bufferPage = undefined;
  };

  for (const t of tokens) {
    if (t.type === "heading") {
      flush();
      const h = t as Tokens.Heading;
      // 사이트와 똑같이: 인라인 렌더링 → 태그 제거 → id. 엔티티(&lt; 등)도 사이트처럼 남긴 채로 id 를 만든다
      const plain = headingPlainText(siteInline.parseInline(h.text, { async: false }) as string);
      anchor = ids.next(plain, h.depth);
      const label = inlineToText(h.text); // 표시용은 코드 글자를 살린다
      if (h.depth === 1) {
        title ??= label;
        path = [];
      } else {
        path = [...path.slice(0, h.depth - 2), label];
      }
      continue;
    }

    if (t.type === "html") {
      const m = /<!--\s*page:(\d+)\s*-->/.exec(t.raw);
      if (m) {
        page = Number(m[1]);
        continue;
      }
    }

    if (t.type === "table") {
      // 표 바로 앞의 "[표 1] ..." 캡션은 본문이 아니라 표에 붙인다 — 표만 따로 검색돼도 무슨 표인지 알 수 있게
      const caption = buffer.length && /^\[?(표|table)\s*\d+/i.test(buffer[buffer.length - 1]) ? buffer.pop()! : null;
      flush();
      const tb = t as Tokens.Table;
      const rows = flattenTable(tb.header.map((c) => inlineToText(c.text)), tb.rows.map((r) => r.map((c) => inlineToText(c.text))));
      push("table", caption ? `${inlineToText(caption)}\n${rows}` : rows);
      continue;
    }

    if (t.type === "space" || t.type === "hr") continue;
    bufferPage ??= page;
    buffer.push(t.raw.trim());
  }
  flush();

  return { title, sections };
}
