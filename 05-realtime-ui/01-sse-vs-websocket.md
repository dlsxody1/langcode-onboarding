# SSE vs WebSocket

**AI 채팅 화면의 첫 번째 설계 결정.** 결론부터: **LLM 스트리밍은 거의 항상 SSE 가 맞다.**

---

## 1. 비교

| | SSE (Server-Sent Events) | WebSocket |
| --- | --- | --- |
| 방향 | **서버 → 클라이언트 단방향** | 양방향 |
| 프로토콜 | 그냥 HTTP (`text/event-stream`) | HTTP 업그레이드 후 별도 프로토콜 |
| 재연결 | **브라우저가 자동** + `Last-Event-ID` | 직접 구현 |
| 프록시·방화벽 | HTTP 라 잘 통과 | 기업망에서 막히는 경우가 있다 |
| 인증 | 쿠키·헤더 그대로 | 핸드셰이크 때 별도 처리 필요 |
| 압축·HTTP/2 | 그대로 적용 | 별도 |
| 데이터 | 텍스트만 | 바이너리 가능 |
| 서버 부담 | 연결당 커넥션 유지 | 연결당 커넥션 유지 |
| 브라우저 API | `EventSource` (GET 만) | `WebSocket` |

---

## 2. 왜 LLM 스트리밍은 SSE 인가

1. **데이터가 한 방향으로만 흐른다.** 질문은 POST 한 번이고, 그 뒤로는 서버가 토큰을 밀어주기만 한다.
   양방향이 필요 없는데 WebSocket 을 쓰면 재연결·하트비트·인증을 전부 직접 만들어야 한다.

2. **기업 네트워크.** 랭코드 고객사는 대기업·금융이다. **프록시가 WebSocket 업그레이드를 막는 경우가 실제로 있다.**
   SSE 는 그냥 오래 열려 있는 HTTP 응답이라 훨씬 잘 통과한다.

3. **재연결이 공짜다.** `EventSource` 는 끊기면 알아서 다시 붙고, 마지막으로 받은 `id` 를
   `Last-Event-ID` 헤더로 보낸다. 서버가 그 다음부터 보내면 이어받기가 된다.

4. **OpenAI, Anthropic, Azure OpenAI 의 스트리밍 API 가 전부 SSE 다.** 업스트림이 SSE 인데
   우리가 WebSocket 으로 바꿔서 내보낼 이유가 없다.

### WebSocket 이 맞는 경우

- **협업 편집** (여러 사용자의 커서·변경이 양방향으로 오감)
- 클라이언트가 **고빈도로** 서버에 보내야 할 때 (음성 스트림, 게임)
- 하나의 연결로 여러 종류의 양방향 채널을 다중화해야 할 때

**"채팅"이라고 해서 WebSocket 이 아니다.** 사용자가 보내는 건 가끔 한 번이고, 그건 그냥 POST 다.

---

## 3. SSE 프로토콜 — 실제 생김새

```
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
X-Accel-Buffering: no          ← nginx 가 버퍼링하면 스트리밍이 안 된다

id: 1
event: token
data: {"text":"안녕"}

id: 2
event: token
data: {"text":"하세요"}

event: citation
data: {"index":1,"source":"규정.pdf","page":3}

event: done
data: {"usage":{"input":3200,"output":410}}

: heartbeat                    ← 주석. 연결 유지용
```

**규칙:**
- 이벤트는 **빈 줄 두 개**(`\n\n`)로 구분한다. 이걸 빠뜨리면 클라이언트가 이벤트를 못 받는다
- `data:` 가 여러 줄이면 줄바꿈으로 합쳐진다
- `:` 로 시작하면 주석 — **하트비트용**. 프록시가 유휴 연결을 끊는 걸 막는다
- `id:` 를 붙이면 재연결 시 `Last-Event-ID` 로 돌아온다
- `retry: 3000` 으로 재연결 간격을 지정할 수 있다

---

## 4. 서버 구현 (ASP.NET Core)

```csharp
app.MapGet("/api/chat/{runId:guid}/stream", async (
    Guid runId, IAgentService agent, HttpContext ctx, CancellationToken ct) =>
{
    ctx.Response.Headers.ContentType = "text/event-stream";
    ctx.Response.Headers.CacheControl = "no-cache";
    ctx.Response.Headers["X-Accel-Buffering"] = "no";

    // 재연결 시 이어받기
    var lastId = ctx.Request.Headers["Last-Event-ID"].FirstOrDefault();
    var from = int.TryParse(lastId, out var n) ? n + 1 : 0;

    var seq = from;
    await foreach (var chunk in agent.StreamAsync(runId, from, ct))
    {
        await ctx.Response.WriteAsync($"id: {seq++}\n", ct);
        await ctx.Response.WriteAsync($"event: {chunk.Type}\n", ct);
        await ctx.Response.WriteAsync($"data: {JsonSerializer.Serialize(chunk.Data)}\n\n", ct);
        await ctx.Response.Body.FlushAsync(ct);      // ⚠️ 반드시 flush
    }
});
```

**빠뜨리면 반드시 당하는 것 세 가지:**

1. **`FlushAsync()`** — 안 하면 버퍼에 쌓였다가 끝날 때 한 번에 나간다. 스트리밍이 아니게 된다
2. **`X-Accel-Buffering: no`** — nginx 가 응답을 버퍼링하면 위와 같은 증상. 로컬에선 되는데 배포하면 안 되는 전형적 원인
3. **`CancellationToken` 전파** — 사용자가 탭을 닫으면 `ct` 가 취소된다. LLM 호출까지 전파해야 토큰 비용이 멈춘다

### 하트비트

```csharp
// 15초마다 주석 한 줄. 프록시 idle timeout 방지
await ctx.Response.WriteAsync(": ping\n\n", ct);
```

### 시작은 POST, 스트림은 GET 으로 분리

```
POST /api/chat/runs        → 202 { runId }       (질문 전송)
GET  /api/chat/runs/{id}/stream  → SSE            (결과 수신)
```

**이렇게 나누는 이유:**
- `EventSource` 는 GET 만 된다
- 스트림이 끊겨도 잡은 서버에서 계속 돈다 → 재연결로 이어받기 가능
- 새로고침해도 `runId` 만 있으면 복구된다

한 방에 `POST` + 스트리밍 응답으로 하고 싶으면 `fetch` + `ReadableStream` 을 직접 파싱해야 한다
(브라우저 `EventSource` 를 못 쓴다). Vercel AI SDK 등이 이 방식을 쓴다. **대신 자동 재연결을 잃는다.**

---

## 5. 클라이언트 구현

### EventSource (간단)

```ts
const es = new EventSource(`/api/chat/runs/${runId}/stream`, { withCredentials: true });

es.addEventListener("token", (e) => appendToken(JSON.parse(e.data).text));
es.addEventListener("citation", (e) => addCitation(JSON.parse(e.data)));
es.addEventListener("done", () => es.close());
es.onerror = () => { /* 브라우저가 자동 재연결 시도. 영구 실패 시만 처리 */ };
```

**제약: 커스텀 헤더를 못 붙인다.** `Authorization: Bearer` 를 넣을 수 없다.
→ 쿠키 인증을 쓰거나, 단기 토큰을 쿼리스트링에 넣거나(권장 안 함), `fetch` 방식으로 간다.

### fetch + ReadableStream (유연)

```ts
const res = await fetch("/api/chat/runs", {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
  body: JSON.stringify({ message }),
  signal: abortController.signal,       // 취소 가능
});

const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
let buffer = "";
while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  buffer += value;

  // 이벤트는 \n\n 로 구분 — 부분 수신을 반드시 고려해야 한다
  const parts = buffer.split("\n\n");
  buffer = parts.pop()!;                 // 마지막 조각은 미완성일 수 있다
  for (const part of parts) handleEvent(part);
}
```

**`buffer.pop()` 을 빠뜨리는 게 가장 흔한 버그다.** 네트워크 청크 경계는 이벤트 경계와 무관하므로
`data: {"text":"안` 까지만 도착할 수 있다. 미완성 조각을 버퍼에 남겨야 한다.

**장점:** 헤더를 붙일 수 있고, `AbortController` 로 깔끔하게 취소되고, POST 바디를 쓸 수 있다.
**단점:** 자동 재연결이 없다. 직접 만들어야 한다.

---

## 6. 정리 — 선택 기준

```
LLM 응답 스트리밍          → SSE
에이전트 진행 상황 알림      → SSE
알림 푸시                  → SSE (또는 폴링)
협업 편집 / 커서 공유       → WebSocket
음성 입력 스트림           → WebSocket
단순 상태 조회             → 폴링 (SSE 도 과하다)
```

**의심스러우면 폴링부터 시작해라.** 폴링으로 되는 걸 SSE 로 만들면 커넥션 관리 문제만 늘어난다.
초 단위 갱신이 필요 없으면 `refetchInterval: 3000` 이 훨씬 싸고 튼튼하다.
