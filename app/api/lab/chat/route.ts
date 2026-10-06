import { NextResponse } from "next/server";
import { createClient, currentUser } from "@/lib/supabase/server";
import { getChunksByIds, normalizeQuery, search, skipAudienceFilterForExperiment, MAX_QUERY_CHARS } from "@/lib/rag/search";

const TOP_K = 5;

/**
 * 4단계: 검색만 한다. 답변 생성(6단계)과 스트리밍(7단계)은 아직 없다.
 * 응답: { query, audience, evidence[], warnings[] }
 */
export async function POST(request: Request) {
  // 미들웨어만 믿지 않는다. 서버에서 getUser() 로 다시 확인
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다" }, { status: 401 });
  if (!user.audience) return NextResponse.json({ error: "프로필(audience)이 없어 검색할 수 없습니다" }, { status: 403 });

  const body = await request.json().catch(() => null);
  const query = normalizeQuery(body?.query);
  if (!query) return NextResponse.json({ error: `질문은 1~${MAX_QUERY_CHARS}자로 입력하세요` }, { status: 400 });

  const started = performance.now();
  // audience 는 클라이언트가 보낸 값이 아니라 profiles 에서 읽은 값만 쓴다
  const hits = search(query, user.audience, TOP_K);
  const supabase = (await createClient())!;
  const { evidence, warnings } = await getChunksByIds(supabase, hits);
  if (skipAudienceFilterForExperiment) warnings.unshift("⚠ 실험 모드: 1차 권한 필터가 꺼져 있습니다 (LAB_UNSAFE_SKIP_PREFILTER=1)");

  return NextResponse.json({
    query,
    audience: user.audience,
    evidence,
    warnings,
    ms: Math.round(performance.now() - started),
  });
}
