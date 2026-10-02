import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { supabaseEnv } from "./env";

/** 서버 컴포넌트 · 서버 액션 · Route Handler 용. 사용자 세션(쿠키)으로 접근하므로 RLS 가 적용된다. */
export async function createClient() {
  const env = supabaseEnv();
  if (!env) return null;
  const cookieStore = await cookies();

  return createServerClient(env.url, env.key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) cookieStore.set(name, value, options);
        } catch {
          // 서버 컴포넌트에서는 쿠키를 쓸 수 없다. 세션 갱신은 middleware 가 맡는다.
        }
      },
    },
  });
}

export type Audience = "employee" | "customer";

/**
 * 지금 요청의 사용자와 audience.
 * getSession() 이 아니라 getUser() — 쿠키 값을 그대로 믿지 않고 Supabase Auth 서버에 검증한다.
 * audience 는 언제나 profiles 에서 읽는다. 클라이언트가 보낸 값은 쓰지 않는다.
 */
export async function currentUser() {
  const supabase = await createClient();
  if (!supabase) return null;

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name, audience")
    .eq("id", user.id)
    .maybeSingle();

  return {
    id: user.id,
    email: user.email ?? "",
    displayName: (profile?.display_name as string | null) ?? null,
    // 프로필이 없으면 audience 도 없다 — 아무 문서도 못 보는 쪽이 안전하다
    audience: (profile?.audience as Audience | undefined) ?? null,
  };
}
