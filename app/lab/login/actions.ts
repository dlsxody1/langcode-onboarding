"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type LoginState = { error: string | null };

/** 이메일 + 비밀번호 로그인. 회원가입은 없다 — 계정은 대시보드에서만 만든다 (초대 전용). */
export async function login(_prev: LoginState, form: FormData): Promise<LoginState> {
  const supabase = await createClient();
  if (!supabase) return { error: "Supabase 환경 변수가 설정되지 않았습니다." };

  const email = String(form.get("email") ?? "").trim();
  const password = String(form.get("password") ?? "");
  if (!email || !password) return { error: "이메일과 비밀번호를 입력하세요." };

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  // 어느 쪽이 틀렸는지 알려 주지 않는다 (계정 존재 여부 노출 방지)
  if (error) return { error: "이메일 또는 비밀번호가 맞지 않습니다." };

  // 열린 리다이렉트 방지: 실습 탭 안쪽 경로만 허용
  const next = String(form.get("next") ?? "");
  redirect(next.startsWith("/lab") && !next.startsWith("//") ? next : "/lab");
}
