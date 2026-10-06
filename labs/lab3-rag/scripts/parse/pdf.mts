/**
 * PDF → 마크다운. Document Intelligence 의 "레이아웃 분석"을 작게 흉내 낸다.
 *
 * unpdf 는 글자 조각마다 (문자열, x, y, 글자 크기) 만 준다. 문단도 제목도 표도 없다.
 * 그래서 좌표와 글자 크기만으로 구조를 다시 세운다.
 *
 *   ① 같은 y 의 조각을 한 줄로 묶는다
 *   ② 본문보다 큰 글자 줄 = 제목. 크기 순서대로 #, ##, ###
 *   ③ 칸이 2개 이상인 줄이 이어지면 표. 숫자가 든 줄 = 데이터 행, 그 위 = 머리글
 *   ④ 머리글은 여러 줄로 흩어져 있다(병합 셀). 머리글 글자의 가운데가 어느 열(들)의 가운데와 맞는지로
 *      열 이름을 복원한다 → "직원" + "숙박비 상한" = "직원 숙박비 상한"
 *
 * 한계 (유료 서비스가 확실히 나은 지점):
 * - 스캔 PDF 는 글자 조각이 아예 없다 (OCR 필요)
 * - 줄바꿈이 단어 중간인지 띄어쓰기 자리인지 모른다. 한글-한글 사이는 붙이고, 나머지는 띄운다
 * - 테두리 없는 표, 셀 안 줄바꿈, 여러 쪽에 걸친 표는 이 규칙으로 못 푼다
 */
import { getDocumentProxy } from "unpdf";

type Item = { str: string; x: number; y: number; w: number; size: number; eol: boolean };
type Line = { y: number; size: number; cells: Item[] };

const HANGUL = /[가-힣]/;
const center = (c: { x: number; w: number }) => c.x + c.w / 2;

function toLines(items: Item[]): Line[] {
  const lines: Line[] = [];
  for (const it of [...items].sort((a, b) => b.y - a.y || a.x - b.x)) {
    const line = lines.find((l) => Math.abs(l.y - it.y) < 1);
    if (line) line.cells.push(it);
    else lines.push({ y: it.y, size: it.size, cells: [it] });
  }
  for (const l of lines) {
    l.cells = mergeCells(l.cells.sort((a, b) => a.x - b.x));
    l.size = Math.max(...l.cells.map((c) => c.size));
  }
  return lines;
}

/**
 * 같은 줄에서 간격이 좁은 조각은 한 칸으로 합친다.
 * 굵은 글씨처럼 글꼴이 바뀌는 곳에서 조각이 나뉘는데, 그걸 표의 칸으로 착각하면 문단이 표가 된다.
 * 표의 칸 사이는 여백 + 테두리라서 글자 크기보다 훨씬 넓다.
 */
function mergeCells(cells: Item[]): Item[] {
  const out: Item[] = [];
  for (const c of cells) {
    const prev = out[out.length - 1];
    const gap = prev ? c.x - (prev.x + prev.w) : Infinity;
    if (prev && gap < c.size * 1.2) {
      const space = gap > c.size * 0.15 && !prev.str.endsWith(" ") && !c.str.startsWith(" ") ? " " : "";
      out[out.length - 1] = { ...prev, str: prev.str + space + c.str, w: c.x + c.w - prev.x, eol: c.eol, size: Math.max(prev.size, c.size) };
    } else out.push({ ...c });
  }
  return out;
}

/** 본문 글자 크기 = 가장 많은 글자가 쓰인 크기 */
function bodySize(lines: Line[]) {
  const chars = new Map<number, number>();
  for (const l of lines) for (const c of l.cells) chars.set(c.size, (chars.get(c.size) ?? 0) + c.str.length);
  return [...chars.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 10;
}

const escapeCell = (s: string) => s.replace(/\|/g, "\\|").trim();

/** 칸이 2개 이상인 줄 묶음 → 마크다운 표. 표로 볼 수 없으면 null */
function tableToMarkdown(region: Line[]): string | null {
  const maxCells = Math.max(...region.map((l) => l.cells.length));
  const firstData = region.findIndex((l) => l.cells.length === maxCells && l.cells.some((c) => /\d/.test(c.str)));
  if (maxCells < 3 || firstData < 0) return null;

  const headerLines = region.slice(0, firstData);
  const dataLines = region.slice(firstData);

  // 열 위치: 칸이 다 찬 데이터 행들에서 i 번째 칸이 차지하는 가로 범위의 합집합.
  // 왼쪽 정렬 칸("서울특별시")은 글자 가운데가 칸 가운데와 다르므로, 범위 전체를 본다
  const full = dataLines.filter((l) => l.cells.length === maxCells);
  const cols = full[0].cells.map((_, i) => ({
    left: Math.min(...full.map((l) => l.cells[i].x)),
    right: Math.max(...full.map((l) => l.cells[i].x + l.cells[i].w)),
  }));
  const colCenter = cols.map((c) => (c.left + c.right) / 2);
  /** 칸이 모자란 줄(셀 안 줄바꿈)의 조각이 어느 열인지: 시작 x 를 품은 열, 없으면 가장 가까운 열 */
  const colOf = (it: Item) => {
    const inside = cols.findIndex((c) => it.x >= c.left - 2 && it.x <= c.right + 2);
    if (inside >= 0) return inside;
    return colCenter.reduce((best, cc, i) => (Math.abs(cc - center(it)) < Math.abs(colCenter[best] - center(it)) ? i : best), 0);
  };

  // 머리글 칸 하나가 덮는 열 범위 찾기. 병합 셀의 글자는 덮는 열들의 한가운데에 놓인다는 점을 이용한다.
  // 후보: 연속한 열 구간 중, 구간 가운데와 머리글 가운데의 차이가 구간 폭의 30% 이내인 것.
  // 그중 열 수가 가장 적은 구간을 고른다 — 넓은 구간은 평균이 우연히 맞을 수 있다
  const labels: string[][] = cols.map(() => []);
  for (const hl of headerLines) {
    for (const cell of hl.cells) {
      const cx = center(cell);
      let best: { a: number; b: number; d: number } | null = null;
      for (let a = 0; a < cols.length; a++) {
        for (let b = a; b < cols.length; b++) {
          const mid = (cols[a].left + cols[b].right) / 2;
          const width = cols[b].right - cols[a].left;
          const d = Math.abs(mid - cx);
          if (d > width * 0.3) continue;
          if (!best || b - a < best.b - best.a || (b - a === best.b - best.a && d < best.d)) best = { a, b, d };
        }
      }
      if (best) for (let i = best.a; i <= best.b; i++) labels[i].push(cell.str.trim());
    }
  }
  const header = labels.map((ls, i) => ls.join(" ") || `열${i + 1}`);

  // 데이터 행: 칸이 다 찬 줄은 순서대로, 모자란 줄은 윗행 셀이 줄바꿈된 것으로 보고 이어 붙인다
  const rows: string[][] = [];
  for (const l of dataLines) {
    if (l.cells.length === maxCells || rows.length === 0) {
      const row = cols.map(() => "");
      if (l.cells.length === maxCells) l.cells.forEach((c, i) => (row[i] = c.str.trim()));
      else for (const c of l.cells) row[colOf(c)] += (row[colOf(c)] ? " " : "") + c.str.trim();
      rows.push(row);
    } else {
      const row = rows[rows.length - 1];
      for (const c of l.cells) row[colOf(c)] += " " + c.str.trim();
    }
  }

  return [
    `| ${header.map(escapeCell).join(" | ")} |`,
    `| ${header.map(() => "---").join(" | ")} |`,
    ...rows.map((r) => `| ${r.map(escapeCell).join(" | ")} |`),
  ].join("\n");
}

/** 일반 줄들 → 문단. 줄 간격이 벌어지면 새 문단 */
function paragraphs(lines: Line[]): string[] {
  const out: string[] = [];
  let cur = "";
  let prev: Line | null = null;
  for (const l of lines) {
    const text = l.cells.map((c) => c.str).join("").trim();
    const last = prev?.cells[prev.cells.length - 1];
    const gap = prev ? prev.y - l.y : 0;
    if (prev && gap < l.size * 1.9 && last?.eol) {
      // 자동 줄바꿈 이어 붙이기. 한글-한글이면 단어 중간에서 끊겼을 가능성이 더 높아 붙인다
      cur += HANGUL.test(cur.slice(-1)) && HANGUL.test(text[0] ?? "") ? text : ` ${text}`;
    } else {
      if (cur) out.push(cur);
      cur = text;
    }
    prev = l;
  }
  if (cur) out.push(cur);
  return out;
}

export async function pdfToMarkdown(buf: Uint8Array): Promise<{ markdown: string; pages: number }> {
  const pdf = await getDocumentProxy(buf);
  const pageLines: Line[][] = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const tc = await (await pdf.getPage(p)).getTextContent();
    const items: Item[] = [];
    let lastEol: Item | null = null;
    for (const raw of tc.items) {
      if (!("str" in raw)) continue;
      // 빈 문자열 + hasEOL 은 "다음 줄로" 표시. 앞 조각에 붙여 둔다
      if (!raw.str.trim()) {
        if (raw.hasEOL && lastEol) lastEol.eol = true;
        continue;
      }
      const t = raw.transform as number[];
      const it: Item = { str: raw.str, x: t[4], y: t[5], w: raw.width, size: Math.round(Math.hypot(t[2], t[3]) * 10) / 10, eol: !!raw.hasEOL };
      items.push(it);
      lastEol = it;
    }
    pageLines.push(toLines(items));
  }

  const body = bodySize(pageLines.flat());
  const headingSizes = [...new Set(pageLines.flat().map((l) => l.size).filter((s) => s > body * 1.03))].sort((a, b) => b - a);

  const md: string[] = [];
  pageLines.forEach((lines, pi) => {
    md.push(`<!-- page:${pi + 1} -->`);
    let i = 0;
    let plain: Line[] = [];
    const flushPlain = () => {
      md.push(...paragraphs(plain));
      plain = [];
    };
    while (i < lines.length) {
      const l = lines[i];
      const level = headingSizes.indexOf(l.size);
      if (level >= 0 && l.cells.length === 1) {
        flushPlain();
        md.push(`${"#".repeat(Math.min(level + 1, 6))} ${l.cells[0].str.trim()}`);
        i++;
        continue;
      }
      if (l.cells.length >= 2) {
        let j = i;
        while (j < lines.length && lines[j].cells.length >= 2) j++;
        const table = tableToMarkdown(lines.slice(i, j));
        if (table) {
          flushPlain();
          md.push(table);
          i = j;
          continue;
        }
      }
      plain.push(l);
      i++;
    }
    flushPlain();
  });

  return { markdown: md.join("\n\n"), pages: pdf.numPages };
}
