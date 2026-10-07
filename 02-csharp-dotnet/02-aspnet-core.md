# ASP.NET Core

`01-backend-basics/01-request-lifecycle.md` 에서 개념은 이미 봤다. 여기서는 **실제 코드 모양**만 본다.

ASP.NET Core 는 .NET 의 웹 프레임워크다. Next.js 의 API Route 나 Express 처럼 HTTP 요청을 받아 코드로 연결하고 응답을 돌려준다. 다른 점은 DI 컨테이너, 설정, 로깅, 인증, 검증이 처음부터 프레임워크에 들어 있다는 것이다. Express 에서 미들웨어 패키지를 골라 붙이던 것들이 대부분 기본 제공된다.

---

## 1. Program.cs — 이 파일이 서비스의 설계도다

.NET 6 부터 `Startup.cs` 가 사라지고 `Program.cs` 하나로 합쳐졌다.
**회사 코드베이스를 열면 가장 먼저 읽어야 할 파일이다.**

```csharp
var builder = WebApplication.CreateBuilder(args);

// ───── ① 서비스 등록 (DI 컨테이너 조립) ─────
builder.Services.AddControllers();
builder.Services.AddDbContext<AppDbContext>(opt =>
    opt.UseNpgsql(builder.Configuration.GetConnectionString("Default")));

builder.Services.AddScoped<IPetService, PetService>();
builder.Services.AddScoped<IPetRepository, PetRepository>();

builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(o => { o.Authority = builder.Configuration["Auth:Authority"]; });
builder.Services.AddAuthorization();

builder.Services.AddHttpClient<ILlmClient, OpenAiClient>();   // HttpClient 는 팩토리로
builder.Services.AddCors(o => o.AddDefaultPolicy(p =>
    p.WithOrigins("https://app.example.com").AllowAnyHeader().AllowAnyMethod().AllowCredentials()));

builder.Services.AddProblemDetails();     // 표준 에러 응답 (RFC 7807)
builder.Services.AddOpenApi();            // .NET 9. 이전 버전은 AddSwaggerGen()

var app = builder.Build();

// ───── ② 미들웨어 파이프라인 (순서가 전부) ─────
app.UseExceptionHandler();
if (app.Environment.IsDevelopment()) app.MapOpenApi();
app.UseHttpsRedirection();
app.UseCors();
app.UseAuthentication();        // 반드시 Authorization 보다 먼저
app.UseAuthorization();
app.MapControllers();

app.Run();
```

**두 블록의 의미가 완전히 다르다.**
- `builder.Services.Add~` = **무엇을 만들 수 있는지 등록** (조립 설명서)
- `app.Use~` / `app.Map~` = **요청이 어떤 순서로 처리되는지** (파이프라인)

`builder.Build()` 를 호출한 뒤에는 서비스를 추가할 수 없다.

`WebApplication.CreateBuilder(args)` 한 줄이 이미 많은 일을 한다. `appsettings.json` 과 환경변수를 읽어 설정을 만든다. 콘솔 로깅을 켜고 빈 DI 컨테이너를 준비한다. 우리는 거기에 서비스를 더 등록할 뿐이다.

### ① 서비스 등록 — DI 컨테이너에 "만드는 법"을 알려 준다

**DI 컨테이너**는 "이 인터페이스를 달라고 하면 이 클래스를 만들어 줘라"는 목록을 들고 있다가, 필요한 곳에 객체를 만들어 넣어 주는 장치다. `AddScoped<IPetService, PetService>()` 는 "누가 `IPetService` 를 요구하면 `PetService` 를 만들어 주라"는 등록이다. 왜 이렇게 하는지는 `01-backend-basics/02-layers-and-di.md` 3절에서 다뤘다.

| 줄 | 하는 일 | 프론트 감각으로 |
| --- | --- | --- |
| `AddControllers()` | 컨트롤러 클래스를 찾아 라우트로 쓸 준비 | Next.js 가 `app/` 폴더를 스캔하는 것 |
| `AddDbContext<AppDbContext>(...)` | DB 연결 설정과 함께 DbContext 등록 (기본 Scoped) | Prisma client 생성 |
| `AddScoped<I, Impl>()` | 요청 1건마다 새 인스턴스 | 요청마다 새로 만드는 객체 |
| `AddAuthentication().AddJwtBearer(...)` | `Authorization: Bearer ...` 헤더의 JWT 를 검증하는 방법 | NextAuth 의 세션 검증 |
| `AddHttpClient<I, Impl>()` | 외부 API 를 부를 `HttpClient` 를 팩토리로 관리 | 공용 `fetch` 래퍼 |
| `AddCors(...)` | 다른 출처(origin)의 브라우저 요청을 허용할 목록 | 프론트에서 보던 CORS 에러의 서버 쪽 |
| `AddProblemDetails()` | 에러 응답을 표준 JSON 모양으로 | — |
| `AddOpenApi()` | 엔드포인트 목록을 OpenAPI 문서로 | Swagger 페이지 |

**`HttpClient` 를 `new` 로 만들지 않는 이유**도 알아 둔다. `HttpClient` 를 요청마다 새로 만들고 버리면 운영체제 소켓이 바로 회수되지 않아 트래픽이 많을 때 소켓이 바닥난다. 반대로 하나를 앱 내내 쓰면 DNS 변경을 못 따라간다. `AddHttpClient` 로 등록하면 `IHttpClientFactory` 가 내부 연결을 적당히 재사용하고 교체해서 두 문제를 다 피한다. 재시도·타임아웃 같은 보호 장치도 여기에 붙인다. (→ `07-db-infra/03-resilience.md` 4절)

### DI 수명을 고르는 기준

등록 메서드 이름의 `Scoped` / `Singleton` / `Transient` 는 **수명**(lifetime), 곧 "객체를 얼마나 오래 재사용하나"를 정한다. 세 가지의 함정은 `01-backend-basics/02-layers-and-di.md` 4절에서 자세히 다뤘으므로 여기서는 고르는 기준만 둔다.

| 수명 | 언제 새로 만드나 | 이걸 고르는 경우 |
| --- | --- | --- |
| `AddScoped` | HTTP 요청 1건당 1개 | 서비스·리포지토리·`DbContext`. 고민되면 이것 |
| `AddSingleton` | 앱 전체에 1개 | 상태가 없거나 스레드 안전한 것. 설정, 캐시 클라이언트 |
| `AddTransient` | 요청할 때마다 매번 | 가볍고 상태 없는 도우미 |

규칙은 하나만 기억한다. **오래 사는 객체가 짧게 사는 객체를 붙들면 안 된다.** Singleton 이 Scoped 인 `DbContext` 를 생성자로 받으면 첫 요청의 DbContext 를 앱이 끝날 때까지 쥐고 있게 된다. 개발 환경에서는 앱이 시작될 때 이 실수를 예외로 알려 준다.

.NET 8 부터는 같은 인터페이스에 이름을 붙여 여러 구현을 등록하는 **keyed service** 도 있다. `AddKeyedScoped<ILlmClient, OpenAiClient>("openai")` 로 등록하고 `[FromKeyedServices("openai")] ILlmClient client` 로 받는다. LLM 프로바이더를 여러 개 붙이는 코드에서 볼 수 있다.

### ② 미들웨어 파이프라인 — 위에서 아래로 통과한다

**미들웨어**는 모든 요청이 차례로 지나가는 함수 사슬이다. Express 의 `app.use()` 나 Next.js 의 `middleware.ts` 와 같은 개념이다. 요청은 위에서 아래로 통과하고 응답은 아래에서 위로 되돌아온다. 그래서 순서가 곧 동작이다. (→ `01-backend-basics/01-request-lifecycle.md` 2절)

| 순서 | 미들웨어 | 이 자리에 있는 이유 |
| ---: | --- | --- |
| 1 | `UseExceptionHandler` | 맨 바깥에 있어야 아래 어디서 난 예외든 잡는다 |
| 2 | `MapOpenApi` (개발만) | API 문서 엔드포인트 |
| 3 | `UseHttpsRedirection` | http 요청을 https 로 돌려보낸다 |
| 4 | `UseCors` | 인증보다 앞이어야 브라우저의 사전 요청(preflight)이 인증에 막히지 않는다 |
| 5 | `UseAuthentication` | 토큰을 읽어 "이 사람이 누구인가"를 정한다 |
| 6 | `UseAuthorization` | "이 사람이 이걸 해도 되나"를 판단한다. 누구인지 알아야 하므로 5번 뒤 |
| 7 | `MapControllers` | 실제 컨트롤러 액션으로 보낸다 |

인증·인가의 개념 차이는 `01-backend-basics/04-auth.md` 에서 다뤘다.

---

## 2. 컨트롤러

**컨트롤러**는 관련된 엔드포인트를 메서드로 모아 둔 클래스다. 메서드 하나(액션)가 엔드포인트 하나다. 대괄호로 쓴 `[HttpGet]` 같은 것은 **어트리뷰트**(attribute)라고 부른다. TS 데코레이터(`@Get()`)처럼 클래스나 메서드에 메타데이터를 붙인다. NestJS 를 써 봤다면 모양이 거의 같다.

```csharp
[ApiController]                      // 이게 있으면 자동 모델 검증 + 400 응답 + 바인딩 추론
[Route("api/[controller]")]          // [controller] → 클래스명에서 "Controller" 뗀 것 = "pets"
[Authorize]                          // 이 컨트롤러 전체에 인증 필요
public class PetsController(IPetService petService) : ControllerBase
{
    [HttpGet("{id:guid}")]
    [ProducesResponseType<PetDto>(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<PetDto>> GetById(Guid id, CancellationToken ct)
    {
        var pet = await petService.GetAsync(id, ct);
        return pet is null ? NotFound() : Ok(pet);
    }

    [HttpPost]
    public async Task<ActionResult<PetDto>> Create([FromBody] CreatePetRequest req, CancellationToken ct)
    {
        var pet = await petService.CreateAsync(req, ct);
        return CreatedAtAction(nameof(GetById), new { id = pet.Id }, pet);   // 201 + Location 헤더
    }

    [HttpDelete("{id:guid}")]
    [Authorize(Roles = "Admin")]     // 이 액션만 추가 제한
    public async Task<IActionResult> Delete(Guid id, CancellationToken ct)
    {
        await petService.DeleteAsync(id, ct);
        return NoContent();          // 204
    }
}
```

코드를 읽을 때 걸리는 부분을 풀어 둔다.

- **`{id:guid}`** 는 **라우트 제약**이다. URL 의 그 자리가 GUID 형식일 때만 이 액션에 연결한다. `/api/pets/abc` 는 아예 매칭되지 않아 404 가 된다. `{page:int}` 처럼 쓸 수도 있다.
- **모델 바인딩**은 URL·쿼리스트링·헤더·바디에서 값을 꺼내 액션 파라미터에 채워 주는 기능이다. Express 에서 `req.params.id` 를 꺼내고 `JSON.parse(req.body)` 하던 일을 프레임워크가 파라미터 이름과 타입을 보고 대신 한다. 위에서 `Guid id` 는 경로에서, `CreatePetRequest req` 는 JSON 바디에서 온다.
- **`ControllerBase`** 는 `Ok()`, `NotFound()` 같은 응답 헬퍼를 물려주는 부모 클래스다.
- 생성자 파라미터 `IPetService petService` 는 DI 컨테이너가 요청마다 채워 준다. 컨트롤러도 요청마다 새로 만들어진다.

### 반드시 챙길 것 두 가지

**① `CancellationToken ct` 를 모든 async 액션의 마지막 파라미터로 받는다.**
ASP.NET Core 가 자동으로 주입해 주고 **클라이언트가 연결을 끊으면 자동으로 취소 신호가 온다.**
이걸 DB 호출·LLM 호출까지 전파하면 "사용자가 탭 닫았는데 서버는 3분간 계속 돈다"가 사라진다.

```csharp
await _db.Pets.ToListAsync(ct);                      // 전파
await _llm.CompleteAsync(prompt, ct);                // 전파
```

이 토큰의 정체는 `HttpContext.RequestAborted` 다. 브라우저 탭이 닫히거나 프론트에서 `AbortController.abort()` 를 부르면 연결이 끊기고 서버 쪽 토큰이 "취소됨" 상태로 바뀐다. 토큰을 받은 EF Core 쿼리나 `HttpClient` 호출은 그 순간 작업을 멈추고 `OperationCanceledException` 을 던진다.

토큰은 저절로 전파되지 않는다. 컨트롤러가 받았어도 서비스 메서드에 넘기지 않으면 서비스 아래로는 신호가 닿지 않는다. 그래서 async 메서드 시그니처마다 `CancellationToken ct` 를 두고 계속 넘겨 주는 것이 관례다. LLM 호출이 1분씩 걸리는 AI 제품에서는 전파하지 않은 만큼 토큰 비용이 그대로 나간다.

`OperationCanceledException` 은 서버 오류가 아니라 사용자가 떠난 것이다. 전역 예외 핸들러에서 이걸 500 오류 로그로 남기지 않게 따로 거르는 팀이 많다.

**② `[ApiController]` 가 해주는 것을 알고 있어라.**
- `[FromBody]` 추론 (복합 타입은 자동으로 바디)
- **모델 검증 실패 시 자동 400** — 액션에서 `if (!ModelState.IsValid)` 를 쓸 필요 없다
- 에러 응답을 `ProblemDetails` 형식으로

업무 규칙 위반(예: 같은 이름 중복)까지 알아서 막아 주지는 않는다. 그건 프레임워크가 알 수 없는 규칙이라 서비스가 판단한다. (→ 7절)

### 반환 타입

| 쓰는 것 | 의미 |
| --- | --- |
| `ActionResult<T>` | T 를 반환하거나 상태코드를 반환 — **기본으로 이걸 써라** |
| `IActionResult` | 상태코드만. 바디 타입이 문서화 안 됨 |
| `T` 직접 | 항상 200. 단순 조회에만 |

헬퍼: `Ok()`, `NotFound()`, `BadRequest()`, `NoContent()`, `CreatedAtAction()`, `Conflict()`, `Forbid()`, `Unauthorized()`, `Accepted()`

`ActionResult<T>` 를 권하는 이유는 OpenAPI 문서다. 반환 타입에 `PetDto` 가 적혀 있으면 문서 생성기가 응답 모양을 알 수 있고 프론트에서 그 문서로 TS 타입을 자동 생성할 때 그대로 쓰인다. `[ProducesResponseType]` 은 "404 도 나올 수 있다"처럼 성공 외의 응답을 문서에 추가한다.

---

## 3. Minimal API — 컨트롤러 대신

작은 서비스나 내부 엔드포인트는 이 스타일도 많이 쓴다.

```csharp
app.MapGet("/api/pets/{id:guid}", async (Guid id, IPetService svc, CancellationToken ct) =>
    await svc.GetAsync(id, ct) is { } pet ? Results.Ok(pet) : Results.NotFound())
   .RequireAuthorization()
   .WithName("GetPet");

app.MapPost("/api/pets", async (CreatePetRequest req, IPetService svc, CancellationToken ct) =>
{
    var pet = await svc.CreateAsync(req, ct);
    return Results.Created($"/api/pets/{pet.Id}", pet);
});
```

파라미터에 인터페이스를 쓰면 **DI 가 자동 주입**된다. Express 라우트 핸들러와 느낌이 비슷하다.
`labs/lab1-dotnet-crud` 는 이 스타일로 만든다. 코드가 훨씬 짧아 배우기 좋다.

`is { } pet` 은 "null 이 아니면 그 값을 `pet` 이라는 이름으로 받아라"라는 패턴이다. `const pet = await ...; pet ? ok(pet) : notFound()` 를 한 줄로 쓴 것이다.

엔드포인트가 늘어나면 `MapGroup` 으로 공통 경로와 설정을 묶는다.

```csharp
var pets = app.MapGroup("/api/pets").RequireAuthorization().WithTags("Pets");
pets.MapGet("/{id:guid}", ...);     // 실제 경로는 /api/pets/{id}
pets.MapPost("/", ...);
```

### 컨트롤러와 Minimal API 비교

둘은 같은 런타임 위에서 돌고 성능 차이도 실무에서 의미 있는 수준이 아니다. 고르는 기준은 코드 구조와 팀 관례다.

| | 컨트롤러 | Minimal API |
| --- | --- | --- |
| 모양 | 클래스 + 어트리뷰트 | `app.MapGet(경로, 람다)` |
| 입력 검증 | `[ApiController]` 가 자동 400 | .NET 10 부터 내장(`AddValidation()`). 그 전에는 직접 하거나 패키지 사용 |
| 공통 처리 | 액션 필터 | 엔드포인트 필터(`AddEndpointFilter`) |
| 잘 맞는 곳 | 엔드포인트가 많은 큰 API, 오래된 코드베이스 | 작은 서비스, 내부 API, 새 프로젝트 |
| 프론트 감각 | NestJS | Express, Hono |

Minimal API 에서는 `Results.Ok(...)` 대신 `TypedResults.Ok(...)` 를 쓰는 코드도 볼 수 있다. 반환 타입이 구체적으로 남아서 OpenAPI 문서와 단위 테스트에 유리하다.

> ✅ 팀 기술 목록에는 **Minimal API + Carter**(Minimal API 를 모듈 단위로 나누는 라이브러리)가 올라 있다. 전후 비교는 `05-team-tech-list.md` 1절.
> ❓ 입사 후 확인: 컨트롤러로 된 옛 코드가 남아 있나? 신규 엔드포인트 기준은?

---

## 4. 설정 (Configuration)

```jsonc
// appsettings.json
{
  "ConnectionStrings": { "Default": "Host=localhost;Database=cxp;Username=dev" },
  "Llm": { "Provider": "openai", "Model": "gpt-4o", "TimeoutSeconds": 60 }
}
// appsettings.Development.json 이 위를 덮어쓴다
```

우선순위 (뒤가 이김): `appsettings.json` → `appsettings.{Env}.json` → 사용자 시크릿 → **환경변수** → 커맨드라인

**환경변수 계층 구분자는 `__` (밑줄 두 개)** 다. `Llm:Model` → `Llm__Model`.
Azure App Service 나 컨테이너에서 설정을 주입할 때 이 규칙을 쓴다.

여러 출처가 같은 키를 덮어쓰는 과정을 `Llm:Model` 하나로 따라가 보면 이렇다.

| 출처 | 들어 있는 값 | 이 단계까지의 최종값 |
| --- | --- | --- |
| `appsettings.json` | `"gpt-4o"` | `gpt-4o` |
| `appsettings.Development.json` (로컬에서만) | `"gpt-4o-mini"` | `gpt-4o-mini` |
| 환경변수 `Llm__Model` (운영 컨테이너) | `gpt-4.1` | `gpt-4.1` |

코드는 `builder.Configuration["Llm:Model"]` 로 읽을 뿐 값이 어디서 왔는지 모른다. 같은 빌드가 환경마다 다른 값을 쓰는 원리다. `{Env}` 자리는 `ASPNETCORE_ENVIRONMENT` 환경변수로 정해지고 로컬은 보통 `Development` 다. (→ `07-db-infra/05-infra.md` 5절)

### 타입 있는 설정 (권장)

```csharp
public class LlmOptions
{
    public string Provider { get; set; } = "openai";
    public string Model { get; set; } = "";
    public int TimeoutSeconds { get; set; } = 60;
}

builder.Services.Configure<LlmOptions>(builder.Configuration.GetSection("Llm"));

// 사용
public class LlmClient(IOptions<LlmOptions> options)
{
    private readonly LlmOptions _opt = options.Value;
}
```

`IOptionsSnapshot<T>` 를 쓰면 요청마다 새로 읽는다(설정 변경 반영).
`IOptionsMonitor<T>` 는 싱글톤에서 변경 알림까지 받는다.

이 방식을 **Options 패턴**이라고 부른다. `builder.Configuration["Llm:TimeoutSeconds"]` 처럼 문자열 키로 꺼내 쓰면 오타가 런타임에야 드러나고 매번 숫자로 변환해야 한다. 설정 섹션을 클래스 하나에 묶어 두면 자동완성이 되고 타입도 맞춰진다. TS 에서 `process.env` 를 zod 스키마로 한 번 파싱해 타입 있는 `env` 객체로 쓰던 것과 같은 발상이다.

세 인터페이스는 수명과 갱신 시점이 다르다.

| 주입받는 타입 | 수명 | 값이 언제 읽히나 | 쓰는 곳 |
| --- | --- | --- | --- |
| `IOptions<T>` | Singleton | 처음 한 번. 이후 파일을 바꿔도 그대로 | 대부분. 기본값으로 이것 |
| `IOptionsSnapshot<T>` | Scoped | 요청마다 다시 읽는다 | 재시작 없이 바꾸고 싶은 값. Singleton 에는 주입 못 한다 |
| `IOptionsMonitor<T>` | Singleton | `.CurrentValue` 로 항상 최신. `OnChange` 로 알림 | Singleton 서비스가 바뀐 값을 따라가야 할 때 |

설정이 빠졌거나 잘못됐을 때 첫 요청이 아니라 **앱 시작 시점에** 실패하게 만들면 배포 사고를 일찍 잡는다.

```csharp
public class LlmOptions
{
    [Required] public string Model { get; set; } = "";
    [Range(1, 600)] public int TimeoutSeconds { get; set; } = 60;
}

builder.Services.AddOptions<LlmOptions>()
    .Bind(builder.Configuration.GetSection("Llm"))
    .ValidateDataAnnotations()    // [Required], [Range] 검사
    .ValidateOnStart();           // 시작할 때 바로 검사. 없으면 처음 쓰는 순간에야 터진다
```

### 비밀값

로컬: `dotnet user-secrets set "Llm:ApiKey" "sk-..."` — 소스 트리 밖에 저장된다. **절대 appsettings 에 커밋 금지.**
운영: Azure Key Vault + Managed Identity. (내가 GitHub Actions 에서 OIDC 로 Azure 붙인 것과 같은 계열)

**user-secrets** 는 개발 PC 의 사용자 폴더에 JSON 으로 저장되는 개발 전용 설정 출처다. 프론트의 `.env.local` 처럼 쓰되 저장소 밖에 있어서 실수로 커밋될 일이 없다. `Development` 환경에서만 자동으로 읽힌다. **Key Vault** 는 Azure 의 비밀값 금고이고 **Managed Identity** 는 서버가 비밀번호 없이 Azure 서비스에 로그인하게 해 주는 방식이다. 자세한 내용은 `07-db-infra/05-infra.md` 5절에 있다.

---

## 5. 로깅

```csharp
public class PetService(ILogger<PetService> logger)
{
    public async Task DoAsync(Guid id)
    {
        logger.LogInformation("Pet {PetId} 처리 시작", id);   // ← 구조화 로깅
        // ❌ logger.LogInformation($"Pet {id} 처리 시작");   ← 문자열 보간 쓰지 마라
    }
}
```

**중괄호 플레이스홀더를 쓰는 이유:** 로그 수집 시스템(Seq, Application Insights, Datadog)이
`PetId` 를 **검색 가능한 필드**로 인식한다. `$"..."` 로 미리 합쳐버리면 그냥 문자열이 된다.

두 방식이 수집기에 실제로 어떻게 저장되는지 비교하면 차이가 분명하다.

```jsonc
// 구조화 로깅: "Pet {PetId} 처리 시작", id
{ "message": "Pet 8f3a... 처리 시작", "PetId": "8f3a...", "SourceContext": "PetService" }

// 문자열 보간: $"Pet {id} 처리 시작"
{ "message": "Pet 8f3a... 처리 시작", "SourceContext": "PetService" }
```

구조화 로깅으로 남긴 앞쪽은 `PetId = "8f3a..."` 로 필터링할 수 있다. 뒤쪽은 메시지 문자열 검색밖에 안 된다. `ILogger<PetService>` 의 `<PetService>` 는 로그의 출처(카테고리)가 되어 "이 클래스의 로그만" 보는 데 쓰인다. 로그 설계 전반은 `07-db-infra/04-observability.md` 2절에서 다룬다.

레벨: `Trace` < `Debug` < `Information` < `Warning` < `Error` < `Critical`
- 운영 기본은 `Information` 이상
- **예외는 `logger.LogError(ex, "...")` 로 예외 객체를 첫 인자에** (스택트레이스가 남는다)

어느 레벨부터 남길지는 코드가 아니라 `appsettings.json` 의 `"Logging": { "LogLevel": { "Default": "Information" } }` 에서 정한다. 특정 네임스페이스만 `Debug` 로 낮추는 식의 조정도 설정으로 한다.

---

## 6. 예외 → HTTP 상태코드

서비스 계층은 HTTP 를 모르므로 도메인 예외를 던지고 한 곳에서 변환한다.

**도메인 예외**는 `NotFoundException`, `ConflictException` 처럼 업무 상황을 이름으로 가진 예외다. 서비스는 "보호자가 없다"는 사실만 예외로 알리고 그게 404 인지 몰라도 된다. HTTP 와의 대응은 아래 핸들러 한 곳에만 둔다. 나중에 같은 서비스를 백그라운드 작업에서 불러도 HTTP 개념이 섞여 있지 않으니 그대로 쓸 수 있다.

```csharp
// 예외 정의
public class NotFoundException(string msg) : Exception(msg);
public class ConflictException(string msg) : Exception(msg);

// 전역 핸들러 (.NET 8+)
public class GlobalExceptionHandler(ILogger<GlobalExceptionHandler> logger) : IExceptionHandler
{
    public async ValueTask<bool> TryHandleAsync(HttpContext ctx, Exception ex, CancellationToken ct)
    {
        var (status, title) = ex switch
        {
            NotFoundException   => (StatusCodes.Status404NotFound, "찾을 수 없습니다"),
            ConflictException   => (StatusCodes.Status409Conflict, "충돌이 발생했습니다"),
            ValidationException => (StatusCodes.Status400BadRequest, "입력이 올바르지 않습니다"),
            _                   => (StatusCodes.Status500InternalServerError, "서버 오류")
        };

        if (status == 500) logger.LogError(ex, "처리되지 않은 예외");

        ctx.Response.StatusCode = status;
        await ctx.Response.WriteAsJsonAsync(new ProblemDetails
        {
            Status = status,
            Title = title,
            // ⚠️ 500 일 때 ex.Message 를 여기 넣지 마라 — 내부 정보 유출
            Detail = status == 500 ? null : ex.Message,
            Instance = ctx.Request.Path,
            Extensions = { ["traceId"] = ctx.TraceIdentifier }   // 로그에서 찾을 열쇠
        }, ct);
        return true;
    }
}

// 등록
builder.Services.AddExceptionHandler<GlobalExceptionHandler>();
app.UseExceptionHandler();
```

**500 에서 `ex.Message` 를 노출하면 안 된다.** 연결 문자열이나 내부 경로가 그대로 나갈 수 있다.
대신 추적 ID(`ctx.TraceIdentifier`)를 응답에 넣고 로그에서 그걸로 찾는다.

**ProblemDetails** 는 HTTP API 의 에러 응답 모양을 정한 표준(RFC 7807, 2023년 개정판은 RFC 9457)이다. `status`, `title`, `detail`, `instance` 필드를 갖는다. 서비스마다 에러 JSON 모양이 제각각이면 프론트가 서비스별로 파싱 코드를 따로 짜야 한다. 표준 모양으로 맞춰 두면 프론트의 에러 처리 코드 하나로 모든 API 를 다룬다.

`IExceptionHandler` 는 .NET 8 에서 생긴 전역 예외 처리 인터페이스다. `TryHandleAsync` 가 `true` 를 돌려주면 "이 예외는 처리했다"는 뜻이다. Spring 의 `@ControllerAdvice` 와 같은 자리다.

### 예외 대신 Result 를 돌려주는 팀도 있다

"같은 이름이 이미 있다"는 프로그램 오류가 아니라 자주 일어나는 정상적인 실패다. 이런 실패까지 예외로 던지는 데 반대하는 팀은 반환값에 성공·실패를 담는 **Result 패턴**을 쓴다.

```csharp
public record Result<T>(T? Value, string? Error)
{
    public bool IsSuccess => Error is null;
    public static Result<T> Ok(T value) => new(value, null);
    public static Result<T> Fail(string error) => new(default, error);
}

// 서비스
if (await db.Pets.AnyAsync(p => p.Name == req.Name, ct))
    return Result<PetDto>.Fail("DUPLICATE_NAME");

// 엔드포인트
var result = await svc.CreateAsync(req, ct);
return result.IsSuccess ? Results.Created($"/api/pets/{result.Value!.Id}", result.Value)
                        : Results.Conflict(new { code = result.Error });
```

| | 도메인 예외 + 전역 핸들러 | Result 패턴 |
| --- | --- | --- |
| 실패를 알리는 법 | `throw` | 반환값 |
| 호출하는 쪽 | 신경 안 써도 핸들러가 처리 | 매번 `IsSuccess` 를 확인해야 한다 |
| 장점 | 코드가 짧다. 이 저장소의 lab1 이 이 방식 | 실패 가능성이 시그니처에 드러난다. 예외 비용이 없다 |
| 단점 | 어떤 예외가 날지 시그니처만 보고는 모른다 | 코드가 길어진다 |

TS 에서 `{ ok: true, data } | { ok: false, error }` 판별 유니온을 돌려주던 습관과 같은 발상이다. 어느 쪽이 맞다기보다 팀이 정한 쪽을 따른다. 다만 DB 연결 끊김처럼 예상하지 못한 오류는 두 방식 모두 예외로 둔다.

> ❓ 입사 후 확인: 업무 규칙 실패를 예외로 던지나, Result 류 타입으로 돌려주나?

---

## 7. 검증

```csharp
public record CreatePetRequest(
    [Required, StringLength(50)] string Name,
    [Range(0, 50)] int Age,
    DateOnly? BirthDate);
```

`[ApiController]` 가 붙어 있으면 위반 시 **자동으로 400 + 필드별 에러**를 돌려준다.

`[Required]`, `[StringLength]`, `[Range]` 같은 어트리뷰트 묶음을 **DataAnnotations** 라고 부른다. "이 필드는 필수, 최대 50자" 같은 형식 규칙을 타입 선언에 바로 붙인다. 위반하면 응답은 이런 모양이다.

```json
{
  "title": "One or more validation errors occurred.",
  "status": 400,
  "errors": { "Name": ["The Name field is required."] }
}
```

record 의 위치 매개변수(괄호 안 파라미터)에 붙인 어트리뷰트는 기본으로 생성자 매개변수에 붙는다. MVC 컨트롤러는 이 위치의 어트리뷰트를 읽어 검증하므로 위처럼 쓰면 된다. 예전 예제에서 보이는 `[property: Required]` 처럼 프로퍼티 쪽으로 옮기면 MVC 가 오히려 예외를 던진다. 검증 방식마다 어트리뷰트를 읽는 위치가 달라서 생기는 차이다. (Minimal API 에서의 주의점은 `labs/lab1-dotnet-crud/reference/NOTES.md` 에 있다)

복잡한 규칙은 **FluentValidation** 라이브러리를 많이 쓴다. (zod 와 발상이 비슷)

```csharp
public class CreatePetValidator : AbstractValidator<CreatePetRequest>
{
    public CreatePetValidator()
    {
        RuleFor(x => x.Name).NotEmpty().MaximumLength(50);
        RuleFor(x => x.BirthDate).LessThanOrEqualTo(_ => DateOnly.FromDateTime(DateTime.UtcNow));
    }
}
```

FluentValidation 은 예전에는 컨트롤러에 자동으로 붙이는 방식을 많이 썼지만 지금은 라이브러리 쪽에서도 권하지 않는다. 검증기를 DI 로 받아 `await validator.ValidateAsync(req, ct)` 를 직접 부르는 코드가 요즘 모양이다.

> **검증은 두 층이다.** 요청 형식 검증(DTO) 은 컨트롤러 진입에서, 업무 규칙 검증은 서비스에서.
> "이름이 비었나"는 앞, "이 병원에 같은 이름의 펫이 이미 있나"는 뒤.

앞 층은 DB 를 보지 않고 요청만 보고 판단할 수 있는 것이다. 뒤 층은 DB 의 현재 상태를 봐야 판단할 수 있는 것이다. 프론트에서 react-hook-form + zod 로 형식을 검사해도 서버가 같은 검사를 다시 하는 것도 이 때문이다. 클라이언트 검증은 사용자 편의이고 서버 검증은 방어다.

---

## 8. 테스트

```csharp
// 단위 테스트 — 서비스만
[Fact]
public async Task 중복_이름이면_예외()
{
    var repo = Substitute.For<IPetRepository>();     // NSubstitute (= vitest mock)
    repo.ExistsAsync(default, default, default).ReturnsForAnyArgs(true);
    var sut = new PetService(repo, ...);

    await Assert.ThrowsAsync<DuplicatePetException>(() => sut.CreateAsync(cmd, tenantId));
}

// 통합 테스트 — 앱 전체를 메모리에 띄운다
public class PetsApiTests(WebApplicationFactory<Program> factory) : IClassFixture<WebApplicationFactory<Program>>
{
    [Fact]
    public async Task 없는_펫은_404()
    {
        var client = factory.CreateClient();
        var res = await client.GetAsync($"/api/pets/{Guid.NewGuid()}");
        Assert.Equal(HttpStatusCode.NotFound, res.StatusCode);
    }
}
```

| 도구 | 역할 | 프론트에서 아는 것 |
| --- | --- | --- |
| **xUnit** | 테스트 러너 (`[Fact]`, `[Theory]`) | vitest |
| **NSubstitute** / Moq | 목 객체 | `vi.fn()` |
| **FluentAssertions** | 읽기 쉬운 단언 | `expect(...).toBe(...)` |
| **WebApplicationFactory** | 앱 전체 인메모리 기동 | MSW + 실제 서버 |
| **Testcontainers** | 진짜 Postgres 를 Docker 로 띄워 테스트 | — |

**`WebApplicationFactory` 가 강력하다.** 미들웨어·DI·라우팅까지 실제와 같은 상태로 HTTP 테스트를 한다.
프론트로 치면 E2E 에 가까운 신뢰도를 단위 테스트 속도로 얻는 것.

용어부터 정리한다.

- **`[Fact]`** 는 입력이 고정된 테스트 하나다. vitest 의 `it(...)` 이다. **`[Theory]`** 는 같은 테스트를 여러 입력으로 돌린다. `it.each` 와 같다.
- **sut**(system under test)는 "지금 테스트하는 대상"을 가리키는 관례적인 변수 이름이다.
- **목 객체**(mock)는 진짜 리포지토리 대신 넣는 가짜다. "`ExistsAsync` 를 부르면 무조건 `true` 를 돌려줘라"처럼 동작을 정해 둔다. 서비스 인터페이스를 두는 큰 이유가 이 교체를 쉽게 하는 것이다.
- **`IClassFixture<T>`** 는 테스트 클래스 하나가 `T` 를 한 번만 만들어 모든 테스트에서 공유하게 한다. 앱을 테스트마다 다시 띄우지 않아서 빠르다.

```csharp
[Theory]
[InlineData(-1)]
[InlineData(51)]
public async Task 나이가_범위를_벗어나면_400(int age)   // 같은 테스트가 입력 -1, 51 로 두 번 돈다 ([Range(0, 50)])
{
    var client = factory.CreateClient();
    var res = await client.PostAsJsonAsync("/api/pets", new { name = "코코", age });
    Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
}
```

단위 테스트와 통합 테스트의 몫은 나눈다. 업무 규칙("중복이면 실패") 같은 서비스 로직은 목을 써서 단위 테스트로 빠르게 많이 검사한다. 라우팅·검증·예외 변환·DB 매핑처럼 조립이 맞는지는 `WebApplicationFactory` 통합 테스트로 확인한다.

통합 테스트에서는 DB 를 테스트용으로 바꿔 끼우는 일이 거의 항상 필요하다. `factory.WithWebHostBuilder(b => b.ConfigureTestServices(services => ...))` 안에서 DbContext 등록을 바꾸는 코드가 그 자리다. 이때 EF Core 의 InMemory 프로바이더는 진짜 DB 가 아니라서 SQL 번역 실패나 제약 조건 위반을 잡지 못한다. 운영과 같은 DB 엔진을 Docker 로 띄우는 Testcontainers 나 최소한 SQLite 를 쓰는 편이 믿을 만하다. 실습 코드에서 이 부분을 어떻게 하는지는 `labs/lab1-dotnet-crud/README.md` 4절 ⑥에 있다.

---

## 9. 첫 주에 열어볼 파일 순서

1. **`Program.cs`** — 어떤 미들웨어, 어떤 서비스가 등록돼 있나
2. **`appsettings.json`** — 어떤 외부 의존성이 있나 (DB, LLM, 스토리지, 고객사 API)
3. **`*Controller.cs`** 아무거나 하나 — 요청→서비스→응답 한 줄기를 끝까지 따라가 본다
4. **`DbContext`** — 도메인 모델 전체가 여기 다 있다
5. **마이그레이션 폴더** — 스키마가 어떻게 진화해 왔는지 = 제품이 어떻게 변해 왔는지

---

## 스스로 답해보기

1. `builder.Services.Add~` 와 `app.Use~` 는 각각 무엇을 정하나? `builder.Build()` 뒤에 서비스를 등록하면?
2. `UseAuthorization` 을 `UseAuthentication` 보다 위로 올리면 무슨 일이 생기나?
3. 컨트롤러가 `CancellationToken ct` 를 받았지만 서비스에 넘기지 않았다. 사용자가 탭을 닫으면 LLM 호출은 어떻게 되나?
4. `Llm:Model` 이 `appsettings.json`, `appsettings.Development.json`, 환경변수에 모두 있다. 운영 컨테이너에서는 어떤 값이 쓰이나?
5. Singleton 서비스에 `IOptionsSnapshot<LlmOptions>` 를 주입하면 어떻게 되나? 대신 무엇을 써야 하나?
6. 500 응답의 `detail` 을 비우면 운영 중에 원인을 어떻게 찾나?
7. "이름이 비었다"와 "이미 같은 이름이 있다"는 각각 어느 층에서 검사하나? 왜 나누나?
