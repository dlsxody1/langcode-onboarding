import { NextResponse } from "next/server";
import { createClient, currentUser } from "@/lib/supabase/server";

/**
 * 원본 파일 내려받기. 버킷은 비공개라 직접 링크가 없다.
 * 사용자 세션으로 documents 를 읽고(RLS), Storage 정책("볼 수 있는 문서의 원본만")을 통과해야 서명 URL 이 나온다.
 * 서명 URL 은 60초 뒤 만료 — 링크가 밖으로 퍼져도 오래 쓰지 못한다.
 */
export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다" }, { status: 401 });

  const { slug } = await params;
  const supabase = (await createClient())!;
  const { data: doc } = await supabase.from("documents").select("storage_path").eq("doc_id", `internal/${slug}`).maybeSingle();
  if (!doc?.storage_path) return NextResponse.json({ error: "볼 수 없는 문서입니다" }, { status: 403 });

  const { data, error } = await supabase.storage.from("originals").createSignedUrl(doc.storage_path, 60, { download: true });
  if (error || !data) return NextResponse.json({ error: "볼 수 없는 문서입니다" }, { status: 403 });

  return NextResponse.redirect(data.signedUrl, { status: 303 });
}
