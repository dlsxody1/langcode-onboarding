import { currentUser, createClient } from "@/lib/supabase/server";
import { assess, extractiveAnswer, parseCitations } from "@/lib/rag/answer";
import { loadIndex, normalizeQuery, retrieve, skipAudienceFilterForExperiment, MAX_QUERY_CHARS } from "@/lib/rag/search";

const TOP_K = 5;

/**
 * 6단계: 검색 + 답변, SSE 스트리밍.
 *
 *   event: status     {"text": "문서를 찾는 중…"}
 *   event: meta       {"audience", "applied": [...], "mode": "extractive", "found": true}
 *   event: delta      {"text": "글자 조각"}            ← 여러 번
 *   event: citations  {"sources": [...], "cited": [1,2], "unknown": []}
 *   event: done       {"ms": 120}
 *   event: error      {"message": "..."}
 *
 * POST 로 질문을 보내야 해서 EventSource 대신 fetch + ReadableStream 으로 읽는다 (05-realtime-ui/01 5절).
 * 출처(citations)는 맨 끝에 보낸다 — 생성형(LLM)이면 답이 다 나와야 어떤 [n] 을 썼는지 알 수 있어서다.
 *
 * 모드 A(추출형)는 답이 한 번에 만들어진다. 그래도 생성형과 같은 길로 보내려고 조각내 흘려보낸다.
 * 무료 LLM 키를 붙이면(모드 B) 여기서 모델의 토큰을 그대로 delta 로 넘기면 된다.
 */
export async function POST(request: Request) {
  // 미들웨어만 믿지 않는다. 서버에서 getUser() 로 다시 확인
  const user = await currentUser();
  if (!user) return Response.json({ error: "로그인이 필요합니다" }, { status: 401 });
  if (!user.audience) return Response.json({ error: "프로필(audience)이 없어 검색할 수 없습니다" }, { status: 403 });

  const body = await request.json().catch(() => null);
  const question = normalizeQuery(body?.query);
  if (!question) return Response.json({ error: `질문은 1~${MAX_QUERY_CHARS}자로 입력하세요` }, { status: 400 });

  const audience = user.audience;
  const supabase = (await createClient())!;
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      const started = performance.now();
      try {
        send("status", { text: "문서를 찾는 중…" });
        // audience 는 클라이언트가 보낸 값이 아니라 profiles 에서 읽은 값만 쓴다
        const { expandedQuery, applied, evidence, warnings } = await retrieve(supabase, question, audience, TOP_K);
        if (skipAudienceFilterForExperiment) warnings.unshift("⚠ 실험 모드: 1차 권한 필터가 꺼져 있습니다");

        const verdict = assess(loadIndex(), question, evidence, applied);
        const answer = verdict.found ? extractiveAnswer(loadIndex(), expandedQuery, evidence) : "";
        const found = verdict.found && answer.length > 0;
        send("meta", { audience, applied, mode: "extractive", found, coverage: Math.round(verdict.coverage * 100) / 100, missing: verdict.missing.slice(0, 3), warnings });

        const text = found
          ? answer
          : `문서에서 찾지 못했어요.${verdict.missing.length ? ` 볼 수 있는 문서에 「${verdict.missing.slice(0, 2).join("」, 「")}」에 대한 내용이 없습니다.` : ""} 다른 표현으로 물어보세요.`;

        // 2~4글자씩 흘려보낸다. 잘린 "[1" 마커 처리는 화면 쪽에서 한다
        for (let i = 0; i < text.length; ) {
          const step = 2 + Math.floor(Math.random() * 3);
          send("delta", { text: text.slice(i, i + step) });
          i += step;
          await new Promise((r) => setTimeout(r, 12));
        }

        const { cited, unknown } = parseCitations(text, evidence.length);
        if (unknown.length) console.warn(`[lab3] 근거에 없는 출처 번호: ${unknown.join(", ")}`);
        // 찾지 못했을 때도 무엇을 뒤졌는지는 보여 준다 (디버깅용으로 접어서)
        send("citations", { sources: evidence, cited, unknown });
        send("done", { ms: Math.round(performance.now() - started) });
      } catch (e) {
        console.error("[lab3] chat 실패", e);
        send("error", { message: "답변을 만드는 중 문제가 생겼어요. 잠시 뒤 다시 시도해 주세요." });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
    },
  });
}
