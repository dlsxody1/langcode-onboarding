import { NextResponse } from "next/server";
import { currentUser } from "@/lib/supabase/server";

export async function POST() {
  // 미들웨어만 믿지 않는다. 서버에서 getUser() 로 다시 확인
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다" }, { status: 401 });

  return NextResponse.json(
    { error: "아직 구현되지 않았습니다 (PLAN.md 8단계)", audience: user.audience },
    { status: 501 },
  );
}
