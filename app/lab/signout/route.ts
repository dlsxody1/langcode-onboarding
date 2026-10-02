import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  await supabase?.auth.signOut();
  // 303: POST 뒤 GET 으로 이동
  return NextResponse.redirect(new URL("/lab/login", request.url), { status: 303 });
}
