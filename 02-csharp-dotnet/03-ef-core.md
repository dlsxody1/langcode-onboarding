# EF Core

C# 객체로 DB 를 다루는 ORM. `01-backend-basics/03-database.md` 의 개념이 여기서 코드로 나타난다.

**한 줄 요약: EF Core 는 LINQ 를 SQL 로 번역하고, 가져온 객체의 변경을 추적한다.**
이 두 가지가 편의의 원천이자 모든 함정의 원인이다.

---

## 1. 구성 요소

```csharp
// ① 엔티티 — 테이블 한 개
public class Pet
{
    public Guid Id { get; set; }
    public Guid TenantId { get; set; }
    public string Name { get; set; } = "";
    public DateOnly? BirthDate { get; set; }

    public Guid OwnerId { get; set; }
    public Owner Owner { get; set; } = null!;      // 네비게이션 프로퍼티
}

// ② DbContext — DB 세션 + 모델 정의
public class AppDbContext(DbContextOptions<AppDbContext> options) : DbContext(options)
{
    public DbSet<Pet> Pets => Set<Pet>();
    public DbSet<Owner> Owners => Set<Owner>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.Entity<Pet>(e =>
        {
            e.ToTable("pets");
            e.HasKey(p => p.Id);
            e.Property(p => p.Name).HasMaxLength(50).IsRequired();
            e.HasIndex(p => new { p.TenantId, p.OwnerId });        // 복합 인덱스
            e.HasOne(p => p.Owner).WithMany(o => o.Pets).HasForeignKey(p => p.OwnerId);
            e.HasQueryFilter(p => p.TenantId == _tenant.Current);  // 멀티테넌시 강제
        });
    }
}
```

**설정 방법이 두 가지**인데 섞지 말고 팀 컨벤션을 따른다.
- **데이터 어노테이션** — 엔티티에 `[Required]`, `[MaxLength(50)]`
- **Fluent API** — `OnModelCreating` 에서 (위 코드). 더 강력하고 엔티티가 깨끗하다. **큰 프로젝트는 대개 이쪽**

엔티티가 많아지면 `IEntityTypeConfiguration<Pet>` 로 파일을 분리한다.

---

## 2. 조회

```csharp
// 단건
var pet = await db.Pets.FindAsync(id);                      // PK 조회. 캐시에 있으면 SQL 안 감
var pet = await db.Pets.FirstOrDefaultAsync(p => p.Name == n);
var pet = await db.Pets.SingleOrDefaultAsync(p => p.Id == id);   // 2개 이상이면 예외

// 목록 — 읽기 전용이면 AsNoTracking
var pets = await db.Pets.AsNoTracking()
    .Where(p => p.OwnerId == ownerId)
    .OrderBy(p => p.Name)
    .ToListAsync(ct);

// 관계 로딩
var pets = await db.Pets.Include(p => p.Owner)                       // JOIN
                        .ThenInclude(o => o.Address)                 // 중첩
                        .ToListAsync(ct);

// ✅ 더 나은 방법: 필요한 것만 (Projection)
var dtos = await db.Pets
    .Where(p => p.OwnerId == ownerId)
    .Select(p => new PetDto(p.Id, p.Name, p.Owner.Name))   // Include 불필요. 필요한 컬럼만 SELECT
    .ToListAsync(ct);
```

**Projection(`Select`) 이 거의 항상 정답이다.** 이유:
- 필요한 컬럼만 SELECT → 네트워크·메모리 절약
- 추적 안 함 (자동으로 no-tracking)
- `Include` 없이도 관련 테이블 값을 가져온다

### 페이지네이션

```csharp
var page = await db.Pets.AsNoTracking()
    .Where(p => p.TenantId == t)
    .OrderBy(p => p.CreatedAt).ThenBy(p => p.Id)     // ⚠️ 정렬이 결정적이어야 한다
    .Skip((pageNo - 1) * size).Take(size)
    .Select(p => new PetDto(...))
    .ToListAsync(ct);

var total = await db.Pets.CountAsync(p => p.TenantId == t, ct);
```

`OrderBy` 없이 `Skip/Take` 하면 **순서가 보장되지 않아 같은 행이 두 페이지에 나온다.**
`ThenBy(p => p.Id)` 로 타이브레이커를 넣는 습관.

---

## 3. 변경 추적 — 여기가 핵심 개념

```csharp
var pet = await db.Pets.FirstAsync(p => p.Id == id);   // 추적 시작
pet.Name = "루비";                                      // 아무 SQL 도 안 나감
await db.SaveChangesAsync();                            // ← 여기서 UPDATE 1건 발행
```

`db.Update()` 를 부를 필요가 없다. **DbContext 가 가져올 때의 값을 기억해 두고, 저장 시점에 비교해서
바뀐 컬럼만 UPDATE 문을 만든다.**

### 추적의 대가

1. **메모리** — 가져온 모든 엔티티의 원본 스냅샷을 들고 있다. 10만 건 조회하면 20만 개 객체
2. **SaveChanges 가 느려짐** — 추적 중인 전체를 비교한다
3. **의도치 않은 저장** — 조회만 하려고 가져온 엔티티를 어디선가 고치면 같이 저장된다

→ **조회 전용이면 항상 `AsNoTracking()`.** 목록 API 에 붙이는 게 습관이 돼야 한다.

전역으로 기본값을 바꿀 수도 있다 (보수적인 팀은 이렇게 한다):

```csharp
db.ChangeTracker.QueryTrackingBehavior = QueryTrackingBehavior.NoTracking;
```

### 삽입 / 삭제

```csharp
db.Pets.Add(pet);                     // 메모리에만
db.Pets.AddRange(pets);
db.Pets.Remove(pet);                  // 삭제하려면 먼저 가져와야 한다 (SELECT + DELETE)
await db.SaveChangesAsync(ct);        // 여기서 한 트랜잭션으로 전부 반영
```

**`SaveChangesAsync()` 는 자동으로 트랜잭션을 연다.** 여러 변경이 전부 되거나 전부 안 된다.
그래서 서비스 계층에서 여러 리포지토리를 호출하고 마지막에 한 번만 저장하면 Unit of Work 가 공짜로 된다.

### 대량 작업 (.NET 7+)

```csharp
// ❌ 10만 건을 메모리로 가져와 하나씩 UPDATE
var old = await db.Pets.Where(p => p.Status == "x").ToListAsync();
old.ForEach(p => p.Status = "y");
await db.SaveChangesAsync();

// ✅ SQL 한 방 — 추적도 안 하고 메모리도 안 쓴다
await db.Pets.Where(p => p.Status == "x")
             .ExecuteUpdateAsync(s => s.SetProperty(p => p.Status, "y"), ct);

await db.Pets.Where(p => p.CreatedAt < cutoff).ExecuteDeleteAsync(ct);
```

**단, `ExecuteUpdate/Delete` 는 변경 추적을 우회한다.** 이미 메모리에 있는 엔티티는 갱신 안 되고,
`SaveChanges` 인터셉터나 감사(audit) 로직도 안 탄다. 대량 작업에만 쓴다.

---

## 3-2. LINQ 가 SQL 로 어떻게 번역되는가 — 대조표

**EF Core 를 이해한다는 건 이 대응 관계가 머리에 들어 있다는 뜻이다.**
LINQ 를 외우는 게 아니라, LINQ 를 보면 SQL 이 보이는 상태가 목표다.

> ⚠️ 아래 SQL 은 PostgreSQL(Npgsql) 기준의 **전형적인 형태**다. EF Core 버전·프로바이더에 따라
> 별칭 이름이나 괄호 배치는 달라진다. 구조를 보는 용도로 읽어라.

### ① 기본 조회

```csharp
await db.Pets.Where(p => p.Species == "dog").ToListAsync();
```
```sql
SELECT p."Id", p."Name", p."Species", p."BirthDate", p."InternalMemo",
       p."IsDeleted", p."CreatedAt", p."OwnerId"
FROM pets AS p
WHERE p."Species" = 'dog' AND NOT p."IsDeleted"    -- ← 글로벌 쿼리 필터가 자동으로 붙는다
```

**`NOT IsDeleted` 를 내가 안 썼는데 붙어 있다.** `HasQueryFilter` 의 효과다.
멀티테넌시의 `tenant_id` 도 정확히 이 방식으로 강제된다. *(→ `01-backend-basics/04-auth.md`)*

또 하나 — **`SELECT *` 가 아니라 컬럼을 전부 나열**한다. 즉 `InternalMemo` 같은
안 쓸 컬럼까지 네트워크로 가져온다. 그래서 다음 항목이 중요하다.

### ② Projection — 필요한 컬럼만

```csharp
await db.Pets.Select(p => new PetDto(p.Id, p.Name, p.Species, p.BirthDate, p.Owner.Name))
             .ToListAsync();
```
```sql
SELECT p."Id", p."Name", p."Species", p."BirthDate", o."Name"
FROM pets AS p
INNER JOIN owners AS o ON p."OwnerId" = o."Id"
WHERE NOT p."IsDeleted"
```

- **컬럼이 5개만 나간다** (①은 8개)
- `Include` 를 안 썼는데 **JOIN 이 생겼다** — `p.Owner.Name` 을 쓴 것만으로 EF 가 알아서 조인한다
- 결과가 엔티티가 아니라 DTO 라서 **변경 추적도 안 한다** (`AsNoTracking` 불필요)

**이래서 "Projection 이 거의 항상 정답"이라고 하는 것이다.**

### ③ Include 와의 차이

```csharp
await db.Pets.Include(p => p.Owner).ToListAsync();
```
```sql
SELECT p."Id", p."Name", p."Species", p."BirthDate", p."InternalMemo",
       p."IsDeleted", p."CreatedAt", p."OwnerId",
       o."Id", o."Name", o."Phone"                 -- ← Owner 의 모든 컬럼
FROM pets AS p
INNER JOIN owners AS o ON p."OwnerId" = o."Id"
WHERE NOT p."IsDeleted"
```

같은 JOIN 인데 **양쪽 테이블의 전 컬럼**을 가져오고, 엔티티 두 종류를 **전부 추적**한다.
`Owner.Name` 하나만 필요했다면 ②보다 명백히 손해다.

### ④ 페이지네이션

```csharp
await db.Pets.AsNoTracking()
    .OrderByDescending(p => p.CreatedAt).ThenBy(p => p.Id)
    .Skip(40).Take(20)
    .Select(p => new PetDto(...))
    .ToListAsync();
```
```sql
SELECT ...
FROM pets AS p
INNER JOIN owners AS o ON p."OwnerId" = o."Id"
WHERE NOT p."IsDeleted"
ORDER BY p."CreatedAt" DESC, p."Id"
LIMIT 20 OFFSET 40
```

`Skip/Take` → `OFFSET/LIMIT`. **`ThenBy(p => p.Id)` 가 `ORDER BY` 두 번째 키로 들어간 걸 보라.**
이게 없으면 `CreatedAt` 이 같은 행들의 순서가 매번 달라져 **페이지 간에 항목이 중복되거나 누락된다.**

### ⑤ 존재 확인 — 행을 가져오지 않는다

```csharp
await db.Pets.AnyAsync(p => p.OwnerId == id && p.Name == name);
```
```sql
SELECT EXISTS (
    SELECT 1 FROM pets AS p
    WHERE p."OwnerId" = @id AND p."Name" = @name AND NOT p."IsDeleted")
```

`SELECT 1` 이다. 데이터를 안 가져온다.
**`(await db.Pets.CountAsync(...)) > 0` 이나 `.ToList().Any()` 로 쓰면 훨씬 비싸다.**

### ⑥ 변경 추적 — UPDATE 는 바뀐 컬럼만

```csharp
var pet = await db.Pets.FirstAsync(p => p.Id == id);   // SELECT
pet.Name = "루비";                                      // SQL 없음
pet.IsDeleted = true;                                   // SQL 없음
await db.SaveChangesAsync();                            // 여기서 UPDATE
```
```sql
-- 1) FirstAsync 시점
SELECT p."Id", p."Name", ... FROM pets AS p
WHERE p."Id" = @id AND NOT p."IsDeleted" LIMIT 1

-- 2) SaveChangesAsync 시점 — 트랜잭션으로 감싸서
UPDATE pets SET "Name" = @p0, "IsDeleted" = @p1 WHERE "Id" = @id;
--          ↑ 안 바꾼 Species, BirthDate 는 UPDATE 문에 없다
```

EF 가 조회 시점의 원본 값을 기억해 두고 **저장 시점에 비교해서 달라진 컬럼만** 문장을 만든다.
`db.Update(pet)` 를 부를 필요가 없는 이유이자, `AsNoTracking()` 을 쓰면 이게 **안 되는** 이유다.

### ⑦ 흔히 틀리는 것 — 인덱스를 죽이는 LINQ

```csharp
db.Pets.Where(p => p.Name.ToLower() == q.ToLower())
```
```sql
WHERE LOWER(p."Name") = LOWER(@q)      -- ❌ Name 인덱스를 못 쓴다. Seq Scan
```

```csharp
db.Pets.Where(p => EF.Functions.ILike(p.Name, q))     // PostgreSQL
```
```sql
WHERE p."Name" ILIKE @q                 -- 여전히 앞 와일드카드면 못 쓰지만, 함수 래핑은 없앴다
```

**컬럼에 함수를 씌우는 순간 인덱스가 죽는다.** *(→ `01-backend-basics/03-database.md` 1절)*
근본 해결은 함수 인덱스를 따로 만들거나, 정규화된 컬럼(`name_normalized`)을 하나 두는 것.

### ⑧ 지연 실행 — `ToList()` 를 어디 찍느냐로 SQL 이 달라진다

```csharp
db.Pets.ToList().Where(p => p.Species == "dog")    // ❌
```
```sql
SELECT ... FROM pets AS p WHERE NOT p."IsDeleted"
-- 전 행을 앱 메모리로 가져온 뒤, C# 에서 필터링. 10만 행이면 10만 행을 다 읽는다
```

```csharp
db.Pets.Where(p => p.Species == "dog").ToList()    // ✅
```
```sql
SELECT ... FROM pets AS p WHERE p."Species" = 'dog' AND NOT p."IsDeleted"
```

**`IQueryable` 인 동안은 조건이 SQL 로 간다. `IEnumerable` 이 되는 순간 메모리 필터링이다.**
`.ToList()`, `.ToArray()`, `.AsEnumerable()` 이 그 전환점이다.

### ⑨ 번역이 안 되는 경우

```csharp
db.Pets.Where(p => MyHelper.IsAdult(p.BirthDate))   // ❌ 내 C# 메서드는 SQL 로 못 바꾼다
```

런타임에 이 예외가 난다.

```
System.InvalidOperationException: The LINQ expression 'DbSet<Pet>()
    .Where(p => MyHelper.IsAdult(p.BirthDate))' could not be translated.
Either rewrite the query in a form that can be translated, or switch to client
evaluation explicitly by inserting a call to 'AsEnumerable', 'AsAsyncEnumerable',
'ToList', or 'ToListAsync'.
```

> **이 에러 메시지를 기억해 둬라.** EF Core 에서 가장 자주 만나는 예외 중 하나다.
> "`ToList()` 를 넣으라"는 안내를 그대로 따르면 **전 행을 메모리로 가져오게 되므로**,
> 대부분의 경우 조건을 LINQ 로 풀어 쓰는 게 맞는 대응이다.
> (EF Core 3.0 부터 이런 경우를 조용히 메모리 평가하지 않고 예외로 막는다 — 좋은 변경이다)

### 요약 — 이것만 기억하면 된다

| LINQ | SQL | 함정 |
| --- | --- | --- |
| `Where` | `WHERE` | 컬럼에 함수 씌우면 인덱스 죽음 |
| `Select(new Dto(...))` | 필요한 컬럼만 + 자동 JOIN | **기본으로 이걸 써라** |
| `Include` | JOIN + 전 컬럼 + 추적 | 수정할 게 아니면 과하다 |
| `OrderBy.Skip.Take` | `ORDER BY ... LIMIT ... OFFSET` | 타이브레이커 없으면 중복 |
| `Any` | `SELECT EXISTS(SELECT 1 ...)` | `Count() > 0` 보다 싸다 |
| `Count` | `SELECT COUNT(*)` | |
| `First` / `FirstOrDefault` | `LIMIT 1` | `First` 는 없으면 **예외** |
| 필드 변경 + `SaveChanges` | 바뀐 컬럼만 `UPDATE` | `AsNoTracking` 이면 안 됨 |
| `ToList()` 위치 | 여기서 SQL 발행 | 앞에 찍으면 메모리 필터링 |

---

## 4. N+1 잡기

```csharp
// ❌ 101번 쿼리
var pets = await db.Pets.ToListAsync();
foreach (var p in pets) Console.WriteLine(p.Owner.Name);   // lazy loading 또는 예외

// ✅
var pets = await db.Pets.Include(p => p.Owner).ToListAsync();
// ✅✅
var dtos = await db.Pets.Select(p => new { p.Name, OwnerName = p.Owner.Name }).ToListAsync();
```

**개발 중에 SQL 을 눈으로 보는 설정을 반드시 켜라.** 이게 없으면 N+1 을 절대 못 잡는다.

```csharp
builder.Services.AddDbContext<AppDbContext>(o =>
{
    o.UseNpgsql(conn);
    if (builder.Environment.IsDevelopment())
    {
        o.LogTo(Console.WriteLine, LogLevel.Information);
        o.EnableSensitiveDataLogging();     // 파라미터 값까지. ⚠️ 개발 환경에서만
    }
});
```

콘솔에 SQL 이 줄줄이 찍힌다. **화면 하나 띄웠는데 쿼리가 40줄 나오면 그게 N+1 이다.**

### 콘솔에 실제로 이렇게 찍힌다

펫 20마리를 등록해 두고 목록 API 를 **한 번** 호출했을 때. (로그 형태는 EF Core 버전마다 조금 다르다)

**N+1 인 코드:**

```
info: Microsoft.EntityFrameworkCore.Database.Command[20101]
      Executed DbCommand (4ms) [Parameters=[], CommandType='Text']
      SELECT p."Id", p."Name", p."Species", ... FROM pets AS p WHERE NOT p."IsDeleted"

info: Microsoft.EntityFrameworkCore.Database.Command[20101]
      Executed DbCommand (1ms) [Parameters=[@__p_0='8f3a...'], CommandType='Text']
      SELECT o."Id", o."Name", o."Phone" FROM owners AS o WHERE o."Id" = @__p_0 LIMIT 1

info: Microsoft.EntityFrameworkCore.Database.Command[20101]
      Executed DbCommand (1ms) [Parameters=[@__p_0='c21b...'], CommandType='Text']
      SELECT o."Id", o."Name", o."Phone" FROM owners AS o WHERE o."Id" = @__p_0 LIMIT 1

      ... (똑같은 SELECT 가 18번 더) ...
```

**같은 모양의 `SELECT ... FROM owners ... LIMIT 1` 이 파라미터만 바뀌며 20번 반복**되는 것.
이 패턴이 눈에 들어오면 N+1 을 찾은 것이다.

**Projection 으로 고친 코드:**

```
info: Microsoft.EntityFrameworkCore.Database.Command[20101]
      Executed DbCommand (5ms) [Parameters=[@__p_0='20'], CommandType='Text']
      SELECT p."Id", p."Name", p."Species", p."BirthDate", o."Name"
      FROM pets AS p
      INNER JOIN owners AS o ON p."OwnerId" = o."Id"
      WHERE NOT p."IsDeleted"
      ORDER BY p."CreatedAt" DESC, p."Id"
      LIMIT @__p_0
```

**쿼리 1개.** 21번 → 1번.

### 왜 개발 환경에서는 안 잡히나

위 로그의 괄호 안 숫자를 보라. **각 쿼리가 1ms 다.** 20번 해도 20ms 라 체감이 없다.

운영에서는 셋이 겹친다.

| | 로컬 | 운영 |
| --- | --- | --- |
| 네트워크 지연 | 0ms (같은 머신) | 1~5ms (DB 가 다른 호스트) |
| 데이터 양 | 20건 | 2,000건 |
| 동시 요청 | 1명 | 200명 |

2,000건 × 3ms = **6초**. 여기에 동시 요청 200개가 각각 커넥션을 붙들면
`Timeout expired... prior to obtaining a connection from the pool` 이 뜬다.
*(→ `01-backend-basics/03-database.md` 4절)*

**그래서 로컬에서 SQL 로그를 켜고 개수를 세는 것 말고는 방어 수단이 없다.**
AI 에게 LINQ 를 짜달라고 하면 문법적으로 완벽한 코드를 주지만
**그게 쿼리를 몇 번 발행하는지는 알려주지 않는다.** 이건 사람이 눈으로 봐야 한다.

### 카테시안 폭발

`Include` 를 여러 컬렉션에 걸면 JOIN 결과가 곱해져서 행이 폭증한다.

```csharp
db.Owners.Include(o => o.Pets).Include(o => o.Invoices)   // 펫 10 × 청구 20 = 200행
```

→ `.AsSplitQuery()` 로 쿼리를 나누거나, Projection 으로 필요한 것만.

---

## 5. 마이그레이션

```bash
dotnet tool install --global dotnet-ef       # 최초 1회

dotnet ef migrations add AddPetStatus        # 엔티티 변경 → 마이그레이션 코드 생성
dotnet ef migrations script                  # 적용할 SQL 을 눈으로 확인 (운영 전 필수)
dotnet ef database update                    # 적용
dotnet ef migrations remove                  # 아직 적용 안 한 마지막 것 취소
```

생성된 파일은 `Up()` (적용) 과 `Down()` (되돌리기) 을 가진 **C# 코드**다. 커밋 대상이다.

> **운영 규칙:** `dotnet ef database update` 를 운영 DB 에 직접 쏘는 팀은 드물다.
> 보통 `migrations script` 로 SQL 을 뽑아 DBA 검토를 거치거나, 배포 파이프라인이 적용한다.
> ❓ 입사 후 확인: 우리는 어느 쪽인가? 고객사 온프레미스는?

`03-database.md` 의 **확장/수축 패턴** (컬럼 삭제·이름 변경 시 무중단 배포) 을 여기서 적용한다.

---

## 6. 트랜잭션

대부분 `SaveChangesAsync()` 하나로 충분하다. 명시적 트랜잭션이 필요한 경우:

```csharp
await using var tx = await db.Database.BeginTransactionAsync(ct);
try
{
    await db.SaveChangesAsync(ct);            // 1차 저장 (생성된 ID 필요 등)
    await someOtherThing(ct);
    await db.SaveChangesAsync(ct);
    await tx.CommitAsync(ct);
}
catch { await tx.RollbackAsync(ct); throw; }
```

**트랜잭션 안에서 외부 API 를 부르지 마라** (`03-database.md` 참조).

### 낙관적 동시성

```csharp
public class Pet
{
    public uint Version { get; set; }        // PostgreSQL: xmin 매핑
}
// OnModelCreating
e.Property(p => p.Version).IsRowVersion();
```

동시 수정 시 `DbUpdateConcurrencyException` → 409 로 변환 → 프론트에서 "다른 사람이 수정함" 안내.

---

## 7. 생 SQL 이 필요할 때

LINQ 로 표현 안 되는 게 있다. **특히 벡터 검색(pgvector)은 지금도 LINQ 로 안 된다.**

```csharp
// 안전: 파라미터 바인딩 (보간 문자열이지만 FromSql 이 파라미터로 처리한다)
var pets = await db.Pets
    .FromSql($"SELECT * FROM pets WHERE tenant_id = {tenantId} AND name ILIKE {pattern}")
    .ToListAsync(ct);

// ❌ 위험: FromSqlRaw 에 문자열을 직접 이어붙이면 SQL Injection
db.Pets.FromSqlRaw("SELECT * FROM pets WHERE name = '" + name + "'");   // 절대 금지

// 매핑 없이 실행만
await db.Database.ExecuteSqlAsync($"REFRESH MATERIALIZED VIEW pet_stats");
```

**`FromSql` (보간) 은 안전, `FromSqlRaw` (문자열 연결) 는 위험.** 이름으로 구분된다.

벡터 검색 예 (pgvector):

```csharp
var results = await db.Database.SqlQuery<ChunkHit>(
    $"SELECT id, content, 1 - (embedding <=> {queryVec}::vector) AS score " +
    $"FROM chunks WHERE tenant_id = {tenantId} " +
    $"ORDER BY embedding <=> {queryVec}::vector LIMIT {k}").ToListAsync(ct);
```

> `pgvector/pgvector-dotnet` 패키지를 쓰면 LINQ 에서 `EF.Functions.CosineDistance` 같은 걸 쓸 수 있다.
> ❓ 입사 후 확인: 우리 Vector DB 는 pgvector 인가, 별도 제품(Qdrant/Azure AI Search)인가?

---

## 8. 흔한 함정 정리

| 함정 | 증상 | 해결 |
| --- | --- | --- |
| 추적 켠 채 대량 조회 | 메모리 폭증, SaveChanges 느림 | `AsNoTracking()` |
| N+1 | 쿼리 수백 개 | `Include` 또는 Projection, SQL 로깅 켜기 |
| `ToList()` 위치 | 전체를 메모리로 | `IQueryable` 인 동안 필터 |
| `Skip/Take` 에 `OrderBy` 없음 | 페이지 간 항목 중복 | 결정적 정렬 + 타이브레이커 |
| DbContext 를 싱글톤·공유 | `A second operation started...` 예외 | **Scoped 유지.** 병렬 쿼리는 컨텍스트를 따로 |
| DbContext 로 병렬 `Task.WhenAll` | 같은 예외 | 스코프를 각각 열거나 순차 실행 |
| `Include` 여러 컬렉션 | 행 폭증 | `AsSplitQuery()` |
| 마이그레이션 충돌 | 여러 명이 동시에 생성 | 브랜치 머지 후 재생성. **적용된 마이그레이션은 수정 금지** |
| `.ToLower()` 비교 | 인덱스 미사용 | `EF.Functions.ILike` (PG) 또는 함수 인덱스 |

특히 이 에러 메시지를 기억해 둬라:

```
A second operation was started on this context instance before a previous operation completed.
```

**DbContext 는 스레드 안전하지 않다.** 하나의 컨텍스트로 `Task.WhenAll` 을 돌리면 항상 이게 난다.

---

## 9. 프론트에서 아는 것과의 대조

| EF Core | TanStack Query | 비고 |
| --- | --- | --- |
| Change Tracking | 쿼리 캐시 | 둘 다 "가져온 것을 기억" |
| `AsNoTracking()` | `gcTime: 0` | 기억하지 않기 |
| `SaveChanges()` | mutation | 변경 반영 |
| `Include` | 여러 쿼리 합치기 | 관계 데이터 |
| 지연 실행 (`IQueryable`) | — | 조건을 쌓다가 마지막에 실행 |
| 마이그레이션 | — | 백엔드 고유 |

**"가져온 데이터를 클라이언트가 기억하고 있고, 그 기억이 실제와 어긋날 수 있다"** 는 문제 구조가 같다.
TanStack Query 의 stale 개념을 이해했다면 change tracking 도 같은 사고로 접근하면 된다.
