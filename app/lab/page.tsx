import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Masthead } from "@/app/components/Masthead";
import { currentUser } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "실습" };
// 사용자마다 다른 화면이다. env 가 없는 빌드에서도 정적 페이지로 굳지 않게
export const dynamic = "force-dynamic";

const AUDIENCE_LABEL = { employee: "임직원", customer: "고객" } as const;

export default async function LabPage() {
  // 미들웨어가 이미 막았지만 페이지에서도 다시 확인한다
  const user = await currentUser();
  if (!user) redirect("/lab/login");

  return (
    <>
      <Masthead />
      <main className="quiz lab">
        <header className="quiz__head lab__head">
          <div>
            <span className="qcount">실습 3 · 미니 사내 RAG</span>
            <h1>랭코드 가상법인 · 사내 도우미</h1>
          </div>
          <div className="lab__who">
            <span className="lab__badge" data-audience={user.audience ?? "none"}>
              {user.audience ? AUDIENCE_LABEL[user.audience] : "프로필 없음"}
            </span>
            <span className="note">{user.displayName ?? user.email}</span>
            <form action="/lab/signout" method="post">
              <button className="btn btn--ghost lab__out" type="submit">
                로그아웃
              </button>
            </form>
          </div>
        </header>

        {!user.audience && (
          <p className="empty">
            <strong>profiles 행이 없습니다</strong>
            SQL 에디터에서 <code>labs/lab3-rag/supabase/seed.sql</code> 을 이 계정 id 로 실행하세요. 그 전에는 어떤 문서도 검색되지 않습니다.
          </p>
        )}

        <form className="lab-ask" aria-disabled="true">
          <input type="text" placeholder="온보딩 문서에 대해 물어보세요 — 4단계 이후 연결" disabled />
          <button className="btn" type="submit" disabled>
            보내기
          </button>
        </form>
        <p className="note">
          0단계: 로그인 게이트만 동작한다. 검색·답변은 <code>labs/lab3-rag/PLAN.md</code> 4·6단계에서 붙는다.
        </p>
      </main>
    </>
  );
}
