import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { marked } from "marked";
import { Masthead } from "@/app/components/Masthead";
import { createClient, currentUser } from "@/lib/supabase/server";
import { loadIndex } from "@/lib/rag/search";
import { ScrollToHighlight } from "./ScrollToHighlight";

export const metadata: Metadata = { title: "사내 문서" };
export const dynamic = "force-dynamic";

type ChunkRow = { chunk_id: string; heading_path: string[]; anchor: string | null; page: number | null; text: string };

/**
 * 가상 사내 문서 뷰어. 근거 카드의 "원문 보기"가 여기로 온다 (#앵커 + ?hl=청크 강조).
 *
 * 권한 확인은 서버에서: 사용자 세션으로 documents·chunks 를 읽으므로 RLS 가 막는다.
 * 고객이 /lab/docs/security-policy-v4.2 를 직접 쳐도 documents 가 0행 → "볼 수 없는 문서".
 * "없는 문서"와 "권한 없는 문서"를 구분해 보여 주지 않는다 — 구분하면 문서가 있다는 사실 자체가 새기 때문이다.
 */
export default async function InternalDocPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ hl?: string }> }) {
  const user = await currentUser();
  if (!user) redirect("/lab/login");
  const { slug } = await params;
  const { hl } = await searchParams;
  const supabase = (await createClient())!;
  const docId = `internal/${slug}`;

  const { data: doc } = await supabase
    .from("documents")
    .select("doc_id, title, version, effective_date, status, audience, storage_path, format")
    .eq("doc_id", docId)
    .maybeSingle();

  if (!doc) {
    return (
      <>
        <Masthead />
        <main className="quiz lab">
          <p className="empty">
            <strong>볼 수 없는 문서예요</strong>
            문서가 없거나, 지금 계정의 열람 범위 밖입니다. <Link href="/lab">사내 도우미로 돌아가기</Link>
          </p>
        </main>
      </>
    );
  }

  const { data } = await supabase.from("chunks").select("chunk_id, heading_path, anchor, page, text").eq("doc_id", docId);
  // DB 에는 순서 칼럼이 없다. 색인의 청크 순서가 곧 문서 순서다
  const order = new Map(loadIndex().chunks.map((c, i) => [c.id, i]));
  const chunks = ((data ?? []) as ChunkRow[]).sort((a, b) => (order.get(a.chunk_id) ?? 0) - (order.get(b.chunk_id) ?? 0));

  let lastAnchor: string | null | undefined;
  let lastTop: string | undefined;

  return (
    <>
      <Masthead />
      <main className="quiz lab lab-doc">
        <header className="quiz__head">
          <span className="qcount">
            가상 사내 문서 · {doc.format.toUpperCase()}
            {doc.version ? ` · v${doc.version}` : ""}
            {doc.effective_date ? ` · 시행 ${doc.effective_date}` : ""}
          </span>
          <h1>{doc.title}</h1>
          <p>
            {doc.status === "superseded" && <span className="source__flag">폐지된 버전</span>} 열람 범위: {(doc.audience as string[]).map((a) => (a === "employee" ? "임직원" : "고객")).join(" · ")} ·{" "}
            {doc.storage_path && <a href={`/lab/docs/${slug}/download`}>원본 파일 내려받기 ↓</a>} · <Link href="/lab">← 사내 도우미</Link>
          </p>
        </header>

        <article className="prose">
          {chunks.map((c) => {
            const out: React.ReactNode[] = [];
            if (c.anchor !== lastAnchor) {
              const [top, ...rest] = c.heading_path;
              if (rest.length && top !== lastTop) out.push(<h2 key={`h2-${c.chunk_id}`}>{top}</h2>);
              const label = c.heading_path[c.heading_path.length - 1];
              if (label) {
                const H = rest.length ? "h3" : "h2";
                out.push(<H key={`h-${c.chunk_id}`} id={c.anchor ?? undefined}>{label}</H>);
              }
              lastAnchor = c.anchor;
              lastTop = top;
            }
            out.push(
              <div
                key={c.chunk_id}
                className="lab-doc__chunk"
                data-hl={c.chunk_id === hl}
                title={`${c.chunk_id}${c.page ? ` · p.${c.page}` : ""}`}
                // "09~13시" 의 ~ 가 취소선(~텍스트~)으로 읽히지 않게 이스케이프한다
                dangerouslySetInnerHTML={{ __html: marked.parse(c.text.replace(/~/g, "\\~"), { breaks: true, async: false }) as string }}
              />,
            );
            return out;
          })}
        </article>
        {hl && <ScrollToHighlight />}
      </main>
    </>
  );
}
