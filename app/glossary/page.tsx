import Link from "next/link";
import type { Metadata } from "next";
import { Masthead } from "@/app/components/Masthead";
import { getDoc } from "@/lib/chapters";
import { GLOSSARY, type GlossaryEntry } from "@/lib/glossary";

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
  const groups = new Map<string, GlossaryEntry[]>();
  for (const g of GLOSSARY) {
    const k = initialOf(g.term);
    groups.set(k, [...(groups.get(k) ?? []), g]);
  }
  // 한글 초성 먼저, 그다음 영문, 기호
  const keys = [...groups.keys()].sort((a, b) => {
    const rank = (k: string) => (/[ㄱ-ㅎ]/.test(k) ? 0 : /[A-Z]/.test(k) ? 1 : 2);
    return rank(a) - rank(b) || a.localeCompare(b, "ko");
  });

  return (
    <>
      <Masthead />
      <main className="quiz glossary">
        <header className="quiz__head">
          <span className="qcount">{GLOSSARY.length} 개</span>
          <h1>용어 사전</h1>
          <p>
            본문에서 점선 밑줄이 그어진 말에 마우스를 올리면 이 풀이가 뜬다. 문서마다 처음 나올 때 한 번만 표시한다.
          </p>
        </header>

        {keys.length > 0 && (
          <nav className="glossary__index" aria-label="초성 색인">
            {keys.map((k) => (
              <a key={k} href={`#idx-${k}`}>
                {k}
              </a>
            ))}
          </nav>
        )}

        {keys.map((k) => (
          <section key={k} className="glossary__group" aria-labelledby={`idx-${k}`}>
            <h2 id={`idx-${k}`}>{k}</h2>
            <dl>
              {groups.get(k)!.map((g) => {
                const [chapterId, slug] = g.doc.split("/");
                const found = getDoc(chapterId, slug);
                return (
                  <div key={g.id} id={g.id} className="glossary__item">
                    <dt>{g.term}</dt>
                    <dd>
                      {g.def}
                      {found && (
                        <Link href={`/docs/${found.chapter.id}/${found.doc.slug}`}>
                          {found.chapter.no} · {found.doc.title} →
                        </Link>
                      )}
                    </dd>
                  </div>
                );
              })}
            </dl>
          </section>
        ))}
      </main>
    </>
  );
}
