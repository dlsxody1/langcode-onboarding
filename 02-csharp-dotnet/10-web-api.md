# Web API 만들기 — 컨트롤러 · Minimal API · 시험용 정리

`02-aspnet-core.md` 가 Program.cs 부터 설정·로깅·테스트까지 훑은 문서라면, 이 문서는 **"Web API 를 만든다"는 한 가지에 집중**한다.
컨트롤러와 Minimal API 를 나란히 놓고, 바인딩 · 반환 · 상태코드 · 필터 · 검증을 시험 문제 단위로 정리했다.

> 공식 문서: [컨트롤러 기반 Web API](https://learn.microsoft.com/ko-kr/aspnet/core/tutorials/first-web-api) ·
> [Minimal API](https://learn.microsoft.com/ko-kr/aspnet/core/tutorials/min-web-api) ·
> [Minimal API 개요](https://learn.microsoft.com/ko-kr/aspnet/core/fundamentals/minimal-apis)

---

## 1. 두 가지 방식

| | 컨트롤러 | Minimal API |
| --- | --- | --- |
| 모양 | `class` + 액션 메서드 | `app.MapGet(...)` 람다·메서드 |
| 등록 | `AddControllers()` + `MapControllers()` | `MapGet` `MapPost` … |
| 라우팅 | 특성 `[Route]` `[HttpGet]` | 호출 시 경로 문자열 |
| 필터 | Action · Result · Exception **필터** | **Endpoint 필터** |
| 검증 | `[ApiController]` 가 자동 400 | 직접, 또는 .NET 10 `AddValidation()` |
| 어울리는 곳 | 규모 큰 API · 기존 코드 | 마이크로서비스 · 작은 API · 시작 빠름 |

둘은 **섞어 써도 된다**. 같은 파이프라인 위에서 돈다. Minimal API 가 "기능이 적다"는 건 옛말이다 — 지금은 대부분 따라잡았다.

```csharp
// 컨트롤러
[ApiController]
[Route("api/[controller]")]
public class TodosController(ITodoService svc) : ControllerBase
{
    [HttpGet("{id:int}")]
    public async Task<ActionResult<TodoDto>> Get(int id, CancellationToken ct)
    {
        var todo = await svc.FindAsync(id, ct);
        return todo is null ? NotFound() : Ok(todo);
    }
}

// Minimal API
app.MapGet("/api/todos/{id:int}", async (int id, ITodoService svc, CancellationToken ct) =>
    await svc.FindAsync(id, ct) is { } todo ? Results.Ok(todo) : Results.NotFound());
```

### JS (Express) 와 비교

Minimal API 는 Express 와 모양이 거의 같다.

```js
// Express
app.get("/api/todos/:id", async (req, res) => {
  const todo = await svc.find(Number(req.params.id));
  if (!todo) return res.sendStatus(404);
  res.json(todo);
});
```

| Express | ASP.NET Core |
| --- | --- |
| `app.get(path, handler)` | `app.MapGet(path, handler)` |
| `req.params.id` (문자열 → 직접 `Number()`) | 핸들러 인자 `int id` 로 **자동 변환** |
| `req.query.page` | 인자 `int page` (단순 타입이면 쿼리) |
| `req.body` (`express.json()` 필요) | 복합 타입 인자 (JSON 자동 역직렬화) |
| `res.status(404).json(x)` | `Results.NotFound()` / `Results.Ok(x)` |
| `app.use(mw)` (미들웨어) | `app.Use...()` (미들웨어, 등록 **순서**가 중요한 것은 같다) |
| 전역 변수·모듈로 공유 | **DI**: 인자로 서비스가 자동 주입된다 |
| 클래스 + 데코레이터 (NestJS) | 컨트롤러 + 특성(`[HttpGet]`) |

---

## 2. Program.cs — API 에 필요한 최소 구성

```csharp
var builder = WebApplication.CreateBuilder(args);

builder.Services.AddControllers();          // 컨트롤러를 쓸 때
builder.Services.AddOpenApi();              // OpenAPI 문서 생성 (.NET 9+ 내장)
builder.Services.AddProblemDetails();       // 오류를 RFC 9457 형식으로
builder.Services.AddScoped<ITodoService, TodoService>();

var app = builder.Build();

app.UseExceptionHandler();                  // 예외 → ProblemDetails
app.UseAuthentication();                    // 반드시 인증이 먼저
app.UseAuthorization();

app.MapControllers();
app.MapOpenApi();                           // /openapi/v1.json
app.Run();
```

- **인증(Authentication) → 인가(Authorization)** 순서. 뒤집으면 판정 대상이 비어 있다.
- .NET 9 부터 **OpenAPI 문서 생성이 내장**(`Microsoft.AspNetCore.OpenApi`)이다. 예전의 Swashbuckle 은 템플릿에서 빠졌다.
- UI(Swagger UI · Scalar 등)는 별도 패키지다. 내장은 **JSON 문서**까지.

---

## 3. 라우팅

```csharp
[HttpGet("{id:int}")]            // 경로 제약: id 가 정수일 때만 매치
[HttpGet("{slug:minlength(3)}")]
app.MapGet("/files/{**path}", ...);   // catch-all
```

| 제약 | 의미 |
| --- | --- |
| `:int` `:long` `:guid` | 해당 타입만 |
| `:bool` `:datetime` | 해당 타입만 |
| `:min(1)` `:range(1,10)` | 값 범위 |
| `:minlength(n)` `:regex(..)` | 문자열 제약 |
| `:alpha` | 영문자만 |

- `[Route("api/[controller]")]` 에서 `[controller]` 는 클래스 이름에서 `Controller` 를 뺀 값으로 치환된다.
- **같은 경로 + 같은 메서드**가 둘 이상이면 `AmbiguousMatchException` (500).
- 제약에 안 맞으면 **404** 다 (400 이 아니다 — 라우트가 매치되지 않는다).

---

## 4. 모델 바인딩 — 값이 어디서 오나

| 특성 | 출처 | 기본으로 추정되는 경우 |
| --- | --- | --- |
| `[FromRoute]` | 경로 `{id}` | 이름이 라우트 템플릿에 있으면 |
| `[FromQuery]` | 쿼리 `?page=2` | 단순 타입 |
| `[FromBody]` | 요청 본문 (JSON) | 복합 타입 (`[ApiController]` 일 때) |
| `[FromHeader]` | 헤더 | 명시해야 함 |
| `[FromForm]` | 폼 / 파일 | 명시해야 함 |
| `[FromServices]` | **DI 컨테이너** | Minimal API 는 자동 |

```csharp
app.MapPost("/api/todos", (CreateTodo body, ITodoService svc, ILogger<Program> log) => ...);
//                         └ 본문(JSON)      └ DI            └ DI
```

Minimal API 의 추정 규칙 (단순 → 복합):
1. 경로에 있으면 route, 2. 서비스로 등록돼 있으면 DI, 3. 단순 타입이면 query, 4. 그 외 복합 타입은 **body**.

**본문은 하나만** 받을 수 있다. `[FromBody]` 가 둘이면 안 된다 (스트림을 한 번만 읽는다).

JS 에서는 `req` 객체 하나에서 `params` / `query` / `body` / `headers` 를 **직접 꺼내 쓴다**. ASP.NET 은 반대로 **핸들러 인자의 타입과 이름을 보고** 프레임워크가 알아서 꺼내서 채워 준다. 그래서 위 표의 "출처" 개념이 필요하다.

---

## 5. 반환 — 상태코드를 돌려주는 법

| 하고 싶은 일 | 컨트롤러 | Minimal API |
| --- | --- | --- |
| 200 | `Ok(x)` | `Results.Ok(x)` |
| 201 + Location | `CreatedAtAction(...)` | `Results.Created(uri, x)` |
| 204 | `NoContent()` | `Results.NoContent()` |
| 400 | `BadRequest()` | `Results.BadRequest()` |
| 404 | `NotFound()` | `Results.NotFound()` |
| 409 | `Conflict()` | `Results.Conflict()` |
| 422 | `UnprocessableEntity()` | `Results.UnprocessableEntity()` |
| ProblemDetails | `Problem(...)` | `Results.Problem(...)` |

```csharp
// TypedResults — 반환 타입이 시그니처에 드러난다. OpenAPI 문서·테스트에 유리
app.MapGet("/api/todos/{id}", async Task<Results<Ok<TodoDto>, NotFound>> (int id, ITodoService s) =>
    await s.FindAsync(id) is { } t ? TypedResults.Ok(t) : TypedResults.NotFound());
```

- 컨트롤러에서 `ActionResult<T>` 를 쓰면 **`T` 를 직접 반환하거나 상태코드 결과**를 반환할 수 있고, OpenAPI 도 정확해진다.
- `Results` 는 `IResult` 를 돌려주고, `TypedResults` 는 **구체 타입**을 돌려준다. 후자가 단위 테스트에서 `Assert.IsType<Ok<T>>` 가 가능하다.
- 생성(POST) 성공은 **201 + Location 헤더**가 정석이다. 200 이 아니다.

### 상태코드 정리

| 코드 | 의미 | 언제 |
| --- | --- | --- |
| 200 | OK | 조회·수정 성공 |
| 201 | Created | 생성 성공 |
| 204 | No Content | 성공했지만 줄 본문이 없음 (삭제·PUT) |
| 400 | Bad Request | 형식이 잘못됨, 바인딩 실패 |
| 401 | Unauthorized | **누구인지 모름** (인증 안 됨) |
| 403 | Forbidden | 누구인지 알지만 **권한 없음** |
| 404 | Not Found | 리소스 없음 |
| 409 | Conflict | 상태 충돌 (중복, 동시성) |
| 422 | Unprocessable | 형식은 맞는데 의미상 불가 |
| 429 | Too Many Requests | 레이트 리밋 |
| 500 | Internal Server Error | 처리 안 된 예외 |

> 401 과 403 을 바꿔 쓰는 실수가 가장 많다. 401 은 "로그인해라", 403 은 "로그인했는데 안 된다".

---

## 6. [ApiController] 가 해주는 것

컨트롤러에 `[ApiController]` 를 붙이면:

1. **자동 400** — `ModelState` 가 유효하지 않으면 액션 본문에 들어가기 전에 400 + ProblemDetails.
2. **바인딩 소스 추정** — 복합 타입은 `[FromBody]`, 단순 타입은 query/route.
3. **ProblemDetails 응답** — 오류 상태코드 응답이 `application/problem+json`.
4. **특성 라우팅 필수** — 관례 기반 라우팅 불가.
5. multipart/form-data 요청 추정 (`[FromForm]`).

그래서 `if (!ModelState.IsValid) return BadRequest(ModelState);` 는 `[ApiController]` 가 있으면 **쓸 필요가 없다** (도달하지 않는다).

---

## 7. 검증

```csharp
public record CreateTodo(
    [property: Required, StringLength(100, MinimumLength = 1)] string Title,
    [property: Range(1, 5)] int Priority);
```

| 도구 | 설명 |
| --- | --- |
| 데이터 주석 | `[Required]` `[StringLength]` `[Range]` `[EmailAddress]` |
| `IValidatableObject` | 여러 필드에 걸친 검증을 `Validate()` 로 |
| FluentValidation | 외부 라이브러리. 규칙을 클래스로 분리 |
| Minimal API | .NET 10 에서 `AddValidation()` 으로 데이터 주석 검증 내장. 이전에는 직접 |

- 검증 실패는 **400** (ProblemDetails 의 `errors` 에 필드별 메시지).
- 데이터 주석이 **형식·범위**를 본다면, "이미 존재하는 이메일" 같은 **비즈니스 규칙은 서비스 계층**에서 판단하고 409 로 돌려준다.

---

## 8. 오류 응답 — ProblemDetails

```json
{
  "type": "https://tools.ietf.org/html/rfc9110#section-15.5.5",
  "title": "Not Found",
  "status": 404,
  "detail": "Todo 42 를 찾을 수 없습니다",
  "traceId": "00-..."
}
```

- 표준(RFC 9457, 전신 RFC 7807)이고 미디어 타입은 `application/problem+json`.
- 전역 예외 처리: `UseExceptionHandler()` + **`IExceptionHandler`** (.NET 8+) 로 예외 종류를 상태코드로 매핑한다. 컨트롤러마다 try/catch 를 두지 않는다.
- 개발 환경이 아니면 **스택 트레이스를 응답에 넣지 않는다**.

---

## 9. 필터 · 미들웨어

| | 위치 | 쓰임 |
| --- | --- | --- |
| **미들웨어** | 파이프라인 전체 (모든 요청) | 로깅 · 인증 · CORS · 예외 |
| **Action 필터** | 컨트롤러 액션 전후 | 모델 바인딩 후 가공 |
| **Result 필터** | 결과 실행 전후 | 응답 래핑 |
| **Exception 필터** | 액션의 예외 | 컨트롤러 한정 |
| **Endpoint 필터** | Minimal API 엔드포인트 | 검증 · 로깅 |

미들웨어는 **MVC 를 모른다**. 액션 정보(어떤 컨트롤러·어떤 인자)가 필요하면 필터, 모든 요청에 걸리면 미들웨어.

```csharp
app.MapPost("/api/todos", Create)
   .AddEndpointFilter(async (ctx, next) =>
   {
       var dto = ctx.GetArgument<CreateTodo>(0);
       if (string.IsNullOrWhiteSpace(dto.Title))
           return Results.ValidationProblem(new() { ["title"] = ["필수"] });
       return await next(ctx);
   });
```

---

## 10. 직렬화 · 비동기 · 취소

- 기본 JSON 은 **System.Text.Json**, 이름은 **camelCase**. 바꾸려면 `ConfigureHttpJsonOptions` / `AddJsonOptions`.
- 모든 액션은 `async Task<…>` + `CancellationToken ct` 를 받아 하위로 전달한다. 클라이언트가 끊으면 취소 토큰이 신호를 준다.
- 서버에서 DB 엔티티를 **그대로 반환하지 않는다**. DTO(record)로 바꿔 주고받는다 — 순환 참조, 과다 노출, 스키마 결합을 막는다.

---

## 11. 그 밖의 시험 포인트

| 주제 | 요점 |
| --- | --- |
| CORS | 브라우저가 거는 제약. `AddCors` + `UseCors`. 서버 간 호출에는 해당 없음 |
| 인증 | JWT Bearer: `AddAuthentication().AddJwtBearer()`. `[Authorize]` · `[AllowAnonymous]` |
| 버저닝 | URL(`/v1/`) · 헤더 · 쿼리. `Asp.Versioning` 라이브러리 |
| 멱등성 | `GET` `PUT` `DELETE` 는 멱등, `POST` 는 아님 |
| PUT vs PATCH | PUT 은 **전체 교체**, PATCH 는 **부분 수정** |
| 페이지네이션 | `page` + `size` (오프셋), 또는 커서. 정렬이 필요하다 |
| 레이트 리밋 | `AddRateLimiter` (.NET 7+) → 초과 시 429 |
| 헬스체크 | `AddHealthChecks` + `MapHealthChecks("/health")` |

---

## 12. 자주 틀리는 것

1. 생성 성공은 **201 + Location**. 200 이 아니다.
2. **401** = 로그인 안 함, **403** = 권한 없음.
3. 경로 제약에 안 맞으면 **404**. 400 이 아니다.
4. `[ApiController]` 가 있으면 `ModelState.IsValid` 검사가 필요 없다.
5. 본문(`[FromBody]`)은 **하나만**.
6. 미들웨어 순서: `UseAuthentication` → `UseAuthorization`.
7. 엔티티를 직접 반환하지 말고 **DTO**.
8. `Results` 와 `TypedResults` 의 차이는 반환 타입이 구체적인가.
9. 컨트롤러는 `ControllerBase` 를 상속한다 (`Controller` 는 View 지원 포함이라 API 엔 과하다).
10. `AddOpenApi` / `MapOpenApi` 는 **JSON 문서** — Swagger UI 는 아니다.

---

## 스스로 답해보기

1. 컨트롤러와 Minimal API 를 비교하고, 언제 무엇을 고르겠는가?
2. `[ApiController]` 가 해주는 일 세 가지는?
3. 다음 파라미터가 각각 어디서 바인딩되는가: `int id` (경로에 `{id}`), `string q`, `CreateTodo body`, `ITodoService svc`?
4. 생성 요청의 성공 응답은 몇 번이고, 어떤 헤더가 따라오나?
5. 401 과 403 의 차이를 예로 설명하라.
6. `Results.Ok` 와 `TypedResults.Ok` 의 차이는?
7. 미들웨어와 필터의 차이는? 각각 언제 쓰나?
8. ProblemDetails 가 무엇이고 왜 쓰나? 전역 예외 처리는 어떻게 하나?
9. 엔티티를 그대로 반환하면 안 되는 이유는?
10. PUT 과 PATCH, 그리고 멱등한 HTTP 메서드는?
