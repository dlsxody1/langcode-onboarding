# 계층 구조와 DI

공고에 **"MVC 기반 컨트롤러, 서비스(DI) 로직"** 이라고 적혀 있다. 그 한 줄이 이 문서 전체다.

---

## 1. 왜 계층을 나누나

프론트에서 FSD 를 쓰는 이유와 **완전히 같다.** 의존 방향을 한쪽으로 고정해서, 변경이 번지는 범위를 자른다.

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

| 계층 | 아는 것 | 모르는 것 | FSD 로 치면 |
| --- | --- | --- | --- |
| Controller | HTTP, 상태코드, DTO | 업무 규칙, SQL | `pages` / route handler |
| Service | 업무 규칙, 트랜잭션 경계 | HTTP, SQL 방언 | `features` 의 model |
| Repository | 테이블, 쿼리 | 왜 이 데이터가 필요한지 | `shared/api` |

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

### "그냥 컨트롤러에 다 쓰면 안 되나?"

작으면 된다. 나눠야 하는 시점은 **두 번째 진입점이 생길 때**다.

- 같은 "펫 등록"을 REST API 와 배치 CSV 업로드 둘 다에서 해야 한다
- 같은 로직을 백그라운드 잡에서도 불러야 한다
- 테스트에서 HTTP 없이 규칙만 검증하고 싶다

컨트롤러에 규칙이 있으면 이 순간 전부 복붙이 된다. **랭코드처럼 고객사마다 연동 방식이 다른 제품에서는
두 번째 진입점이 거의 항상 생긴다.**

---

## 2. DTO 와 엔티티를 왜 분리하나

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

엔티티를 그대로 `return` 하면 세 가지가 터진다.

1. **과다 노출** — `InternalMemo`, `TenantId` 같은 내부 필드가 그대로 나간다
2. **순환 참조** — `Pet.Owner.Pets[0].Owner...` 직렬화 무한루프
3. **DB 스키마가 곧 API 계약이 됨** — 컬럼 이름 하나 바꾸면 프론트가 깨진다

> 프론트에서 이미 겪은 것과 같다. 서버 응답을 그대로 컴포넌트 props 로 쓰다가
> 서버가 필드명을 바꿔서 화면이 깨진 경험 — 그 경계를 서버 쪽에서 세운 게 DTO 다.

**입력 쪽도 마찬가지다.** `CreatePetRequest` 에 `Id` 나 `TenantId` 필드를 두면,
클라이언트가 그걸 채워 보내서 남의 테넌트에 데이터를 넣을 수 있다 (**over-posting 취약점**).
요청 DTO 에는 **클라이언트가 정해도 되는 값만** 둔다.

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

```csharp
// Program.cs — 조립 설명서
builder.Services.AddScoped<IPetRepository, PetRepository>();
builder.Services.AddScoped<IPetService, PetService>();
builder.Services.AddDbContext<AppDbContext>(o => o.UseNpgsql(conn));
```

요청이 들어오면 컨테이너가 `PetsController` → `IPetService` → `IPetRepository` → `AppDbContext` 를
**의존 그래프를 따라 역순으로 전부 생성해서 꽂아준다.** 내가 `new` 를 쓸 일이 없어진다.

**이미 아는 것과의 대조:**

| 개념 | ASP.NET Core | Spring Boot (해봤음) | React |
| --- | --- | --- | --- |
| 등록 | `builder.Services.AddScoped<I, Impl>()` | `@Service` + 컴포넌트 스캔 | — |
| 주입 | 생성자 파라미터 | 생성자 / `@Autowired` | `useContext` |
| 컨테이너 | `IServiceProvider` | `ApplicationContext` | Provider 트리 |
| 개념적 유사물 | | | Context Provider 로 의존성 내려주기 |

Spring 을 해봤으면 이건 **새로 배우는 게 아니라 문법만 바뀌는 것**이다. 실제로 그렇다.

---

## 4. 생명주기 — 여기가 진짜 함정

DI 컨테이너에 등록할 때 **셋 중 하나**를 고른다. 잘못 고르면 조용히 버그가 난다.

| 생명주기 | 언제 새로 만드나 | 쓰는 것 |
| --- | --- | --- |
| `AddTransient` | **요청할 때마다** 매번 새로 | 가볍고 상태 없는 것 |
| `AddScoped` | **HTTP 요청 1건당 1개** | `DbContext`, 리포지토리, 서비스 — **기본값으로 생각해라** |
| `AddSingleton` | **앱 전체에 1개** | 설정, 캐시, HttpClient 팩토리 |

### 함정 1: Singleton 에 Scoped 를 주입

```csharp
builder.Services.AddSingleton<ICacheWarmer, CacheWarmer>();   // 앱 전체에 1개

public class CacheWarmer
{
    public CacheWarmer(AppDbContext db) { ... }   // ❌ DbContext 는 Scoped
}
```

Singleton 은 한 번만 생성되므로, **첫 요청 때 만들어진 DbContext 를 앱이 죽을 때까지 붙들고 있게 된다.**
그 DbContext 는 이미 Dispose 됐거나, 스레드 안전하지 않은데 여러 요청이 동시에 쓴다.
→ `ObjectDisposedException` 이나 정체불명의 데이터 오염.

**이걸 "captive dependency" 라고 한다.** .NET 은 개발 환경에서 이걸 시작 시점에 잡아준다
(`ValidateScopes`). 필요하면 `IServiceScopeFactory` 로 그때그때 스코프를 열어서 쓴다.

```csharp
public class CacheWarmer(IServiceScopeFactory scopeFactory)
{
    public async Task WarmAsync()
    {
        using var scope = scopeFactory.CreateScope();          // 스코프를 직접 연다
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        ...
    }
}
```

### 함정 2: Scoped 를 Singleton 처럼 믿기

`DbContext` 가 Scoped 라는 건, **같은 요청 안에서는 같은 인스턴스**라는 뜻이다.
그래서 서비스 A 와 서비스 B 가 같은 요청에서 각각 변경을 쌓고, 마지막에 `SaveChangesAsync()` 한 번으로
**한 트랜잭션에 묶을 수 있다.** 이게 Unit of Work 패턴이 공짜로 되는 이유다.

반대로 백그라운드 잡에는 HTTP 요청이 없으므로 Scope 가 없다. 위처럼 직접 열어야 한다.

> ❓ 입사 후 확인: 우리 서비스에서 백그라운드 작업(에이전트 실행 등)은 어떻게 스코프를 관리하나?
> `IHostedService` / `BackgroundService` 를 쓰는지, 별도 워커 프로세스인지.

---

## 5. 인터페이스를 꼭 만들어야 하나

`IPetService` 를 만들지 말지는 취향 문제가 아니라 **용도가 있느냐**의 문제다.

만드는 이유로 유효한 것:
- 테스트에서 가짜 구현으로 바꿔 끼운다 (특히 외부 API 클라이언트)
- 구현이 실제로 둘 이상이다 (고객사별 연동 어댑터 — **랭코드에서 흔할 것**)

유효하지 않은 것:
- "원래 다 인터페이스로 하니까"

구현이 하나뿐이고 테스트에서도 실물을 쓰는 클래스에 인터페이스를 붙이면, 파일만 두 배가 되고
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

고객사가 늘어날 때 **서비스 코드는 안 바뀌고 어댑터만 추가**된다.
이게 "커스터마이징 범벅이 되지 않게 하는" 실제 방법이고, 인터페이스를 쓸 진짜 이유의 교과서적 예다.

---

## 스스로 답해보기

1. Controller 에서 `DbContext` 를 직접 쓰면 당장은 되는데, 뭐가 문제인가?
2. 엔티티를 그대로 API 로 반환하면 생기는 문제 3가지는?
3. `AddSingleton` 으로 등록한 클래스가 `AddScoped` 인 `DbContext` 를 생성자에서 받으면?
4. 같은 요청 안에서 서비스 두 개가 데이터를 바꿨을 때, 왜 한 트랜잭션으로 묶이나?
5. `CreatePetRequest` 에 `TenantId` 필드를 두면 왜 위험한가?
