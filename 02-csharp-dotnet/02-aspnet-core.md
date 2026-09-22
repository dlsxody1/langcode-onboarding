# ASP.NET Core

`01-backend-basics/01-request-lifecycle.md` 에서 개념은 이미 봤다. 여기서는 **실제 코드 모양**만 본다.

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

---

## 2. 컨트롤러

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

### 반드시 챙길 것 두 가지

**① `CancellationToken ct` 를 모든 async 액션의 마지막 파라미터로 받는다.**
ASP.NET Core 가 자동으로 주입해 주고, **클라이언트가 연결을 끊으면 자동으로 취소 신호가 온다.**
이걸 DB 호출·LLM 호출까지 전파하면 "사용자가 탭 닫았는데 서버는 3분간 계속 돈다"가 사라진다.

```csharp
await _db.Pets.ToListAsync(ct);                      // 전파
await _llm.CompleteAsync(prompt, ct);                // 전파
```

**② `[ApiController]` 가 해주는 것을 알고 있어라.**
- `[FromBody]` 추론 (복합 타입은 자동으로 바디)
- **모델 검증 실패 시 자동 400** — 액션에서 `if (!ModelState.IsValid)` 를 쓸 필요 없다
- 에러 응답을 `ProblemDetails` 형식으로

### 반환 타입

| 쓰는 것 | 의미 |
| --- | --- |
| `ActionResult<T>` | T 를 반환하거나 상태코드를 반환 — **기본으로 이걸 써라** |
| `IActionResult` | 상태코드만. 바디 타입이 문서화 안 됨 |
| `T` 직접 | 항상 200. 단순 조회에만 |

헬퍼: `Ok()`, `NotFound()`, `BadRequest()`, `NoContent()`, `CreatedAtAction()`, `Conflict()`, `Forbid()`, `Unauthorized()`, `Accepted()`

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

> ❓ 입사 후 확인: 우리 팀은 컨트롤러와 Minimal API 중 뭘 쓰나? 신규 엔드포인트 기준은?

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

### 비밀값

로컬: `dotnet user-secrets set "Llm:ApiKey" "sk-..."` — 소스 트리 밖에 저장된다. **절대 appsettings 에 커밋 금지.**
운영: Azure Key Vault + Managed Identity. (내가 GitHub Actions 에서 OIDC 로 Azure 붙인 것과 같은 계열)

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

레벨: `Trace` < `Debug` < `Information` < `Warning` < `Error` < `Critical`
- 운영 기본은 `Information` 이상
- **예외는 `logger.LogError(ex, "...")` 로 예외 객체를 첫 인자에** (스택트레이스가 남는다)

---

## 6. 예외 → HTTP 상태코드

서비스 계층은 HTTP 를 모르므로 도메인 예외를 던지고, 한 곳에서 변환한다.

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
            // ⚠️ ex.Message 를 여기 넣지 마라 — 내부 정보 유출
            Detail = status == 500 ? null : ex.Message,
            Instance = ctx.Request.Path
        }, ct);
        return true;
    }
}

// 등록
builder.Services.AddExceptionHandler<GlobalExceptionHandler>();
app.UseExceptionHandler();
```

**500 에서 `ex.Message` 를 노출하면 안 된다.** 연결 문자열이나 내부 경로가 그대로 나갈 수 있다.
대신 추적 ID(`ctx.TraceIdentifier`)를 응답에 넣고, 로그에서 그걸로 찾는다.

---

## 7. 검증

```csharp
public record CreatePetRequest(
    [property: Required, StringLength(50)] string Name,
    [property: Range(0, 50)] int Age);
```

`[ApiController]` 가 붙어 있으면 위반 시 **자동으로 400 + 필드별 에러**를 돌려준다.

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

> **검증은 두 층이다.** 요청 형식 검증(DTO) 은 컨트롤러 진입에서, 업무 규칙 검증은 서비스에서.
> "이름이 비었나"는 앞, "이 병원에 같은 이름의 펫이 이미 있나"는 뒤.

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

---

## 9. 첫 주에 열어볼 파일 순서

1. **`Program.cs`** — 어떤 미들웨어, 어떤 서비스가 등록돼 있나
2. **`appsettings.json`** — 어떤 외부 의존성이 있나 (DB, LLM, 스토리지, 고객사 API)
3. **`*Controller.cs`** 아무거나 하나 — 요청→서비스→응답 한 줄기를 끝까지 따라가 본다
4. **`DbContext`** — 도메인 모델 전체가 여기 다 있다
5. **마이그레이션 폴더** — 스키마가 어떻게 진화해 왔는지 = 제품이 어떻게 변해 왔는지
