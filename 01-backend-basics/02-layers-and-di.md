# 계층 구조와 DI

공고에 **"MVC 기반 컨트롤러, 서비스(DI) 로직"** 이라고 적혀 있다. 그 한 줄이 이 문서 전체다.

MVC 는 Model-View-Controller 의 줄임말이다. 원래는 화면까지 서버가 그리던 시절의 구조인데,
API 서버에서는 View 가 JSON 응답으로 바뀌고 "Controller 가 요청을 받아 Model(데이터·규칙)을 부른다"는 뼈대만 남았다.
DI 는 3절에서 자세히 본다.

---

## 1. 왜 계층을 나누나

프론트에서 FSD 를 쓰는 이유와 **완전히 같다.** 의존 방향을 한쪽으로 고정해서 변경이 번지는 범위를 자른다.

```
Controller   ← HTTP 를 아는 유일한 층. 요청/응답 형태 변환, 상태코드 결정
    ↓
Service      ← 업무 규칙. HTTP 도 SQL 도 모른다
    ↓
Repository   ← 데이터 접근. 업무 규칙을 모른다
    ↓
DB
```

**화살표는 아래로만 간다.** Service 가 `HttpContext` 를 만지는 순간 이 구조는 죽는다.
"A 가 B 에 의존한다"는 A 의 코드가 B 를 import 하거나 호출한다는 뜻이다. Service 는 Repository 를 부르지만 Repository 는 Service 를 모른다.
그래서 Repository 를 고쳐도 Controller 까지 번지지 않고 HTTP 를 gRPC 로 바꿔도 Service 는 그대로다.

| 계층 | 아는 것 | 모르는 것 | FSD 로 치면 |
| --- | --- | --- | --- |
| Controller | HTTP, 상태코드, DTO | 업무 규칙, SQL | `pages` / route handler |
| Service | 업무 규칙, 트랜잭션 경계 | HTTP, SQL 방언 | `features` 의 model |
| Repository | 테이블, 쿼리 | 왜 이 데이터가 필요한지 | `shared/api` |

표의 용어 몇 개를 풀어 둔다.

- **업무 규칙(비즈니스 로직)** — "같은 병원에 같은 이름의 펫은 중복 등록 불가"처럼 기술이 아니라 업무에서 나온 규칙. 기획서에 적히는 종류의 문장이다.
- **트랜잭션 경계** — 어디서부터 어디까지를 "전부 성공 아니면 전부 취소"로 묶을지. 이걸 정하려면 업무 의미를 알아야 해서 Service 몫이다. (`03-database.md` 2절)
- **SQL 방언** — PostgreSQL 과 MSSQL 의 문법 차이(`LIMIT` vs `TOP` 등). Repository 와 EF Core 가 흡수한다.

### 각 층이 실제로 하는 일

```csharp
// ── Controller: 얇아야 한다. 판단하지 않는다 ──────────────────
[HttpPost]
public async Task<ActionResult<PetDto>> Create([FromBody] CreatePetRequest req)
{
    var pet = await _petService.CreateAsync(req.ToCommand(), User.GetTenantId());
    return CreatedAtAction(nameof(GetById), new { id = pet.Id }, pet);
}

// ── Service: 여기에 규칙이 산다 ────────────────────────────
public async Task<PetDto> CreateAsync(CreatePetCommand cmd, Guid tenantId)
{
    // 업무 규칙 1: 같은 병원에 같은 이름+보호자 조합은 중복 등록 불가
    if (await _repo.ExistsAsync(tenantId, cmd.Name, cmd.OwnerId))
        throw new DuplicatePetException(cmd.Name);

    // 업무 규칙 2: 생년월일이 미래면 안 됨
    if (cmd.BirthDate > DateOnly.FromDateTime(DateTime.UtcNow))
        throw new ValidationException("생년월일이 미래입니다");

    var pet = Pet.Create(tenantId, cmd);
    await _repo.AddAsync(pet);
    await _uow.SaveChangesAsync();          // 트랜잭션 경계는 서비스가 정한다
    return PetDto.From(pet);
}

// ── Repository: 데이터만 ──────────────────────────────────
public Task<bool> ExistsAsync(Guid tenantId, string name, Guid ownerId) =>
    _db.Pets.AnyAsync(p => p.TenantId == tenantId && p.Name == name && p.OwnerId == ownerId);
```

코드에 나온 이름 몇 개.

- **`CreatePetCommand`** — 요청 DTO(`CreatePetRequest`)를 서비스가 쓰기 좋은 모양으로 바꾼 객체. 서비스가 HTTP 요청 타입을 몰라도 되게 하려고 한 번 갈아 끼운다.
- **`_uow`** — Unit of Work. "이번 작업에서 쌓인 변경을 한 번에 저장하는 창구"다. EF Core 에서는 `DbContext` 자체가 이 역할이라 대개 `_db.SaveChangesAsync()` 와 같다. (4절 함정 2)
- **`CreatedAtAction`** — 201 응답과 함께 `Location: /api/pets/{id}` 헤더를 만들어 준다. (`01-request-lifecycle.md` 4절 상태 코드)

서비스가 규칙 위반을 예외로 던지면 그걸 404·409 같은 HTTP 상태 코드로 바꾸는 건 바깥의 예외 처리 미들웨어다.
서비스는 "중복이다"까지만 말하고 "그러니 409"는 모른다. 이 변환 코드는 `02-csharp-dotnet/02-aspnet-core.md` 6절에 있다.
예외 대신 `Result<T>` 같은 반환 타입으로 실패를 돌려주는 팀도 있다. 어느 쪽이든 "서비스는 HTTP 를 모른다"는 원칙은 같다.

### "그냥 컨트롤러에 다 쓰면 안 되나?"

작으면 된다. 나눠야 하는 시점은 **두 번째 진입점이 생길 때**다. 진입점은 "이 로직을 부르는 바깥 입구"다.

- 같은 "펫 등록"을 REST API 와 배치 CSV 업로드 둘 다에서 해야 한다
- 같은 로직을 백그라운드 잡에서도 불러야 한다
- 테스트에서 HTTP 없이 규칙만 검증하고 싶다

컨트롤러에 규칙이 있으면 이 순간 전부 복붙이 된다. **랭코드처럼 고객사마다 연동 방식이 다른 제품에서는
두 번째 진입점이 거의 항상 생긴다.**

---

## 2. DTO 와 엔티티를 왜 분리하나

- **엔티티(entity)** — DB 테이블 한 행을 그대로 옮긴 C# 클래스. EF Core 가 이 클래스를 보고 테이블을 만들고 읽고 쓴다.
- **DTO(Data Transfer Object)** — 계층이나 네트워크 경계를 건너갈 때 쓰는 "운반용" 클래스. API 의 요청·응답 JSON 모양이 곧 DTO 다.

TS 로 치면 Prisma 가 생성한 모델 타입과, 내가 API 응답용으로 따로 정의한 `type PetResponse = {...}` 의 차이다.

```csharp
// 엔티티 — DB 테이블의 모양
public class Pet
{
    public Guid Id { get; set; }
    public Guid TenantId { get; set; }          // 내부용. 밖에 나가면 안 됨
    public string Name { get; set; }
    public string? InternalMemo { get; set; }   // 직원용 메모. 보호자에게 노출 금지
    public Owner Owner { get; set; }            // 네비게이션 → 직렬화하면 순환참조 폭발
}

// DTO — API 응답의 모양
public record PetDto(Guid Id, string Name, string OwnerName);
```

`Owner` 처럼 다른 엔티티를 가리키는 프로퍼티를 **네비게이션 프로퍼티**라고 한다. 외래 키로 이어진 다른 테이블의 행을 객체로 따라갈 수 있게 해 준다.
`record` 는 값만 담는 불변 클래스를 한 줄로 선언하는 C# 문법이다. (`02-csharp-dotnet/01-csharp-for-ts-devs.md` 2절)

엔티티를 그대로 `return` 하면 세 가지가 터진다.

1. **과다 노출** — `InternalMemo`, `TenantId` 같은 내부 필드가 그대로 나간다
2. **순환 참조** — `Pet.Owner.Pets[0].Owner...` 직렬화 무한루프
3. **DB 스키마가 곧 API 계약이 됨** — 컬럼 이름 하나 바꾸면 프론트가 깨진다

엔티티도 직렬화 자체는 된다. 에러 없이 조용히 동작하기 때문에 더 위험하다.
"API 계약"은 프론트와 백엔드가 약속한 요청·응답 모양이다. DTO 를 두면 DB 컬럼을 바꿔도 DTO 로 옮기는 한 줄만 고치면 되고 프론트는 모른다.

> 프론트에서 이미 겪은 것과 같다. 서버 응답을 그대로 컴포넌트 props 로 쓰다가
> 서버가 필드명을 바꿔서 화면이 깨진 경험 — 그 경계를 서버 쪽에서 세운 게 DTO 다.

**입력 쪽도 마찬가지다.** `CreatePetRequest` 에 `Id` 나 `TenantId` 필드를 두면
클라이언트가 그걸 채워 보내서 남의 테넌트에 데이터를 넣을 수 있다 (**over-posting 취약점**).
요청 DTO 에는 **클라이언트가 정해도 되는 값만** 둔다.

```csharp
// ❌ 클라이언트가 TenantId 를 정할 수 있다
public record CreatePetRequest(string Name, Guid OwnerId, Guid TenantId);

// ✅ TenantId 는 서버가 토큰에서 꺼낸다 (위 Controller 의 User.GetTenantId())
public record CreatePetRequest(string Name, Guid OwnerId, DateOnly BirthDate);
```

---

## 3. DI (의존성 주입)

### 문제부터

```csharp
public class PetService
{
    private readonly AppDbContext _db = new AppDbContext();   // ❌
}
```

- 테스트에서 진짜 DB 없이 못 돌린다
- `AppDbContext` 생성자가 바뀌면 이걸 쓰는 모든 클래스를 고쳐야 한다
- 이 객체를 누가 언제 `Dispose` 하는지 아무도 모른다

`Dispose` 는 DB 커넥션 같은 자원을 돌려주는 정리 메서드다. 직접 `new` 한 객체는 직접 정리해야 하는데 서비스가 여러 곳에서 쓰이면 "언제 닫아도 되는지"를 아무도 확신할 수 없다.

### 해결: 밖에서 넣어준다

```csharp
public class PetService : IPetService
{
    private readonly IPetRepository _repo;
    private readonly ILogger<PetService> _logger;

    public PetService(IPetRepository repo, ILogger<PetService> logger)   // 생성자 주입
    {
        _repo = repo;
        _logger = logger;
    }
}
```

`PetService` 는 이제 **"나는 IPetRepository 가 필요하다"** 고 선언만 한다. 누가 어떻게 만드는지는 모른다.
그걸 실제로 조립하는 게 **DI 컨테이너**다.
DI(Dependency Injection, 의존성 주입)는 "필요한 객체를 스스로 만들지 않고 생성자 파라미터로 받는다"는 단순한 규칙이다.
이 규칙을 지키면 진짜 DB 대신 가짜 리포지토리를 넣어 테스트할 수 있고 생성 방법이 바뀌어도 쓰는 쪽은 그대로다.

```csharp
// Program.cs — 조립 설명서
builder.Services.AddScoped<IPetRepository, PetRepository>();
builder.Services.AddScoped<IPetService, PetService>();
builder.Services.AddDbContext<AppDbContext>(o => o.UseNpgsql(conn));
```

`AddScoped<IPetRepository, PetRepository>()` 는 "누가 `IPetRepository` 를 달라고 하면 `PetRepository` 를 만들어 줘라"는 등록이다.
`AddDbContext` 는 내부적으로 `DbContext` 를 Scoped 로 등록한다.

요청이 들어오면 컨테이너가 `PetsController` → `IPetService` → `IPetRepository` → `AppDbContext` 를
**의존 그래프를 따라 역순으로 전부 생성해서 꽂아준다.** 내가 `new` 를 쓸 일이 없어진다.
"역순"은 가장 아래 것부터 만든다는 뜻이다. `AppDbContext` 가 있어야 `PetRepository` 를 만들 수 있고 그게 있어야 `PetService` 를 만들 수 있다.

요즘 C# 코드에서는 생성자를 이렇게 줄여 쓰기도 한다(C# 12 primary constructor).
TS 의 `constructor(private repo: PetRepository) {}` 와 같은 발상이다.

```csharp
public class PetService(IPetRepository repo, ILogger<PetService> logger) : IPetService
{
    public Task<bool> Exists(Guid id) => repo.ExistsAsync(id);   // 파라미터를 바로 쓴다
}
```

**이미 아는 것과의 대조:**

| 개념 | ASP.NET Core | Spring Boot (해봤음) | React |
| --- | --- | --- | --- |
| 등록 | `builder.Services.AddScoped<I, Impl>()` | `@Service` + 컴포넌트 스캔 | — |
| 주입 | 생성자 파라미터 | 생성자 / `@Autowired` | `useContext` |
| 컨테이너 | `IServiceProvider` | `ApplicationContext` | Provider 트리 |
| 개념적 유사물 | | | Context Provider 로 의존성 내려주기 |

Spring 을 해봤으면 이건 **새로 배우는 게 아니라 문법만 바뀌는 것**이다. 실제로 그렇다.
차이 하나는 기억해 둔다. Spring 은 `@Service` 를 붙이면 자동으로 찾아 등록하지만 ASP.NET Core 는 기본적으로 `Program.cs` 에 한 줄씩 직접 등록한다.
등록을 빠뜨리면 요청 시점에 "Unable to resolve service for type 'IPetService'" 예외가 난다. 이 메시지를 보면 등록 누락부터 의심한다.

### 등록 코드가 길어지면

서비스가 수십 개가 되면 `Program.cs` 가 등록 줄로 덮인다. 그래서 보통 기능별로 확장 메서드를 만들어 묶는다.

```csharp
public static class PetModule
{
    public static IServiceCollection AddPetModule(this IServiceCollection services)
    {
        services.AddScoped<IPetRepository, PetRepository>();
        services.AddScoped<IPetService, PetService>();
        return services;
    }
}

// Program.cs
builder.Services.AddPetModule();
```

입사 후 `Program.cs` 에서 `AddXxx()` 를 만나면 F12 로 들어가 보면 된다. 안쪽은 위처럼 등록 줄의 모음이다.

---

## 4. 생명주기 — 여기가 진짜 함정

DI 컨테이너에 등록할 때 **셋 중 하나**를 고른다. 잘못 고르면 조용히 버그가 난다.
생명주기(lifetime)는 "컨테이너가 이 객체를 언제 새로 만들고 언제 버리는가"다.

| 생명주기 | 언제 새로 만드나 | 쓰는 것 |
| --- | --- | --- |
| `AddTransient` | **요청할 때마다** 매번 새로 | 가볍고 상태 없는 것 |
| `AddScoped` | **HTTP 요청 1건당 1개** | `DbContext`, 리포지토리, 서비스 — **기본값으로 생각해라** |
| `AddSingleton` | **앱 전체에 1개** | 설정, 캐시, HttpClient 팩토리 |

Transient 의 "요청할 때마다"는 HTTP 요청이 아니라 "컨테이너에 달라고 할 때마다"다. 헷갈리기 쉬우니 숫자로 본다.
HTTP 요청 하나에서 `ServiceA` 와 `ServiceB` 가 둘 다 `IFoo` 를 생성자로 받는다고 하자.

| `IFoo` 를 이렇게 등록하면 | 요청 1건 안에서 만들어지는 `IFoo` | 요청 3건이 지나간 뒤 총 개수 |
| --- | --- | --- |
| Transient | 2개 (A 용, B 용) | 6개 |
| Scoped | 1개 (A 와 B 가 같은 것을 공유) | 3개 |
| Singleton | 1개 | 1개 (앱이 끝날 때까지 같은 것) |

Singleton 은 모든 요청, 모든 스레드가 같은 인스턴스를 동시에 쓴다. 그래서 Singleton 으로 등록한 클래스는 **스레드 안전**해야 한다.
스레드 안전하다는 건 여러 스레드가 동시에 불러도 `01-request-lifecycle.md` 5절의 `_count++` 같은 사고가 나지 않는다는 뜻이다.
가장 쉬운 방법은 가변 필드를 아예 두지 않는 것이다.

어느 것을 고를지 헷갈리면 이 순서로 묻는다.

1. `DbContext` 나 요청별 정보(현재 사용자, 테넌트)를 쓰나? → Scoped
2. 앱 전체가 공유해야 하는 비싼 것(캐시, 커넥션 멀티플렉서, 설정)이고 스레드 안전한가? → Singleton
3. 둘 다 아니고 상태도 없나? → Scoped 로 두면 무난하다. Transient 는 "매번 새것이어야 하는" 이유가 있을 때만

### 함정 1: Singleton 에 Scoped 를 주입

```csharp
builder.Services.AddSingleton<ICacheWarmer, CacheWarmer>();   // 앱 전체에 1개

public class CacheWarmer
{
    public CacheWarmer(AppDbContext db) { ... }   // ❌ DbContext 는 Scoped
}
```

Singleton 은 한 번만 생성되므로 **첫 요청 때 만들어진 DbContext 를 앱이 죽을 때까지 붙들고 있게 된다.**
그 DbContext 는 이미 Dispose 됐거나, 스레드 안전하지 않은데 여러 요청이 동시에 쓴다.
→ `ObjectDisposedException` 이나 정체불명의 데이터 오염.

**이걸 "captive dependency" 라고 한다.** 오래 사는 객체가 짧게 살아야 할 객체를 "포로로 붙잡는다"는 뜻이다.
규칙으로 외우면 간단하다. **오래 사는 것이 더 짧게 살아야 할 것을 생성자로 받으면 안 된다.** 대표적인 게 Singleton 이 Scoped 를 받는 경우다.
Singleton 이 Transient 를 받아도 그 Transient 는 사실상 Singleton 이 되므로, 상태가 있거나 스레드 안전하지 않은 Transient 라면 같은 사고가 난다.

.NET 은 개발 환경에서 이걸 시작 시점에 잡아준다
(`ValidateScopes`). "Cannot consume scoped service ... from singleton ..." 예외가 뜨면 바로 이 문제다.
운영 환경에서는 이 검사가 기본으로 꺼져 있어서 조용히 지나간다. 로컬에서 앱이 뜰 때 이 예외가 나면 우회하지 말고 등록을 고친다.
필요하면 `IServiceScopeFactory` 로 그때그때 스코프를 열어서 쓴다.

```csharp
public class CacheWarmer(IServiceScopeFactory scopeFactory)
{
    public async Task WarmAsync()
    {
        using var scope = scopeFactory.CreateScope();          // 스코프를 직접 연다
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        ...
    }   // ← 여기서 scope 가 Dispose 되며 db 도 정리된다
}
```

스코프는 "Scoped 객체들이 살아 있는 한 구간"이다. HTTP 요청이면 프레임워크가 요청 시작에 열고 끝에 닫아 준다.
`using var` 는 블록을 벗어날 때 자동으로 `Dispose()` 를 부르는 문법이다. TS 5.2 의 `using` 선언과 같다.

같은 함정이 다른 모양으로도 나온다.

| 상황 | 문제 | 대신 |
| --- | --- | --- |
| Singleton 이 `IOptionsSnapshot<T>` 를 받음 | `IOptionsSnapshot` 은 Scoped 라 같은 captive dependency | Singleton 에서는 `IOptions<T>` 나 `IOptionsMonitor<T>` |
| 서비스 안에서 `new HttpClient()` 를 요청마다 만듦 | 소켓이 바로 반납되지 않아 고갈되고 DNS 변경도 못 따라간다 | `builder.Services.AddHttpClient<MyApiClient>()` 로 등록해 주입받기 |
| `HttpClient` 하나를 static 으로 영원히 재사용 | 소켓 고갈은 피하지만 DNS 변경을 못 따라간다 | 위와 같이 `IHttpClientFactory` 에 맡긴다 |

`IOptions<T>` 계열은 `appsettings.json` 의 설정 섹션을 타입 있는 클래스로 받는 방법이다. 세 가지의 차이는 `02-csharp-dotnet/02-aspnet-core.md` 4절에서 다룬다.
`AddHttpClient` 로 등록한 클라이언트는 내부의 연결을 팩토리가 재사용·교체해 준다. 외부 LLM API 를 부르는 코드가 많은 랭코드에서는 거의 반드시 만날 패턴이다.
재시도·타임아웃 정책도 이 등록에 붙인다(`07-db-infra/03-resilience.md` 4절).

### 함정 2: Scoped 를 Singleton 처럼 믿기

`DbContext` 가 Scoped 라는 건 **같은 요청 안에서는 같은 인스턴스**라는 뜻이다.
그래서 서비스 A 와 서비스 B 가 같은 요청에서 각각 변경을 쌓고 마지막에 `SaveChangesAsync()` 한 번으로
**한 트랜잭션에 묶을 수 있다.** 이게 Unit of Work 패턴이 공짜로 되는 이유다.

예를 들어 "예약 생성" 요청에서 이렇게 흐른다.

```csharp
await _appointments.AddAsync(appt);       // AppointmentService → 같은 DbContext 에 INSERT 를 쌓음
await _pets.MarkVisitedAsync(petId);      // PetService        → 같은 DbContext 에 UPDATE 를 쌓음
await _db.SaveChangesAsync();             // 둘을 한 트랜잭션으로 커밋. 하나라도 실패하면 둘 다 취소
```

두 서비스가 서로 다른 `DbContext` 를 받았다면 한쪽만 저장되는 상황이 생길 수 있다. Scoped 가 기본값인 이유다.

반대로 백그라운드 잡에는 HTTP 요청이 없으므로 Scope 가 없다. 위처럼 직접 열어야 한다.

> ❓ 입사 후 확인: 우리 서비스에서 백그라운드 작업(에이전트 실행 등)은 어떻게 스코프를 관리하나?
> `IHostedService` / `BackgroundService` 를 쓰는지, 별도 워커 프로세스인지.

---

## 5. 인터페이스를 꼭 만들어야 하나

`IPetService` 를 만들지 말지는 취향 문제가 아니라 **용도가 있느냐**의 문제다.
C# 의 인터페이스는 TS 의 `interface` 와 비슷하지만 런타임에도 존재해서 DI 컨테이너가 "이 인터페이스엔 이 구현"을 연결하는 열쇠로 쓴다.

만드는 이유로 유효한 것:
- 테스트에서 가짜 구현으로 바꿔 끼운다 (특히 외부 API 클라이언트)
- 구현이 실제로 둘 이상이다 (고객사별 연동 어댑터 — **랭코드에서 흔할 것**)

유효하지 않은 것:
- "원래 다 인터페이스로 하니까"

구현이 하나뿐이고 테스트에서도 실물을 쓰는 클래스에 인터페이스를 붙이면 파일만 두 배가 되고
Ctrl+클릭 할 때마다 인터페이스로 튄다. 다만 **팀 컨벤션이 있으면 거기를 따른다.** 혼자 다르게 하는 게 더 나쁘다.

> ❓ 입사 후 확인: 우리 팀은 서비스에 인터페이스를 항상 두는 편인가?

---

## 6. 랭코드 맥락 — 어댑터 계층

대표 인터뷰의 "비표준 시스템 연동(Moderator)" 은 이 구조에서 이렇게 생긴다.

```
Service (업무 규칙 — 고객사를 모른다)
    ↓  IDocumentSource 인터페이스에만 의존
    ├── SharePointAdapter      (A 고객사)
    ├── ConfluenceAdapter      (B 고객사)
    └── LegacyMssqlAdapter     (C 고객사, 표준 없음)
```

어댑터는 "모양이 제각각인 바깥 시스템을 우리가 정한 하나의 인터페이스 모양으로 맞춰 주는 클래스"다.
여행용 플러그 어댑터와 같은 발상이다. 서비스는 `IDocumentSource.ListAsync()` 만 부르고 SharePoint 의 REST API 인지 MSSQL 테이블인지는 어댑터 안에 갇힌다.

고객사가 늘어날 때 **서비스 코드는 안 바뀌고 어댑터만 추가**된다.
이게 "커스터마이징 범벅이 되지 않게 하는" 실제 방법이고 인터페이스를 쓸 진짜 이유의 교과서적 예다.

### 어떤 어댑터를 쓸지는 누가 고르나

.NET 8 부터는 같은 인터페이스에 구현 여러 개를 이름(키)을 붙여 등록할 수 있다(keyed services).

```csharp
builder.Services.AddKeyedScoped<IDocumentSource, SharePointAdapter>("sharepoint");
builder.Services.AddKeyedScoped<IDocumentSource, ConfluenceAdapter>("confluence");

// 고객사 설정에 따라 실행 시점에 고른다
public class SyncService(IServiceProvider sp, ITenantSettings settings)
{
    public Task SyncAsync(CancellationToken ct)
    {
        var source = sp.GetRequiredKeyedService<IDocumentSource>(settings.SourceType);   // "sharepoint" 등
        return source.ListAsync(ct);
    }
}
```

키가 코드에 고정돼 있으면 생성자에 `[FromKeyedServices("sharepoint")] IDocumentSource source` 처럼 바로 받을 수도 있다.
keyed services 이전에는 `IDocumentSourceFactory` 같은 팩토리 클래스를 따로 만들어 `switch` 로 골랐다. 기존 코드베이스에서는 이 방식도 자주 보인다.

> ❓ 입사 후 확인: 고객사별 어댑터를 고르는 코드가 어디에 있나? (keyed services, 팩토리, 설정 기반 중 무엇인가)

---

## 스스로 답해보기

1. Controller 에서 `DbContext` 를 직접 쓰면 당장은 되는데 뭐가 문제인가?
2. 엔티티를 그대로 API 로 반환하면 생기는 문제 3가지는?
3. `AddSingleton` 으로 등록한 클래스가 `AddScoped` 인 `DbContext` 를 생성자에서 받으면?
4. 같은 요청 안에서 서비스 두 개가 데이터를 바꿨을 때, 왜 한 트랜잭션으로 묶이나?
5. `CreatePetRequest` 에 `TenantId` 필드를 두면 왜 위험한가?
6. 한 HTTP 요청에서 서비스 두 개가 같은 Transient 객체를 받으면 인스턴스는 몇 개인가? Scoped 라면?
7. 외부 API 를 부르는 서비스에서 `new HttpClient()` 를 매번 만들면 어떤 문제가 생기나?
8. "Unable to resolve service for type ..." 예외를 봤다. 가장 먼저 무엇을 확인하나?
