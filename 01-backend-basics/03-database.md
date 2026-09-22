# 데이터베이스

**EF Core 에서 생기는 문제의 90% 는 EF Core 문제가 아니라 이 층의 문제다.**
ORM 은 SQL 을 숨겨주지만, 느린 쿼리를 빠르게 만들어주지는 않는다.

---

## 1. 인덱스

### 왜 필요한가

테이블에 100만 행이 있고 인덱스가 없으면, `WHERE email = 'a@b.com'` 는 **100만 행을 전부 읽는다** (Full Scan).
인덱스는 그 컬럼만 미리 정렬해 둔 별도 구조(B-Tree)라서 **몇 번의 비교로 찾는다** (log n).

책 뒤의 색인과 같다. 색인이 없으면 처음부터 끝까지 넘겨야 한다.

### 대가

공짜가 아니다.

- **쓰기가 느려진다** — INSERT/UPDATE 마다 인덱스도 갱신해야 한다
- **디스크를 먹는다**
- 그래서 "일단 다 걸자"는 틀렸다. **조회 조건에 실제로 쓰이는 컬럼에만** 건다

### 어디에 거나

1. **외래키(FK)** — 조인에 쓰이니까. 많은 DB 가 자동으로 안 걸어준다. **PostgreSQL 은 FK 에 인덱스를 자동 생성하지 않는다**
2. **WHERE 에 자주 오는 컬럼** — `tenant_id`, `status`, `created_at`
3. **정렬(ORDER BY) 기준**
4. **유니크 제약** — 자동으로 인덱스가 생긴다

### 복합 인덱스와 순서 — 자주 틀리는 부분

```sql
CREATE INDEX ix_pets_tenant_status ON pets (tenant_id, status);
```

이 인덱스는 이런 쿼리에 쓰인다:

| 쿼리 | 인덱스 쓰이나 | 왜 |
| --- | --- | --- |
| `WHERE tenant_id = X AND status = 'active'` | ✅ | 둘 다 |
| `WHERE tenant_id = X` | ✅ | 앞부터 쓰므로 OK |
| `WHERE status = 'active'` | ❌ | **앞 컬럼을 건너뛸 수 없다** |

전화번호부가 (성, 이름) 순으로 정렬돼 있으면 "김"으로 시작하는 사람은 찾을 수 있어도
"이름이 철수인 사람" 전부는 못 찾는 것과 같다. **선택도가 높은(값이 다양한) 컬럼을 앞에** 두는 게 보통 정석이다.

### 인덱스가 무시되는 경우

```sql
WHERE LOWER(email) = 'a@b.com'          -- ❌ 컬럼에 함수를 씌우면 인덱스 못 씀
WHERE email LIKE '%@gmail.com'          -- ❌ 앞이 와일드카드면 못 씀
WHERE created_at::date = '2026-09-22'   -- ❌ 캐스팅도 마찬가지
```

→ 해법: 함수 인덱스를 따로 만들거나, 조건을 범위로 바꾼다
(`created_at >= '2026-09-22' AND created_at < '2026-09-23'`).

**EF Core 에서 `.Where(p => p.Name.ToLower() == x)` 라고 쓰면 위의 ❌ 첫 줄 SQL 이 나간다.**
LINQ 가 편해서 무심코 쓰기 쉬운 지점이다.

### 실행 계획 보기

느린 쿼리를 만나면 추측하지 말고 확인한다.

```sql
EXPLAIN ANALYZE SELECT * FROM pets WHERE tenant_id = '...' AND status = 'active';
```

`Seq Scan` (전체 훑기) 이 나오면 인덱스가 안 쓰이는 것, `Index Scan` 이면 쓰이는 것이다.

---

## 2. 트랜잭션

### ACID — 실무에서 의미 있는 것만

- **A(원자성)** — 전부 되거나 전부 안 되거나. 계좌 이체에서 출금만 되고 입금이 안 되는 상태가 없다
- **C(일관성)** — 제약조건(FK, UNIQUE, CHECK)이 깨진 상태로 커밋되지 않는다
- **I(격리성)** — 동시에 도는 트랜잭션끼리 서로를 얼마나 보나. ← **여기가 실무 이슈**
- **D(지속성)** — 커밋됐으면 서버가 죽어도 남는다

### 격리 수준과 이상 현상

| 수준 | Dirty Read | Non-repeatable Read | Phantom Read |
| --- | --- | --- | --- |
| Read Uncommitted | 발생 | 발생 | 발생 |
| **Read Committed** (PostgreSQL 기본) | 없음 | 발생 | 발생 |
| Repeatable Read | 없음 | 없음 | (PG 는 없음) |
| Serializable | 없음 | 없음 | 없음 |

- **Dirty Read** — 아직 커밋 안 된 남의 변경을 읽음
- **Non-repeatable Read** — 같은 행을 두 번 읽었는데 값이 달라짐 (사이에 남이 커밋)
- **Phantom Read** — 같은 조건으로 두 번 조회했는데 행 개수가 달라짐

대부분 **Read Committed** 로 충분하다. 올릴수록 정확하지만 락 경합이 늘어 느려진다.

### 트랜잭션 경계는 서비스가 정한다

```csharp
// Service 계층
public async Task TransferAsync(Guid from, Guid to, decimal amount)
{
    await using var tx = await _db.Database.BeginTransactionAsync();
    try
    {
        await _repo.WithdrawAsync(from, amount);
        await _repo.DepositAsync(to, amount);
        await _db.SaveChangesAsync();
        await tx.CommitAsync();
    }
    catch { await tx.RollbackAsync(); throw; }
}
```

**중요한 규칙 하나: 트랜잭션 안에서 외부 API 를 호출하지 마라.**

```csharp
await using var tx = await _db.Database.BeginTransactionAsync();
await _repo.AddAsync(order);
await _httpClient.PostAsync("https://payment.example.com/charge", ...);  // ❌
await tx.CommitAsync();
```

외부 API 가 10초 걸리면 **DB 락과 커넥션을 10초 동안 붙들고 있는다.** 동시 요청 몇 개면 커넥션 풀이 마른다.
외부 호출은 트랜잭션 밖으로 빼거나, "일단 pending 으로 커밋 → 외부 호출 → 결과로 상태 갱신" 2단계로 나눈다.
(→ `05-long-running-jobs.md`)

### 낙관적 동시성 — 동시 수정 충돌

두 사람이 같은 차트를 동시에 열어 각자 저장하면, 나중 저장이 앞의 것을 덮어쓴다 (lost update).

```csharp
public class Pet
{
    [Timestamp]                       // 또는 EF Core: .IsRowVersion()
    public byte[] RowVersion { get; set; }
}
```

읽을 때의 버전값을 UPDATE 조건에 포함시켜서, 그 사이에 바뀌었으면 0행이 갱신되고 예외가 난다
(`DbUpdateConcurrencyException`). 그때 사용자에게 "다른 사람이 수정했습니다" 를 보여준다.

**프론트에서 해야 할 일:** 이 예외를 409 로 받아서, 그냥 "저장 실패"가 아니라
*무엇이 달라졌는지* 보여주는 UI 를 만드는 것. 이게 실무에서 체감 차이가 크다.

---

## 3. N+1 문제 — ORM 최대의 함정

```csharp
var pets = await _db.Pets.ToListAsync();          // 쿼리 1번: 펫 100마리
foreach (var pet in pets)
{
    Console.WriteLine(pet.Owner.Name);            // 쿼리 100번! 마리마다 보호자 조회
}
```

**1 + N = 101 번의 쿼리.** 각각 1ms 라도 100ms 다. 개발 DB 에서는 안 느껴지고 운영에서 터진다.

### 해결

```csharp
// ✅ Eager loading — JOIN 한 번으로
var pets = await _db.Pets.Include(p => p.Owner).ToListAsync();

// ✅ 더 나은 방법 — 필요한 컬럼만 골라서 DTO 로 (Projection)
var pets = await _db.Pets
    .Select(p => new PetDto(p.Id, p.Name, p.Owner.Name))
    .ToListAsync();
```

**Projection 이 더 나은 이유:** `Include` 는 Owner 의 모든 컬럼을 가져오고 엔티티를 추적(tracking)한다.
`Select` 로 DTO 를 만들면 필요한 컬럼만 SELECT 하고 추적도 안 한다.

### 읽기 전용이면 추적을 끈다

```csharp
var pets = await _db.Pets.AsNoTracking().ToListAsync();
```

EF Core 는 기본적으로 가져온 엔티티를 전부 기억해 두고 (change tracking) 변경을 감지한다.
목록 조회처럼 수정할 일이 없으면 이건 순수한 낭비다. **목록 API 에는 거의 항상 `AsNoTracking()`.**

> 프론트로 치면 TanStack Query 에서 안 쓸 데이터를 캐시에 쌓아두는 것과 비슷하다.

### 지연 실행 — LINQ 는 언제 실행되나

```csharp
var q = _db.Pets.Where(p => p.TenantId == t);   // 아직 SQL 안 나감
q = q.Where(p => p.Status == "active");         // 아직
var list = await q.ToListAsync();               // ← 여기서 한 번에 나감
```

`ToListAsync()`, `FirstAsync()`, `CountAsync()`, `AnyAsync()` 가 실행 트리거다.
**`IQueryable` 인 동안은 조건을 계속 붙일 수 있다** — 동적 필터를 만들 때 유용하다.

반대의 함정:

```csharp
var pets = _db.Pets.ToList().Where(p => p.Age > 3);   // ❌ 전부 메모리로 가져온 뒤 C# 에서 필터
var pets = _db.Pets.Where(p => p.Age > 3).ToList();   // ✅ DB 에서 필터
```

`ToList()` 를 어디에 찍느냐로 SQL 이 완전히 달라진다. **`IEnumerable` 로 바뀌는 순간 메모리 필터링이다.**

---

## 4. 커넥션 풀

DB 커넥션을 새로 여는 건 비싸다(TCP + 인증). 그래서 앱은 커넥션을 미리 몇 개 열어두고 돌려 쓴다.

```
Max Pool Size=100   ← Npgsql 기본값
```

**풀이 마르는 시나리오:**
- 트랜잭션 안에서 외부 API 호출 (위 참조)
- `DbContext` 를 Dispose 안 함 → Scoped 로 등록하면 자동 해결
- 동기 코드(`.Result`)로 스레드가 묶여서 커넥션 반납이 지연됨

증상은 `Timeout expired. The timeout period elapsed prior to obtaining a connection from the pool.`
**이 에러 메시지를 보면 커넥션 누수를 의심해라.**

---

## 5. 페이지네이션

```csharp
// ❌ Offset 방식 — 쉽지만 뒤로 갈수록 느려진다
_db.Pets.OrderBy(p => p.Id).Skip(10000).Take(20)
// → DB 가 10020 행을 읽고 앞 10000개를 버린다
```

```csharp
// ✅ Keyset (cursor) 방식 — 항상 일정하게 빠르다
_db.Pets.Where(p => p.Id > lastSeenId).OrderBy(p => p.Id).Take(20)
```

Offset 은 또 하나의 문제가 있다: 1페이지를 보는 동안 새 데이터가 들어오면 **2페이지에서 항목이 중복되거나 누락된다.**
무한 스크롤에는 keyset 이 맞다. (프론트에서 `useInfiniteQuery` 의 `cursor` 가 바로 이것)

---

## 6. 관계형 vs 문서형 — 언제 뭘 쓰나

| | 관계형 (PostgreSQL, MSSQL) | 문서형 (MongoDB) |
| --- | --- | --- |
| 강점 | 조인, 제약조건, 트랜잭션, 정확성 | 스키마 유연성, 중첩 구조 저장 |
| 약할 때 | 스키마가 자주 바뀌는 반정형 데이터 | 여러 컬렉션에 걸친 일관성 |
| 쓰는 곳 | 사용자·권한·주문·결제 — **틀리면 안 되는 것** | 로그, 대화 이력, 크롤링 원문, 스키마가 제각각인 고객사 데이터 |

랭코드 스택에 **PostgreSQL + MongoDB + Vector DB + MSSQL** 이 다 있는 건,
"고객사 시스템이 제각각"이라는 제품 성격 때문일 가능성이 높다.

> 참고: PostgreSQL 의 `jsonb` 는 문서형의 상당 부분을 대체한다. 인덱스(GIN)도 걸린다.
> "반정형이니까 무조건 Mongo" 는 옛날 이야기다.

---

## 7. 마이그레이션

스키마 변경을 코드로 버전 관리하는 것. EF Core 는 이렇게 한다.

```bash
dotnet ef migrations add AddPetStatus      # 변경분을 C# 코드로 생성
dotnet ef database update                  # 적용
```

**운영에서 주의할 것:**
- 컬럼 삭제·이름 변경은 배포 중 순간에 구버전 앱이 죽는다 → **확장/수축 패턴**
  (① 새 컬럼 추가 → ② 양쪽에 쓰기 → ③ 읽기를 새 컬럼으로 → ④ 구 컬럼 삭제)
- 큰 테이블에 인덱스 추가는 락을 건다 → PostgreSQL 은 `CREATE INDEX CONCURRENTLY`
- 마이그레이션은 되돌릴 수 있게 작성하되, **데이터를 지우는 마이그레이션은 되돌릴 수 없다**

> ❓ 입사 후 확인: 마이그레이션을 누가 언제 적용하나? (배포 파이프라인 자동? 수동?)
> 고객사 온프레미스 설치본은 어떻게 하나?

---

## 스스로 답해보기

1. `(tenant_id, status)` 복합 인덱스가 있을 때, `WHERE status = 'active'` 만 있는 쿼리는 인덱스를 쓰나?
2. 트랜잭션 안에서 외부 결제 API 를 호출하면 뭐가 문제인가?
3. N+1 이 개발 환경에서 안 잡히는 이유는?
4. `_db.Pets.ToList().Where(...)` 와 `_db.Pets.Where(...).ToList()` 의 차이는?
5. 무한 스크롤에 offset 페이지네이션을 쓰면 왜 항목이 중복되나?
6. 목록 조회 API 에 `AsNoTracking()` 을 붙이는 이유는?
