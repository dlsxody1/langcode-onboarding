/**
 * Supabase 접속 정보. 실습 탭에서만 쓴다.
 * 값이 없어도 사이트 빌드는 성공해야 한다 — 공부·문제·오답·용어 탭은 Supabase 와 무관하다.
 * 키는 신규 이름(publishable)과 구 이름(anon) 둘 다 받는다. 둘 다 브라우저에 노출돼도 되는 키다.
 * service_role 키는 여기서 절대 읽지 않는다 (로컬·CI 동기화 스크립트 전용).
 */
export function supabaseEnv(): { url: string; key: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return url && key ? { url, key } : null;
}
