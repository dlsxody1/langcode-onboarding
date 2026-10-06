/**
 * 6단계 답변 만들기. 서버(app/api/lab/chat)와 평가(scripts/eval.mts)가 함께 쓴다 — 의존성 없이 둔다.
 *
 *   assess()            "문서에서 찾지 못했어요" 판단. 리랭크 점수는 후보끼리의 상대값이라 못 쓴다 (RESULTS 5단계 6번)
 *                       → 절대 신호: 질의 단어가 상위 청크에 얼마나 들어 있나. 단어마다 희귀도(IDF)로 가중
 *   extractiveAnswer()  모드 A 추출형 (LLM 없음). 1·2위 청크에서 질의 단어가 가장 많이 든 문장·행 1~3개 + [n]
 *   buildContext()      모드 B 생성형(LLM)에 넣을 컨텍스트. 임계값 → 예산 2,000자 → 1·2위를 양 끝에 → [n] (문서 > 절) 마커
 *   parseCitations()    답변의 [n] 을 근거 번호와 맞춘다. 없는 번호는 경고
 */
import type { Bm25Index } from "./bm25.ts";

export type Source = {
  chunkId: string;
  title: string;
  headingPath: string[];
  text: string;
  kind: "text" | "table";
};

// 판단에서 빼는 흔한 말 (질의 쪽만). 색인·검색에는 영향 없다
const STOP = new Set(
  ("해 돼 뭐 왜 꼭 좀 거 것 수 더 잘 뭘 때 등 있어 있나 있나요 되나요 돼요 해요 해야 하는 하면 어떻게 얼마 얼마야 얼마나 까지 " +
    "거야 건가 정확히 그럼 그건 나와 써야 되는 무엇 무엇이 언제 어디 회사 회사가 회사에서 이거 저거 그거 할 하나 있는 없는 다음 중 " +
    "것은 이유는 이유로 가장 알려줘 알려주세요 궁금해 주세요 해줘 인가요 인가 뭐야 뭔가요 맞아 맞나요 " +
    // 요청 표현: 무엇을 해 달라는 말이지 무엇에 관한 말이 아니다
    "우리 우리회사 저희 사내 요약 요약해 정리 정리해 설명 설명해 알려 the is a").split(" "),
);
const WORD = /[a-z0-9]+|[가-힣]+/g;

/**
 * 형태소 분석기 흉내: 흔한 의문형·구어 어미를 뗀다. "주냐" → "주", "있나요" → "있".
 * 안 떼면 "주냐" 같은 말이 색인에 없는 드문 단어로 보여 가장 큰 가중치를 받고, 그게 빠졌다고 "찾지 못함"이 된다.
 * 진짜 해법은 형태소 분석(Kiwi, Azure AI Search 의 ko.microsoft 같은 분석기)으로 어간을 원형으로 되돌리는 것 — 10단계 후보.
 */
const ENDING = /(?:나요|까요|니까|냐고|래요|대요|세요|해줘|해봐|냐|니|나|까|죠|지|줘|봐|요|야|래|대)$/;

function stem(w: string) {
  if (!/^[가-힣]{2,}$/.test(w)) return w;
  const s = w.replace(ENDING, "");
  return s.length >= 1 ? s : w;
}

export function queryWords(query: string) {
  return [...new Set((query.toLowerCase().match(WORD) ?? []).map(stem).filter((w) => w.length >= 2 && !STOP.has(w)))];
}

/**
 * 조사·어미가 붙은 단어도 맞힌 것으로 친다.
 *   문서 쪽에 붙은 경우: 질의 "숙박비" ↔ 문서 "숙박비는"  (문서 단어가 질의 단어로 시작)
 *   질의 쪽에 붙은 경우: 질의 "경조금하면" ↔ 문서 "경조금"  (질의 단어가 문서 단어로 시작, 문서 단어가 절반 이상 길이)
 */
function present(word: string, hay: Set<string>) {
  for (const h of hay) {
    if (h.startsWith(word) || (word.length >= 3 && h.startsWith(word.slice(0, -1)))) return true;
    if (h.length >= 2 && h.length * 2 >= word.length && word.startsWith(h)) return true;
  }
  return false;
}

/** 단어의 희귀도. 한글 단어가 그 모양 그대로 색인에 없으면 앞 두 글자(bigram)로 본다. 아예 없으면 최대값 */
export function idfOf(index: Bm25Index, word: string) {
  const n = index.meta.n;
  const key = /^[가-힣]{3,}$/.test(word) && !Object.hasOwn(index.postings, word) ? word.slice(0, 2) : word;
  const df = Object.hasOwn(index.postings, key) ? index.postings[key].length / 2 : 0;
  return Math.log(1 + (n - df + 0.5) / (df + 0.5));
}

export const COVERAGE_THRESHOLD = 0.4;

/**
 * 상위 3개 근거에 질의 단어가 IDF 가중으로 40% 미만 들어 있으면 "찾지 못함".
 * 평가셋에서: 정답을 맞힌 118문항 중 잘못 거르는 것 3개, 어디에도 없는 질문 2개는 모두 거름 (RESULTS 6단계)
 */
export function assess(index: Bm25Index, query: string, sources: Source[], applied: { variant: string; canonical: string }[] = []) {
  // 용어 사전으로 바꾼 표현은 대표어로 바꿔 놓고 잰다. "바꿔야" 가 문서에 없어도 대표어 "변경" 이 있으면 맞힌 것
  let q = query.toLowerCase();
  for (const a of applied) q = q.split(a.variant.toLowerCase()).join(a.canonical);
  const words = queryWords(q);
  const hay = new Set(sources.slice(0, 3).flatMap((s) => `${s.title} ${s.headingPath.join(" ")} ${s.text}`.toLowerCase().match(WORD) ?? []));
  const weights = words.map((w) => ({ w, idf: idfOf(index, w), hit: present(w, hay) }));
  const total = weights.reduce((s, x) => s + x.idf, 0);
  const coverage = total ? weights.filter((x) => x.hit).reduce((s, x) => s + x.idf, 0) / total : 0;
  return {
    found: sources.length > 0 && coverage >= COVERAGE_THRESHOLD,
    coverage,
    missing: weights.filter((x) => !x.hit).sort((a, b) => b.idf - a.idf).map((x) => x.w),
  };
}

/** 마크다운 꾸밈을 걷어 낸 한 줄 */
function plain(line: string) {
  return line
    .replace(/^\s*(?:[-*]|\d+\.)\s+/, "")
    .replace(/^#+\s*/, "")
    .replace(/^>\s?/, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .trim();
}

/** 표를 편 행: "열: 값 | 열: 값" (파서가 만든 모양) */
const TABLE_ROW = /^[^|\n]{1,40}: .+ \| [^|\n]{1,40}: /;

/** 근거 하나를 답변 후보 단위로 쪼갠다: 표는 행, 목록은 항목, 문단은 문장. 코드 블록은 뺀다 */
function units(s: Source): { u: string; row: boolean }[] {
  const out: { u: string; row: boolean }[] = [];
  let inCode = false;
  for (const raw of s.text.split("\n")) {
    if (raw.trim().startsWith("```")) {
      inCode = !inCode;
      continue;
    }
    if (inCode || !raw.trim()) continue;
    if (TABLE_ROW.test(raw)) out.push({ u: raw.trim(), row: true });
    else if (/^\s*(?:[-*]|\d+\.)\s/.test(raw)) out.push({ u: plain(raw), row: false });
    else for (const u of plain(raw).split(/(?<=[다요음함임됨][.]|[?!])\s+/)) out.push({ u, row: false });
  }
  // 표 캡션("[표 1] ...")은 답이 아니다
  return out.filter((x) => x.u.length >= 6 && !/^\[?표\s*\d+/.test(x.u));
}

/**
 * 모드 A 추출형. LLM 없이 근거 문장을 그대로 옮긴다 — 지어낼 수가 없어서 환각이 0 이다. 대신 문장이 매끄럽지 않다.
 * 1위 근거에서 가장 질의에 맞는 단위 1개 + (새 질의 단어를 더하는) 1·2위의 단위 최대 2개, 합쳐 400자 이내.
 */
export function extractiveAnswer(index: Bm25Index, query: string, sources: Source[]): string {
  const words = queryWords(query);
  const idf = new Map(words.map((w) => [w, idfOf(index, w)]));
  // 표의 행은 숫자를 묻는 질문일 때만 앞세운다. 아니면 "코사인 유사도: 0.981" 같은 예시 표가 설명 문장을 이긴다
  const asksNumber = /얼마|며칠|몇|금액|한도|상한|비용|요금|일비|숙박비|기간|횟수|시간/.test(query);
  const scored = sources.slice(0, 2).flatMap((s, si) => {
    // 절 제목에서 맞은 단어는 그 절의 모든 문장에 절반 점수. "### 연차휴가" 아래 항목들에는 "연차"라는 글자가 없다
    const head = new Set(`${s.title} ${s.headingPath.join(" ")}`.toLowerCase().match(WORD) ?? []);
    const headHits = words.filter((w) => present(w, head));
    return units(s).map(({ u, row }, ui) => {
      const hay = new Set(u.toLowerCase().match(WORD) ?? []);
      const hits = words.filter((w) => present(w, hay));
      const fromHead = headHits.filter((w) => !hits.includes(w));
      const tableFactor = row && !asksNumber ? 0.7 : 1;
      const numberBonus = asksNumber && /\d/.test(u) ? 1.2 : 1;
      const raw = hits.reduce((a, w) => a + idf.get(w)!, 0) + 0.5 * fromHead.reduce((a, w) => a + idf.get(w)!, 0);
      const score = raw * (si === 0 ? 1.15 : 1) * tableFactor * numberBonus - u.length / 2000;
      return { u, n: si + 1, ui, hits, score, src: s };
    });
  });
  scored.sort((a, b) => b.score - a.score);
  if (!scored.length || scored[0].score <= 0) return "";

  // 1등 문장이 본문에서는 하나도 안 맞고 제목 덕분에 이겼다면, 그 절이 통째로 답이다 → 절 앞부분을 순서대로
  if (scored[0].hits.length === 0) {
    const best = scored[0];
    const own = scored.filter((x) => x.n === best.n).sort((a, b) => a.ui - b.ui);
    const out: string[] = [];
    let chars = 0;
    for (const x of own) {
      if (out.length >= 3 || chars + x.u.length > 400) break;
      out.push(`${x.u} [${x.n}]`);
      chars += x.u.length;
    }
    return out.join("\n");
  }

  const picked = [scored[0]];
  const covered = new Set(scored[0].hits);
  let chars = scored[0].u.length;
  for (const c of scored.slice(1)) {
    if (picked.length >= 3 || chars + c.u.length > 400) continue;
    if (c.score < scored[0].score * 0.5 || !c.hits.some((w) => !covered.has(w))) continue;
    picked.push(c);
    c.hits.forEach((w) => covered.add(w));
    chars += c.u.length;
  }
  // 원문 순서를 지키려고 근거 번호 → 원래 위치 순으로 정렬
  picked.sort((a, b) => a.n - b.n);
  return picked.map((p) => `${p.u} [${p.n}]`).join("\n");
}

/**
 * 모드 B(생성형 LLM)용 컨텍스트. 지금은 키가 없어 쓰지 않지만, 넣을 모양을 고정해 둔다.
 * Lost in the middle: 1위·2위를 맨 앞과 맨 뒤에 둔다. 예산을 넘는 근거는 넣지 않는다.
 */
export function buildContext(sources: Source[], budget = 2000) {
  const used: { n: number; s: Source }[] = [];
  let chars = 0;
  sources.forEach((s, i) => {
    const block = s.text.length + 40;
    if (chars + block <= budget) {
      used.push({ n: i + 1, s });
      chars += block;
    }
  });
  const ordered = used.length > 2 ? [used[0], ...used.slice(2), used[1]] : used;
  return ordered.map(({ n, s }) => `[${n}] (${[s.title, ...s.headingPath].join(" > ")})\n${s.text}`).join("\n\n");
}

/** 답변의 [n] 을 근거와 맞춘다. 근거에 없는 번호는 unknown 으로 돌려 경고에 쓴다 */
export function parseCitations(answer: string, sourceCount: number) {
  const nums = [...answer.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1]));
  const cited = [...new Set(nums)].filter((n) => n >= 1 && n <= sourceCount).sort((a, b) => a - b);
  const unknown = [...new Set(nums)].filter((n) => n < 1 || n > sourceCount);
  return { cited, unknown };
}
