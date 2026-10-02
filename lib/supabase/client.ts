"use client";

import { createBrowserClient } from "@supabase/ssr";
import { supabaseEnv } from "./env";

/** 브라우저용. 지금은 쓰는 곳이 없다 — 로그인은 서버 액션으로 처리한다. */
export function createClient() {
  const env = supabaseEnv();
  if (!env) throw new Error("Supabase 환경 변수가 없습니다 (.env.local.example 참고)");
  return createBrowserClient(env.url, env.key);
}
