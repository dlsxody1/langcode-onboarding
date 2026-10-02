import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { supabaseEnv } from "@/lib/supabase/env";

/**
 * 실습 탭 로그인 게이트. matcher 로 /lab, /api/lab 에만 걸린다.
 * 나머지 탭은 이 파일을 거치지 않는다 — Supabase 가 멈춰도 공부는 계속할 수 있게.
 * 여기서 막아도 API · 페이지에서 getUser() 로 한 번 더 확인한다 (미들웨어만 믿지 않음).
 */
export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isApi = pathname.startsWith("/api/");
  const isPublic = pathname === "/lab/login";

  const env = supabaseEnv();
  if (!env) {
    const msg = "실습 탭을 쓰려면 Supabase 환경 변수가 필요합니다. labs/lab3-rag/README.md 를 보세요.";
    return isApi
      ? NextResponse.json({ error: msg }, { status: 503 })
      : new NextResponse(msg, { status: 503, headers: { "content-type": "text/plain; charset=utf-8" } });
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient(env.url, env.key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
      },
    },
  });

  // getUser() 는 만료된 토큰을 갱신하고, 갱신된 쿠키는 위 setAll 로 응답에 실린다
  const { data: { user } } = await supabase.auth.getUser();

  if (!user && !isPublic) {
    if (isApi) return NextResponse.json({ error: "로그인이 필요합니다" }, { status: 401 });
    const url = request.nextUrl.clone();
    url.pathname = "/lab/login";
    url.search = `?next=${encodeURIComponent(pathname)}`;
    return NextResponse.redirect(url);
  }

  if (user && isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/lab";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: ["/lab", "/lab/:path*", "/api/lab/:path*"],
};
