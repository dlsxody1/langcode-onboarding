# EF Core

C# 객체로 DB 를 다루는 ORM. `01-backend-basics/03-database.md` 의 개념이 여기서 코드로 나타난다.

**한 줄 요약: EF Core 는 LINQ 를 SQL 로 번역하고 가져온 객체의 변경을 추적한다.**
이 두 가지가 편의의 원천이자 모든 함정의 원인이다.

Prisma 를 써 봤다면 출발점이 비슷하다. `prisma.pet.findMany({ where: { species: "dog" } })` 가 SQL 이 되듯 `db.Pets.Where(p => p.Species == "dog").ToListAsync()` 가 SQL 이 된다. 크게 다른 점은 두 번째 기능, **변경 추적**이다. Prisma 는 `update()` 를 명시적으로 불러야 하지만 EF Core 는 가져온 객체의 프로퍼티를 바꾸고 `SaveChangesAsync()` 만 부르면 바뀐 부분을 찾아 UPDATE 를 만든다. 편한 만큼 "무엇이 언제 DB 로 나가는지"를 알고 써야 한다.

테이블·키·JOIN 같은 관계형 DB 기초는 `07-db-infra/01-relational-basics.md` 에 있다. 이 문서는 그걸 안다고 보고 EF Core 쪽만 다룬다.

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
public class AppDbContext(DbContextOptions<AppDbContext> options, ITenantContext tenant) : DbContext(options)
{
    public DbSet<Pet> Pets => Set<Pet>();
    public DbSet<Owner> Owners => Set<Owner>();

    // 쿼리 필터가 요청마다 다른 테넌트 값을 쓰도록 DbContext 의 멤버로 노출한다
    private Guid CurrentTenantId => tenant.TenantId;

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.Entity<Pet>(e =>
        {
            e.ToTable("pets");
            e.HasKey(p => p.Id);
            e.Property(p => p.Name).HasMaxLength(50).IsRequired();
            e.HasIndex(p => new { p.TenantId, p.OwnerId });        // 복합 인덱스
            e.HasOne(p => p.Owner).WithMany(o => o.Pets).HasForeignKey(p => p.OwnerId);
            e.HasQueryFilter(p => p.TenantId == CurrentTenantId);  // 멀티테넌시 강제
        });
    }
}
```

등장하는 이름을 하나씩 풀면 이렇다.

| 이름 | 무엇 | Prisma 로 치면 |
| --- | --- | --- |
| **엔티티** (`Pet`) | 테이블 한 개에 대응하는 C# 클래스. 프로퍼티 하나가 컬럼 하나 | `schema.prisma` 의 `model Pet` |
| **DbContext** (`AppDbContext`) | DB 와의 대화 세션. 쿼리를 보내고 가져온 엔티티를 기억하고 변경을 저장한다 | `PrismaClient` 인스턴스 (+ 변경 기억) |
| **DbSet** (`db.Pets`) | 테이블 하나에 대한 진입점. 여기서 LINQ 를 시작한다 | `prisma.pet` |
| **네비게이션 프로퍼티** (`pet.Owner`, `owner.Pets`) | 외래 키로 이어진 다른 엔티티를 객체로 가리키는 프로퍼티 | relation 필드 |
| **`OnModelCreating`** | 테이블 이름, 키, 인덱스, 관계 같은 매핑 규칙을 적는 곳 | `@@index`, `@relation` 등 |

네비게이션 프로퍼티 선언 `Owner Owner { get; set; } = null!` 의 `null!` 은 "지금은 비어 있지만 EF 가 채워 준다"고 컴파일러 경고를 끄는 관용구다. 실제로 채워지는 것은 `Include` 나 Projection 으로 Owner 를 함께 읽었을 때뿐이다. 그냥 `db.Pets.ToListAsync()` 로 가져온 Pet 의 `Owner` 는 `null` 이다. (→ 4절)

DbContext 는 DI 에 **Scoped** 로 등록된다. 요청 하나가 DbContext 하나를 쓰고 요청이 끝나면 버린다. 그 이유는 8절의 함정 표에 있다.

`HasQueryFilter` 는 **글로벌 쿼리 필터**다. 이 엔티티로 나가는 모든 쿼리에 조건을 자동으로 붙인다. 위 예에서는 "현재 테넌트의 행만" 조건이 모든 SELECT 에 들어간다. 필터 안에서 요청마다 달라지는 값을 쓰려면 `CurrentTenantId` 처럼 DbContext 의 멤버를 거쳐야 EF 가 그 값을 매번 새로 읽는다. 상수를 박아 두면 처음 값이 굳어 버린다. 이 필터를 일부러 끄려면 쿼리에 `.IgnoreQueryFilters()` 를 붙인다.

**설정 방법이 두 가지**인데 섞지 말고 팀 컨벤션을 따른다.
- **데이터 어노테이션** — 엔티티에 `[Required]`, `[MaxLength(50)]`
- **Fluent API** — `OnModelCreating` 에서 (위 코드). 더 강력하고 엔티티가 깨끗하다. **큰 프로젝트는 대개 이쪽**

Fluent API 라는 이름은 `e.Property(...).HasMaxLength(50).IsRequired()` 처럼 메서드를 점으로 이어 쓰는 스타일에서 왔다. 복합 인덱스, 쿼리 필터, 삭제 동작처럼 어노테이션으로 표현할 수 없는 설정이 많아서 큰 프로젝트는 이쪽으로 모인다.

엔티티가 많아지면 `IEntityTypeConfiguration<Pet>` 로 파일을 분리한다.

```csharp
public class PetConfiguration : IEntityTypeConfiguration<Pet>
{
    public void Configure(EntityTypeBuilder<Pet> e)
    {
        e.ToTable("pets");
        e.Property(p => p.Name).HasMaxLength(50).IsRequired();
    }
}

// OnModelCreating 에서 한 줄로 전부 등록
b.ApplyConfigurationsFromAssembly(typeof(AppDbContext).Assembly);
```

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

`FindAsync` 의 "캐시"는 DbContext 가 이미 추적 중인 엔티티 목록이다. 같은 요청 안에서 그 ID 의 엔티티를 이미 가져왔다면 DB 에 다시 묻지 않고 그 객체를 돌려준다. 나머지 메서드는 항상 SQL 을 보낸다.

**Include** 는 연결된 엔티티를 같은 쿼리에서 JOIN 으로 함께 가져오라는 지시다. Prisma 의 `include: { owner: true }` 와 같다. `ThenInclude` 는 그 다음 단계(보호자의 주소)까지 이어서 가져온다.

**Projection** 은 `Select` 로 결과를 엔티티가 아닌 원하는 모양(DTO)으로 바로 만드는 것이다. Prisma 의 `select: { id: true, name: true, owner: { select: { name: true } } }` 와 같은 일을 한다.

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

"결정적 정렬"이란 같은 데이터에 같은 쿼리를 보내면 항상 같은 순서가 나오는 정렬이다. `CreatedAt` 만으로 정렬하면 같은 시각에 생성된 두 행의 순서는 DB 마음대로라 요청마다 바뀔 수 있다. 유일한 값인 `Id` 를 두 번째 정렬 키(**타이브레이커**)로 붙이면 순서가 하나로 고정된다.

`Skip` 방식(OFFSET)은 뒤 페이지로 갈수록 느려진다. 1000페이지를 보려면 DB 가 앞의 행을 전부 세고 버려야 하기 때문이다. 무한 스크롤처럼 깊이 내려가는 화면은 커서 방식을 쓴다. (→ `01-backend-basics/03-database.md` 5절)

---

## 3. 변경 추적 — 여기가 핵심 개념

```csharp
var pet = await db.Pets.FirstAsync(p => p.Id == id);   // 추적 시작
pet.Name = "루비";                                      // 아무 SQL 도 안 나감
await db.SaveChangesAsync();                            // ← 여기서 UPDATE 1건 발행
```

`db.Update()` 를 부를 필요가 없다. **DbContext 가 가져올 때의 값을 기억해 두고 저장 시점에 비교해서
바뀐 컬럼만 UPDATE 문을 만든다.**

**변경 추적**(change tracking)은 DbContext 가 자기가 가져온 엔티티마다 "가져왔을 때의 값"을 복사해 두는 기능이다. `SaveChangesAsync()` 를 부르면 현재 값과 복사본을 하나하나 비교해서 다른 것만 SQL 로 만든다. 추적 중인 엔티티는 각자 상태를 갖는다.

| 상태 | 언제 이 상태가 되나 | `SaveChanges` 때 나가는 SQL |
| --- | --- | --- |
| `Unchanged` | 조회해서 가져온 직후 | 없음 |
| `Modified` | 추적 중인 엔티티의 프로퍼티를 바꿨을 때 | 바뀐 컬럼만 `UPDATE` |
| `Added` | `db.Pets.Add(pet)` | `INSERT` |
| `Deleted` | `db.Pets.Remove(pet)` | `DELETE` |
| `Detached` | 추적하지 않는 객체 (`AsNoTracking`, 직접 `new` 한 것) | 없음. EF 가 모른다 |

디버깅할 때 `db.ChangeTracker.DebugView.LongView` 를 찍어 보면 지금 무엇이 어떤 상태로 추적되고 있는지 그대로 보인다.

### 추적의 대가

1. **메모리** — 가져온 모든 엔티티의 원본 스냅샷을 들고 있다. 10만 건 조회하면 20만 개 객체
2. **SaveChanges 가 느려짐** — 추적 중인 전체를 비교한다
3. **의도치 않은 저장** — 조회만 하려고 가져온 엔티티를 어디선가 고치면 같이 저장된다

→ **조회 전용이면 항상 `AsNoTracking()`.** 목록 API 에 붙이는 게 습관이 돼야 한다.

3번이 가장 찾기 어렵다. 예를 들어 목록을 가져와 화면용으로 `pet.Name = pet.Name.Trim()` 을 했다고 하자. 같은 요청의 다른 서비스가 나중에 `SaveChangesAsync()` 를 부르면 그 Trim 결과가 DB 에 저장된다. `AsNoTracking()` 으로 가져온 엔티티는 EF 가 기억하지 않으므로 이런 일이 생기지 않는다.

전역으로 기본값을 바꿀 수도 있다 (보수적인 팀은 이렇게 한다):

```csharp
db.ChangeTracker.QueryTrackingBehavior = QueryTrackingBehavior.NoTracking;
```

등록 시점에 `options.UseQueryTrackingBehavior(QueryTrackingBehavior.NoTracking)` 로 정하는 방법도 있다. 이렇게 하면 수정이 필요한 쿼리에만 `.AsTracking()` 을 붙인다.

### 삽입 / 삭제

```csharp
db.Pets.Add(pet);                     // 메모리에만
db.Pets.AddRange(pets);
db.Pets.Remove(pet);                  // 삭제하려면 먼저 가져와야 한다 (SELECT + DELETE)
await db.SaveChangesAsync(ct);        // 여기서 한 트랜잭션으로 전부 반영
```

**`SaveChangesAsync()` 는 자동으로 트랜잭션을 연다.** 여러 변경이 전부 되거나 전부 안 된다.
그래서 서비스 계층에서 여러 리포지토리를 호출하고 마지막에 한 번만 저장하면 Unit of Work 가 공짜로 된다.

**Unit of Work** 는 "한 업무 단위의 변경을 모아 두었다가 한 번에 커밋한다"는 패턴이다. 펫을 등록하면서 보호자의 펫 수를 갱신해야 한다면 두 변경을 추적해 두고 `SaveChangesAsync()` 한 번에 묶는다. 하나가 실패하면 둘 다 반영되지 않는다. DbContext 가 Scoped 라서 같은 요청 안의 서비스들이 같은 DbContext 를 공유하기 때문에 가능한 일이다. (→ `01-backend-basics/02-layers-and-di.md` 4절)

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

첫 번째 방식은 10만 행을 앱으로 읽어 온 뒤 UPDATE 10만 건을 보낸다(EF 가 배치로 묶어도 왕복이 많이 남는다). 두 번째는 `UPDATE pets SET "Status" = 'y' WHERE "Status" = 'x'` 한 문장이다. **인터셉터**는 `SaveChanges` 직전·직후에 끼어드는 코드로, "수정 시각 자동 기록"이나 "변경 이력 남기기"를 여기에 구현하는 팀이 많다. `ExecuteUpdate` 는 이 경로를 아예 지나지 않으므로 그런 규칙이 있는 테이블이라면 직접 챙겨야 한다.

---

## 3-2. LINQ 가 SQL 로 어떻게 번역되는가 — 대조표

**EF Core 를 이해한다는 건 이 대응 관계가 머리에 들어 있다는 뜻이다.**
LINQ 를 외우는 게 아니라, LINQ 를 보면 SQL 이 보이는 상태가 목표다.

번역이 가능한 이유를 먼저 짚는다. `db.Pets` 는 `IQueryable<Pet>` 타입이다. 여기에 `Where(p => ...)` 를 붙이면 람다가 실행 가능한 함수가 아니라 **식 트리**(expression tree), 곧 "p 의 Species 가 'dog' 와 같다"는 구조 데이터로 전달된다. EF Core 는 그 구조를 읽어 SQL 문장으로 다시 쓴다. 그래서 SQL 로 옮길 수 있는 표현만 쓸 수 있고 내가 만든 C# 메서드는 번역하지 못한다(⑨).

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

`IsDeleted` 는 **소프트 삭제** 표시다. 행을 실제로 지우지 않고 "삭제됨" 표시만 해 두면 실수로 지운 데이터를 되살릴 수 있고 감사 기록도 남는다. 대신 모든 조회에서 삭제된 행을 빼야 한다. 그걸 사람이 매번 기억하는 대신 글로벌 쿼리 필터가 맡는다.

또 하나 — **`SELECT *` 가 아니라 컬럼을 전부 나열**한다. 그래서 `InternalMemo` 같은
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

같은 JOIN 인데 **양쪽 테이블의 전 컬럼**을 가져오고 엔티티 두 종류를 **전부 추적**한다.
`Owner.Name` 하나만 필요했다면 ②보다 명백히 손해다.

그럼 `Include` 는 언제 쓰나. 가져온 엔티티를 **수정해서 저장할 때**다. 예를 들어 보호자와 그 펫 목록을 함께 읽어 펫 하나를 고치고 `SaveChangesAsync()` 하려면 둘 다 추적되는 엔티티여야 한다. 화면에 보여 주기만 할 거라면 Projection 이다.

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

`Skip(40).Take(20)` 은 "앞의 40개를 건너뛰고 20개", 곧 페이지 크기 20 의 3페이지다. SQL Server 에서는 같은 LINQ 가 `OFFSET 40 ROWS FETCH NEXT 20 ROWS ONLY` 로 번역된다. 문법은 달라도 LINQ 는 그대로다.

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

`EXISTS` 는 조건에 맞는 행을 하나 찾는 순간 멈춘다. `COUNT` 는 맞는 행을 끝까지 다 센다. 맞는 행이 1만 개라면 앞은 1개에서 멈추고 뒤는 1만 개를 센다. `@id`, `@name` 은 **파라미터**다. 값이 SQL 문자열에 직접 박히지 않고 따로 전달되므로 SQL Injection 이 원천적으로 막힌다.

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

반대로 추적하지 않는 객체에 `db.Update(pet)` 를 부르면 EF 는 무엇이 바뀌었는지 모르므로 **모든 컬럼**을 UPDATE 문에 넣는다. 그래서 수정은 "추적 조회 → 프로퍼티 변경 → SaveChanges" 순서가 기본이다.

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

**Seq Scan**(순차 스캔)은 PostgreSQL 이 테이블을 처음부터 끝까지 한 행씩 다 읽는 방식이다. 인덱스는 `Name` 의 원래 값으로 정렬되어 있는데 `LOWER(Name)` 으로 찾으면 그 정렬을 쓸 수 없어서 전부 읽게 된다. 10만 행 테이블이라면 인덱스로 몇 번 만에 끝날 일을 10만 번 비교한다. 실제로 어떤 방식으로 실행되는지는 `EXPLAIN` 으로 확인한다.

**함수 인덱스**는 `CREATE INDEX ... ON pets (LOWER("Name"))` 처럼 함수를 적용한 결과로 만든 인덱스다. 이러면 `LOWER(Name) = ...` 조건도 인덱스를 탄다. `ILIKE '%코코%'` 처럼 앞에 와일드카드가 붙는 검색은 일반 인덱스로는 어느 쪽도 해결되지 않는다.

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

두 타입은 메서드 이름이 똑같아서 눈으로는 구분이 안 된다. 차이는 "그 `Where` 를 누가 실행하나"다.

| 타입 | `Where` 를 실행하는 곳 | 비유 |
| --- | --- | --- |
| `IQueryable<T>` | DB. 조건이 SQL 로 번역된다 | 서버에 `?species=dog` 를 붙여 요청 |
| `IEnumerable<T>` | 앱 메모리. C# 반복문으로 거른다 | 전부 받아 온 뒤 `array.filter()` |

IDE 에서 변수 위에 마우스를 올려 타입이 `IQueryable` 인지 확인하는 습관이 도움이 된다. 메서드가 `IEnumerable<Pet>` 을 반환하도록 선언되어 있으면 그 뒤에 붙인 조건은 전부 메모리에서 돈다.

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

풀어 쓰는 예를 하나 들면 이렇다. `IsAdult` 가 "생일로부터 1년 이상"이라면 기준 날짜를 C# 에서 먼저 계산하고 비교만 LINQ 에 남긴다.

```csharp
var cutoff = DateOnly.FromDateTime(DateTime.UtcNow).AddYears(-1);   // C# 에서 미리 계산
db.Pets.Where(p => p.BirthDate <= cutoff)                           // ✅ WHERE "BirthDate" <= @cutoff
```

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

어떤 SQL 이 나가는지 로그 없이 바로 보고 싶으면 쿼리에 `.ToQueryString()` 을 붙여 문자열로 찍어 볼 수 있다.

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

**N+1** 은 목록 1번(1) + 항목마다 관련 데이터 1번씩(N)으로 쿼리가 N+1 개 나가는 문제다. 펫 100마리면 101번이다. 개념은 `01-backend-basics/03-database.md` 3절에서 다뤘다.

주석의 "lazy loading 또는 예외"를 풀면 이렇다. **lazy loading**(지연 로딩)은 `p.Owner` 에 처음 접근하는 순간 EF 가 몰래 SELECT 를 보내 채워 주는 기능이다. 켜 두면 위 루프가 조용히 101번 쿼리를 보낸다. EF Core 는 이 기능이 기본으로 꺼져 있다(`Microsoft.EntityFrameworkCore.Proxies` 패키지와 `UseLazyLoadingProxies()` 로 켠다). 꺼져 있으면 `p.Owner` 가 `null` 이라 `NullReferenceException` 이 난다. 차라리 이쪽이 낫다. 문제가 바로 드러나기 때문이다.

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

`EnableSensitiveDataLogging()` 은 `@__p_0='8f3a...'` 처럼 파라미터의 실제 값까지 로그에 남긴다. 디버깅에는 좋지만 운영에서 켜면 고객의 이름·전화번호가 로그로 흘러간다. 그래서 반드시 `IsDevelopment()` 안에 둔다.

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
| 네트워크 지연 | 0ms (같은 머신) | 1\~5ms (DB 가 다른 호스트) |
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

카테시안 폭발이라는 이름은 수학의 카테시안 곱(모든 조합)에서 왔다. 보호자 한 명에게 펫 10마리, 청구서 20건이 있으면 한 번의 JOIN 결과는 두 목록의 모든 조합인 200행이 된다. 보호자 정보는 200번, 펫 정보는 20번씩 중복해서 네트워크로 온다. 보호자가 100명이면 2만 행이다. (→ `07-db-infra/01-relational-basics.md` 4절)

**`AsSplitQuery()`** 를 붙이면 EF 가 쿼리를 컬렉션별로 쪼갠다.

| 방식 | 나가는 쿼리 | 가져오는 행 (보호자 1명) |
| --- | --- | --- |
| 기본 (단일 쿼리) | owners ⨝ pets ⨝ invoices 1개 | 10 × 20 = 200행 |
| `AsSplitQuery()` | owners 1개 + pets 1개 + invoices 1개 | 1 + 10 + 20 = 31행 |

대가도 있다. 왕복이 3번으로 늘고 세 쿼리 사이에 다른 요청이 데이터를 바꾸면 결과가 서로 맞지 않을 수 있다. 컬렉션 `Include` 가 둘 이상일 때만 고려한다. 화면에 보여 줄 목적이라면 여전히 Projection 이 먼저다. 프로젝트 전체 기본값을 바꾸려면 `UseNpgsql(conn, o => o.UseQuerySplittingBehavior(QuerySplittingBehavior.SplitQuery))` 로 정한다.

---

## 5. 마이그레이션

**마이그레이션**은 엔티티(C# 코드)의 변경을 DB 스키마 변경으로 옮기는 버전 관리된 스크립트다. Prisma 의 `prisma migrate dev` 와 같은 역할이다. `Pet` 에 프로퍼티를 하나 추가하고 마이그레이션을 만들면 EF 가 이전 모델과 비교해서 `ALTER TABLE ... ADD COLUMN` 을 만들어 준다.

```bash
dotnet tool install --global dotnet-ef       # 최초 1회

dotnet ef migrations add AddPetStatus        # 엔티티 변경 → 마이그레이션 코드 생성
dotnet ef migrations script                  # 적용할 SQL 을 눈으로 확인 (운영 전 필수)
dotnet ef database update                    # 적용
dotnet ef migrations remove                  # 아직 적용 안 한 마지막 것 취소
```

생성된 파일은 `Up()` (적용) 과 `Down()` (되돌리기) 을 가진 **C# 코드**다. 커밋 대상이다.

`migrations add` 를 하면 파일이 세 종류 생긴다. 시각이 붙은 마이그레이션 파일(`20250301093000_AddPetStatus.cs`), 그 짝인 `.Designer.cs`, 그리고 현재 모델 전체의 스냅샷(`AppDbContextModelSnapshot.cs`)이다. 다음 마이그레이션은 이 스냅샷과 비교해서 만들어진다. DB 쪽에는 `__EFMigrationsHistory` 테이블이 있어서 어떤 마이그레이션까지 적용됐는지 기록한다. `database update` 는 이 표에 없는 것만 순서대로 실행한다.

`Down()` 이 있다고 항상 되돌릴 수 있는 것은 아니다. 컬럼을 지우는 마이그레이션의 `Down()` 은 컬럼을 다시 만들 뿐 지워진 데이터는 돌아오지 않는다.

> **운영 규칙:** `dotnet ef database update` 를 운영 DB 에 직접 쏘는 팀은 드물다.
> 보통 `migrations script` 로 SQL 을 뽑아 DBA 검토를 거치거나, 배포 파이프라인이 적용한다.
> ❓ 입사 후 확인: 우리는 어느 쪽인가? 고객사 온프레미스는?

파이프라인용으로 쓰이는 옵션 두 가지를 알아 두면 코드에서 봤을 때 덜 낯설다.

- `dotnet ef migrations script --idempotent` 는 "이미 적용된 것은 건너뛰는" SQL 을 만든다. DB 가 어느 버전에 있든 같은 스크립트를 돌릴 수 있어서 여러 고객사 설치본에 배포할 때 편하다.
- `dotnet ef migrations bundle` 은 마이그레이션을 실행 파일 하나로 묶는다. 운영 서버에 SDK 를 깔지 않고 그 파일만 실행하면 된다.

`01-backend-basics/03-database.md` 의 **확장/수축 패턴** (컬럼 삭제·이름 변경 시 무중단 배포) 을 여기서 적용한다. 배포 순서와 마이그레이션의 관계는 `07-db-infra/05-infra.md` 6절에 있다.

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

**트랜잭션 안에서 외부 API 를 부르지 마라** (`01-backend-basics/03-database.md` 참조).

명시적 트랜잭션은 `SaveChangesAsync()` 를 두 번 이상 불러야 하는데 전체를 한 덩어리로 묶고 싶을 때 쓴다. 대표적인 경우가 "DB 가 만들어 주는 자동 증가 ID 를 받아서 다음 행에 써야 할 때"다. `Guid.NewGuid()` 처럼 ID 를 앱에서 만들면 이 이유는 사라진다. 외부 API 를 부르지 말라는 이유는 트랜잭션이 열려 있는 동안 행 잠금과 DB 커넥션을 붙들고 있기 때문이다. LLM 호출이 30초 걸리면 그동안 다른 요청이 같은 행을 기다린다.

> DB 연결이 잠깐 끊겼을 때 자동으로 다시 시도하도록 `EnableRetryOnFailure()` 를 켜 둔 프로젝트라면 위처럼 직접 연 트랜잭션에서 예외가 난다. 재시도할 때 트랜잭션 전체를 처음부터 다시 해야 하기 때문이다. 이때는 `db.Database.CreateExecutionStrategy().ExecuteAsync(async () => { ... })` 로 트랜잭션 블록 전체를 감싼다. 재시도 일반론은 `07-db-infra/03-resilience.md` 2절에 있다.

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

**낙관적 동시성**은 "충돌이 드물다고 보고 잠그지 않되, 저장할 때 그사이 누가 바꿨는지 확인한다"는 방식이다. 시간 순서로 따라가면 이렇다.

| 시각 | 사용자 A | 사용자 B | DB 의 Version |
| --- | --- | --- | --- |
| 1 | 펫 조회 (Version=7) | | 7 |
| 2 | | 펫 조회 (Version=7) | 7 |
| 3 | | 이름 변경 후 저장 → `UPDATE ... WHERE "Id"=@id AND xmin=7` 성공 | 8 |
| 4 | 나이 변경 후 저장 → `... AND xmin=7` 에 맞는 행이 0개 | | 8 |
| 5 | EF 가 `DbUpdateConcurrencyException` 을 던진다 → 409 | | |

A 가 B 의 변경을 모르고 덮어쓰는 일이 막힌다. PostgreSQL 의 `xmin` 은 행이 바뀔 때마다 DB 가 알아서 바꾸는 시스템 컬럼이라 따로 컬럼을 만들 필요가 없다. (표의 7 → 8 은 설명용이다. 실제 `xmin` 은 1씩 늘지 않고 그 행을 마지막으로 바꾼 트랜잭션 번호가 들어간다. 값이 "달라졌는지"만 중요하다) SQL Server 에서는 `public byte[] RowVersion { get; set; }` 에 `IsRowVersion()` 을 붙여 `rowversion` 컬럼을 쓴다. 개념은 `01-backend-basics/03-database.md` 2절에 있다.

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

`FromSql` 이 보간 문자열을 받는데도 안전한 이유는 타입에 있다. 이 메서드의 파라미터는 `string` 이 아니라 `FormattableString` 이다. 보간 문자열이 이 타입으로 넘어가면 "SQL 틀"과 "끼워 넣을 값"이 분리된 채로 전달되고 EF 가 값을 `@p0`, `@p1` 파라미터로 바꿔 보낸다. 반대로 `name = "' OR 1=1 --"` 같은 값이 `FromSqlRaw` 의 문자열 연결로 들어가면 SQL 문장 자체가 바뀐다.

`FromSql` 결과에도 LINQ 를 이어 붙일 수 있고 글로벌 쿼리 필터도 적용된다. EF 가 내 SQL 을 서브쿼리로 감싸서 바깥에 조건을 붙이기 때문이다.

벡터 검색 예 (pgvector):

```csharp
var results = await db.Database.SqlQuery<ChunkHit>($"""
    SELECT id, content, 1 - (embedding <=> {queryVec}::vector) AS score
    FROM chunks WHERE tenant_id = {tenantId}
    ORDER BY embedding <=> {queryVec}::vector LIMIT {k}
    """).ToListAsync(ct);
```

`SqlQuery<T>` 는 EF Core 8 부터 엔티티가 아닌 임의의 타입(`ChunkHit`)으로 결과를 받는 방법이다. `$"""..."""` 는 여러 줄 보간 문자열(C# 11 raw string literal)로, 이것도 `FormattableString` 으로 넘어가서 값이 파라미터가 된다. `<=>` 는 pgvector 의 코사인 거리 연산자다.

> `pgvector/pgvector-dotnet` 패키지를 쓰면 LINQ 에서 `EF.Functions.CosineDistance` 같은 걸 쓸 수 있다.
> ❓ 입사 후 확인: 우리 Vector DB 는 pgvector 인가, 별도 제품(Qdrant/Azure AI Search)인가?

### Dapper — EF Core 옆에 같이 쓰는 경량 도구

**Dapper** 는 "SQL 은 내가 쓰고 결과를 객체로 바꾸는 것만 해 주는" 작은 라이브러리다. 변경 추적도 LINQ 번역도 없다. 그만큼 빠르고 결과 SQL 이 정확히 내가 쓴 그대로다.

```csharp
await using var conn = new NpgsqlConnection(connString);
var stats = await conn.QueryAsync<PetStat>(
    new CommandDefinition(
        "SELECT species, COUNT(*) AS count FROM pets WHERE tenant_id = @TenantId GROUP BY species",
        new { TenantId = tenantId },           // @TenantId 파라미터로 바인딩된다
        cancellationToken: ct));
```

한 코드베이스에서 둘을 섞어 쓰는 경우가 많다. 기준은 대략 이렇다.

| 상황 | 고를 것 |
| --- | --- |
| 엔티티를 읽어 고치고 저장하는 일반 CRUD | EF Core |
| 업무 규칙, 관계가 얽힌 도메인 모델 | EF Core |
| 복잡한 집계·리포트, SQL 튜닝이 핵심인 조회 | Dapper 또는 EF 의 `SqlQuery<T>` |
| 초당 수천 번 불리는 단순 조회에서 마지막 성능까지 | Dapper |

Dapper 쿼리에는 글로벌 쿼리 필터가 적용되지 않는다. 테넌트 조건(`tenant_id = @TenantId`)을 사람이 매번 직접 써야 한다는 뜻이다. 멀티테넌트 서비스에서 Dapper 를 쓸 때 가장 먼저 확인할 점이다.

> ❓ 입사 후 확인: Dapper 를 같이 쓰나? 쓴다면 테넌트 조건을 어떻게 강제하나?

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
| `async` 안에서 `ToList()` | 요청 스레드가 DB 를 기다리며 묶임 | `ToListAsync(ct)` 등 `~Async` 버전 |

특히 이 에러 메시지를 기억해 둬라:

```
A second operation was started on this context instance before a previous operation completed.
```

**DbContext 는 스레드 안전하지 않다.** 하나의 컨텍스트로 `Task.WhenAll` 을 돌리면 항상 이게 난다.

"스레드 안전하지 않다"는 두 작업이 같은 객체를 동시에 쓰면 내부 상태가 꼬인다는 뜻이다. DbContext 는 DB 연결 하나와 추적 목록 하나를 들고 있다. 쿼리 두 개가 그 연결을 동시에 쓰려고 하면 EF 가 이 예외로 막는다. 대부분은 `await` 를 하나씩 순서대로 하면 충분하다. 정말 병렬이 필요하면 `AddDbContextFactory` 로 등록한 `IDbContextFactory<AppDbContext>` 를 주입받아 작업마다 `CreateDbContextAsync()` 로 따로 만든다.

### 성능을 더 짜내야 할 때 — 알아만 두기

위 함정을 다 피한 뒤에도 느린 경우에만 꺼내는 도구들이다. 코드에서 보면 "성능 때문에 넣었구나"라고 읽으면 된다.

| 도구 | 하는 일 | 효과가 있는 곳 |
| --- | --- | --- |
| `AddDbContextPool<T>()` | DbContext 객체를 버리지 않고 재사용 | 요청이 아주 많은 서비스 |
| `EF.CompileAsyncQuery(...)` | LINQ → SQL 번역 결과를 미리 만들어 둔다 | 같은 모양의 쿼리를 초당 수천 번 실행할 때 |
| `AsNoTrackingWithIdentityResolution()` | 추적은 안 하되 같은 행은 같은 객체로 | 읽기 전용인데 같은 엔티티가 여러 번 나올 때 |

```csharp
// 컴파일된 쿼리 — 정적 필드에 한 번 만들어 두고 재사용
private static readonly Func<AppDbContext, Guid, Task<Pet?>> GetPetById =
    EF.CompileAsyncQuery((AppDbContext db, Guid id) => db.Pets.FirstOrDefault(p => p.Id == id));

var pet = await GetPetById(db, id);
```

EF Core 는 원래 번역 결과를 내부에 캐시하므로 컴파일된 쿼리로 얻는 이득은 크지 않은 경우가 많다. 측정해서 차이가 보일 때만 쓴다.

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

**"가져온 데이터를 클라이언트가 기억하고 있고 그 기억이 실제와 어긋날 수 있다"** 는 문제 구조가 같다.
TanStack Query 의 stale 개념을 이해했다면 change tracking 도 같은 사고로 접근하면 된다.

차이는 수명이다. TanStack Query 의 캐시는 브라우저 탭이 살아 있는 동안 남지만 DbContext 의 기억은 요청 하나가 끝나면 사라진다. 그래서 EF Core 에서 "어긋남"은 한 요청 안에서만 생기고 요청과 요청 사이의 어긋남은 6절의 낙관적 동시성이 맡는다.

---

## 스스로 답해보기

1. `db.Pets.Where(p => p.Species == "dog").ToList()` 와 `db.Pets.ToList().Where(p => p.Species == "dog")` 는 DB 에서 각각 몇 행을 읽나?
2. `Select(p => new PetDto(..., p.Owner.Name))` 와 `Include(p => p.Owner)` 의 SQL 은 어떻게 다른가? `Include` 가 필요한 경우는?
3. 조회해 온 엔티티의 `Name` 을 바꾸고 `SaveChangesAsync()` 만 불렀는데 UPDATE 가 나갔다. 어떻게 가능한가? 같은 일을 `AsNoTracking()` 으로 가져온 엔티티에 하면?
4. `ExecuteUpdateAsync` 로 상태를 바꿨는데 "수정 시각"이 갱신되지 않았다. 왜인가?
5. 같은 DbContext 로 두 쿼리를 `Task.WhenAll` 하면 무슨 일이 생기나? 어떻게 고치나?
6. Dapper 로 쿼리를 짤 때 EF Core 에서는 신경 쓰지 않던 무엇을 직접 챙겨야 하나?
