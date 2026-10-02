# 요청 하나의 수명주기

`fetch('/api/pets/42')` 를 부르고 나서 응답이 돌아올 때까지 서버 안에서 무슨 일이 일어나는가.
**ASP.NET Core 를 이해하는 데 가장 중요한 문서다.** 이 프레임워크는 사실상 이 파이프라인 그 자체이기 때문이다.

---

## 1. 전체 그림

```
[브라우저]
   │  HTTP 요청 (메서드 + 경로 + 헤더 + 바디)
   ▼
[리버스 프록시 / 로드밸런서]   ← nginx, Azure App Gateway. TLS 종료, 라우팅
   ▼
[웹 서버 (Kestrel)]            ← .NET 에 내장된 HTTP 서버. 소켓에서 바이트를 읽어 요청 객체로
   ▼
┌──────────────────────────────────────────────────────────┐
│  미들웨어 파이프라인                                         │  ← 여기가 ASP.NET Core 의 본체
│   예외처리 → HTTPS → 라우팅 매칭 → CORS → 인증 → 인가          │
└──────────────────────────────────────────────────────────┘
   ▼
[엔드포인트 = 컨트롤러 액션]     ← 여기서부터 "내 코드"
   ▼
[서비스 계층]                   ← 업무 규칙
   ▼
[리포지토리 / DbContext]         ← DB 접근
   ▼
[데이터베이스]
```

그리고 **응답은 이 길을 거꾸로 되돌아 나온다.** 이게 핵심이다.

그림에 나온 낯선 이름부터 풀어 둔다.

| 이름 | 무엇인가 | 프론트로 치면 |
| --- | --- | --- |
| HTTP 요청 | 메서드(`GET`), 경로(`/api/pets/42`), 헤더(`Authorization: ...`), 바디(JSON)로 이뤄진 텍스트 묶음 | `fetch(url, { method, headers, body })` 의 인자 그대로 |
| 리버스 프록시 | 바깥 요청을 먼저 받아 뒤쪽 서버로 넘겨주는 서버. 클라이언트는 그 뒤에 서버가 몇 대인지 모른다 | Vercel 이 요청을 받아 내 함수로 넘겨주는 앞단 |
| 로드밸런서 | 요청을 여러 서버에 나눠 보내는 장치. 리버스 프록시가 이 역할을 겸하는 경우가 많다 | — |
| TLS 종료 | HTTPS 암호화를 프록시에서 풀고 안쪽은 평문 HTTP 로 넘기는 것. 인증서를 프록시 한 곳에만 두면 된다 | 브라우저 주소창의 자물쇠가 끝나는 지점 |
| Kestrel | ASP.NET Core 앱 안에 들어 있는 HTTP 서버. `dotnet run` 하면 뜨는 게 이것 | `next dev` 가 띄우는 Node HTTP 서버 |
| 소켓 | OS 가 제공하는 네트워크 연결의 끝점. 여기서 날것의 바이트가 들어온다 | — |
| 엔드포인트 | "이 경로 + 이 메서드면 이 함수"로 연결된 최종 처리기. 컨트롤러의 메서드 하나(액션)가 엔드포인트 하나다 | Next.js `app/api/pets/[id]/route.ts` 의 `GET` 함수 |

인프라 쪽(리버스 프록시·로드밸런서·Azure 서비스)은 `07-db-infra/05-infra.md` 에서 더 자세히 본다. 이 문서는 Kestrel 안쪽에 집중한다.

---

## 2. 미들웨어 파이프라인 — 양파 구조

미들웨어는 요청을 받아서 **다음 미들웨어를 부를지 말지 결정하는 함수**다.
요청 하나가 컨트롤러에 닿기까지 이런 함수 여러 개를 줄줄이 통과하는데 이 줄을 파이프라인이라고 부른다.

```csharp
// ASP.NET Core. 실제로 이렇게 생겼다
app.Use(async (context, next) =>
{
    // ① 들어갈 때 (요청 방향)
    var sw = Stopwatch.StartNew();

    await next();          // ② 다음 미들웨어 호출 — 여기서 나머지 전부가 실행된다

    // ③ 나올 때 (응답 방향)
    logger.LogInformation("{Path} took {Ms}ms", context.Request.Path, sw.ElapsedMilliseconds);
});
```

`context` 는 `HttpContext` 객체다. 요청(`context.Request`), 응답(`context.Response`), 로그인한 사용자(`context.User`)가 전부 여기 들어 있고
요청 하나가 끝날 때까지 모든 미들웨어와 컨트롤러가 같은 객체를 돌려 쓴다.

`await next()` 앞은 요청이 들어갈 때, 뒤는 응답이 나올 때 실행된다. 양파 껍질을 뚫고 들어갔다 나오는 모양이다.
그래서 위 코드는 "안쪽 전부가 걸린 시간"을 잴 수 있다. `next()` 가 끝났다는 건 컨트롤러와 DB 조회까지 다 끝났다는 뜻이기 때문이다.

**이미 아는 것과 같다:**

| 개념 | ASP.NET Core | 내가 아는 것 |
| --- | --- | --- |
| 요청 전후를 감싸는 함수 | 미들웨어 | Express `app.use((req,res,next)=>{})` — **거의 동일** |
| | | Next.js `middleware.ts` |
| | | axios interceptor (요청/응답 양방향) |
| 순서가 곧 동작 | 등록 순서대로 실행 | Express 와 동일하게 **순서가 전부** |

### next() 를 안 부르면 — 단락(short-circuit)

미들웨어가 `next()` 를 부르지 않고 바로 응답을 써 버리면 그 안쪽은 아예 실행되지 않는다. 이걸 단락이라고 한다.

```csharp
app.Use(async (context, next) =>
{
    if (maintenance.IsOn)
    {
        context.Response.StatusCode = 503;      // 점검 중
        return;                                 // next() 없음 → 컨트롤러·DB 는 손도 안 댄다
    }
    await next();
});
```

인증 미들웨어가 토큰이 없을 때 401 을 돌려주는 것도, CORS 미들웨어가 preflight 에 바로 답하는 것도 같은 원리다.
"컨트롤러에 브레이크포인트를 걸었는데 안 멈춘다"면 바깥 미들웨어에서 단락됐을 가능성부터 본다.

### 순서가 왜 전부인가

인증 미들웨어보다 인가 미들웨어를 먼저 등록하면 아직 "누구인지" 모르는 상태에서 "이 사람이 할 수 있나"를 판정하게 된다.
항상 401 이 뜨거나, 더 나쁘게는 항상 통과한다.

```csharp
// Program.cs — 이 순서에는 이유가 있다
app.UseExceptionHandler("/error");   // 가장 바깥: 아래 전부의 예외를 잡아야 하니까
app.UseHttpsRedirection();
app.UseCors();                       // 인증보다 먼저: preflight(OPTIONS)에는 토큰이 없다
app.UseAuthentication();             // 너는 누구냐 → context.User 를 채운다
app.UseAuthorization();              // 너는 이걸 해도 되냐 → User 가 채워진 뒤라야 함
app.MapControllers();                // 가장 안쪽: 실제 핸들러
```

여기 `UseRouting()` 이 안 보이는 이유가 있다. .NET 6 이후의 `WebApplication` 은 라우팅 매칭 미들웨어를 파이프라인 앞쪽에 자동으로 넣는다.
그래서 라우팅은 두 단계로 나뉜다. 앞쪽에서 "이 요청은 `PetsController.GetById` 로 간다"를 **고르기만** 하고,
실제 실행은 맨 안쪽 `MapControllers()` 지점에서 한다. 인가 미들웨어가 "이 엔드포인트에 `[Authorize]` 가 붙어 있나"를 알 수 있는 것도 이미 골라 두었기 때문이다.

> 입사 후 `Program.cs` 를 열면 이 목록이 회사 버전으로 20줄쯤 있을 것이다.
> **그 파일 하나가 그 서비스의 요청 처리 규칙 전부다.** 첫날 이 파일부터 읽어라. (`02-csharp-dotnet/02-aspnet-core.md` 1절에 실제 모양이 있다)

### 미들웨어를 "쓰는" 실제 경우

- **요청 로깅 / 추적 ID 부여** — 요청마다 `X-Request-Id` 를 만들어 모든 로그에 붙인다. 고객사에서 "3시에 에러 났어요" 할 때 이게 없으면 못 찾는다. (`07-db-infra/04-observability.md` 3절)
- **테넌트 판별** — 멀티테넌시에서 서브도메인이나 토큰에서 `tenant_id` 를 뽑아 컨텍스트에 심는다. 이게 있어야 아래 모든 계층이 "지금 어느 고객사인지" 안다. (`04-auth.md` 5절)
- **전역 예외 → 표준 에러 응답** — 아래 어디서 터지든 일관된 JSON 으로 바꿔 내보낸다.

모든 요청에 똑같이 적용돼야 하는 일이면 미들웨어, 특정 엔드포인트에만 필요한 일이면 컨트롤러나 필터(`[Authorize]` 같은 어트리뷰트)에 둔다.

---

## 3. 라우팅 — 경로를 코드에 연결

```csharp
[ApiController]
[Route("api/pets")]                          // 이 컨트롤러의 공통 접두사
public class PetsController : ControllerBase
{
    [HttpGet("{id:int}")]                    // GET /api/pets/42
    public async Task<ActionResult<PetDto>> GetById(int id) { ... }

    [HttpGet]                                // GET /api/pets?page=1&size=20
    public async Task<ActionResult<PagedResult<PetDto>>> List([FromQuery] PetQuery query) { ... }

    [HttpPost]                               // POST /api/pets  (바디 JSON)
    public async Task<ActionResult<PetDto>> Create([FromBody] CreatePetRequest req) { ... }
}
```

`[...]` 로 감싼 것은 어트리뷰트다. TS 데코레이터(`@Get(':id')`)처럼 클래스나 메서드에 메타데이터를 붙이고 프레임워크가 그걸 읽는다.

`{id:int}` 의 `:int` 는 **라우트 제약**이다. `/api/pets/abc` 는 아예 이 액션에 도달하지 못하고 404 가 된다.
내 코드에서 파싱 실패를 처리할 필요가 없어진다.

URL·쿼리스트링·바디에서 값을 꺼내 메서드 파라미터에 채워 넣는 과정을 **모델 바인딩**이라고 한다.
`id` 에 `42` 가 들어가 있는 건 프레임워크가 경로에서 문자열 `"42"` 를 꺼내 `int` 로 바꿔 준 결과다.
`[ApiController]` 가 붙어 있으면 바인딩·검증에 실패했을 때 액션을 실행하지 않고 400 을 자동으로 돌려준다.

**바인딩 소스**를 명시하는 습관을 들여라. 어디서 값이 오는지가 코드에 드러난다.

| 어트리뷰트 | 어디서 | 예 |
| --- | --- | --- |
| `[FromRoute]` | URL 경로 | `/api/pets/42` 의 `42` |
| `[FromQuery]` | 쿼리스트링 | `?page=1` |
| `[FromBody]` | 요청 바디 (JSON) | POST/PUT 의 내용 |
| `[FromHeader]` | 헤더 | `X-Tenant-Id` |
| `[FromServices]` | DI 컨테이너 | 잘 안 씀 (생성자 주입이 정석) |

---

## 4. HTTP 를 "제대로" 쓰는 것이 왜 중요한가

프론트만 할 때는 대충 다 `POST` 로 보내고 `200 OK` 에 `{ success: false }` 를 담아도 돌아간다.
백엔드에서 그러면 안 되는 이유는 **HTTP 를 지키면 공짜로 얻는 게 많기 때문**이다.
브라우저 캐시, 프록시의 자동 재시도, 모니터링 도구의 에러율 집계가 전부 메서드와 상태 코드를 보고 동작한다.
`200` 에 실패를 담으면 대시보드는 에러율 0% 를 보여 주고 TanStack Query 의 `onError` 도 불리지 않는다.

### 메서드

| 메서드 | 의미 | 안전한가 (safe) | 멱등한가 (idempotent) |
| --- | --- | --- | --- |
| `GET` | 조회 | ✅ 아무것도 안 바뀜 | ✅ |
| `POST` | 생성 / 그 외 | ❌ | ❌ 두 번 부르면 두 개 생김 |
| `PUT` | 전체 교체 | ❌ | ✅ 몇 번 해도 같은 상태 |
| `PATCH` | 부분 수정 | ❌ | 보통 ✅ |
| `DELETE` | 삭제 | ❌ | ✅ 두 번 지워도 없는 건 없는 거 |

두 열은 서로 다른 질문이다.

- **안전(safe)** — 서버 상태를 아예 바꾸지 않는가. `GET` 은 몇 번을 불러도 DB 에 아무것도 쓰지 않는다.
- **멱등(idempotent)** — 바꾸긴 하지만 한 번 하든 다섯 번 하든 최종 상태가 같은가.

**멱등성(idempotency)** = 같은 요청을 여러 번 보내도 결과 상태가 같다. 숫자로 보면 바로 보인다.

| 요청 | 1번 보낸 뒤 | 3번 보낸 뒤 | 멱등? |
| --- | --- | --- | --- |
| `PUT /pets/42 { "name": "루비" }` | 이름 = 루비 | 이름 = 루비 | ✅ |
| `DELETE /pets/42` | 42번 없음 | 42번 없음 (2·3번째는 404) | ✅ 상태는 같다 |
| `POST /orders { "item": "사료" }` | 주문 1건 | 주문 3건 | ❌ |
| `PATCH /pets/42 { "op": "addWeight", "kg": 1 }` | 체중 +1 | 체중 +3 | ❌ |

마지막 줄처럼 PATCH 는 "값을 이걸로 바꿔라"면 멱등이지만 "이만큼 더해라"면 멱등이 아니다. 표에서 "보통"이라고 적은 이유다.

이게 왜 중요하냐면 **네트워크는 항상 끊기고 클라이언트·프록시·큐는 재시도하기 때문**이다.
`GET` 이 멱등이라서 브라우저가 마음대로 재시도하고 캐시할 수 있다. `POST` 는 못 한다 — 결제가 두 번 될 수 있으니까.

> `05-long-running-jobs.md` 에서 "그럼 POST 를 안전하게 재시도하려면?" (= Idempotency-Key) 를 다룬다.

### 상태 코드 — 최소한 이것만

| 코드 | 언제 | 헷갈리는 포인트 |
| --- | --- | --- |
| `200 OK` | 성공 + 바디 있음 | |
| `201 Created` | 생성 성공 | `Location` 헤더에 새 리소스 URL 을 넣는 게 정석 |
| `204 No Content` | 성공 + 바디 없음 | DELETE, PUT 응답에 자주 |
| `400 Bad Request` | **요청이 잘못됨** | 형식·필수값 오류 |
| `401 Unauthorized` | **누구인지 모름** | 이름이 잘못 지어졌다. 실제 의미는 "인증 안 됨" |
| `403 Forbidden` | **누군지는 아는데 권한 없음** | 401 과 이 구분을 못 하면 프론트가 로그인 화면을 잘못 띄운다 |
| `404 Not Found` | 없음 | 보안상 403 대신 404 를 주기도 한다 (존재 자체를 숨김) |
| `409 Conflict` | 상태 충돌 | 중복 생성, 동시 수정 충돌 |
| `422` | 형식은 맞는데 의미가 틀림 | 400 으로 퉁치는 팀도 많다. 팀 컨벤션 확인할 것 |
| `500` | 서버 잘못 | **여기에 내부 예외 메시지를 노출하면 보안 사고** |
| `502 / 503 / 504` | 게이트웨이·과부하·타임아웃 | 내 코드가 아니라 인프라가 냈을 가능성 |

앞자리로 크게 나누면 외우기 쉽다. 4xx 는 "요청한 쪽이 고쳐야 한다", 5xx 는 "서버 쪽이 고쳐야 한다"다.
그래서 프론트의 자동 재시도도 보통 5xx 와 네트워크 오류에만 건다. 400 을 몇 번 다시 보내도 결과는 400 이다.

500 에 예외 메시지를 그대로 내보내면 안 되는 이유는 구체적이다. `Npgsql.PostgresException: relation "pets_internal" ...` 같은 문장에는
테이블 이름, 라이브러리 버전, 때로는 쿼리 일부가 들어 있다. 공격자에게 내부 구조를 알려 주는 셈이다.
사용자에게는 "문제가 생겼습니다 + 추적 ID"만 주고 상세 내용은 서버 로그에 남긴다.

> ❓ 입사 후 확인: 우리 팀 에러 응답 포맷은? (RFC 7807 `ProblemDetails` 를 쓰는지, 자체 포맷인지)
> ASP.NET Core 는 `ProblemDetails` 가 기본 내장이다.

`ProblemDetails` 는 에러 응답 JSON 의 표준 모양이다. 대략 이렇게 생겼다.

```json
{
  "type": "https://tools.ietf.org/html/rfc9110#section-15.5.10",
  "title": "Conflict",
  "status": 409,
  "detail": "다른 사람이 먼저 수정했습니다.",
  "traceId": "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"
}
```

프론트는 에러마다 모양을 따로 파싱할 필요 없이 `status` 와 `detail` 만 보면 된다.
예외를 이 모양으로 바꾸는 코드는 `02-csharp-dotnet/02-aspnet-core.md` 6절에 있다.

---

## 5. 동시성 — 프론트에 없던 개념

```csharp
public class PetService
{
    private int _count;          // ❌ 절대 하면 안 되는 것

    public void Handle() { _count++; }   // 500개 요청이 동시에 여기 들어온다
}
```

서버는 요청마다 스레드(또는 비동기 태스크)를 쓴다. 스레드는 CPU 가 동시에 따로 실행할 수 있는 작업 흐름 하나다.
JS 는 스레드가 하나뿐이라 코드 두 줄이 정말로 같은 순간에 돌 일이 없었지만 C# 서버는 여러 스레드가 같은 객체를 진짜로 동시에 만진다.
인스턴스가 여러 요청에 공유되는 순간 그 안의 가변 필드는 **경쟁 상태(race condition)** 가 된다.

`_count++` 는 한 줄이지만 실제로는 "읽기 → 1 더하기 → 쓰기" 세 단계다. 요청 A 와 B 가 겹치면 이렇게 된다.

| 시점 | 요청 A | 요청 B | `_count` |
| --- | --- | --- | --- |
| t1 | 읽음: 5 | | 5 |
| t2 | | 읽음: 5 | 5 |
| t3 | 6 을 씀 | | 6 |
| t4 | | 6 을 씀 | 6 ← 두 번 더했는데 1 만 늘었다 |

이 버그는 로컬에서 혼자 클릭할 때는 절대 재현되지 않는다. 동시 요청이 몰리는 운영에서만, 그것도 가끔 나타난다.

해결책은 락이 아니라 **상태를 안 갖는 것**이다. 서비스는 함수처럼 동작하고 상태는 전부 DB 나 요청 컨텍스트에 둔다.
→ 이게 `02-layers-and-di.md` 의 **생명주기(Scoped/Singleton)** 이야기로 이어진다.

### async/await — 의미가 프론트와 다르다

```csharp
// ❌ 동기: 이 스레드는 DB 응답 200ms 동안 아무것도 못 하고 묶여 있다
var pet = _db.Pets.First(p => p.Id == id);

// ✅ 비동기: 기다리는 동안 스레드를 반납 → 다른 요청을 처리한다
var pet = await _db.Pets.FirstAsync(p => p.Id == id);
```

JS 는 애초에 싱글 스레드라 `await` 가 "UI 안 멈추게" 하는 장치였다.
C# 서버에서 `await` 는 **스레드 풀 고갈을 막아 처리량(throughput)을 올리는** 장치다. 목적이 다르다.

두 용어를 풀면 이렇다.

- **스레드 풀** — 서버가 미리 만들어 두고 돌려 쓰는 스레드 묶음. 스레드를 새로 만드는 건 비싸서 요청이 올 때마다 풀에서 하나 빌려 쓰고 반납한다.
- **처리량(throughput)** — 단위 시간에 처리하는 요청 수. 응답 속도(한 요청이 얼마나 빨리 끝나나)와는 다른 지표다.

숫자로 보면 차이가 크다. 요청 하나가 DB 를 200ms 기다리고 풀에 스레드가 10개 있다고 하자.

| | 스레드 하나가 1초에 처리하는 요청 | 스레드 10개로 1초에 |
| --- | --- | --- |
| 동기 (`First`) | 200ms 씩 묶이므로 5건 | 50건. 51번째부터 줄을 선다 |
| 비동기 (`FirstAsync`) | 기다리는 동안 반납하므로 DB 가 버티는 만큼 | 수백 건 이상 |

`await` 는 요청 하나를 빠르게 만들지 않는다. 같은 스레드로 더 많은 요청을 받게 해 준다.
스레드가 모자라면 .NET 은 풀에 스레드를 천천히 추가하는데 그사이 요청은 대기열에서 쌓이고 응답 시간이 갑자기 몇 초씩 튄다. 이걸 스레드 풀 고갈(starvation)이라고 부른다.

**규칙: I/O 가 있는 함수는 끝까지 `async` 로 전파한다.** 중간에 `.Result` 나 `.Wait()` 로 동기화하면
데드락이 나거나 스레드가 묶인다. ("async all the way")

I/O 는 CPU 가 계산하는 게 아니라 바깥(DB, 다른 API, 파일)의 응답을 기다리는 작업이다.
데드락은 두 쪽이 서로 상대가 끝나기를 기다리며 영원히 멈추는 상태다.
ASP.NET Core 자체에서는 고전적인 데드락이 드물지만 `.Result` 는 그 스레드를 응답이 올 때까지 붙들어 두므로 위 표의 "동기" 줄과 똑같아진다.

### async 를 쓸 때 자주 하는 실수

| 코드 | 무엇이 문제인가 | 대신 |
| --- | --- | --- |
| `var x = GetAsync().Result;` | 스레드를 묶는다. 환경에 따라 데드락 | `var x = await GetAsync();` |
| `public async void Save()` | 호출한 쪽이 `await` 할 수 없고 안에서 던진 예외를 아무도 못 잡는다. 서버 프로세스가 죽을 수 있다 | `public async Task Save()`. `async void` 는 이벤트 핸들러 전용 |
| `await Task.Run(() => _db.Pets.ToListAsync())` | 이미 비동기인 작업을 다른 스레드에 한 번 더 맡겨 스레드만 낭비 | 그냥 `await _db.Pets.ToListAsync()` |
| 같은 `DbContext` 로 `Task.WhenAll(q1, q2)` | `DbContext` 는 한 번에 쿼리 하나만 처리한다. "A second operation was started on this context instance" 예외 | 순서대로 `await` 하거나, 정말 병렬이 필요하면 쿼리마다 별도 스코프 |
| 액션에 `CancellationToken` 을 안 받음 | 사용자가 탭을 닫아도 서버는 쿼리를 끝까지 돌린다 | 아래 예처럼 받아서 끝까지 넘긴다 |

TS 로 치면 `async void` 는 `promise.then()` 을 걸어 놓고 `.catch()` 도 `await` 도 안 한 상태다.
브라우저에서는 콘솔에 "Uncaught (in promise)" 가 찍히고 끝나지만 서버에서는 그 예외가 프로세스 전체를 내릴 수 있다.

```csharp
[HttpGet]
public async Task<ActionResult<List<PetDto>>> List(CancellationToken ct)   // ← 프레임워크가 넣어 준다
{
    return await _petService.ListAsync(ct);    // 서비스 → 리포지토리 → ToListAsync(ct) 까지 그대로 전달
}
```

액션 파라미터에 `CancellationToken` 을 두면 ASP.NET Core 가 "클라이언트 연결이 끊기면 취소되는 토큰"을 넣어 준다.
프론트의 `AbortController` 와 같은 역할이고 `fetch` 에 `signal` 을 넘기듯 아래 계층까지 계속 넘겨야 실제로 쿼리가 멈춘다.
독립적인 외부 API 두 개를 동시에 부를 때(`Task.WhenAll`)는 `Promise.all` 처럼 쓰면 된다. 다만 위 표처럼 같은 `DbContext` 를 나눠 쓰는 경우는 예외다.

---

## 6. 손으로 따라가 보기

```
GET /api/pets/42
Authorization: Bearer eyJ...
```

1. **Kestrel** 이 소켓에서 바이트를 읽어 `HttpContext` 를 만든다
2. **ExceptionHandler** 미들웨어: try 블록을 열고 다음으로
3. **Routing (매칭)**: `/api/pets/{id:int}` 패턴 매칭 → `PetsController.GetById` 로 갈 것을 정하고 `id=42` 를 뽑아 둔다. 실행은 아직 안 한다
4. **Authentication**: `Bearer` 토큰 서명 검증 → `context.User` 에 클레임(userId, tenantId, role) 채움
5. **Authorization**: 3에서 고른 엔드포인트에 `[Authorize(Roles="Vet")]` 가 있나? User 의 role 과 대조
6. **DI 컨테이너**: `PetsController` 생성 → 생성자가 요구하는 `IPetService` 생성 → 그게 요구하는 `AppDbContext` 생성 (이 요청 전용 인스턴스)
7. **액션 실행**: `id=42` 를 파라미터에 바인딩하고 `await _petService.GetAsync(42)`
8. **서비스**: 권한 확인(이 테넌트의 펫인가) → `await _repo.FindAsync(42)`
9. **EF Core**: LINQ → SQL 번역 → 커넥션 풀에서 커넥션 대여 → 쿼리 → 엔티티 매핑 → 커넥션 반납
10. **되돌아 나오며**: 엔티티 → DTO 변환 → `200 OK` + JSON 직렬화
11. 미들웨어를 역순으로 통과 (로깅 미들웨어가 소요 시간 기록)
12. **DI 컨테이너가 Scoped 객체들을 Dispose** — `DbContext` 정리
13. Kestrel 이 소켓에 응답 기록

중간에 나온 용어를 정리한다.

- **클레임(claim)** — 토큰 안에 담긴 "이 사용자에 대한 사실" 한 줄씩. `sub=user-123`, `tid=tenant-abc`, `role=Vet` 같은 키-값이다. (`04-auth.md` 2절)
- **엔티티 / DTO** — 엔티티는 DB 테이블 모양의 C# 클래스, DTO 는 API 응답 모양의 클래스다. 둘을 왜 나누는지가 `02-layers-and-di.md` 2절이다.
- **직렬화** — C# 객체를 JSON 문자열로 바꾸는 것. `JSON.stringify` 와 같다.
- **Dispose** — 객체가 쥐고 있던 자원(DB 커넥션, 파일 핸들)을 돌려주는 정리 메서드. JS 의 GC 는 메모리만 치워 주고 커넥션은 안 닫아 주므로, 이런 자원은 명시적으로 닫아야 한다.

4번에서 토큰이 없거나 틀리면 그 자리에서 401 로 단락되고 5번에서 역할이 안 맞으면 403 으로 단락된다. 둘 다 6번 이후는 실행되지 않는다.

**10번과 12번을 기억해라.** "엔티티를 그대로 내보내면 왜 안 되는가"와 "DbContext 는 왜 요청마다 새로 만드는가"가
다음 문서의 주제다.

---

## 스스로 답해보기

1. `app.UseAuthorization()` 을 `app.UseAuthentication()` 앞에 두면 무슨 일이 생기나?
2. 401 과 403 의 차이는? 프론트에서 각각 어떻게 다르게 처리해야 하나?
3. `POST /api/orders` 요청이 타임아웃 났는데 실제로는 서버에서 성공했다. 클라이언트가 재시도하면?
4. 서비스 클래스에 `private List<string> _cache` 를 두면 왜 위험한가?
5. C# 서버에서 `await` 를 쓰는 이유는 JS 와 어떻게 다른가?
6. 컨트롤러 액션에 브레이크포인트를 걸었는데 요청이 401 로 끝나고 멈추지 않는다. 어디를 봐야 하나?
7. `PATCH /cart { "op": "add", "qty": 1 }` 은 멱등한가? 재시도하면 무슨 일이 생기나?
8. 사용자가 무거운 목록 화면을 열자마자 닫았다. 서버의 쿼리까지 멈추게 하려면 무엇이 필요한가?
