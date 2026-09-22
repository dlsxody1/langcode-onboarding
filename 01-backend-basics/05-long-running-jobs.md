# 오래 걸리는 작업 설계

AI 제품 백엔드의 핵심 설계 문제. **에이전트 한 번 실행에 30초~수 분이 걸린다.**
이걸 평범한 REST 요청-응답으로 처리하려 하면 전부 깨진다.

---

## 1. 왜 동기 응답이 안 되나

```
POST /api/agent/run   →  ... 180초 ...  →  200 OK
```

깨지는 지점이 겹겹이 있다.

| 계층 | 기본 타임아웃 | 결과 |
| --- | --- | --- |
| 브라우저 `fetch` | 무제한이지만 사용자가 먼저 포기 | |
| nginx / Azure App Gateway | 60~240초 | **504 Gateway Timeout** |
| 로드밸런서 idle timeout | 4분(Azure LB 기본) | 연결 끊김 |
| Kestrel 요청 타임아웃 | 설정 가능 | |

그리고 타임아웃이 없어도 문제가 남는다.

- **진행 상황을 알 수 없다** — 3분 동안 스피너만 돌아간다
- **취소할 수 없다** — 사용자가 탭을 닫아도 서버는 계속 돈다
- **재시도가 위험하다** — 실패했는지 성공했는데 응답만 못 받았는지 모른다
- **서버 재배포하면 진행 중인 작업이 전부 증발한다**

---

## 2. 패턴 1 — 잡 등록 + 폴링

가장 단순하고 가장 튼튼하다.

```
POST /api/agent/runs          → 202 Accepted
                                 { "runId": "r-123", "status": "queued" }
                                 Location: /api/agent/runs/r-123

GET  /api/agent/runs/r-123    → 200 { "status": "running", "progress": 0.4,
                                       "currentStep": "문서 12/30 검색 중" }
GET  /api/agent/runs/r-123    → 200 { "status": "succeeded", "result": {...} }

DELETE /api/agent/runs/r-123  → 취소
```

핵심은 **`202 Accepted` + 리소스 URL** 이다. "받았고, 여기서 확인해라".

```csharp
[HttpPost("runs")]
public async Task<IActionResult> Start([FromBody] StartRunRequest req)
{
    var run = await _runService.EnqueueAsync(req, User.GetTenantId());
    return AcceptedAtAction(nameof(Get), new { id = run.Id }, new { runId = run.Id, status = "queued" });
}
```

**장점:** HTTP 그대로. 프록시·방화벽·재시도 전부와 호환. 서버가 재시작돼도 잡이 DB 에 있으니 살아남는다.
**단점:** 폴링 간격만큼 지연. 요청이 늘어난다.

> 프론트에서 이미 아는 것: TanStack Query 의 `refetchInterval`.
> `status !== 'succeeded'` 인 동안만 2초마다 폴링하고, 끝나면 멈추면 된다.

---

## 3. 패턴 2 — SSE 로 진행 상황 밀어주기

폴링 대신 서버가 이벤트를 밀어준다. **LLM 토큰 스트리밍이 바로 이것.**

```
POST /api/agent/runs          → 202 { runId }
GET  /api/agent/runs/r-123/events   (SSE 연결)
     ← event: progress  data: {"step":"검색","pct":0.2}
     ← event: token     data: {"text":"안녕"}
     ← event: token     data: {"text":"하세요"}
     ← event: done      data: {"citations":[...]}
```

**중요: 시작은 POST, 스트림은 별도 GET 으로 분리하는 게 낫다.**
- 스트림이 끊겨도 잡은 계속 돈다. 재연결해서 이어받을 수 있다
- 브라우저 `EventSource` 는 GET 만 된다 (POST 스트리밍은 `fetch` + `ReadableStream` 로 직접)

자세한 비교는 `05-realtime-ui/01-sse-vs-websocket.md`.

### 이어받기 (resumable)

SSE 에는 `Last-Event-ID` 라는 표준 장치가 있다. 서버가 각 이벤트에 `id:` 를 붙여 보내면,
브라우저가 재연결할 때 그 헤더를 자동으로 보낸다. 서버는 그 다음부터 다시 보내면 된다.

**이게 되려면 이벤트를 어딘가 저장해 둬야 한다.** (Redis Stream, DB 등)
저장 안 하면 재연결 = 처음부터. 채팅 UI 에서 답변이 중간에 날아가는 건 대부분 이 문제다.

---

## 4. 멱등성 — 재시도를 안전하게

`POST` 는 멱등하지 않다. 네트워크가 끊겨서 클라이언트가 재시도하면 잡이 두 개 생긴다.

### Idempotency-Key

```
POST /api/agent/runs
Idempotency-Key: 550e8400-e29b-41d4-a716-446655440000
```

서버 동작:
1. 이 키로 이미 만든 결과가 있나 확인
2. 있으면 **새로 실행하지 않고 그때 결과를 그대로 반환**
3. 없으면 실행하고 (키 → 결과) 를 저장 (보통 24시간 TTL)

클라이언트는 **재시도할 때 같은 키를 보낸다.** 새 작업일 때만 새 키를 만든다.
Stripe 등 결제 API 가 전부 이 방식이다.

```csharp
// 저장은 DB 유니크 제약으로 경쟁 상태까지 막는다
CREATE UNIQUE INDEX ix_idem ON idempotency_keys (tenant_id, key);
```

**동시에 두 요청이 같은 키로 오는 경우까지 막으려면** 유니크 제약 위반을 잡아서
"이미 진행 중" (409) 을 반환하거나, 원 결과를 기다렸다 준다.

---

## 5. 작업을 실제로 어디서 돌리나

| 방식 | 설명 | 언제 |
| --- | --- | --- |
| `BackgroundService` (인프로세스) | 앱 안의 백그라운드 스레드. `Channel<T>` 로 큐 | 가장 간단. **앱이 죽으면 잡도 죽는다** |
| DB 기반 큐 | `jobs` 테이블 + 워커가 폴링 (`FOR UPDATE SKIP LOCKED`) | 인프라 추가 없이 튼튼. 중소 규모에 충분 |
| 전용 큐 | Azure Service Bus, RabbitMQ, Redis | 재시도·DLQ·확장 전부 제공 |
| 라이브러리 | Hangfire, Quartz.NET | .NET 에서 흔함. 대시보드 포함 |

**.NET 에서 처음 만나는 함정:** `BackgroundService` 는 HTTP 요청 스코프 밖이다.
`DbContext` 를 생성자에서 못 받는다 (captive dependency, `01-backend-basics/02` 참조).

```csharp
public class AgentRunWorker(IServiceScopeFactory scopeFactory) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            using var scope = scopeFactory.CreateScope();       // 잡마다 스코프를 연다
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            ...
        }
    }
}
```

### 필수 장치들

- **CancellationToken 을 끝까지 전파** — 취소 요청이 LLM 호출까지 닿아야 실제로 멈춘다
- **재시도는 지수 백오프 + 지터** — 전부 동시에 재시도하면 서버를 다시 죽인다 (thundering herd)
- **최대 시도 횟수 + DLQ(dead letter)** — 무한 재시도는 큐를 막는다
- **적어도 한 번(at-least-once) 전달이 기본** — 즉 **같은 잡이 두 번 실행될 수 있다.** 핸들러를 멱등하게 짜야 한다
- **타임아웃** — 걸어두지 않으면 죽은 잡이 워커를 영원히 점유한다

---

## 6. 상태 머신으로 설계하기

```
queued → running → succeeded
            ├───→ failed      (재시도 가능 / 불가)
            └───→ cancelled
```

DB 에 이 상태를 저장하고, **허용된 전이만** 코드로 강제한다.
`succeeded` 에서 `running` 으로 가는 일이 없어야 한다.

> **이미 해본 것:** MetaDx Office 전자결재의 결재선 상태머신이 정확히 같은 구조다.
> 에이전트 실행 관리는 "AI" 라서 특별한 게 아니라, **오래 걸리는 업무 프로세스**라서 어렵다.
> 결재 워크플로우를 다뤄본 경험이 여기에 그대로 옮겨진다.

기록해 둘 것:
- `started_at`, `finished_at` — 소요 시간 통계
- `error_code`, `error_message` — 사용자용 / 내부용 분리
- `attempt` — 몇 번째 시도인지
- `input_hash` — 같은 입력의 재실행 감지, 캐싱
- **LLM 특유: 토큰 사용량, 모델명, 프롬프트 버전** — 비용 추적과 회귀 분석에 필수

---

## 7. AI 작업에만 있는 특징

| 특징 | 설계에 미치는 영향 |
| --- | --- |
| **비결정적** | 같은 입력에 다른 출력. "재시도하면 되겠지"가 안 통한다. 결과를 저장해 두고 재사용 |
| **부분 결과가 의미 있음** | 30% 진행된 답변도 사용자에겐 가치 있다 → 스트리밍 |
| **비용이 호출당 발생** | 중복 실행 = 돈. 멱등성이 예산 문제이기도 하다 |
| **외부 API 의존** | OpenAI/Anthropic 가 rate limit 이나 장애를 낸다 → 폴백 모델, 서킷 브레이커 |
| **응답 시간 편차가 크다** | p50 2초, p99 60초. 평균으로 타임아웃을 정하면 안 된다 |

**서킷 브레이커** — 외부 API 가 연속 실패하면 일정 시간 아예 호출을 끊는다.
죽은 서비스를 계속 두드려서 우리 스레드까지 마르는 걸 막는다. .NET 에서는 **Polly** 라이브러리가 표준
(재시도·백오프·타임아웃·서킷브레이커를 전부 제공. .NET 8 부터 `Microsoft.Extensions.Http.Resilience` 로 통합).

---

## 8. 프론트엔드 쪽 짝

| 서버 | 프론트 |
| --- | --- |
| `202 Accepted` + runId | 낙관적으로 "처리 중" 카드 추가 |
| `GET /runs/{id}` 폴링 | `useQuery` + `refetchInterval`, 완료 시 `false` 반환해 중단 |
| SSE progress 이벤트 | 진행률 바. **상태를 ref 에 모으고 화면은 간헐 갱신** (→ `05-realtime-ui/02`) |
| `DELETE /runs/{id}` | 취소 버튼. 응답 전에 UI 는 즉시 "취소 중"으로 |
| 실패 | **재시도 버튼 + 같은 Idempotency-Key 유지 여부 결정** |
| 새로고침 | runId 를 URL 이나 로컬에 두고 복구. **이게 없으면 사용자는 결과를 영영 잃는다** |

마지막 줄이 실제로 가장 자주 빠뜨리는 부분이다. 3분짜리 작업을 돌리고 실수로 새로고침했을 때
결과를 되찾을 수 있어야 한다 → **잡 목록 화면이 필요하다.**

---

## 스스로 답해보기

1. 3분 걸리는 API 를 그냥 동기로 만들면 어디서 먼저 깨지나?
2. `202 Accepted` 응답에 반드시 들어가야 할 것은?
3. Idempotency-Key 는 클라이언트가 언제 새로 만들고 언제 유지하나?
4. `BackgroundService` 생성자에 `DbContext` 를 받으면 왜 안 되나?
5. 큐가 "at-least-once" 라는 게 내 핸들러 코드에 미치는 영향은?
6. 사용자가 작업 중 새로고침했다. 결과를 잃지 않게 하려면 무엇이 필요한가?
