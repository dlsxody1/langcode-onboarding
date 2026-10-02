# SSE vs WebSocket

**AI 채팅 화면의 첫 번째 설계 결정.** 결론부터: **LLM 스트리밍은 거의 항상 SSE 가 맞다.**

---

## 0. 먼저 두 기술이 무엇인지

보통의 HTTP 요청은 "요청 한 번에 응답 한 번"이다. 서버는 응답을 다 만든 뒤 한꺼번에 보내고 연결을 끝낸다. LLM 답변처럼 몇 초에서 몇십 초에 걸쳐 조금씩 만들어지는 데이터에는 이 방식이 맞지 않는다. 사용자는 마지막 글자가 만들어질 때까지 빈 화면을 보게 된다. 그래서 "서버가 만드는 족족 조금씩 보내는" 방법이 필요하다. 대표적인 두 가지가 SSE 와 WebSocket 이다.

SSE(Server-Sent Events)는 응답을 끝내지 않고 열어 둔 채 서버가 텍스트 조각을 계속 써 내려가는 방식이다. 형식만 정해져 있을 뿐 그냥 HTTP 응답이다. 다운로드가 아주 천천히 진행되는 파일을 받는 모습을 떠올리면 된다. 브라우저에는 이 형식을 읽어 주는 내장 API 인 EventSource 가 있다.

WebSocket 은 HTTP 로 시작한 연결을 "이제부터는 HTTP 말고 WebSocket 규칙으로 말하자"고 바꾼(업그레이드) 뒤 양쪽이 아무 때나 메시지를 보내는 방식이다. 전화를 연결해 두고 서로 말을 주고받는 것에 가깝다. 업그레이드가 끝나면 HTTP 요청·응답이라는 개념이 없어진다.

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

표에서 두 가지를 더 짚는다.

핸드셰이크(handshake)는 연결을 맺으면서 양쪽이 조건을 맞추는 첫 인사다. WebSocket 은 `Upgrade: websocket` 헤더가 붙은 HTTP 요청을 보내고 서버가 `101 Switching Protocols` 로 답하면서 시작된다. 브라우저의 `WebSocket` API 는 이 요청에 `Authorization` 헤더를 붙일 수 없다. 그래서 쿠키를 쓰거나, 연결 직후 첫 메시지로 토큰을 보내는 식의 별도 처리가 필요하다.

연결 수 제한도 알아 둘 만하다. HTTP/1.1 에서 브라우저는 같은 도메인에 동시에 여는 연결을 6개 정도로 제한한다. SSE 연결은 계속 열려 있으므로 탭 여러 개에서 SSE 를 하나씩 열면 그 도메인의 일반 API 요청이 줄을 서서 멈춘 것처럼 보일 수 있다. HTTP/2 는 연결 하나에 여러 요청을 섞어 보내므로 이 문제가 사실상 없어진다. 운영 환경이 HTTP/2 인지 확인해 두면 좋다.

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

2번의 프록시(proxy)는 회사 네트워크와 인터넷 사이에서 모든 HTTP 트래픽을 중계하고 검사하는 서버다. 보안 장비가 이해하지 못하는 트래픽은 막는 게 기본 정책인 곳이 많다. WebSocket 업그레이드 요청이 여기서 거절되면 개발 환경에서는 잘 되던 채팅이 고객사에서만 연결되지 않는다.

3번의 이어받기(Last-Event-ID 재연결)는 이렇게 동작한다. 서버가 이벤트마다 `id: 1`, `id: 2` 처럼 번호를 붙여 보낸다. 사용자가 엘리베이터에 타서 `id: 41` 까지 받고 연결이 끊겼다고 하자. 브라우저는 몇 초 뒤 같은 주소로 다시 요청하면서 `Last-Event-ID: 41` 헤더를 자동으로 붙인다. 서버는 이 헤더를 보고 42번부터 보낸다. 사용자 화면에서는 잠깐 멈췄다가 이어서 글자가 나온다. 단, 서버가 지나간 이벤트를 어딘가에 저장해 두고 있어야 가능하다. 저장 방법은 `01-backend-basics/05-long-running-jobs.md` 의 이어받기 절에 있다.

4번의 업스트림(upstream)은 우리 서버가 다시 호출하는 쪽, 여기서는 모델 API 를 말한다. 데이터는 모델 API → 우리 서버 → 브라우저 순서로 흐르고 앞쪽이 위(upstream)다.

### WebSocket 이 맞는 경우

- **협업 편집** (여러 사용자의 커서·변경이 양방향으로 오감)
- 클라이언트가 **고빈도로** 서버에 보내야 할 때 (음성 스트림, 게임)
- 하나의 연결로 여러 종류의 양방향 채널을 다중화해야 할 때

**"채팅"이라고 해서 WebSocket 이 아니다.** 사용자가 보내는 건 가끔 한 번이고, 그건 그냥 POST 다.

사람끼리 대화하는 메신저라면 상대의 메시지와 "입력 중..." 표시가 언제든 양쪽에서 오가니 WebSocket 이 어울린다. AI 채팅은 사용자가 질문을 보내고 답을 받는 구조라 사용자 쪽 송신이 드물다. 그 드문 송신은 일반 POST 로 충분하다.

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

위 네 줄은 응답 헤더, 그 아래가 본문이다. 본문은 이벤트의 연속이다. 이벤트 하나는 `필드이름: 값` 형식의 줄 몇 개로 이뤄진다. `event:` 는 이벤트 종류를 붙이는 이름표다. 클라이언트는 이 이름별로 처리 함수를 따로 등록할 수 있어서 토큰, 출처, 종료를 한 스트림에 섞어 보내도 구분된다. 이름을 생략하면 기본값 `message` 가 된다.

`Connection: keep-alive` 는 HTTP/1.1 용 헤더다. HTTP/2 에서는 이 헤더가 의미가 없고 넣지 말아야 하는 헤더라서 서버 프레임워크나 프록시가 알아서 빼기도 한다.

**규칙:**
- 이벤트는 **빈 줄 하나**(줄바꿈 두 번, `\n\n`)로 구분한다. 이걸 빠뜨리면 클라이언트가 이벤트를 못 받는다
- `data:` 가 여러 줄이면 줄바꿈으로 합쳐진다
- `:` 로 시작하면 주석 — **하트비트용**. 프록시가 유휴 연결을 끊는 걸 막는다
- `id:` 를 붙이면 재연결 시 `Last-Event-ID` 로 돌아온다
- `retry: 3000` 으로 재연결 간격을 지정할 수 있다

하트비트(heartbeat)는 "아직 살아 있다"는 신호로 주기적으로 보내는 의미 없는 데이터다. 프록시나 로드 밸런서는 일정 시간(예: 60초) 동안 아무 데이터도 오가지 않는 연결을 죽은 것으로 보고 끊는다. 에이전트가 도구를 실행하느라 30초 넘게 토큰을 안 보내는 일은 흔하다. 그 사이에 주석 한 줄씩 흘려보내면 연결이 유지된다. 클라이언트의 `EventSource` 는 주석을 무시하므로 화면에는 영향이 없다.

---

## 4. 서버 구현 (ASP.NET Core)

```csharp
app.MapGet("/api/chat/runs/{runId:guid}/stream", async (
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

코드를 위에서부터 읽으면 이렇다. 헤더 세 개로 "이건 SSE 이고 캐시하거나 모아 두지 마라"를 알린다. 다음으로 재연결이라면 `Last-Event-ID` 에서 마지막 번호를 꺼내 그 다음 번호부터 받겠다고 정한다. 처음 연결이면 헤더가 없으니 0 부터다. `agent.StreamAsync` 는 `IAsyncEnumerable` 을 돌려준다. JS 의 async generator 처럼 결과가 하나씩 도착하고 `await foreach` 가 도착할 때마다 한 번씩 돈다(`04-agent/02-maf.md` 3장). 루프 안에서는 3장의 형식 그대로 세 줄을 쓰고 빈 줄로 이벤트를 닫는다.

`StreamAsync(runId, from, ct)` 의 `from` 이 뜻하는 바가 중요하다. 실제 에이전트 실행은 이 GET 요청과 따로 서버 어딘가에서 돌고 있다. 만들어진 이벤트는 저장소(Redis, DB 등)에 차례로 쌓인다. 이 엔드포인트는 그 저장소에서 `from` 번부터 읽어 흘려보내는 역할만 한다. 그래서 연결이 끊겼다 다시 붙어도 실행 자체는 영향을 받지 않는다.

**빠뜨리면 반드시 당하는 것 세 가지:**

1. **`FlushAsync()`** — 안 하면 버퍼에 쌓였다가 끝날 때 한 번에 나간다. 스트리밍이 아니게 된다
2. **`X-Accel-Buffering: no`** — nginx 가 응답을 버퍼링하면 위와 같은 증상. 로컬에선 되는데 배포하면 안 되는 전형적 원인
3. **`CancellationToken` 전파** — 사용자가 탭을 닫으면 `ct` 가 취소된다. LLM 호출까지 전파해야 토큰 비용이 멈춘다

1번과 2번은 둘 다 버퍼링(buffering) 문제다. 버퍼는 데이터를 바로 보내지 않고 일정량이 찰 때까지 모아 두는 임시 공간이다. 작은 조각을 여러 번 보내는 것보다 모아서 한 번에 보내는 편이 효율적이라 서버와 프록시는 기본적으로 버퍼링을 한다. 일반 API 에서는 장점이지만 스트리밍에서는 "다 모일 때까지 기다린다"가 되어 버린다. 앱 서버의 버퍼는 `FlushAsync` 로 비우고 앞단 nginx 의 버퍼는 `X-Accel-Buffering: no` 로 끈다. 로컬에는 nginx 가 없어서 2번은 배포 후에야 드러난다. Azure 의 게이트웨이나 CDN 처럼 다른 프록시가 앞에 있다면 그쪽 버퍼링 설정도 확인해야 한다.

HTTP/1.1 에서 길이를 모르는 응답을 조금씩 보낼 때는 청크 전송 인코딩(chunked transfer encoding)이 쓰인다. 응답 헤더에 전체 길이(`Content-Length`) 대신 `Transfer-Encoding: chunked` 를 적고 본문을 "길이 + 조각" 단위로 이어 보내는 방식이다. ASP.NET Core 는 길이를 정하지 않고 쓰기 시작하면 이 방식을 자동으로 쓴다. HTTP/2 에서는 프레임이라는 단위가 같은 역할을 한다. 어느 쪽이든 네트워크가 나르는 조각의 경계는 SSE 이벤트의 경계와 상관이 없다. 5장의 버퍼 처리가 필요한 이유가 이것이다.

3번은 `WriteAsync` 와 `FlushAsync` 에 `ct` 를 넘기는 것만으로 끝나지 않는다. 요청 하나에서 실행과 스트리밍을 같이 하는 구조라면 이 `ct` 가 LLM 호출까지 닿아야 한다. 위 코드처럼 실행과 스트림을 나눴다면 스트림 쪽 `ct` 는 저장소 읽기만 멈춘다. 실행을 멈추는 일은 실행 쪽 CancellationToken 이 맡는다. 사용자의 중지 버튼이 별도의 취소 요청으로 그 토큰을 취소한다(`02-streaming-ui.md` 5장). 그 토큰이 LLM 호출까지 닿아야 하는 건 마찬가지다.

자연스럽게 생기는 배압(backpressure)도 알아 둔다. 배압은 받는 쪽이 느릴 때 보내는 쪽이 속도를 늦추게 되는 현상이다. 사용자 네트워크가 느리면 `WriteAsync` 가 바로 끝나지 않고 기다린다. 그동안 `await foreach` 의 다음 바퀴도 기다리므로 서버가 무한정 데이터를 메모리에 쌓지 않는다. `await` 를 빠뜨리고 쓰기를 던져만 두면 이 장치가 사라져 느린 클라이언트 하나가 서버 메모리를 잡아먹을 수 있다.

> ❓ 입사 후 확인: .NET 10 부터는 SSE 응답을 만들어 주는 내장 결과 타입이 생겼다고 알려져 있다. 사내 .NET 버전과, 직접 쓰기 방식과 내장 타입 중 무엇을 쓰는지 확인할 것.

### 하트비트

```csharp
// 15초마다 주석 한 줄. 프록시 idle timeout 방지
await ctx.Response.WriteAsync(": ping\n\n", ct);
```

idle timeout 은 "데이터가 이만큼 오래 안 오가면 연결을 끊는다"는 유휴 시간 제한이다. 15초는 대부분의 프록시 기본값(보통 30\~120초)보다 충분히 짧다.

구현할 때 주의할 점이 있다. 위 `await foreach` 루프는 다음 이벤트가 올 때까지 멈춰 있으므로 같은 루프 안에서는 15초마다 무언가를 쓸 수 없다. 별도 타이머에서 `WriteAsync` 를 부르면 이번에는 두 곳에서 동시에 응답에 쓰게 되어 이벤트 중간에 `: ping` 이 끼어들 수 있다. 응답 쓰기는 한 곳에서만 하는 게 원칙이다. 이벤트와 하트비트를 같은 큐(`Channel<T>` 등)에 넣고 쓰는 쪽은 그 큐 하나만 읽게 하거나, "다음 이벤트 대기"에 15초 타임아웃을 걸어 시간이 지나면 핑을 쓰는 식으로 직렬화한다.

### 시작은 POST, 스트림은 GET 으로 분리

```
POST /api/chat/runs        → 202 { runId }       (질문 전송)
GET  /api/chat/runs/{id}/stream  → SSE            (결과 수신)
```

**이렇게 나누는 이유:**
- `EventSource` 는 GET 만 된다
- 스트림이 끊겨도 잡은 서버에서 계속 돈다 → 재연결로 이어받기 가능
- 새로고침해도 `runId` 만 있으면 복구된다

`202 Accepted` 는 "요청은 받았고 처리는 아직 안 끝났다"는 상태 코드다. 질문을 받은 서버는 실행을 백그라운드 잡으로 등록하고 `runId` 만 바로 돌려준다. 프론트는 이 `runId` 로 스트림 주소를 열고 URL 이나 localStorage 에도 저장해 둔다. 잡 등록 구조는 `01-backend-basics/05-long-running-jobs.md` 와 같다.

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

`EventSource` 는 브라우저에 내장된 SSE 전용 클라이언트다. 주소를 주면 GET 요청을 보내고 `text/event-stream` 응답을 읽어 이벤트 단위로 잘라 준다. `addEventListener` 의 첫 인자가 서버가 보낸 `event:` 이름과 짝을 이룬다. `withCredentials: true` 는 다른 도메인의 API 라도 쿠키를 함께 보내라는 옵션이다.

`done` 에서 `es.close()` 를 부르는 이유가 있다. 서버가 응답을 다 쓰고 연결을 닫아도 `EventSource` 는 그걸 "끊겼다"로 보고 재연결한다. 닫지 않으면 같은 스트림을 다시 요청하는 일이 반복된다. 그래서 서버는 끝을 알리는 이벤트를 보내고 클라이언트는 그걸 받으면 직접 닫는다. `onerror` 는 일시적인 끊김에도 불리는데 그때 브라우저는 알아서 다시 붙는다. `es.readyState` 가 `EventSource.CLOSED` 라면 서버가 오류 상태 코드를 돌려주는 등 재연결을 포기한 경우이니 그때만 사용자에게 알린다.

**제약: 커스텀 헤더를 못 붙인다.** `Authorization: Bearer` 를 넣을 수 없다.
→ 쿠키 인증을 쓰거나, 단기 토큰을 쿼리스트링에 넣거나(권장 안 함), `fetch` 방식으로 간다.

쿼리스트링 토큰을 권장하지 않는 이유는 URL 이 여기저기 기록되기 때문이다. 서버 접속 로그, 프록시 로그, 브라우저 기록에 토큰이 그대로 남는다. 꼭 써야 한다면 수십 초만 유효한 일회용 토큰으로 제한한다.

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

`res.body` 는 응답 본문을 바이트 조각 단위로 내주는 `ReadableStream` 이다. `reader.read()` 를 부를 때마다 네트워크에서 도착한 조각 하나를 받는다. 받는 쪽이 `read()` 를 부를 때만 다음 조각을 가져오므로 처리가 느리면 자연스럽게 배압이 걸린다.

`TextDecoderStream` 은 바이트를 문자열로 바꾸는 단계인데, 한국어 때문에 꼭 필요하다. UTF-8 에서 한글 한 글자는 3바이트다. "안" 의 3바이트가 두 조각에 1바이트, 2바이트로 나뉘어 도착할 수 있다. 조각마다 따로 `new TextDecoder().decode(value)` 를 부르면 그 글자가 깨진 문자(�)로 바뀐다. `TextDecoderStream`(또는 `decode(value, { stream: true })`)은 덜 온 바이트를 기억했다가 다음 조각과 합쳐 바꿔 준다.

**`buffer.pop()` 을 빠뜨리는 게 가장 흔한 버그다.** 네트워크 청크 경계는 이벤트 경계와 무관하므로
`data: {"text":"안` 까지만 도착할 수 있다. 미완성 조각을 버퍼에 남겨야 한다.

구체적으로 따라가 보자. 첫 조각으로 `id: 1\nevent: token\ndata: {"text":"안녕"}\n\nid: 2\nevent: tok` 이 왔다. `split("\n\n")` 하면 `["id: 1...안녕\"}", "id: 2\nevent: tok"]` 두 개가 된다. 앞의 것은 완성된 이벤트이니 처리하고 뒤의 것은 `pop()` 으로 꺼내 버퍼에 남긴다. 다음 조각 `en\ndata: {"text":"하세요"}\n\n` 이 오면 버퍼와 합쳐져 두 번째 이벤트가 완성된다. `pop()` 없이 두 조각을 다 처리하면 반쪽짜리 이벤트를 파싱하다 `JSON.parse` 가 터지거나 토큰이 사라진다.

`handleEvent` 는 이벤트 하나를 줄 단위로 읽어 이름과 데이터를 뽑는 함수다.

```ts
function handleEvent(raw: string) {
  let event = "message";
  const data: string[] = [];
  for (const line of raw.split("\n")) {
    if (line.startsWith(":")) continue;                     // 주석 = 하트비트
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
  }
  if (data.length) dispatch(event, data.join("\n"));        // data 여러 줄은 줄바꿈으로 합친다
}
```

스펙상 줄바꿈으로 `\r\n` 도 허용된다. 서버가 `\r\n` 을 쓰면 위의 `\n\n` 분리가 맞지 않으므로 서버와 형식을 맞추거나 `\r\n` 을 먼저 `\n` 으로 바꾼다. 이런 경우까지 직접 챙기기 번거롭다면 검증된 SSE 파서 라이브러리를 쓰는 것도 방법이다.

**장점:** 헤더를 붙일 수 있고, `AbortController` 로 깔끔하게 취소되고, POST 바디를 쓸 수 있다.
**단점:** 자동 재연결이 없다. 직접 만들어야 한다.

### 재연결을 직접 만든다면

fetch 방식에서 재연결은 `EventSource` 가 해 주던 일을 그대로 흉내 내면 된다.

1. 이벤트를 처리할 때마다 마지막 `id` 를 변수에 저장한다.
2. 스트림이 `done` 이벤트 없이 끝나거나 네트워크 에러가 나면 잠시 기다린다.
3. 같은 실행의 스트림 주소로 다시 요청하면서 `Last-Event-ID` 헤더에 저장한 `id` 를 넣는다.
4. 대기 시간은 1초, 2초, 4초처럼 늘리고 약간의 무작위 값(지터)을 섞는다. 서버가 잠깐 죽었을 때 모든 클라이언트가 같은 순간에 몰려드는 걸 막는다(`07-db-infra/03-resilience.md` 의 지수 백오프).
5. 사용자가 중지를 눌러 `abort()` 한 경우는 재연결하지 않는다.

이때도 질문 전송(POST)과 스트림 수신(GET)을 나눠 두는 편이 낫다. 질문 POST 를 재시도하면 같은 질문이 두 번 실행되기 때문이다.

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

폴링(polling)은 클라이언트가 정해진 간격으로 "끝났어?"를 계속 물어보는 방식이다. 연결을 붙잡고 있지 않으니 서버 재시작, 배포, 프록시 타임아웃에 영향을 받지 않는다. TanStack Query 의 `refetchInterval` 이 바로 폴링이다. 결재 상태처럼 몇 초 늦게 알아도 되는 정보라면 이쪽이 운영하기 편하다.

---

## 스스로 답해보기

1. 사용자가 질문을 보내는 동작이 있는데도 AI 채팅이 "단방향" 이라고 말할 수 있는 이유는?
2. `Last-Event-ID: 41` 로 재연결이 들어왔다. 서버는 무엇을 해야 하고 그러려면 무엇이 미리 저장돼 있어야 하나?
3. 로컬에서는 글자가 한 개씩 나오는데 배포 환경에서는 한꺼번에 나온다. 의심할 곳 두 군데는?
4. 서버가 응답을 끝내고 연결을 닫았는데 `EventSource` 가 같은 요청을 계속 다시 보낸다. 왜 그런가?
5. fetch 로 직접 파싱할 때 `buffer.pop()` 을 빠뜨리면 어떤 증상이 나오나?
6. 조각마다 `new TextDecoder().decode()` 를 따로 부르면 한국어에서 무슨 일이 생기나?
7. 하트비트를 별도 타이머에서 응답에 직접 쓰면 어떤 문제가 생길 수 있나?
