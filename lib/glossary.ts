import GLOSSARY_DATA from "@/data/glossary.json";

export type GlossaryEntry = {
  id: string;
  term: string;
  /** 본문에서 찾을 표기. 한국어는 조사가 붙어도 잡히고, 영문은 단어 경계로 자른다 */
  aliases: string[];
  def: string;
  /** "<chapter-id>/<doc-slug>" — 그 용어를 가장 자세히 다루는 문서 */
  doc: string;
};

export const GLOSSARY: GlossaryEntry[] = (GLOSSARY_DATA as GlossaryEntry[])
  .slice()
  .sort((a, b) => a.term.localeCompare(b.term, "ko"));

const BY_ALIAS = new Map<string, GlossaryEntry>();
for (const g of GLOSSARY) {
  for (const a of [g.term, ...g.aliases]) {
    if (a.trim().length >= 2 && !BY_ALIAS.has(a)) BY_ALIAS.set(a, g);
  }
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// 긴 표기부터 시도해야 "코사인 유사도" 가 "유사도" 보다 먼저 잡힌다.
// 앞쪽 경계: 글자·숫자 바로 뒤에서는 시작하지 않는다 ("분산캐시" 의 "캐시" 는 건너뜀).
// 뒤쪽 경계: 영문·숫자로 끝나는 표기만 막는다. 한국어 표기 뒤에는 조사가 붙어야 하므로 열어 둔다.
const ALIAS_RE = new RegExp(
  [...BY_ALIAS.keys()]
    .sort((a, b) => b.length - a.length)
    .map((a) => {
      const tail = /[A-Za-z0-9]$/.test(a) ? "(?![A-Za-z0-9])" : "";
      return `(?<![\\p{L}\\p{N}])${escapeRe(escapeHtml(a))}${tail}`;
    })
    .join("|"),
  "gu",
);

/** 이 태그 안의 글자는 건드리지 않는다. 링크·코드·제목 안에 툴팁을 넣으면 클릭과 앵커가 꼬이고, 표는 가로 스크롤 컨테이너가 툴팁을 잘라 먹는다 */
const SKIP = new Set(["a", "code", "pre", "h1", "h2", "h3", "h4", "h5", "h6", "table", "script", "style"]);

function tooltip(word: string, g: GlossaryEntry) {
  const tipId = `gl-${g.id}`;
  return (
    `<span class="term" tabindex="0" aria-describedby="${tipId}">${word}` +
    `<span class="term__tip" role="tooltip" id="${tipId}">` +
    `<strong>${escapeHtml(g.term)}</strong>${escapeHtml(g.def)}` +
    `<a href="/glossary#${g.id}">용어 사전 →</a>` +
    `</span></span>`
  );
}

/**
 * 렌더된 문서 HTML 에서, 사전에 있는 용어가 문서 안에서 처음 나오는 곳 한 번만 툴팁으로 감싼다.
 * 매번 감싸면 문단이 밑줄투성이가 되어 오히려 읽기 어렵다.
 */
export function annotateGlossary(html: string): string {
  if (BY_ALIAS.size === 0) return html;
  const used = new Set<string>();
  let skipDepth = 0;

  return html
    .split(/(<[^>]+>)/)
    .map((part) => {
      if (part.startsWith("<")) {
        const m = part.match(/^<(\/?)([a-zA-Z0-9]+)/);
        if (m && SKIP.has(m[2].toLowerCase()) && !part.endsWith("/>")) {
          skipDepth += m[1] ? -1 : 1;
        }
        return part;
      }
      if (skipDepth > 0 || !part.trim()) return part;

      return part.replace(ALIAS_RE, (word) => {
        const g = BY_ALIAS.get(word.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"'));
        if (!g || used.has(g.id)) return word;
        used.add(g.id);
        return tooltip(word, g);
      });
    })
    .join("");
}
