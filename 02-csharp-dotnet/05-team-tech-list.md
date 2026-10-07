# 팀 기술 목록 — 라이브러리를 쓰기 전과 후

팀이 정리한 "아키텍처 · 디자인 패턴 · 라이브러리 · 설계 방식" 목록을 이 레포 문서와 이어 읽을 수 있게 풀어 쓴 것이다.
목록 자체에 **"써드파티 쓰기 전과 후에 대해서 정리"** 라는 숙제가 적혀 있다. 그래서 라이브러리마다 **없을 때의 코드 → 있을 때의 코드 → 대가** 순서로 쓴다.

> ⚠️ 목록은 **논의 중인 문서**다. 취소선(제외), (O)(채택), (X)(제외), "추후 도입", "다시 논의"가 섞여 있다.
> 이 문서의 상태 표시는 받은 목록 그대로이고, 그 뒤에 바뀌었을 수 있다. 입사 후 최신 상태를 확인한다.
> 인증(Authorize) 항목은 이 문서에서 다루지 않는다. 개념은 `01-backend-basics/04-auth.md`, 스택 관점은 `07-db-infra/07-our-stack.md` 9절을 본다.

---

## 0. 한눈에 — 목록과 상태

**(P)** 는 목록에서 High Priority 로 표시된 것이다.

### 아키텍처 · 패턴

| 항목 | 상태 | 어디서 배우나 |
| --- | --- | --- |
| **Clean Architecture** (P) | 채택 | `01-backend-basics/06-architecture.md` 2절 |
| **DDD** (P) | 채택 | `01-backend-basics/06-architecture.md` 1절 |
| CQRS | 채택 | `01-backend-basics/06-architecture.md` 4절 |
| Modular Monolithic | 채택 | `01-backend-basics/06-architecture.md` 6절 |
| Mediator 패턴 | 채택. "모듈러 모놀리스를 위해 꼭 알아야 하는 패턴" | `06-architecture.md` 3절 + 이 문서 4절 |
| ~~Vertical Slice Architecture~~ | **제외** | `06-architecture.md` 5절은 읽기용으로만 |
| Factory · Decorator · Repository · Pub-Sub | 채택 | 이 문서 7절 |
| Minimal API | 채택 | `02-aspnet-core.md` 3절 + 이 문서 1절 |

### 라이브러리

| 라이브러리 | 상태 | 한 줄 |
| --- | --- | --- |
| Entity Framework Core | 채택 | `03-ef-core.md` |
| **Carter** | **(O)** | Minimal API 를 모듈 단위로 나눠 등록 (1절) |
| **FluentValidation** | 채택 | 검증 규칙을 클래스로 (2절) |
| **Scrutor** | **(O)**, 데코레이터는 많이 쓰게 되면 추후 | DI 자동 등록 + 데코레이터 (3절) |
| MediatR | **(X, 상용)** — 직접 구현과 비교 후 다시 논의 | 4절 |
| MassTransit | **(X, 상용)** | 5절 |
| ~~Mapster~~ | **제외** — 매핑은 각자 직접 | 6절 |
| RabbitMQ | 검토 — "어떤 목적으로 쓸지를 먼저 정한다" | 5절 |
| SignalR | 알림 · 푸시용. 채팅 메시지는 SSE | 8절 |
| Polly | 검토 — 목적 · 가이드 정리 필요 | 9절 |

### 실행 환경 · 도구

| 항목 | 상태 | 한 줄 |
| --- | --- | --- |
| Docker · docker-compose | 채택. DB 도 Docker 로 띄워 쓴다 | 10절 |
| Kubernetes | 목록에 있음 | `07-db-infra/05-infra.md` 3절 |
| Aspire Dashboard | 채택 후보 | 10절 |
| Jaeger | Aspire 대안 | 10절 |
| Kubernetes Dashboard | 후순위 | 10절 |
| ~~Git submodule~~ | **제외** | 10절 끝 |

**이 목록에서 읽어 낼 방향:** 아키텍처는 Clean + DDD + 모듈러 모놀리스로 무겁게 가고, **상용 라이선스 라이브러리는 빼고**, 남는 빈자리는 작은 오픈소스(Carter · Scrutor · FluentValidation)나 직접 구현으로 채운다.
MediatR · MassTransit 이 빠진 이유가 둘 다 "상용 전환"이라는 점이 그 방향을 보여 준다.

---

## 1. Carter — Minimal API 를 모듈로 나누기

### 쓰기 전

Minimal API 는 `app.MapGet(...)` 을 `Program.cs` 에 쓴다. 엔드포인트가 100개면 이렇게 된다.

```csharp
// Program.cs — 엔드포인트가 늘수록 이 파일이 끝없이 길어진다
app.MapGet("/api/chatrooms", ...);
app.MapPost("/api/chatrooms", ...);
app.MapGet("/api/chatrooms/{id}/messages", ...);
app.MapPost("/api/documents/upload", ...);
// ... 100줄
```

나누려면 기능마다 확장 메서드를 직접 만들고 `Program.cs` 에서 하나하나 불러야 한다.

```csharp
public static class ChatRoomEndpoints
{
    public static IEndpointRouteBuilder MapChatRoomEndpoints(this IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/api/chatrooms");
        g.MapGet("/", ...);
        g.MapPost("/", ...);
        return app;
    }
}

// Program.cs — 모듈이 생길 때마다 한 줄씩 추가해야 하고, 빠뜨리면 그 API 가 없다
app.MapChatRoomEndpoints();
app.MapDocumentEndpoints();
app.MapSearchEndpoints();
```

### 쓴 후

```csharp
// Features/ChatRooms/ChatRoomModule.cs
public class ChatRoomModule : ICarterModule
{
    public void AddRoutes(IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/api/chatrooms").WithTags("ChatRooms");
        g.MapGet("/", GetList);
        g.MapPost("/", Create);
    }

    private static async Task<IResult> GetList(IChatRoomQueries q, CancellationToken ct)
        => TypedResults.Ok(await q.GetListAsync(ct));

    private static async Task<IResult> Create(CreateChatRoomRequest req, IChatRoomService svc, CancellationToken ct)
    {
        var id = await svc.CreateAsync(req, ct);
        return TypedResults.Created($"/api/chatrooms/{id}", new { id });
    }
}

// Program.cs — 모듈이 몇 개든 이 두 줄로 끝
builder.Services.AddCarter();
app.MapCarter();
```

`AddCarter()` 가 어셈블리를 훑어 `ICarterModule` 구현체를 전부 찾아 등록하고, `MapCarter()` 가 각 모듈의 `AddRoutes` 를 부른다.
**안쪽은 그냥 Minimal API 다.** `MapGroup` · `RequireAuthorization` · `WithTags` 같은 표준 기능을 그대로 쓴다. Carter 는 "어디에 쓰고 어떻게 모으나"만 정해 준다.

### Carter 가 더 주는 것

| 기능 | 하는 일 | 메모 |
| --- | --- | --- |
| `req.Validate(model)` | 등록된 FluentValidation 검증기로 검사 | 2절 |
| `res.Negotiate(data)` | `Accept` 헤더를 보고 응답 형식을 고른다 | JSON 만 쓴다면 의미가 작다 |
| `req.BindFile()` | 업로드 파일 바인딩을 짧게 | 아래 주의 참고 |
| 모듈 자동 등록 | 어셈블리 스캔 | 위 내용 |

**업로드 예제를 그대로 따라 하지 않는다.** 소개 자료 예제는 업로드 파일을 서버 로컬 폴더(`uploads/`)에 저장한다.
서버가 여러 대이거나 컨테이너라면 이 파일은 다른 서버에서 안 보이고 재시작하면 사라진다. 우리 구조에서는 Blob 같은 외부 저장소에 둔다 (`07-db-infra/05-infra.md` 2절, `07-db-infra/07-our-stack.md` 8절).

### 대가

- **"이 API 는 어디서 등록되나"를 `Program.cs` 에서 못 찾는다.** 경로 문자열(`"/api/chatrooms"`)이나 `ICarterModule` 로 검색한다.
- 의존성이 하나 늘어난다. Carter 가 ASP.NET Core 새 버전을 따라오기 전에는 업그레이드가 묶일 수 있다. 다만 Carter 가 하는 일이 얇아서, 최악의 경우 위 "쓰기 전" 모양으로 되돌리기 쉽다.
- 모듈 클래스는 **시작할 때 한 번만** 만들어진다. 모듈 생성자에 서비스를 주입받아 필드에 두면 Singleton 처럼 붙잡힌다. 서비스는 **핸들러 메서드의 매개변수로** 받는다 (`01-backend-basics/02-layers-and-di.md` 4절 함정 1).

**Vertical Slice 를 뺀 것과의 관계:** Carter 모듈은 기능별로 파일을 모으기 좋아서 VSA 와 자주 같이 소개된다.
우리는 VSA 대신 Clean Architecture 층 구조를 쓰므로, Carter 모듈은 **API(Presentation) 층에 두고 Application 층의 유스케이스를 부르는 얇은 입구**로 쓰게 된다.

> ❓ 입사 후 확인: Carter 모듈은 모듈(모놀리스의 모듈)마다 하나인가, 리소스마다 하나인가? 컨트롤러가 남아 있는 코드도 있나?

---

## 2. FluentValidation — 검증 규칙을 클래스로

`02-aspnet-core.md` 7절에서 개념은 봤다. 여기서는 전후 비교와 다른 라이브러리와의 연결만.

### 쓰기 전

```csharp
app.MapPost("/api/chatrooms", async (CreateChatRoomRequest req, IChatRoomService svc, CancellationToken ct) =>
{
    var errors = new Dictionary<string, string[]>();
    if (string.IsNullOrWhiteSpace(req.Title))      errors["title"] = ["제목은 필수입니다."];
    else if (req.Title.Length > 100)              errors["title"] = ["제목은 100자 이하입니다."];
    if (req.MemberIds is null || req.MemberIds.Count == 0) errors["memberIds"] = ["참여자가 필요합니다."];
    if (errors.Count > 0) return Results.ValidationProblem(errors);
    // ... 이제야 본론
});
```

엔드포인트마다 이 `if` 묶음이 붙는다. 같은 요청 타입을 받는 곳이 둘이면 규칙도 두 군데에 생긴다.

### 쓴 후

```csharp
public class CreateChatRoomValidator : AbstractValidator<CreateChatRoomRequest>
{
    public CreateChatRoomValidator()
    {
        RuleFor(x => x.Title).NotEmpty().MaximumLength(100);
        RuleFor(x => x.MemberIds).NotEmpty();
        RuleForEach(x => x.MemberIds).NotEqual(Guid.Empty);
    }
}

// Carter 로 쓰면
private static async Task<IResult> Create(HttpRequest http, CreateChatRoomRequest req, IChatRoomService svc, CancellationToken ct)
{
    var result = http.Validate(req);
    if (!result.IsValid) return Results.ValidationProblem(result.ToDictionary());
    ...
}
```

### 진짜 이득은 "한 곳에서 자동으로"

검증 호출조차 엔드포인트마다 쓰지 않는 것이 목표다. 방법은 세 가지가 있다.

| 어디서 | 방법 | 메모 |
| --- | --- | --- |
| 엔드포인트 필터 | `IEndpointFilter` 에서 요청 타입의 `IValidator<T>` 를 찾아 실행 | Minimal API 표준 기능 |
| Mediator 파이프라인 | 핸들러 앞에 검증 단계를 끼운다 | `06-architecture.md` 3절, 이 문서 4절 |
| Scrutor 데코레이터 | 핸들러를 검증 데코레이터로 감싼다 | 이 문서 3절 |

어느 쪽이든 **"요청 형식 검증은 앞에서, 업무 규칙은 Domain 에서"** 라는 두 층 구분은 그대로다 (`02-aspnet-core.md` 7절). FluentValidation 은 앞 층 담당이다.
.NET 10 부터는 Minimal API 에 DataAnnotations 기반 검증이 내장됐다. 간단한 규칙은 그걸로도 되지만, 조건부 · 컬렉션 · 다국어 메시지처럼 규칙이 복잡하면 FluentValidation 이 여전히 낫다.

| 기능 | 예 |
| --- | --- |
| 조건부 규칙 | `.When(x => x.IsAdult)` |
| 공통 규칙 재사용 | `Include(new CommonUserValidator())`, 또는 공통 부모 클래스 |
| 다국어 메시지 | `.WithMessage(Resources.Errors.NameRequired)` — `.resx` 리소스 파일과 현재 문화권으로 고른다 |
| 비동기 규칙 | `MustAsync(...)` — 단, DB 를 봐야 하는 규칙은 대개 업무 규칙이라 뒤 층이 맞다 |

---

## 3. Scrutor — DI 자동 등록과 데코레이터

### 쓰기 전 — 등록이 끝없이 길어진다

```csharp
builder.Services.AddScoped<IChatRoomService, ChatRoomService>();
builder.Services.AddScoped<IMessageService, MessageService>();
builder.Services.AddScoped<IDocumentService, DocumentService>();
// ... 서비스가 생길 때마다 한 줄. 빠뜨리면 실행 중에 "Unable to resolve service" 
```

`01-backend-basics/02-layers-and-di.md` 3절의 "기능별 확장 메서드로 묶기"가 표준 해법이지만, 묶어도 줄 수는 그대로다.

### 쓴 후 — 규칙으로 등록

```csharp
builder.Services.Scan(scan => scan
    .FromAssemblyOf<IChatRoomService>()                          // 이 어셈블리에서
    .AddClasses(c => c.Where(t => t.Name.EndsWith("Service")))   // 이름이 Service 로 끝나는 클래스를
    .AsImplementedInterfaces()                                   // 구현한 인터페이스로
    .WithScopedLifetime());                                      // Scoped 로 등록
```

"이 규칙을 따르면 자동으로 등록된다"는 관례 기반(convention) 방식이다. Next.js 가 `app/` 폴더 구조만 보고 라우트를 만드는 것과 같은 발상이다.

### 데코레이터 — 원래 코드를 고치지 않고 감싸기

**Decorator 패턴**은 같은 인터페이스를 구현하는 클래스로 원래 객체를 감싸서, 앞뒤에 기능을 붙이는 것이다.
프론트의 고차 함수(`withLogging(fn)`)나 고차 컴포넌트와 같은 모양이다.

```csharp
public class LoggingMessageSender(IMessageSender inner, ILogger<LoggingMessageSender> log) : IMessageSender
{
    public async Task SendAsync(Message m, CancellationToken ct)
    {
        var sw = Stopwatch.StartNew();
        await inner.SendAsync(m, ct);                          // 원래 구현 호출
        log.LogInformation("Sent {MessageId} in {Ms}ms", m.Id, sw.ElapsedMilliseconds);
    }
}
```

기본 DI 컨테이너로 이걸 등록하려면 꼬인다.

```csharp
// 쓰기 전 — 구현 클래스를 따로 등록하고, 인터페이스 등록을 손으로 조립한다
builder.Services.AddScoped<EmailSender>();
builder.Services.AddScoped<IMessageSender>(sp =>
    new LoggingMessageSender(sp.GetRequiredService<EmailSender>(),
                             sp.GetRequiredService<ILogger<LoggingMessageSender>>()));
```

```csharp
// 쓴 후
builder.Services.AddScoped<IMessageSender, EmailSender>();
builder.Services.Decorate<IMessageSender, LoggingMessageSender>();
```

### 데코레이터로 Mediator 파이프라인을 대신할 수 있다

Scrutor 는 **제네릭 인터페이스 전체**를 한 번에 감쌀 수 있다. 이게 4절과 이어진다.

```csharp
// 모든 커맨드 핸들러를 로깅 → 검증 순서로 감싼다
builder.Services.Decorate(typeof(ICommandHandler<,>), typeof(ValidationDecorator<,>));
builder.Services.Decorate(typeof(ICommandHandler<,>), typeof(LoggingDecorator<,>));
// 나중에 Decorate 한 것이 가장 바깥이다: Logging → Validation → 실제 핸들러
```

MediatR 의 `IPipelineBehavior` 가 하던 "검증 · 로그 · 트랜잭션을 한 번만 쓰고 모든 핸들러에"를 라이브러리 없이 얻는다.

### 대가

| 대가 | 대응 |
| --- | --- |
| 등록이 "보이지 않는다". 어떤 클래스가 왜 등록됐는지 코드에 안 적혀 있다 | 스캔 규칙을 단순하게. 이름 · 마커 인터페이스 같은 명확한 기준 하나 |
| 의도하지 않은 클래스까지 등록될 수 있다 | `AddClasses` 조건을 좁게 |
| 데코레이터 **순서**가 등록 순서에 숨어 있다 | 순서를 주석으로 남긴다 (위 예제처럼) |
| 생명주기를 규칙 하나로 정하면 예외가 섞인다 | Singleton 이어야 할 것은 스캔에서 빼고 따로 등록 |

목록의 메모대로 **스캔은 지금, 데코레이터는 많이 쓰게 될 때** 도입한다는 순서가 합리적이다. 데코레이터가 두세 개뿐이면 손으로 등록하는 게 더 읽기 쉽다.

---

## 4. Mediator — MediatR 없이 갈 것인가

### 상태

목록에는 MediatR 이 **(X, commercial)** 이고, "CQRS 를 사용했을 때의 코드 / MediatR 을 사용했을 때의 코드 비교 후 다시 논의"라고 적혀 있다.
목록에 붙어 있는 MediatR 소개 자료에는 Apache-2.0 이라고 적혀 있는데, 이는 **상용 전환 이전 버전** 기준이다. 옛 버전은 계속 쓸 수 있지만 업데이트는 새 라이선스 쪽으로만 나온다.

그런데 같은 목록에서 Mediator **패턴**은 "모듈러 모놀리스를 위해 꼭 알아야 하는 패턴"이다. 즉 **패턴은 쓰고, 라이브러리는 고민 중**이다.

### 비교할 세 가지 모양

**① 라이브러리 없이, 핸들러를 직접 주입 (CQRS 만)**

```csharp
public interface ICommandHandler<TCommand, TResult>
{
    Task<TResult> HandleAsync(TCommand command, CancellationToken ct);
}

// 엔드포인트가 핸들러를 직접 받는다
g.MapPost("/", (CreateChatRoomCommand cmd, ICommandHandler<CreateChatRoomCommand, Guid> handler, CancellationToken ct)
    => handler.HandleAsync(cmd, ct));
```

- 장점: F12 로 바로 핸들러에 간다. 마법이 없다.
- 공통 처리: 3절의 Scrutor 데코레이터로 감싼다.
- 단점: 엔드포인트가 핸들러 타입을 안다. **다른 모듈의 핸들러를 직접 주입하면 모듈 경계가 무너진다.**

**② 사내 Mediator (MediatR 과 같은 모양을 직접 구현)**

```csharp
g.MapPost("/", (CreateChatRoomCommand cmd, IMediator mediator, CancellationToken ct)
    => mediator.Send(cmd, ct));
```

`06-architecture.md` 3절의 마지막 인용처럼, 핵심은 "요청 타입 → 핸들러를 DI 에서 찾아 부르기 + 앞뒤로 behavior 감싸기"뿐이라 수백 줄이면 된다.

**③ MediatR (상용 라이선스 비용을 낸다)**

②와 같은 모양에 문서 · 생태계가 따라온다.

### 모듈러 모놀리스에서 Mediator 가 "꼭" 필요한 이유

모듈끼리는 **서로의 내부 클래스를 참조하면 안 된다** (`06-architecture.md` 6절 모듈 사이의 규칙).

```
Chat 모듈이 Search 모듈의 기능을 쓰고 싶다

❌ Chat → Search.Application.SearchHandler 를 직접 참조     (모듈 내부에 손을 댄다)
✅ Chat → Search.Contracts.SearchQuery 를 mediator.Send      (공개된 요청 객체만 안다)
```

Mediator 가 있으면 다른 모듈에는 **요청 · 응답 타입(Contracts)만** 공개하고, 누가 처리하는지는 숨길 수 있다. ①의 직접 주입으로는 이게 안 된다.
그래서 목록의 결론은 아마 "모듈 **안**은 ① 이어도 되지만 모듈 **사이**는 Mediator 가 필요하다" 쪽으로 갈 가능성이 높다. 비교할 때 이 기준으로 보면 된다.

| | ① 직접 주입 | ② 사내 Mediator | ③ MediatR |
| --- | --- | --- | --- |
| 코드 추적 | 쉽다 | 검색 필요 (`요청이름 + Handler`) | 검색 필요 |
| 공통 처리 | Scrutor 데코레이터 | 직접 만든 behavior | `IPipelineBehavior` |
| 모듈 간 호출 | 경계가 깨지기 쉽다 | Contracts 만 공개 | Contracts 만 공개 |
| 비용 | 없음 | 만들고 유지하는 시간 | 라이선스 |
| 알림(1:N) | 직접 | 직접 (`Publish`) | 내장 `INotification` |

> ❓ 입사 후 확인: MediatR 논의는 어떻게 결론 났나? 사내 Mediator 가 있다면 이름 규칙과 behavior 등록 방법은?

---

## 5. 메시징 — RabbitMQ, 그리고 MassTransit 이 빠진 자리

### 목록의 메모: "어떤 목적으로 사용할지를 먼저 정한다"

이게 가장 중요한 한 줄이다. 메시지 큐는 붙이는 순간 **운영할 시스템이 하나 늘고, "언젠가 처리된다"는 비동기 사고방식**이 코드 전체에 들어온다.
목록에 적힌 후보 용도를 성격별로 나누면 판단이 쉬워진다.

| 후보 용도 (목록) | 성격 | 큐가 필요한가 |
| --- | --- | --- |
| 파일 업로드 후 처리 (배치) | 오래 걸리는 작업. 실패하면 재시도 | **잘 맞는다.** 파싱 · 청킹 · 임베딩을 워커로 (`01-backend-basics/05-long-running-jobs.md`) |
| 대화 내역 · 로그성 데이터 | 쓰기 폭주를 흡수해 DB 부하 분산 | 맞을 수 있다. 단 메시지가 처리되기 전엔 조회에 안 보인다 |
| 통계 데이터 · 알림 | 본 요청과 무관한 후속 작업 | 잘 맞는다. 본 요청을 느리게 하지 않는다 |
| 대용량 트래픽 챗봇 답변 처리 (선택) | 사용자가 **실시간으로 기다리는** 작업 | 신중히. 큐에 줄 서는 시간이 그대로 응답 지연이 된다 |

**DB 기반 큐로 먼저 시작하는 선택지도 있다.** 작업 수가 많지 않으면 Postgres 테이블 + `SKIP LOCKED` 로 충분하다 (`05-long-running-jobs.md` 5절). RabbitMQ 는 처리량 · 라우팅 · 여러 소비자가 필요해질 때의 다음 단계다.

### RabbitMQ 를 처음 볼 때 알아야 할 말

```
발행자 ──▶ Exchange ──(라우팅 키로 분배)──▶ Queue ──▶ 소비자
            "chat"       message.created           chat-stats   통계 워커
                                       ──▶ Queue ──▶ 소비자
                                           chat-archive 보관 워커
```

| 용어 | 뜻 |
| --- | --- |
| Exchange | 메시지를 받아 **어느 큐로 보낼지 정하는 분배기**. 발행자는 큐가 아니라 여기로 보낸다 |
| Queue | 메시지가 쌓여 소비자를 기다리는 줄 |
| Routing key | 분배 기준이 되는 꼬리표. `message.created` 처럼 점으로 나눈다 |
| Topic exchange | 라우팅 키를 `message.*` 같은 패턴으로 고른다 |
| Ack | 소비자가 "처리 끝났다"고 알리는 것. Ack 전에 소비자가 죽으면 **다른 소비자에게 다시 간다** |
| Durable · persistent | 큐와 메시지를 디스크에 남겨 브로커 재시작에도 살아남게 하는 설정 |

**Ack 가 있다는 것은 메시지가 두 번 올 수 있다는 뜻이다(at-least-once).** 처리 직후 Ack 전에 죽으면 같은 메시지를 다시 받는다. 그래서 소비자는 **멱등**이어야 한다 (`05-long-running-jobs.md` 4절).

### MassTransit 이 빠지면 직접 해야 하는 것

MassTransit 은 RabbitMQ 위에서 아래 일들을 대신 해 주던 라이브러리다. 상용 전환으로 빠졌으니 **이 목록이 곧 우리가 직접 챙길 일**이다.

| MassTransit 이 해 주던 것 | 직접 할 때 |
| --- | --- |
| 메시지 타입 → Exchange · Queue 자동 생성 | 이름 규칙을 정하고 시작 시 선언 |
| 직렬화 · 역직렬화 | `System.Text.Json` 으로 직접 |
| 재시도 · 지연 재시도 | 실패 횟수를 헤더에 세고, 넘으면 Dead Letter 큐로 |
| 소비자 DI 스코프 | 메시지마다 `CreateScope()` (`05-long-running-jobs.md` — BackgroundService 함정) |
| 아웃박스 (DB 저장과 발행을 함께) | 직접 구현 (`07-db-infra/07-our-stack.md` 4절) |

공식 클라이언트(`RabbitMQ.Client`)로 쓰면 대략 이런 모양이다. 7.x 부터 API 가 비동기(`...Async`)로 바뀌어서 옛 예제와 다르다.

```csharp
// 발행
await channel.BasicPublishAsync(
    exchange: "chat", routingKey: "message.created",
    body: JsonSerializer.SerializeToUtf8Bytes(evt));

// 소비 — autoAck: false 로 받고, 처리가 끝난 뒤에 Ack
var consumer = new AsyncEventingBasicConsumer(channel);
consumer.ReceivedAsync += async (_, ea) =>
{
    using var scope = scopeFactory.CreateScope();                 // 메시지마다 새 스코프
    var handler = scope.ServiceProvider.GetRequiredService<MessageCreatedHandler>();
    await handler.HandleAsync(JsonSerializer.Deserialize<MessageCreated>(ea.Body.Span)!);
    await channel.BasicAckAsync(ea.DeliveryTag, multiple: false);
};
await channel.BasicConsumeAsync("chat-stats", autoAck: false, consumer);
```

> ❓ 입사 후 확인: RabbitMQ 를 결국 무엇에 쓰기로 했나? 메시지 재시도 · Dead Letter 규칙은? 발행은 아웃박스를 거치나?

---

## 6. Mapster 를 빼고 — 매핑은 직접

목록: ~~Mapster~~ → "각개 하는 형태로". 엔티티 ↔ DTO 변환을 라이브러리 없이 **기능마다 직접 쓴다**는 뜻이다.

### 쓰기 전과 후 (여기서는 "후"가 라이브러리 없는 쪽)

```csharp
// 매핑 라이브러리를 쓰면 — 짧지만 무엇이 무엇으로 가는지 안 보인다
var dto = message.Adapt<MessageDto>();

// 직접 쓰면 — 길지만 전부 보이고, 필드가 빠지면 컴파일러가 잡는다
public static class MessageMappings
{
    public static MessageDto ToDto(this ChatMessage m) => new(
        Id: m.Id,
        Role: m.Role.ToString().ToLowerInvariant(),
        Content: m.Content,
        Citations: m.Citations.Select(c => c.ToDto()).ToList(),
        CreatedAt: m.CreatedAt);
}
```

| | 매핑 라이브러리 | 직접 매핑 |
| --- | --- | --- |
| 코드 양 | 적다 | 많다 |
| DTO 에 필드를 추가하고 매핑을 잊었다 | **조용히 기본값** (런타임에 빈 값이 나간다) | 레코드 생성자라면 **컴파일 에러** |
| "이 값이 어디서 왔나" 추적 | 규칙을 알아야 한다 | F12 한 번 |
| 엔티티 내부 필드가 실수로 노출될 위험 | 이름이 같으면 자동으로 따라간다 | 적은 것만 나간다 |

마지막 줄이 `01-backend-basics/02-layers-and-di.md` 2절 "DTO 와 엔티티를 왜 분리하나"의 이유와 같다. 같은 이유로 .NET 의 대표 매핑 라이브러리 AutoMapper 도 MediatR 과 함께 상용으로 바뀌었고, 직접 매핑으로 돌아가는 팀이 늘었다.
**AI 코딩 도구가 반복 코드를 대신 써 주는 지금은 "코드 양"이라는 단점이 많이 줄었다.**

EF Core 조회에서는 확장 메서드보다 `Select` 안에서 바로 DTO 를 만드는 쪽이 낫다. 그래야 필요한 컬럼만 SQL 로 나간다 (`03-ef-core.md`).

---

## 7. 디자인 패턴 네 가지 — 이 제품에서 어디에 나오나

### Factory — "무엇을 만들지"를 실행 중에 고른다

```csharp
public interface ISearchProviderFactory
{
    ISearchProvider Create(SearchEndpointConfig config);   // 설정을 보고 알맞은 구현을 만든다
}
```

이 제품에서 대표적인 자리는 **고객사 설정에 따라 구현이 바뀌는 곳**이다. LLM 프로바이더(`07-db-infra/07-our-stack.md` 7절 `IChatClientFactory`), 파일 저장소, 검색 엔드포인트.
`01-backend-basics/02-layers-and-di.md` 6절 "어떤 어댑터를 쓸지는 누가 고르나"가 바로 Factory 의 자리다.

### Decorator — 감싸서 기능을 더한다

3절 Scrutor 에서 봤다. 로깅 · 캐싱 · 재시도 · 검증처럼 **본 기능과 상관없는 공통 처리**를 붙일 때 쓴다.
`ISearchProvider` 를 `CachingSearchProvider` 로 감싸면 검색 구현은 그대로 두고 Redis 캐시를 붙일 수 있다.

### Repository — 저장소를 컬렉션처럼

`06-architecture.md` 2절의 `IOrderRepository` 다. 다만 **EF Core 의 `DbContext` 자체가 이미 Repository + Unit of Work** 라서, EF Core 위에 Repository 를 또 씌울지는 팀마다 의견이 갈린다.

| Repository 를 두는 게 의미 있는 곳 | 굳이 안 두는 곳 |
| --- | --- |
| DDD 애그리거트 단위로 저장·불러오기를 강제하고 싶을 때 | 조회 전용 쿼리 (CQRS 의 Query 쪽은 `DbContext` 로 바로 `Select`) |
| 저장소가 Postgres 와 Mongo 로 나뉘어 있을 때 — Application 은 어디에 저장되는지 몰라도 된다 | 단순 CRUD |

이 제품처럼 **채팅 메시지는 Mongo, 채팅방 · 권한은 Postgres** 라면 Repository 인터페이스가 그 차이를 Application 층에서 숨겨 준다.

### Pub-Sub — 보내는 쪽이 받는 쪽을 모른다

"무슨 일이 일어났다"를 알리기만 하고, 누가 듣는지는 모르는 구조다. 같은 이름이지만 **범위가 다른 네 가지**가 이 목록에 다 나온다.

| 종류 | 범위 | 예 | 메시지를 잃으면 |
| --- | --- | --- | --- |
| Mediator 알림 · 도메인 이벤트 | **한 프로세스 안** | 메시지 저장됨 → 같은 서버의 통계 핸들러 | 프로세스가 죽으면 같이 사라진다 |
| Redis pub/sub | 서버 여러 대, **저장 안 함** | 캐시 무효화 신호, SignalR 백플레인 | 그 순간 안 듣던 쪽은 못 받는다 |
| **RabbitMQ** | 서버 여러 대, **저장함** | 파일 처리 · 통계 · 알림 작업 | 큐에 남아 있다가 처리된다 |
| SignalR | 서버 → **브라우저** | 사용자 알림 · 푸시 | 연결이 없던 사용자는 못 받는다 |

**"이 이벤트를 잃으면 안 되는가?"** 가 고르는 기준이다. 잃으면 안 되는 일을 프로세스 안 알림이나 Redis pub/sub 에 두면, 배포 한 번에 조용히 사라진다.

---

## 8. SignalR 과 SSE — 둘 다 쓰는 이유

목록: SignalR 은 **알림 · 푸시**, 채팅 메시지는 **SSE (POST → GET)**.

| | 채팅 답변 스트리밍 | 알림 · 푸시 |
| --- | --- | --- |
| 방향 | 내가 보낸 질문에 대한 응답이 흘러온다 | 서버가 아무 때나 먼저 보낸다 |
| 수명 | 답변 하나 동안 | 로그인해 있는 동안 계속 |
| 고른 기술 | **SSE** | **SignalR** (WebSocket 기반, 끊기면 다른 방식으로 대체) |
| 이유 | 단방향 · HTTP 그대로 · 재연결과 이어받기가 쉽다 | 양방향 · 사용자/그룹 단위로 보내기 · 연결 관리가 내장 |

SSE 를 POST(질문 전송 → `runId`)와 GET(`runId` 로 스트림 수신)으로 나누는 이유는 `05-realtime-ui/01-sse-vs-websocket.md` 4절에 있다.
SignalR 을 서버 여러 대에서 쓰면 **백플레인**(Redis 또는 Azure SignalR Service)이 필요하다. 서버 A 에 붙은 사용자에게 서버 B 가 보낼 길이 없기 때문이다 (`07-db-infra/05-infra.md` 2절).

```csharp
// 서버 어디서든 특정 사용자에게 알림 보내기
public class NotificationService(IHubContext<NotificationHub> hub)
{
    public Task NotifyAsync(string userId, NotificationDto n, CancellationToken ct)
        => hub.Clients.User(userId).SendAsync("notification", n, ct);
}
```

프론트에서는 `@microsoft/signalr` 패키지로 연결하고 `connection.on("notification", ...)` 으로 받는다. SSE 의 `EventSource` 와 달리 **연결 하나로 여러 종류의 이벤트**를 받는다.

> ❓ 입사 후 확인: SignalR 백플레인은 무엇인가? 알림은 어떤 이벤트들인가? (목록에 "예시 만들기"가 있으니 사내 예제가 있을 수 있다)

---

## 9. Polly — "어떤 목적"부터

목록 메모가 RabbitMQ 와 같다. **"어떤 목적", "가이드 정리"**. 도구보다 목적을 먼저 정하자는 것이다.

Polly 는 재시도 · 타임아웃 · 서킷 브레이커를 조립하는 라이브러리다. 개념과 기본 구성은 `07-db-infra/03-resilience.md` 에 다 있다.
.NET 8+ 의 `AddStandardResilienceHandler()` 가 내부적으로 Polly 를 쓰므로, **HttpClient 로 나가는 호출은 대부분 Polly 를 직접 만질 필요가 없다.**

이 제품에서 목적을 나눠 보면 이렇다.

| 대상 | 특성 | 정책의 방향 |
| --- | --- | --- |
| LLM 호출 | 느리다(수십 초). 429 가 잦다. **스트리밍 중간에는 재시도 불가** | 시작 전 실패만 재시도, 긴 타임아웃, `Retry-After` 존중 |
| 검색 엔드포인트 (여러 개) | 하나가 죽어도 나머지 결과로 답할 수 있다 | 짧은 타임아웃 + 서킷 브레이커 + 빠진 결과는 생략 (우아한 실패) |
| 고객사 API | 느리고 호출 제한이 있다. 우리가 못 고친다 | 표준 구성 + 고객사별 조정 |
| RabbitMQ 소비자 | 처리 실패 시 | Polly 대신 큐의 재시도 · Dead Letter 로 |

마지막 줄이 중요하다. **재시도를 두 군데서 하면 곱해진다.** 큐도 재시도하고 소비자 안의 Polly 도 3번 재시도하면, 한 메시지가 9번 실행될 수 있다.

---

## 10. Docker · Aspire · 관측 도구

### Docker 와 docker-compose

목록: Database 는 **Docker 에 띄워서 사용**. 개념은 `07-db-infra/05-infra.md` 3절, 로컬 compose 예시는 `07-db-infra/07-our-stack.md` 11절에 있다.

### Aspire — compose 를 C# 으로

목록 메모: "Aspire 도 Docker 이미지가 있어서 띄우기 쉬움".
**Aspire** 는 마이크로소프트가 만든 **로컬 개발 오케스트레이션 + 관측 도구 묶음**이다. 여러 서비스와 DB 를 C# 코드로 선언하면 한 번에 띄우고, 연결 문자열을 알아서 넣어 주고, 대시보드에서 로그 · 트레이스를 보여 준다.

```csharp
// AppHost/Program.cs — docker-compose.yml 을 C# 으로 쓴 것에 가깝다
var builder = DistributedApplication.CreateBuilder(args);

var pg     = builder.AddPostgres("pg").AddDatabase("app");
var mongo  = builder.AddMongoDB("mongo");
var redis  = builder.AddRedis("cache");
var rabbit = builder.AddRabbitMQ("mq");

builder.AddProject<Projects.Api>("api")
       .WithReference(pg).WithReference(mongo).WithReference(redis).WithReference(rabbit);

builder.Build().Run();
```

`WithReference` 가 연결 문자열을 API 프로젝트의 설정으로 넣어 준다. `appsettings.Development.json` 에 주소를 손으로 적지 않아도 된다.

### Aspire Dashboard · Jaeger · Kubernetes Dashboard

| 도구 | 보는 것 | 메모 |
| --- | --- | --- |
| **Aspire Dashboard** | 로그 · 트레이스 · 메트릭 (OpenTelemetry 로 받은 것 전부) | Aspire 없이 **단독 컨테이너로도** 띄울 수 있다 (standalone mode) |
| **Jaeger** | 트레이스 | 목록의 "Aspire 대안". 트레이스 전용, 오래된 오픈소스 표준 |
| Kubernetes Dashboard | 쿠버네티스 클러스터의 파드 · 배포 상태 | 후순위. 클러스터를 운영할 때의 이야기 |

앞의 둘은 **같은 데이터를 받는 다른 화면**이다. 앱은 OpenTelemetry 로 한 번만 계측하고, 보낼 곳(OTLP 주소)만 바꾸면 된다 (`07-db-infra/04-observability.md` 6절).

```bash
# Aspire Dashboard 단독 실행 — 브라우저 18888, 앱은 OTLP 를 4317 로 보낸다
docker run --rm -d -p 18888:18888 -p 4317:18889 --name aspire-dashboard mcr.microsoft.com/dotnet/aspire-dashboard:latest
```

```csharp
// 앱 쪽 — 보낼 곳만 OTLP 로
builder.Services.AddOpenTelemetry()
    .WithTracing(t => t.AddAspNetCoreInstrumentation().AddHttpClientInstrumentation())
    .UseOtlpExporter();   // OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4317
```

Aspire Dashboard 는 데이터를 **메모리에만** 둔다. 껐다 켜면 사라진다. 로컬 개발 · 테스트 환경용이고, 운영 관측은 별도 저장소(Application Insights 등)가 필요하다.

### ~~Git submodule~~

서브모듈은 Git 저장소 안에 **다른 Git 저장소를 특정 커밋으로 고정해 끼워 넣는** 기능이다. 공용 코드를 여러 저장소가 나눠 쓸 때 쓴다.
`git clone` 후 `git submodule update --init` 을 잊으면 폴더가 비어 있고, 고정 커밋을 올리는 걸 잊으면 옛 버전을 쓰는 등 실수할 지점이 많아서 빠진 것으로 보인다. 공용 코드는 보통 NuGet 패키지나 모노레포로 나눠 쓴다.

> ❓ 입사 후 확인: 로컬 개발은 docker-compose 인가 Aspire AppHost 인가? 공용 코드(사내 Mediator 등)는 어떻게 나눠 쓰나?

---

## 11. 목록 끝의 도메인 메모 — 화면을 만들 때 직접 부딪힌다

목록 마지막에 기술이 아니라 **제품 설계 메모**가 있다. 프론트와 가장 가까운 부분이다.

### "최종 챗 메시지가 1개가 아니라 N개가 되는 사태"

질문 하나에 답변 메시지가 하나라고 가정하기 쉽다. 그런데 메모에 따르면 이미 **반환 타입이 `List<ChatMessage>`** 다. 이유로 든 예가 "따봉, LLM Select 등"이다.

| N개가 되는 경우 | 예 |
| --- | --- |
| 여러 모델 답변 비교 (LLM Select) | 같은 질문에 모델 A · B 의 답을 나란히 보여 주고 사용자가 고른다 |
| 피드백 (따봉) | 답변에 붙은 평가가 별도 메시지 · 이벤트로 남는다 |
| 에이전트 실행 | 도구 호출 결과 · 중간 단계 · 최종 답이 각각 메시지 |

설계에 미치는 영향:

- **"한 턴(turn)"과 "메시지"를 구분한다.** 메시지마다 `turnId` (또는 `parentId`)를 둬서 같은 질문에서 나온 메시지를 묶는다.
- **선택 상태를 저장한다.** LLM Select 라면 "사용자가 고른 답"이 다음 대화의 맥락이 된다. 고르지 않은 답을 맥락에 넣으면 모델이 헷갈린다.
- **프론트는 처음부터 배열로 그린다.** `message: Message` 로 상태를 잡아 두면 나중에 전부 고쳐야 한다. `messages: Message[]` 로 받고, 하나뿐인 경우를 특별 케이스로 본다.
- **SSE 이벤트에도 메시지 id 가 실려야 한다.** 여러 메시지가 동시에 스트리밍되면 토큰 조각이 어느 메시지 것인지 알아야 한다.

### "ChatRoom (n:m)"

채팅방과 사용자가 다대다 관계라는 뜻이다. 한 사용자가 여러 방에, 한 방에 여러 사용자가. 관계형에서는 **중간 테이블**로 만든다 (`07-db-infra/01-relational-basics.md` 3절).

```
chat_rooms (id, title, tenant_id, ...)
chat_room_members (room_id, user_id, role, joined_at, last_read_message_id)   ← n:m 중간 테이블
```

중간 테이블에 **관계 자체의 정보**(방에서의 역할, 마지막으로 읽은 메시지)가 붙는 게 보통이다. 안 읽은 메시지 수 배지가 여기서 나온다.
방 · 멤버는 Postgres(권한과 엮인다), 메시지 본문은 Mongo(4절 · `07-our-stack.md` 4절)로 나뉠 가능성이 높다.

### "서치 — 여러 개의 서치 엔드포인트를 모듈화"

메모를 요약하면 이렇다. **검색 자체를 인터페이스로 만들고**, 프로젝트(고객사)마다 어떤 검색을 뒤에 붙일지는 그 인터페이스를 확립한 다음에 정한다. 벡터 검색은 OpenSearch 말고 다른 것.

```csharp
public interface ISearchProvider
{
    string Name { get; }
    Task<IReadOnlyList<SearchHit>> SearchAsync(SearchRequest req, CancellationToken ct);
}

// 여러 엔드포인트를 동시에 부르고 합친다
public class CompositeSearch(IEnumerable<ISearchProvider> providers, IReranker reranker)
{
    public async Task<IReadOnlyList<SearchHit>> SearchAsync(SearchRequest req, CancellationToken ct)
    {
        var results = await Task.WhenAll(providers.Select(p => SafeSearch(p, req, ct)));   // 하나가 죽어도 나머지로
        return await reranker.RerankAsync(req.Query, results.SelectMany(r => r).ToList(), ct);
    }
}
```

이 문서의 패턴이 여기 다 모인다. 구현을 고르는 **Factory**, 캐시 · 로깅을 붙이는 **Decorator**, 엔드포인트마다 다른 **Polly** 정책, 결과를 합치는 리랭킹(`03-rag/03-retrieval-quality.md`).
여러 검색 결과를 합칠 때는 점수 척도가 서로 달라서 그대로 비교할 수 없다. 그래서 순위 기반으로 합치거나 리랭커를 한 번 더 거친다.

> ❓ 입사 후 확인: 메시지 묶음(턴) 구조와 LLM Select 의 저장 방식은? 검색 인터페이스는 확정됐나? 벡터 검색은 무엇으로 하나?

---

## 12. 정리 — 이 목록을 읽는 법

| 질문 | 답 |
| --- | --- |
| 무엇을 무겁게 가나 | Clean + DDD + 모듈러 모놀리스. 모듈 사이는 Mediator 로 |
| 무엇을 뺐나 | 상용 전환한 라이브러리(MediatR · MassTransit), 마법이 많은 매핑(Mapster), VSA, submodule |
| 빈자리는 무엇으로 | 작은 오픈소스(Carter · Scrutor · FluentValidation) + 직접 구현 |
| 아직 열린 것 | Mediator 구현 방식, RabbitMQ 의 목적, Polly 가이드 |
| 프론트에 직접 닿는 것 | 메시지 N개, ChatRoom n:m, SignalR 알림 + SSE 채팅, 검색 엔드포인트 여러 개 |

**라이브러리를 들일 때마다 묻는 세 가지** — 목록이 실제로 이 순서로 판단하고 있다.

1. **목적이 정해졌나?** (RabbitMQ · Polly 에 붙은 메모)
2. **라이선스와 비용은?** (MediatR · MassTransit 제외)
3. **없을 때의 코드와 비교해 무엇이 줄고 무엇이 숨나?** (이 문서 전체의 "쓰기 전과 후")

## 스스로 답해보기

1. Carter 를 쓰면 `Program.cs` 에서 무엇이 사라지나? 대신 "이 API 는 어디서 등록됐나"는 어떻게 찾나?
2. Carter 모듈 생성자에 Scoped 서비스를 주입받으면 왜 문제인가? 대신 어떻게 받나?
3. 소개 자료의 `BindFile` 예제처럼 업로드 파일을 서버 로컬 폴더에 저장하면 우리 구조에서 무슨 일이 생기나?
4. FluentValidation 검증을 엔드포인트마다 부르지 않고 한 곳에서 자동으로 실행하는 방법 세 가지는?
5. Scrutor 의 `Decorate` 를 두 번 호출했다. 어느 쪽이 가장 바깥에서 실행되나?
6. Scrutor 데코레이터로 MediatR 파이프라인을 대신할 수 있는데도, 모듈러 모놀리스에서 Mediator 가 "꼭" 필요하다고 하는 이유는?
7. MassTransit 없이 RabbitMQ 를 직접 쓰면 우리가 챙겨야 할 일 세 가지는?
8. RabbitMQ 소비자에서 처리 후 Ack 전에 서버가 죽었다. 무슨 일이 생기고, 소비자 코드는 무엇을 지켜야 하나?
9. 큐에서도 재시도하고 소비자 안에서 Polly 로도 3번 재시도하면 무슨 일이 생기나?
10. 직접 매핑이 매핑 라이브러리보다 안전한 경우를 하나 들어 보라.
11. "메시지가 사라지면 안 되는 이벤트"를 Redis pub/sub 으로 보내면 어떤 상황에서 잃나?
12. 채팅 답변은 SSE, 알림은 SignalR 로 나눈 이유는?
13. 질문 하나에 답변 메시지가 N개일 수 있다. 프론트 상태와 SSE 이벤트 설계에서 각각 무엇을 바꿔야 하나?
14. ChatRoom n:m 의 중간 테이블에 붙을 만한 컬럼 두 가지와, 그것으로 그릴 수 있는 화면 요소는?
