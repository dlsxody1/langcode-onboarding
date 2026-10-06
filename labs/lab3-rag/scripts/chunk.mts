/**
 * 섹션 → 청크. 3단계 청킹 규칙:
 *
 * - 섹션이 기본 단위 (구조 기반 청킹). 한 청크 = 한 절 = 한 주제
 * - 600자를 넘으면 나눈다. 문단 경계 → 문장 경계 순으로 자르고, 코드 블록 안에서는 줄 경계로만 자른다
 * - 표는 행 경계로만 자르고, 조각마다 캡션을 다시 붙인다 (행마다 "열: 값" 이라 머리글은 이미 들어 있다)
 * - 검색용 텍스트에는 "[문서 제목 > 절 제목]" 맥락을 앞에 붙인다. 화면에 보일 원문(text)과는 따로 둔다
 */
import { createHash } from "node:crypto";
import type { ParsedDoc } from "./parse.mts";
import type { Section } from "./parse/markdown.mts";

export const MAX_CHARS = 600;

export type Chunk = {
  chunkId: string;
  docId: string;
  title: string;
  source: ParsedDoc["source"];
  route: string;
  kind: Section["kind"];
  headingPath: string[];
  anchor: string | null;
  page?: number;
  version?: string;
  effectiveDate?: string;
  status?: "current" | "superseded";
  audience: ParsedDoc["audience"];
  /** 화면·프롬프트에 쓰는 원문 */
  text: string;
  /** 검색에 쓰는 텍스트 = 맥락 + 원문 */
  searchText: string;
  contentHash: string;
};

/** 문장 끝: "다." "요." 같은 마침 + 공백, 또는 ?! 뒤 공백. 마침표가 숫자 사이(1.5)면 자르지 않는다 */
const SENTENCE_END = /(?<=[다요음함임됨][.]|[?!])\s+|(?<=[^\d][.])\s+(?=[가-힣A-Z(“"'])/;

/** 조각들을 max 를 넘지 않게 차례로 담는다. 혼자서 max 를 넘는 조각은 그대로 한 청크가 된다 */
function pack(pieces: string[], sep: string, max = MAX_CHARS): string[] {
  const out: string[] = [];
  let cur = "";
  for (const p of pieces) {
    if (!cur) cur = p;
    else if (cur.length + sep.length + p.length <= max) cur += sep + p;
    else {
      out.push(cur);
      cur = p;
    }
  }
  if (cur) out.push(cur);
  return out;
}

function splitText(text: string): string[] {
  if (text.length <= MAX_CHARS) return [text];
  const blocks = text.split(/\n{2,}/);
  const pieces = blocks.flatMap((b) => {
    if (b.length <= MAX_CHARS) return [b];
    if (b.startsWith("```")) return pack(b.split("\n"), "\n"); // 코드: 줄 경계
    if (/^\s*([-*]|\d+\.) /m.test(b)) return pack(b.split("\n"), "\n"); // 목록: 항목 경계
    return pack(b.split(SENTENCE_END), " "); // 문단: 문장 경계
  });
  return pack(pieces, "\n\n");
}

function splitTable(text: string): string[] {
  const lines = text.split("\n");
  const caption = /^\[?(표|table)\s*\d+/i.test(lines[0]) ? lines.shift()! : null;
  const budget = MAX_CHARS - (caption ? caption.length + 1 : 0);
  return pack(lines, "\n", budget).map((p) => (caption ? `${caption}\n${p}` : p));
}

const hash = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex").slice(0, 16);

export function chunkDocs(docs: ParsedDoc[]): Chunk[] {
  const chunks: Chunk[] = [];
  for (const d of docs) {
    // chunkId = 문서 + 앵커 + 앵커 안 순번. 다른 절을 고쳐도 이 절의 id 는 그대로라 동기화 때 바뀐 것만 보낸다
    const perAnchor = new Map<string, number>();
    for (const s of d.sections) {
      const parts = s.kind === "table" ? splitTable(s.text) : splitText(s.text);
      for (const text of parts) {
        const key = s.anchor ?? "_";
        const k = perAnchor.get(key) ?? 0;
        perAnchor.set(key, k + 1);
        const context = [d.title, ...s.headingPath].join(" > ");
        const searchText = `[${context}]\n${text}`;
        const meta = {
          headingPath: s.headingPath,
          anchor: s.anchor,
          kind: s.kind,
          ...(s.page ? { page: s.page } : {}),
          ...(d.version ? { version: d.version } : {}),
          ...(d.effectiveDate ? { effectiveDate: d.effectiveDate } : {}),
          ...(d.status ? { status: d.status } : {}),
          audience: d.audience,
        };
        chunks.push({
          chunkId: `${d.docId}#${key}~${k}`,
          docId: d.docId,
          title: d.title,
          source: d.source,
          route: d.route,
          ...meta,
          text,
          searchText,
          contentHash: hash({ text, searchText, ...meta }),
        });
      }
    }
  }
  return chunks;
}
