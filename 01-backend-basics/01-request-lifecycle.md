# 요청 하나의 수명주기

`fetch('/api/pets/42')` 를 부르고 나서 응답이 돌아올 때까지, 서버 안에서 무슨 일이 일어나는가.
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
┌─────────────────────────────────────────────┐
│  미들웨어 파이프라인                            │  ← 여기가 ASP.NET Core 의 본체
│   예외처리 → HTTPS → CORS → 인증 → 인가 → 라우팅 │
└─────────────────────────────────────────────┘
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

---

## 2. 미들웨어 파이프라인 — 양파 구조

미들웨어는 요청을 받아서 **다음 미들웨어를 부를지 말지 결정하는 함수**다.

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

`await next()` 앞은 요청이 들어갈 때, 뒤는 응답이 나올 때 실행된다. 양파 껍질을 뚫고 들어갔다 나오는 모양이다.

**이미 아는 것과 같다:**

| 개념 | ASP.NET Core | 내가 아는 것 |
| --- | --- | --- |
| 요청 전후를 감싸는 함수 | 미들웨어 | Express `app.use((req,res,next)=>{})` — **거의 동일** |
| | | Next.js `middleware.ts` |
| | | axios interceptor (요청/응답 양방향) |
| 순서가 곧 동작 | 등록 순서대로 실행 | Express 와 동일하게 **순서가 전부** |

**순서가 왜 전부인가:** 인증 미들웨어보다 인가 미들웨어를 먼저 등록하면, 아직 "누구인지" 모르는 상태에서 "이 사람이 할 수 있나"를 판정하게 된다. 항상 401 이 뜨거나, 더 나쁘게는 항상 통과한다.

```csharp
// Program.cs — 이 순서에는 이유가 있다
app.UseExceptionHandler("/error");   // 가장 바깥: 아래 전부의 예외를 잡아야 하니까
app.UseHttpsRedirection();
app.UseCors();                       // 인증보다 먼저: preflight(OPTIONS)에는 토큰이 없다
app.UseAuthentication();             // 너는 누구냐 → context.User 를 채운다
app.UseAuthorization();              // 너는 이걸 해도 되냐 → User 가 채워진 뒤라야 함
app.MapControllers();                // 가장 안쪽: 실제 핸들러
```

> 입사 후 `Program.cs` 를 열면 이 목록이 회사 버전으로 20줄쯤 있을 것이다.
> **그 파일 하나가 그 서비스의 요청 처리 규칙 전부다.** 첫날 이 파일부터 읽어라.

### 미들웨어를 "쓰는" 실제 경우

- **요청 로깅 / 추적 ID 부여** — 요청마다 `X-Request-Id` 를 만들어 모든 로그에 붙인다. 고객사에서 "3시에 에러 났어요" 할 때 이게 없으면 못 찾는다.
- **테넌트 판별** — 멀티테넌시에서 서브도메인이나 토큰에서 `tenant_id` 를 뽑아 컨텍스트에 심는다. 이게 있어야 아래 모든 계층이 "지금 어느 고객사인지" 안다.
- **전역 예외 → 표준 에러 응답** — 아래 어디서 터지든 일관된 JSON 으로 바꿔 내보낸다.

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

`{id:int}` 의 `:int` 는 **라우트 제약**이다. `/api/pets/abc` 는 아예 이 액션에 도달하지 못하고 404 가 된다.
내 코드에서 파싱 실패를 처리할 필요가 없어진다.

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
백엔드에서 그러면 안 되는 이유는, **HTTP 를 지키면 공짜로 얻는 게 많기 때문**이다.

### 메서드

| 메서드 | 의미 | 안전한가 (safe) | 멱등한가 (idempotent) |
| --- | --- | --- | --- |
| `GET` | 조회 | ✅ 아무것도 안 바뀜 | ✅ |
| `POST` | 생성 / 그 외 | ❌ | ❌ 두 번 부르면 두 개 생김 |
| `PUT` | 전체 교체 | ❌ | ✅ 몇 번 해도 같은 상태 |
| `PATCH` | 부분 수정 | ❌ | 보통 ✅ |
| `DELETE` | 삭제 | ❌ | ✅ 두 번 지워도 없는 건 없는 거 |

**멱등성(idempotency)** = 같은 요청을 여러 번 보내도 결과 상태가 같다.
이게 왜 중요하냐면 **네트워크는 항상 끊기고, 클라이언트·프록시·큐는 재시도하기 때문**이다.
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

> ❓ 입사 후 확인: 우리 팀 에러 응답 포맷은? (RFC 7807 `ProblemDetails` 를 쓰는지, 자체 포맷인지)
> ASP.NET Core 는 `ProblemDetails` 가 기본 내장이다.

---

## 5. 동시성 — 프론트에 없던 개념

```csharp
public class PetService
{
    private int _count;          // ❌ 절대 하면 안 되는 것

    public void Handle() { _count++; }   // 500개 요청이 동시에 여기 들어온다
}
```

서버는 요청마다 스레드(또는 비동기 태스크)를 쓴다. 인스턴스가 여러 요청에 공유되는 순간,
그 안의 가변 필드는 **경쟁 상태(race condition)** 가 된다.

해결책은 락이 아니라 **상태를 안 갖는 것**이다. 서비스는 함수처럼 동작하고, 상태는 전부 DB 나 요청 컨텍스트에 둔다.
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

**규칙: I/O 가 있는 함수는 끝까지 `async` 로 전파한다.** 중간에 `.Result` 나 `.Wait()` 로 동기화하면
데드락이 나거나 스레드가 묶인다. ("async all the way")

---

## 6. 손으로 따라가 보기

```
GET /api/pets/42
Authorization: Bearer eyJ...
```

1. **Kestrel** 이 소켓에서 바이트를 읽어 `HttpContext` 를 만든다
2. **ExceptionHandler** 미들웨어: try 블록을 열고 다음으로
3. **Authentication**: `Bearer` 토큰 서명 검증 → `context.User` 에 클레임(userId, tenantId, role) 채움
4. **Authorization**: 이 엔드포인트에 `[Authorize(Roles="Vet")]` 가 있나? User 의 role 과 대조
5. **Routing**: `/api/pets/{id:int}` 패턴 매칭 → `PetsController.GetById` 선택, `id=42` 바인딩
6. **DI 컨테이너**: `PetsController` 생성 → 생성자가 요구하는 `IPetService` 생성 → 그게 요구하는 `AppDbContext` 생성 (이 요청 전용 인스턴스)
7. **액션 실행**: `await _petService.GetAsync(42)`
8. **서비스**: 권한 확인(이 테넌트의 펫인가) → `await _repo.FindAsync(42)`
9. **EF Core**: LINQ → SQL 번역 → 커넥션 풀에서 커넥션 대여 → 쿼리 → 엔티티 매핑 → 커넥션 반납
10. **되돌아 나오며**: 엔티티 → DTO 변환 → `200 OK` + JSON 직렬화
11. 미들웨어를 역순으로 통과 (로깅 미들웨어가 소요 시간 기록)
12. **DI 컨테이너가 Scoped 객체들을 Dispose** — `DbContext` 정리
13. Kestrel 이 소켓에 응답 기록

**10번과 12번을 기억해라.** "엔티티를 그대로 내보내면 왜 안 되는가"와 "DbContext 는 왜 요청마다 새로 만드는가"가
다음 문서의 주제다.

---

## 스스로 답해보기

1. `app.UseAuthorization()` 을 `app.UseAuthentication()` 앞에 두면 무슨 일이 생기나?
2. 401 과 403 의 차이는? 프론트에서 각각 어떻게 다르게 처리해야 하나?
3. `POST /api/orders` 요청이 타임아웃 났는데 실제로는 서버에서 성공했다. 클라이언트가 재시도하면?
4. 서비스 클래스에 `private List<string> _cache` 를 두면 왜 위험한가?
5. C# 서버에서 `await` 를 쓰는 이유는 JS 와 어떻게 다른가?
