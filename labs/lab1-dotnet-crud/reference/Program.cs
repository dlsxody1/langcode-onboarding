using Microsoft.EntityFrameworkCore;
using PetClinic.Api;

var builder = WebApplication.CreateBuilder(args);

// ═══ ① 서비스 등록 (DI 컨테이너 조립) ═══════════════════════
builder.Services.AddDbContext<AppDbContext>(o =>
{
    o.UseSqlite(builder.Configuration.GetConnectionString("Default")
                ?? "Data Source=petclinic.db");

    if (builder.Environment.IsDevelopment())
    {
        // ⚠️ 이 두 줄이 이 실습의 핵심이다.
        // LINQ 가 어떤 SQL 로 번역되는지 콘솔에서 직접 봐라. N+1 은 이걸로만 잡힌다.
        o.LogTo(Console.WriteLine, LogLevel.Information);
        o.EnableSensitiveDataLogging();          // 파라미터 값까지. 운영에서는 절대 금지
    }
});

// Scoped = HTTP 요청 1건당 1개. DbContext 와 생명주기를 맞춘다.
// 여기를 AddSingleton 으로 바꾸면 captive dependency 로 시작 시점에 예외가 난다 — 실습 ①
builder.Services.AddScoped<IPetService, PetService>();

builder.Services.AddProblemDetails();            // RFC 7807 표준 에러 응답
builder.Services.AddOpenApi();                   // .NET 9. 8 이하는 AddSwaggerGen()

var app = builder.Build();

// ═══ ② 미들웨어 파이프라인 (순서가 곧 동작) ═══════════════════
app.UseExceptionHandler(errApp => errApp.Run(async ctx =>
{
    var ex = ctx.Features.Get<Microsoft.AspNetCore.Diagnostics.IExceptionHandlerFeature>()?.Error;

    // 도메인 예외 → HTTP 상태코드. 서비스 계층은 HTTP 를 몰라도 된다.
    var (status, title) = ex switch
    {
        NotFoundException         => (StatusCodes.Status404NotFound,   "찾을 수 없습니다"),
        ConflictException         => (StatusCodes.Status409Conflict,   "충돌이 발생했습니다"),
        DomainValidationException => (StatusCodes.Status400BadRequest, "입력이 올바르지 않습니다"),
        _                         => (StatusCodes.Status500InternalServerError, "서버 오류"),
    };

    if (status == StatusCodes.Status500InternalServerError)
        app.Logger.LogError(ex, "처리되지 않은 예외 {TraceId}", ctx.TraceIdentifier);

    ctx.Response.StatusCode = status;
    await ctx.Response.WriteAsJsonAsync(new
    {
        status,
        title,
        // ⚠️ 500 에서 ex.Message 를 노출하면 내부 정보가 샌다. 추적 ID 만 주고 로그에서 찾는다.
        detail = status == 500 ? null : ex?.Message,
        traceId = ctx.TraceIdentifier,
    });
}));

if (app.Environment.IsDevelopment())
    app.MapOpenApi();

// ═══ ③ 엔드포인트 (Minimal API) ══════════════════════════════
// 파라미터에 인터페이스를 쓰면 DI 가 자동 주입한다.
// CancellationToken 도 자동 주입되고, 클라이언트가 연결을 끊으면 취소 신호가 온다.

var pets = app.MapGroup("/api/pets").WithTags("Pets");

pets.MapGet("/{id:guid}", async (Guid id, IPetService svc, CancellationToken ct) =>
    await svc.GetAsync(id, ct) is { } pet
        ? Results.Ok(pet)
        : Results.NotFound());

pets.MapGet("/", async (IPetService svc, CancellationToken ct,
                        int page = 1, int size = 20, string? species = null) =>
    Results.Ok(await svc.ListAsync(page, size, species, ct)));

pets.MapPost("/", async (CreatePetRequest req, IPetService svc, CancellationToken ct) =>
{
    var pet = await svc.CreateAsync(req, ct);
    return Results.Created($"/api/pets/{pet.Id}", pet);      // 201 + Location 헤더
})
.WithParameterValidation();     // .NET 10+. 아래 주석 참고

pets.MapDelete("/{id:guid}", async (Guid id, IPetService svc, CancellationToken ct) =>
{
    await svc.DeleteAsync(id, ct);
    return Results.NoContent();                              // 204
});

// ─── 보호자 (간단 버전) ───
var owners = app.MapGroup("/api/owners").WithTags("Owners");

owners.MapPost("/", async (CreateOwnerRequest req, AppDbContext db, CancellationToken ct) =>
{
    var owner = new Owner { Id = Guid.NewGuid(), Name = req.Name, Phone = req.Phone };
    db.Owners.Add(owner);
    await db.SaveChangesAsync(ct);
    return Results.Created($"/api/owners/{owner.Id}",
                           new OwnerDto(owner.Id, owner.Name, owner.Phone));
});

owners.MapGet("/", async (AppDbContext db, CancellationToken ct) =>
    Results.Ok(await db.Owners.AsNoTracking()
        .Select(o => new OwnerDto(o.Id, o.Name, o.Phone))
        .ToListAsync(ct)));

app.Run();

// 통합 테스트(WebApplicationFactory<Program>)가 이 클래스를 참조할 수 있게 한다.
public partial class Program;
