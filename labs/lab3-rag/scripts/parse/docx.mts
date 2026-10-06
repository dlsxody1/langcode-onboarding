/**
 * DOCX → 마크다운. mammoth 가 Word 스타일(제목, 글머리표…)을 HTML 태그로 바꿔 주고,
 * 여기서는 그 HTML 을 마크다운으로 옮긴다. mammoth 출력은 태그 종류가 몇 개 안 돼서 작은 토크나이저로 충분하다.
 *
 * 함정: Word 의 "제목(Title)" 과 "제목 1(Heading 1)" 이 둘 다 <h1> 이 된다.
 * 그대로 두면 장 제목이 문서 제목과 같은 레벨이 되므로, 첫 <h1> 뒤의 헤딩은 한 단계씩 내린다.
 *
 * 한계: 페이지 번호가 없다. DOCX 에는 "쪽" 개념이 저장되지 않는다 (Word 가 열 때 계산한다).
 */
import mammoth from "mammoth";
import { decodeEntities } from "./markdown.mts";

export async function docxToMarkdown(buf: Buffer): Promise<{ markdown: string; warnings: string[] }> {
  const { value: html, messages } = await mammoth.convertToHtml(
    { buffer: buf },
    { styleMap: ["p[style-name='Title'] => h1:fresh"] },
  );

  const lines: string[] = [];
  let listDepth = -1;
  let block: string | null = null; // 지금 글자를 모으는 블록: h1~h6 | p | li
  let text = "";
  let sawTitle = false;

  const emit = () => {
    const t = text.replace(/\s+/g, " ").trim();
    if (t && block) {
      if (block[0] === "h") {
        let level = Number(block[1]);
        if (sawTitle) level = Math.min(level + 1, 6);
        else if (level === 1) sawTitle = true;
        lines.push(`\n${"#".repeat(level)} ${t}\n`);
      } else if (block === "li") {
        lines.push(`${"  ".repeat(Math.max(listDepth, 0))}- ${t}`);
      } else {
        lines.push(`\n${t}\n`);
      }
    }
    text = "";
  };

  for (const [tok] of html.matchAll(/<[^>]+>|[^<]+/g)) {
    const tag = /^<(\/?)([a-z0-9]+)/i.exec(tok);
    if (!tag) {
      text += decodeEntities(tok);
      continue;
    }
    const [, close, name] = tag;
    if (name === "strong") text += "**";
    else if (name === "br") text += " ";
    else if (name === "ul" || name === "ol") {
      // 항목 안에서 하위 목록이 열리면, 그 항목의 글자를 먼저 내보낸다
      if (!close) emit();
      listDepth += close ? -1 : 1;
      if (close) lines.push("");
    } else if (/^(h[1-6]|p|li)$/.test(name)) {
      if (close) {
        emit();
        block = name === "li" ? "li" : null;
      } else {
        emit();
        block = name;
      }
    }
  }
  emit();

  return { markdown: lines.join("\n").replace(/\n{3,}/g, "\n\n").trim(), warnings: messages.map((x) => x.message) };
}
