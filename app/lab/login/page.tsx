import type { Metadata } from "next";
import { Masthead } from "@/app/components/Masthead";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = { title: "실습 로그인" };

export default async function LabLoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <>
      <Masthead />
      <main className="quiz lab">
        <header className="quiz__head">
          <span className="qcount">실습 3</span>
          <h1>사내 도우미 로그인</h1>
          <p>
            초대받은 계정만 들어올 수 있다. 회원가입은 없다 — 계정은 Supabase 대시보드에서 만든다.
          </p>
        </header>
        <LoginForm next={next ?? "/lab"} />
      </main>
    </>
  );
}
