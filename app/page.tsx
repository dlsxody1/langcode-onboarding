import Link from "next/link";
import { Masthead } from "./components/Masthead";
import { CoverStats } from "./components/CoverStats";
import { CHAPTERS } from "@/lib/content";
import { topicsForChapter } from "@/data/questions";

export default function Home() {
  return (
    <>
      <Masthead />
      <main className="cover">
        <div className="cover__rule">
          <h1>
            랭코드
            <br />
            온보딩 준비
          </h1>
          <p className="cover__lede">
            첫 2주 동안 남의 코드를 읽고 고칠 수 있는 상태를 만드는 게 목표다.
            면접 자료가 아니다.
          </p>
        </div>

        <CoverStats />

        <nav className="gateway">
          <Link className="gateway__card" href="/docs">
            <span className="gateway__no">공부</span>
            <span className="gateway__t">문서를 순서대로 읽는다</span>
            <span className="gateway__d">6챕터 23편. 하루 1~2편이면 입사 전에 끝난다.</span>
          </Link>
          <Link className="gateway__card" href="/quiz">
            <span className="gateway__no">문제</span>
            <span className="gateway__t">주제별로 확인한다</span>
            <span className="gateway__d">18주제 67문항. 한 주제 3~6문항, 힌트와 해설이 붙는다.</span>
          </Link>
        </nav>

        <h2 className="cover__h2">차례</h2>
        <div className="chapters">
          {CHAPTERS.map((c) => {
            const tn = topicsForChapter(c.id).length;
            return (
              <Link className="chapter-row" href={`/docs/${c.id}/${c.docs[0].slug}`} key={c.id}>
                <span className="chapter-row__no">{c.no}</span>
                <span>
                  <span className="chapter-row__title">{c.title}</span>
                  <p className="chapter-row__blurb">{c.blurb}</p>
                </span>
                <span className="chapter-row__meta">
                  <b>{c.docs.length}편</b>
                  {tn}주제
                </span>
              </Link>
            );
          })}
        </div>

        <p className="note" style={{ marginTop: "2.2rem", maxWidth: "48ch" }}>
          진도와 오답은 이 브라우저에만 저장된다. 서버도 계정도 없다.
          기기를 옮기면 처음부터다.
        </p>
      </main>
    </>
  );
}
