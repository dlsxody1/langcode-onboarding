# SignalR — 개념만 짧게

실시간 UI 튜토리얼은 범위에서 뺐다. 시험에 나올 만한 **개념**만 한 장으로 정리한다.
`05-team-tech-list.md` 8절의 SignalR vs SSE 비교도 같이 보면 좋다.

> 공식 문서: [ASP.NET Core SignalR 개요](https://learn.microsoft.com/ko-kr/aspnet/core/signalr/introduction?view=aspnetcore-10.0)

---

## 1. SignalR 이 뭔가

앱에 **실시간 웹 기능**을 넣기 쉽게 해 주는 오픈 소스 라이브러리. 서버 코드가 클라이언트에게 **즉시 내용을 밀어 넣을(push)** 수 있다.
핵심은 **서버 ↔ 클라이언트 RPC(원격 프로시저 호출)**: 서버의 .NET 코드가 클라이언트의 함수를 호출하고, 반대도 된다.

| 시나리오 | 예 |
| --- | --- |
| 고빈도 업데이트 | 게임 · 경매 · 지도 · GPS |
| 대시보드·모니터링 | 사내 대시보드 · 실시간 판매 |
| 협업 | 화이트보드 · 팀 회의 |
| 알림 | 채팅 · 이메일 · 소셜 |

SignalR 이 해 주는 것:
- **연결 관리를 자동**으로 처리한다.
- 연결된 **모든 클라이언트**에 동시에 보낸다 (채팅방).
- **특정 클라이언트나 그룹**에만 보낸다.
- Azure SignalR Service · Redis 백플레인으로 **확장**한다.
- (10.0) 지원되는 시나리오에서 **트리밍 · 네이티브 AOT**, 허브 메서드의 **다형 형식**, `ActivitySource` 를 통한 **분산 추적**.

---

## 2. 전송 방식 (Transport) — 자동 폴백

| 순서 | 전송 | 특징 |
| --- | --- | --- |
| 1 | **WebSockets** | 양방향 · 가장 빠름. **기본** |
| 2 | **Server-Sent Events** | 서버 → 클라이언트 단방향 |
| 3 | **Long Polling** | 마지막 수단. 요청을 열어 두고 응답이 있을 때 닫는다 |

SignalR 은 서버와 클라이언트가 **둘 다 가능한 가장 좋은 것**을 자동 선택한다 (협상, negotiation).
개발자가 코드로 고를 필요가 없고, 선택지를 제한(`HttpTransportType`)할 수는 있다.

---

## 3. Hub — 통신의 중심

**Hub** = 클라이언트와 서버가 서로의 메서드를 호출하는 **상위 수준 파이프라인**.
컴퓨터 경계를 넘는 디스패치를 SignalR 이 대신 처리한다. 강한 형식의 매개변수와 모델 바인딩이 된다.

```csharp
public class ChatHub : Hub
{
    // 클라이언트 → 서버: 클라이언트가 호출하는 메서드
    public async Task Send(string user, string message)
        => await Clients.All.SendAsync("ReceiveMessage", user, message);   // 서버 → 클라이언트

    public Task Join(string room) => Groups.AddToGroupAsync(Context.ConnectionId, room);
}

// Program.cs
builder.Services.AddSignalR();
app.MapHub<ChatHub>("/chat");
```

| 대상 | 의미 |
| --- | --- |
| `Clients.All` | 연결된 모든 클라이언트 |
| `Clients.Caller` | 호출한 클라이언트 |
| `Clients.Others` | 호출자를 뺀 나머지 |
| `Clients.Group("room")` | 그룹 구성원 |
| `Clients.User("id")` | 특정 사용자의 모든 연결 |
| `Clients.Client(connId)` | 특정 연결 하나 |

- 서버 → 클라이언트 호출은 **메서드 이름(문자열)** 과 매개변수를 담은 메시지를 보낸다. 클라이언트는 **이름이 같은 핸들러**를 찾아 실행한다. 못 찾으면 **조용히 무시**된다 (오타가 에러 없이 지나간다).
- **Hub 는 요청마다 새 인스턴스**다 (Transient). 상태를 인스턴스 필드에 두면 안 된다. 연결 단위 정보는 `Context.ConnectionId`, 공유 상태는 별도 서비스(DI)에.
- `Context.ConnectionId` 는 **연결**마다 다르다. 같은 사용자가 탭 두 개면 `ConnectionId` 두 개, `UserIdentifier` 하나.
- 강한 형식의 허브: `Hub<IChatClient>` 로 클라이언트 메서드를 **인터페이스**로 선언하면 문자열 오타를 컴파일 때 잡는다.

---

## 4. 허브 프로토콜

| 프로토콜 | 형식 | 특징 |
| --- | --- | --- |
| **JSON** | 텍스트 | **기본값**. 읽기 쉽다 |
| **MessagePack** | 이진 | 보통 JSON 보다 **메시지가 작다** |

---

## 5. 클라이언트

SignalR 은 **플랫폼별 클라이언트 SDK** 를 제공한다. JavaScript · .NET · Java 등. RPC 로 호출되는 함수의 언어는 클라이언트 플랫폼에 따른다.

```csharp
var conn = new HubConnectionBuilder()
    .WithUrl("https://host/chat")
    .WithAutomaticReconnect()          // 끊기면 재연결 시도
    .Build();

conn.On<string, string>("ReceiveMessage", (u, m) => Console.WriteLine($"{u}: {m}"));
await conn.StartAsync();
await conn.InvokeAsync("Send", "kim", "hi");
```

- 서버 메서드 호출은 `InvokeAsync`(결과 기다림) / `SendAsync`(기다리지 않음).
- 자동 재연결 후에는 **새 `ConnectionId`** 가 부여된다. 그룹 가입은 **다시** 해야 한다.

---

## 6. 확장 (Scale-out)

서버가 **여러 대**면, A 서버에 붙은 클라이언트에게 B 서버가 보낼 방법이 없다. 해결책:

| 방법 | 설명 |
| --- | --- |
| **Azure SignalR Service** | 연결 자체를 관리형 서비스에 맡긴다. 서버는 가벼워진다 |
| **Redis 백플레인** | 서버끼리 Redis pub/sub 으로 메시지를 전달한다 |
| **스티키 세션** | 한 클라이언트를 한 서버에 고정 (Long Polling 폴백·협상 때문에 필요) |

- WebSocket 연결은 **상태가 있는 장수 연결**이라, 서버를 껐다 켜면(배포) 연결이 모두 끊긴다. 재연결 설계가 필요하다.
- 서버당 연결 수 제한이 있고, 연결 하나하나가 메모리를 쓴다.

---

## 7. SignalR vs SSE vs WebSocket

| | WebSocket (직접) | SSE | SignalR |
| --- | --- | --- | --- |
| 방향 | 양방향 | 서버 → 클라이언트 | 양방향 |
| 추상화 | 낮음 (프로토콜) | 낮음 | **높음 (Hub · RPC · 그룹 · 재연결)** |
| 폴백 | 없음 | 없음 | **자동** |
| 쓰임 | 직접 제어 | LLM 토큰 스트리밍 등 | 채팅 · 알림 · 대시보드 |

"AI 응답을 한 글자씩 흘려 보내기" 정도면 SSE 로 충분하고, "서로 주고받으며 그룹·재연결까지" 면 SignalR.

---

## 8. 자주 틀리는 것

1. 기본 전송은 **WebSocket**, 폴백 순서는 WebSocket → SSE → Long Polling.
2. 기본 프로토콜은 **JSON**. MessagePack 은 이진이고 더 작다.
3. Hub 는 **호출마다 새 인스턴스**다 — 필드에 상태를 저장하지 않는다.
4. 이름이 맞지 않는 클라이언트 메서드 호출은 **에러 없이 무시**된다.
5. 재연결하면 `ConnectionId` 가 **바뀐다** — 그룹을 다시 가입.
6. 여러 서버로 늘리려면 **백플레인(Redis)** 또는 **Azure SignalR Service**.
7. `Clients.Others` 는 호출자 **제외**, `Clients.Caller` 는 호출자만.

---

## 스스로 답해보기

1. SignalR 이 필요한 상황 두 가지를 들어라.
2. 세 가지 전송 방식과 자동 폴백 순서는? 기본은 무엇이고 왜인가?
3. Hub 란 무엇인가? `Clients.All` · `Others` · `Group` 의 차이는?
4. JSON 프로토콜과 MessagePack 의 차이는?
5. Hub 인스턴스는 얼마나 오래 사는가? 상태는 어디에 두나?
6. 서버를 두 대로 늘리면 어떤 문제가 생기고 어떻게 해결하나?
7. 재연결 후 그룹 구성원 정보는 어떻게 되나?
8. SSE 와 SignalR 중 LLM 응답 스트리밍에 무엇이 더 어울리고 왜인가?
