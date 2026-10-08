import type { Metadata } from "next";
import { Masthead } from "@/app/components/Masthead";
import { getDoc } from "@/lib/chapters";
import { GLOSSARY } from "@/lib/glossary";
import { GlossarySearch, type GlossaryItem } from "./GlossarySearch";

export const metadata: Metadata = { title: "용어 사전" };

const CHOSEONG = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ";
const MERGE: Record<string, string> = { ㄲ: "ㄱ", ㄸ: "ㄷ", ㅃ: "ㅂ", ㅆ: "ㅅ", ㅉ: "ㅈ" };

/** 가나다는 초성으로, 영문은 첫 글자로 묶는다 */
function initialOf(term: string) {
  const c = term.trim()[0] ?? "#";
  const code = c.charCodeAt(0);
  if (code >= 0xac00 && code <= 0xd7a3) {
    const ch = CHOSEONG[Math.floor((code - 0xac00) / 588)];
    return MERGE[ch] ?? ch;
  }
  if (/[a-z]/i.test(c)) return c.toUpperCase();
  return "#";
}

export default function GlossaryPage() {
  // 문서 목록은 서버에서 한 번만 풀어서 클라이언트로 넘긴다
  const items: GlossaryItem[] = GLOSSARY.map((g) => {
    const [chapterId, slug] = g.doc.split("/");
    const found = getDoc(chapterId, slug);
    return {
      id: g.id,
      term: g.term,
      aliases: g.aliases,
      def: g.def,
      initial: initialOf(g.term),
      docHref: found ? `/docs/${found.chapter.id}/${found.doc.slug}` : null,
      docLabel: found ? `${found.chapter.no} · ${found.doc.title}` : null,
    };
  });

  return (
    <>
      <Masthead />
      <main className="quiz glossary">
        <header className="quiz__head">
          <span className="qcount">{GLOSSARY.length} 개</span>
          <h1>용어 사전</h1>
          <p>
            본문에서 점선 밑줄이 그어진 말에 마우스를 올리면 이 풀이가 뜬다. 아래에서 찾고 싶은 말을 검색하면 바로 나온다.
          </p>
        </header>

        <GlossarySearch items={items} />
      </main>
    </>
  );
}
