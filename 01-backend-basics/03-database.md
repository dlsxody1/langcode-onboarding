# 데이터베이스

**EF Core 에서 생기는 문제의 90% 는 EF Core 문제가 아니라 이 층의 문제다.**
ORM 은 SQL 을 숨겨주지만 느린 쿼리를 빠르게 만들어주지는 않는다.

ORM(Object-Relational Mapper)은 DB 테이블을 클래스로, 행을 객체로 바꿔 주는 라이브러리다. TS 의 Prisma·Drizzle·TypeORM 자리에 .NET 에서는 EF Core 가 있다.
`_db.Pets.Where(p => p.Age > 3)` 라고 쓰면 EF Core 가 `SELECT ... WHERE age > 3` 으로 번역해 보낸다.
번역은 해 주지만 그 SQL 이 빠른지 느린지는 DB 가 정한다. 이 문서는 그 DB 쪽 사정이다.

> 테이블 · 키 · JOIN · NULL 이 낯설면 `07-db-infra/01-relational-basics.md` 를 먼저 읽는다.
> 같은 개념이 C# 코드에서 어떻게 보이는지는 `02-csharp-dotnet/03-ef-core.md` 에서 다룬다.

---

## 1. 인덱스

### 왜 필요한가

테이블에 100만 행이 있고 인덱스가 없으면 `WHERE email = 'a@b.com'` 는 **100만 행을 전부 읽는다** (Full Scan).
인덱스는 그 컬럼만 미리 정렬해 둔 별도 구조(B-Tree)라서 **몇 번의 비교로 찾는다** (log n).

책 뒤의 색인과 같다. 색인이 없으면 처음부터 끝까지 넘겨야 한다.

B-Tree 는 정렬된 값을 여러 단의 나무 모양으로 쌓은 구조다. 한 칸(페이지)에 수백 개의 값이 들어가서 100만 행이라도 나무 깊이가 3\~4단 정도다.
그래서 "100만 번 비교"가 "페이지 서너 개 읽기"로 줄어든다. log n 은 이렇게 데이터가 10배 늘어도 찾는 비용은 조금만 늘어나는 성질을 가리킨다.

| 행 수 | 인덱스 없음 (전부 읽기) | B-Tree 인덱스 |
| --- | --- | --- |
| 1,000 | 1,000행 | 1\~2단 |
| 1,000,000 | 1,000,000행 | 3\~4단 |
| 100,000,000 | 100,000,000행 | 4\~5단 |

### 대가

공짜가 아니다.

- **쓰기가 느려진다** — INSERT/UPDATE 마다 인덱스도 갱신해야 한다
- **디스크를 먹는다**
- 그래서 "일단 다 걸자"는 틀렸다. **조회 조건에 실제로 쓰이는 컬럼에만** 건다

인덱스가 5개 걸린 테이블에 행 하나를 INSERT 하면 테이블 1곳과 인덱스 5곳, 모두 6곳에 써야 한다.
읽기가 대부분인 테이블(펫, 사용자)과 쓰기가 폭주하는 테이블(로그, 이벤트)은 인덱스 전략이 달라야 하는 이유다.

### 어디에 거나

1. **외래키(FK)** — 조인에 쓰이니까. 많은 DB 가 자동으로 안 걸어준다. **PostgreSQL 은 FK 에 인덱스를 자동 생성하지 않는다**
2. **WHERE 에 자주 오는 컬럼** — `tenant_id`, `status`, `created_at`
3. **정렬(ORDER BY) 기준**
4. **유니크 제약** — 자동으로 인덱스가 생긴다

외래키는 "이 행이 저 테이블의 어느 행을 가리키는가"를 담는 컬럼이다(`pets.owner_id` → `owners.id`).
1번에는 반가운 예외가 있다. EF Core 마이그레이션은 관례상 외래키 컬럼마다 인덱스를 만들어 준다.
EF Core 로 스키마를 관리하면 대개 걸려 있고 손으로 짠 SQL 이나 DB 를 먼저 만들고 코드를 맞춘 프로젝트라면 빠져 있기 쉽다.

유니크 제약은 "이 컬럼 값은 테이블 안에서 겹치면 안 된다"는 규칙이다. DB 는 중복 여부를 빨리 확인하려고 내부적으로 인덱스를 만든다.

### 복합 인덱스와 순서 — 자주 틀리는 부분

```sql
CREATE INDEX ix_pets_tenant_status ON pets (tenant_id, status);
```

컬럼 여러 개를 묶어 하나의 인덱스로 만든 것을 복합 인덱스라고 한다. 먼저 `tenant_id` 로 정렬하고 같은 `tenant_id` 안에서 `status` 로 다시 정렬한 구조다.

이 인덱스는 이런 쿼리에 쓰인다:

| 쿼리 | 인덱스 쓰이나 | 왜 |
| --- | --- | --- |
| `WHERE tenant_id = X AND status = 'active'` | ✅ | 둘 다 |
| `WHERE tenant_id = X` | ✅ | 앞부터 쓰므로 OK |
| `WHERE status = 'active'` | ❌ | **앞 컬럼을 건너뛸 수 없다** |

전화번호부가 (성, 이름) 순으로 정렬돼 있으면 "김"으로 시작하는 사람은 찾을 수 있어도
"이름이 철수인 사람" 전부는 못 찾는 것과 같다. **선택도가 높은(값이 다양한) 컬럼을 앞에** 두는 게 보통 정석이다.

선택도(selectivity)는 "조건 하나로 행이 얼마나 많이 걸러지나"다. 100만 행 기준으로 보면 이렇다.

| 컬럼 | 값의 종류 | `= 어떤 값` 으로 남는 행 | 선택도 |
| --- | --- | --- | --- |
| `email` | 100만 (전부 다름) | 1행 | 매우 높음 |
| `tenant_id` | 200개 고객사 | 약 5,000행 | 높음 |
| `status` | 3개 (`active` 등) | 약 33만 행 | 낮음 |

`status` 처럼 값이 몇 개 안 되는 컬럼을 앞에 두면 첫 단계에서 거의 안 걸러진다.

순서를 정할 때 선택도만큼 중요한 기준이 두 개 더 있다.

- **어떤 쿼리가 실제로 들어오나.** 멀티테넌트 시스템은 거의 모든 쿼리에 `tenant_id = X` 가 붙으므로 `tenant_id` 를 앞에 두면 인덱스 하나로 여러 쿼리를 받아낸다.
- **같다(`=`) 조건을 앞에, 범위(`>`, `<`, `BETWEEN`)와 정렬을 뒤에.** `WHERE tenant_id = X AND created_at > '2026-09-01' ORDER BY created_at` 이면 `(tenant_id, created_at)` 이 맞다. 반대로 `(created_at, tenant_id)` 로 만들면 날짜 범위 안의 모든 고객사 행을 훑은 뒤에야 `tenant_id` 로 거를 수 있다.

`(tenant_id, created_at)` 인덱스는 정렬도 대신해 준다. 이미 그 순서로 정렬돼 있으므로 `ORDER BY created_at DESC LIMIT 20` 이 정렬 작업 없이 인덱스 앞쪽 20개만 읽고 끝난다. 5절 keyset 페이지네이션이 빠른 이유가 이것이다.

### 인덱스가 무시되는 경우

```sql
WHERE LOWER(email) = 'a@b.com'          -- ❌ 컬럼에 함수를 씌우면 인덱스 못 씀
WHERE email LIKE '%@gmail.com'          -- ❌ 앞이 와일드카드면 못 씀
WHERE created_at::date = '2026-09-22'   -- ❌ 캐스팅도 마찬가지
```

인덱스는 `email` 의 원래 값으로 정렬돼 있다. `LOWER(email)` 로 바꾼 값의 순서는 인덱스에 없으니 DB 는 모든 행에 `LOWER` 를 계산해 보는 수밖에 없다.
`LIKE '%@gmail.com'` 도 같다. 전화번호부에서 "끝 글자가 '수'인 이름"을 찾으려면 전부 봐야 한다. 반대로 `LIKE 'kim%'` 처럼 앞이 고정이면 인덱스를 쓸 수 있다.
`::date` 는 PostgreSQL 의 형 변환(캐스팅) 문법으로, 시각이 들어 있는 값을 날짜로 잘라낸다. 함수를 씌운 것과 같은 효과다.

→ 해법: 함수 인덱스를 따로 만들거나, 조건을 범위로 바꾼다
(`created_at >= '2026-09-22' AND created_at < '2026-09-23'`).

```sql
-- 함수 인덱스(식 인덱스): LOWER 를 씌운 값으로 정렬한 인덱스를 따로 만든다
CREATE INDEX ix_users_email_lower ON users (LOWER(email));
-- 이제 WHERE LOWER(email) = 'a@b.com' 이 이 인덱스를 쓴다
```

더 근본적인 방법은 저장할 때 소문자로 정규화해 두고 `WHERE email = 'a@b.com'` 으로 찾는 것이다.

**EF Core 에서 `.Where(p => p.Name.ToLower() == x)` 라고 쓰면 위의 ❌ 첫 줄 SQL 이 나간다.**
LINQ 가 편해서 무심코 쓰기 쉬운 지점이다. 날짜도 같다. `.Where(p => p.CreatedAt.Date == day)` 는 컬럼을 가공하는 SQL 이 되고,
`.Where(p => p.CreatedAt >= day && p.CreatedAt < day.AddDays(1))` 는 범위 조건이 된다.

### 특정 행만, 필요한 컬럼까지 — 부분 인덱스와 커버링 인덱스

PostgreSQL 에는 실무에서 자주 쓰는 인덱스 변형이 두 가지 더 있다.

```sql
-- 부분 인덱스: 조건에 맞는 행만 인덱스에 넣는다
CREATE INDEX ix_jobs_queued ON jobs (created_at) WHERE status = 'queued';

-- 커버링 인덱스: 찾는 데는 안 쓰지만 같이 꺼낼 컬럼을 인덱스에 얹어 둔다 (PostgreSQL 11+)
CREATE INDEX ix_pets_tenant_status ON pets (tenant_id, status) INCLUDE (name);
```

부분 인덱스는 "100만 건 중 대기 중인 잡 50건"처럼 늘 일부만 찾는 경우에 맞다. 인덱스가 작아서 빠르고 쓰기 부담도 적다. `05-long-running-jobs.md` 의 DB 기반 큐가 바로 이 모양이다.
커버링 인덱스는 `SELECT name FROM pets WHERE tenant_id = X AND status = 'active'` 같은 쿼리를 인덱스만 읽고 끝내게 해 준다. 실행 계획에 `Index Only Scan` 으로 나온다.

EF Core 에서는 모델 설정에서 선언하고 마이그레이션으로 만든다.

```csharp
modelBuilder.Entity<Pet>().HasIndex(p => new { p.TenantId, p.Status });        // 복합 인덱스
modelBuilder.Entity<Job>().HasIndex(j => j.CreatedAt).HasFilter("status = 'queued'");   // 부분 인덱스
```

`HasFilter` 안은 날것의 SQL 이라 실제 컬럼 이름(따옴표, 대소문자)을 맞춰 써야 한다. 함수 인덱스처럼 EF Core 가 직접 표현하지 못하는 것은 마이그레이션 안에서 `migrationBuilder.Sql("CREATE INDEX ...")` 로 만든다.

### 실행 계획 보기

느린 쿼리를 만나면 추측하지 말고 확인한다.

```sql
EXPLAIN ANALYZE SELECT * FROM pets WHERE tenant_id = '...' AND status = 'active';
```

`Seq Scan` (전체 훑기) 이 나오면 인덱스가 안 쓰이는 것, `Index Scan` 이면 쓰이는 것이다.

실행 계획(query plan)은 DB 가 "이 SQL 을 어떤 순서와 방법으로 처리하겠다"고 세운 계획표다. 같은 결과를 내는 방법이 여러 개라서 DB 의 플래너(planner)가 통계를 보고 가장 싸 보이는 것을 고른다.
`EXPLAIN` 은 계획만 보여 주고 `EXPLAIN ANALYZE` 는 쿼리를 실제로 실행한 뒤 걸린 시간까지 붙여 준다.

인덱스가 없을 때와 있을 때의 출력은 대략 이렇다. (숫자는 예시)

```
-- 인덱스 없음
Seq Scan on pets  (cost=0.00..21846.00 rows=3 width=72) (actual time=0.015..95.210 rows=3 loops=1)
  Filter: ((tenant_id = '...'::uuid) AND (status = 'active'::text))
  Rows Removed by Filter: 999997
Execution Time: 95.300 ms

-- (tenant_id, status) 인덱스 있음
Index Scan using ix_pets_tenant_status on pets  (cost=0.42..8.45 rows=3 width=72) (actual time=0.031..0.036 rows=3 loops=1)
  Index Cond: ((tenant_id = '...'::uuid) AND (status = 'active'::text))
Execution Time: 0.060 ms
```

읽는 법은 이 정도면 충분하다.

| 항목 | 뜻 | 볼 점 |
| --- | --- | --- |
| `Seq Scan` | 테이블 전체를 처음부터 끝까지 읽음 | 큰 테이블에서 나오면 의심 |
| `Index Scan` | 인덱스로 위치를 찾고 테이블에서 행을 꺼냄 | 대부분 원하는 결과 |
| `Index Only Scan` | 인덱스만 읽고 끝남 | 가장 좋음 (커버링 인덱스) |
| `Bitmap Heap Scan` | 인덱스로 후보 위치를 모은 뒤 테이블을 한꺼번에 읽음 | 걸리는 행이 중간 정도로 많을 때. 정상 |
| `cost=0.42..8.45` | 플래너가 추정한 비용(단위 없음). 앞은 첫 행까지, 뒤는 전체 | 절댓값보다 다른 계획과 비교할 때 본다 |
| `rows=3` (앞 괄호) | 플래너가 예상한 행 수 | |
| `actual ... rows=3` | 실제로 나온 행 수 | 예상과 10배 이상 차이 나면 통계가 낡았을 수 있다 |
| `Rows Removed by Filter` | 읽었다가 버린 행 수 | 크면 인덱스가 필요하다는 신호 |

몇 가지 주의할 점.

- **작은 테이블에서는 `Seq Scan` 이 정상이다.** 행이 수백 개뿐이면 인덱스를 거치는 것보다 그냥 다 읽는 게 싸다. 조건에 걸리는 행이 테이블의 상당 부분일 때도 플래너는 일부러 `Seq Scan` 을 고른다. 로컬 DB 에 데이터 20건을 넣고 실행 계획을 보면 판단이 틀린다.
- **`EXPLAIN ANALYZE` 는 쿼리를 진짜로 실행한다.** `UPDATE`·`DELETE` 를 분석할 때는 `BEGIN; EXPLAIN ANALYZE ...; ROLLBACK;` 으로 감싸야 데이터가 안 바뀐다.
- 더 자세히 보려면 `EXPLAIN (ANALYZE, BUFFERS)` 를 쓴다. `Buffers: shared hit=4 read=120` 은 메모리에서 4페이지, 디스크에서 120페이지를 읽었다는 뜻이다. 디스크 읽기가 많을수록 느리다.
- 예상 행 수와 실제가 크게 어긋나면 DB 가 들고 있는 통계가 낡은 것이다. PostgreSQL 은 autovacuum 이 알아서 `ANALYZE`(통계 갱신)를 돌리지만 대량으로 데이터를 넣은 직후에는 `ANALYZE pets;` 를 직접 실행해야 할 때도 있다.

### 어떤 쿼리가 느린지 먼저 찾기

실행 계획은 "이 쿼리가 왜 느린가"에 답한다. "어떤 쿼리가 느린가"는 PostgreSQL 의 `pg_stat_statements` 확장이 모아 준다.

```sql
-- 총 소요 시간이 큰 순서. "자주 불리는데 조금 느린" 쿼리가 위로 올라온다 (PostgreSQL 13+ 컬럼명)
SELECT query, calls, mean_exec_time, total_exec_time
FROM pg_stat_statements
ORDER BY total_exec_time DESC
LIMIT 10;

-- 한 번도 안 쓰인 인덱스. 쓰기만 느리게 하는 중이다
SELECT relname, indexrelname, idx_scan
FROM pg_stat_user_indexes
WHERE idx_scan = 0;
```

평균 2초짜리 쿼리 하나보다 평균 20ms 인데 1분에 3만 번 불리는 쿼리가 DB 를 더 괴롭힌다. 그래서 `total_exec_time` 순으로 본다.
안 쓰이는 인덱스는 바로 지우지 말고 통계가 쌓인 기간(재시작 이후 얼마나 됐나)과 읽기 복제본에서 쓰이는지를 먼저 확인한다.

> ❓ 입사 후 확인: 운영 DB 에 `pg_stat_statements` 가 켜져 있나? 느린 쿼리는 어디서 보나? (Azure Portal 의 Query Performance Insight, Application Insights 의 의존성 추적 등)

---

## 2. 트랜잭션

트랜잭션은 여러 개의 읽기·쓰기를 하나의 단위로 묶는 장치다. 묶인 작업은 끝에 **커밋(commit)** 하면 한꺼번에 확정되고,
중간에 문제가 생겨 **롤백(rollback)** 하면 시작 전 상태로 전부 되돌아간다.

참고로 EF Core 의 `SaveChangesAsync()` 한 번은 그 자체로 트랜잭션 하나다. 쌓인 INSERT·UPDATE 가 전부 들어가거나 전부 안 들어간다.
명시적으로 트랜잭션을 여는 건 `SaveChangesAsync()` 를 여러 번 불러야 하는데 그걸 하나로 묶고 싶을 때다. (`02-csharp-dotnet/03-ef-core.md` 6절)

### ACID — 실무에서 의미 있는 것만

- **A(원자성)** — 전부 되거나 전부 안 되거나. 계좌 이체에서 출금만 되고 입금이 안 되는 상태가 없다
- **C(일관성)** — 제약조건(FK, UNIQUE, CHECK)이 깨진 상태로 커밋되지 않는다
- **I(격리성)** — 동시에 도는 트랜잭션끼리 서로를 얼마나 보나. ← **여기가 실무 이슈**
- **D(지속성)** — 커밋됐으면 서버가 죽어도 남는다

제약조건은 DB 가 직접 지키는 규칙이다. FK 는 "없는 보호자를 가리키는 펫은 못 만든다", UNIQUE 는 "같은 이메일 두 번 금지", CHECK 는 `CHECK (weight > 0)` 같은 값 조건이다.
앱 코드에 버그가 있어도 DB 가 마지막으로 막아 준다.

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

격리 수준은 "다른 트랜잭션이 하는 일을 내 트랜잭션에서 얼마나 차단할지"를 고르는 설정이다.
Read Committed 에서 Non-repeatable Read 가 어떻게 생기는지 시간 순서로 보면 이렇다.

| 시점 | 트랜잭션 A (청구서 계산) | 트랜잭션 B (가격 수정) |
| --- | --- | --- |
| t1 | 진료비 조회 → 30,000원 | |
| t2 | | 진료비를 35,000원으로 바꾸고 커밋 |
| t3 | 같은 진료비 다시 조회 → 35,000원 | |

A 는 한 트랜잭션 안에서 같은 값을 두 번 읽었는데 결과가 다르다. 대부분의 API 는 한 번 읽고 끝나서 문제가 안 되지만,
"읽은 값으로 계산해서 다시 쓰는" 코드라면 영향을 받는다.

대부분 **Read Committed** 로 충분하다. 올릴수록 정확하지만 락 경합이 늘어 느려진다.
락은 "이 행은 내가 쓰는 중이니 기다려라"라는 DB 의 표시다. 락 경합은 여러 트랜잭션이 같은 행의 락을 기다리느라 줄을 서는 상황이다.
PostgreSQL 에서 Serializable 을 쓰면 충돌하는 트랜잭션 중 하나가 `could not serialize access`(SQLSTATE `40001`) 오류로 실패한다. 이 오류는 버그가 아니라 "다시 해라"라는 신호라서 재시도 코드가 함께 있어야 한다.

> ❓ 입사 후 확인: MSSQL 쪽 DB 는 `READ_COMMITTED_SNAPSHOT` 이 켜져 있나? SQL Server 도 기본은 Read Committed 지만 이 옵션에 따라 읽기가 쓰기 락을 기다리는지가 달라진다.

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

`catch` 에서 롤백한 뒤 `throw;` 로 예외를 다시 던진다. 삼키면 호출한 쪽은 실패한 줄 모르고 200 을 돌려준다.

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

2단계로 나누면 이런 모양이다.

```csharp
order.Status = OrderStatus.Pending;
await _db.SaveChangesAsync();                         // ① 짧은 트랜잭션: 주문을 "결제 대기"로 저장

var result = await _payment.ChargeAsync(order, ct);   // ② 트랜잭션 밖: 10초가 걸려도 DB 는 안 잡혀 있다

order.Status = result.Ok ? OrderStatus.Paid : OrderStatus.PaymentFailed;
await _db.SaveChangesAsync();                         // ③ 짧은 트랜잭션: 결과 반영
```

②에서 서버가 죽으면 주문은 `Pending` 으로 남는다. 그래서 "오래된 Pending 을 찾아 결제사에 상태를 다시 묻는" 정리 작업이 짝으로 필요하다. 결제사 API 가 Idempotency-Key 를 받는다면 재시도도 안전해진다.

### 낙관적 동시성 — 동시 수정 충돌

두 사람이 같은 차트를 동시에 열어 각자 저장하면 나중 저장이 앞의 것을 덮어쓴다 (lost update).

| 시점 | 수의사 A | 수의사 B | DB 의 메모 |
| --- | --- | --- | --- |
| t1 | 차트 열기: "기침" | | 기침 |
| t2 | | 차트 열기: "기침" | 기침 |
| t3 | "기침, 열 39도" 저장 | | 기침, 열 39도 |
| t4 | | "기침, 항생제 처방" 저장 | 기침, 항생제 처방 ← A 의 기록이 사라짐 |

대응은 두 가지다. **비관적** 방식은 읽을 때부터 락을 걸어 남이 못 고치게 한다(`SELECT ... FOR UPDATE`). 확실하지만 사람이 화면을 열어 둔 몇 분 동안 락을 쥘 수는 없다.
**낙관적** 방식은 "충돌은 드물다"고 보고 락 없이 진행하다가, 저장하는 순간에 "그사이 누가 바꿨나"를 확인한다. 웹 화면의 동시 수정에는 거의 항상 낙관적 방식을 쓴다.

```csharp
public class Pet
{
    [Timestamp]                       // 또는 EF Core: .IsRowVersion()
    public byte[] RowVersion { get; set; }
}
```

위 코드는 SQL Server 의 `rowversion` 컬럼 모양이다. PostgreSQL(Npgsql)에서는 행이 바뀔 때마다 자동으로 바뀌는 시스템 컬럼 `xmin` 을 버전으로 쓰고,
`public uint Version { get; set; }` 에 `[Timestamp]` 나 `.IsRowVersion()` 을 붙인다. (`02-csharp-dotnet/03-ef-core.md` 6절)

읽을 때의 버전값을 UPDATE 조건에 포함시켜서, 그 사이에 바뀌었으면 0행이 갱신되고 예외가 난다
(`DbUpdateConcurrencyException`). 그때 사용자에게 "다른 사람이 수정했습니다" 를 보여준다.

EF Core 가 실제로 보내는 SQL 은 이런 모양이다.

```sql
UPDATE pets SET memo = '기침, 항생제 처방'
WHERE id = '...' AND xmin = 1234;      -- B 가 차트를 열 때 읽은 버전
-- A 가 t3 에 저장하면서 버전이 이미 1235 로 바뀌었다 → 0행 갱신 → 예외
```

**프론트에서 해야 할 일:** 이 예외를 409 로 받아서 그냥 "저장 실패"가 아니라
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

N+1 은 "목록 1번 + 항목마다 1번씩 N번"으로 쿼리가 불어나는 패턴이다. 프론트로 치면 목록 API 를 한 번 부르고 받은 항목마다 `useQuery` 로 상세 API 를 따로 부르는 것과 같다.

위 코드가 쿼리를 100번 보내는 건 lazy loading(지연 로딩)이 켜져 있을 때다. lazy loading 은 `pet.Owner` 에 처음 접근하는 순간 EF Core 가 몰래 쿼리를 보내 채워 주는 기능인데, EF Core 에서는 기본으로 꺼져 있다.
꺼져 있으면 `pet.Owner` 는 `null` 이고 위 코드는 `NullReferenceException` 으로 터진다. 실무 코드에서 더 흔한 N+1 은 이렇게 눈에 보이는 모양이다.

```csharp
foreach (var pet in pets)
{
    var owner = await _db.Owners.FirstAsync(o => o.Id == pet.OwnerId);   // 루프 안의 await = 쿼리 N번
}
```

**루프 안에 `await _db...` 가 있으면 일단 N+1 을 의심한다.** 서비스 메서드를 루프 안에서 부르는데 그 메서드가 안에서 DB 를 조회하는 경우도 같다. 이쪽은 코드만 봐서는 안 보여서 더 위험하다.

### 해결

```csharp
// ✅ Eager loading — JOIN 한 번으로
var pets = await _db.Pets.Include(p => p.Owner).ToListAsync();

// ✅ 더 나은 방법 — 필요한 컬럼만 골라서 DTO 로 (Projection)
var pets = await _db.Pets
    .Select(p => new PetDto(p.Id, p.Name, p.Owner.Name))
    .ToListAsync();
```

Eager loading 은 "관련 데이터를 처음부터 같이 가져온다"는 뜻이다. lazy loading 의 반대말이다.

**Projection 이 더 나은 이유:** `Include` 는 Owner 의 모든 컬럼을 가져오고 엔티티를 추적(tracking)한다.
`Select` 로 DTO 를 만들면 필요한 컬럼만 SELECT 하고 추적도 안 한다.

| | `Include(p => p.Owner)` | `Select(p => new PetDto(...))` |
| --- | --- | --- |
| 쿼리 수 | 1 | 1 |
| 가져오는 컬럼 | pets 전체 + owners 전체 | `id`, `name`, `owner.name` 3개 |
| 변경 추적 | 함 (`AsNoTracking()` 을 따로 붙여야 꺼짐) | 안 함 (엔티티가 아니라서) |
| 쓰는 곳 | 가져와서 수정·저장할 때 | 화면에 보여 줄 목록·상세 |

`Include` 를 컬렉션 여러 개에 걸면 JOIN 결과가 곱으로 불어나는 문제가 따로 있다(카테시안 폭발). 실제 SQL 로그를 보며 N+1 을 잡는 방법과 함께 `02-csharp-dotnet/03-ef-core.md` 4절에서 다룬다.

### 읽기 전용이면 추적을 끈다

```csharp
var pets = await _db.Pets.AsNoTracking().ToListAsync();
```

EF Core 는 기본적으로 가져온 엔티티를 전부 기억해 두고 (change tracking) 변경을 감지한다.
목록 조회처럼 수정할 일이 없으면 이건 순수한 낭비다. **목록 API 에는 거의 항상 `AsNoTracking()`.**

변경 추적(change tracking)은 "가져올 때의 값 복사본을 따로 들고 있다가 `SaveChanges` 때 비교해서 바뀐 것만 UPDATE 하는" 기능이다.
그래서 `pet.Name = "루비"; await _db.SaveChangesAsync();` 만으로 UPDATE 가 나간다. 편한 대신 행마다 복사본을 하나씩 더 들고 있어야 한다.

> 프론트로 치면 TanStack Query 에서 안 쓸 데이터를 캐시에 쌓아두는 것과 비슷하다.

### 지연 실행 — LINQ 는 언제 실행되나

```csharp
var q = _db.Pets.Where(p => p.TenantId == t);   // 아직 SQL 안 나감
q = q.Where(p => p.Status == "active");         // 아직
var list = await q.ToListAsync();               // ← 여기서 한 번에 나감
```

`ToListAsync()`, `FirstAsync()`, `CountAsync()`, `AnyAsync()` 가 실행 트리거다.
**`IQueryable` 인 동안은 조건을 계속 붙일 수 있다** — 동적 필터를 만들 때 유용하다.

이렇게 SQL 실행을 결과가 정말 필요한 순간까지 미루는 것을 지연 실행이라고 한다.
`IQueryable<T>` 는 "아직 실행하지 않은 쿼리 설계도"다. Knex 나 Drizzle 의 쿼리 빌더에 `.where()` 를 계속 이어 붙이다가 마지막에 `await` 해야 실행되는 것과 같다.
반면 `IEnumerable<T>` 는 이미 메모리에 올라온(또는 하나씩 꺼내 쓰는) 컬렉션이다. JS 배열의 `.filter()` 에 가깝다.

반대의 함정:

```csharp
var pets = _db.Pets.ToList().Where(p => p.Age > 3);   // ❌ 전부 메모리로 가져온 뒤 C# 에서 필터
var pets = _db.Pets.Where(p => p.Age > 3).ToList();   // ✅ DB 에서 필터
```

`ToList()` 를 어디에 찍느냐로 SQL 이 완전히 달라진다. **`IEnumerable` 로 바뀌는 순간 메모리 필터링이다.**

| 코드 | 나가는 SQL | 10만 행 테이블에서 앱으로 오는 행 |
| --- | --- | --- |
| `_db.Pets.ToList().Where(p => p.Age > 3)` | `SELECT * FROM pets` | 100,000 |
| `_db.Pets.Where(p => p.Age > 3).ToList()` | `SELECT * FROM pets WHERE age > 3` | 조건에 맞는 것만 |
| `_db.Pets.ToList().Count` | `SELECT * FROM pets` | 100,000 (세려고 다 가져옴) |
| `await _db.Pets.CountAsync()` | `SELECT COUNT(*) FROM pets` | 숫자 하나 |
| `await _db.Pets.AnyAsync(p => p.Age > 3)` | `SELECT EXISTS (...)` | 참/거짓 하나 |

메서드 시그니처에서도 같은 일이 생긴다. 리포지토리가 `IEnumerable<Pet>` 을 반환하면 서비스에서 붙인 `.Where()` 는 전부 메모리에서 돈다. 조건을 리포지토리 안에서 다 붙이고 결과만 `List` 로 돌려주는 편이 안전하다.

---

## 4. 커넥션 풀

DB 커넥션을 새로 여는 건 비싸다(TCP + 인증). 그래서 앱은 커넥션을 미리 몇 개 열어두고 돌려 쓴다.

커넥션은 앱과 DB 사이에 열어 둔 통신 회선 하나다. 하나 여는 데 네트워크 왕복과 로그인이 필요해서 수 ms 에서 수십 ms 가 든다. 쿼리 자체(1ms)보다 비쌀 때가 많다.
커넥션 풀은 이 회선을 미리 열어 두고 쿼리할 때 빌렸다가 끝나면 반납하는 대여소다. 도서관 열람석과 비슷하다. 자리가 다 차면 누가 일어날 때까지 기다린다.

```
Max Pool Size=100   ← Npgsql 기본값
```

Npgsql 은 .NET 의 PostgreSQL 드라이버다. 풀 설정은 연결 문자열에 들어간다(`Host=...;Max Pool Size=100`).
100개가 전부 빌려진 상태에서 101번째 요청은 빈자리를 기다리다가, 정해진 시간 안에 자리가 안 나면 아래 에러로 실패한다.

**풀이 마르는 시나리오:**
- 트랜잭션 안에서 외부 API 호출 (위 참조)
- `DbContext` 를 Dispose 안 함 → Scoped 로 등록하면 자동 해결
- 동기 코드(`.Result`)로 스레드가 묶여서 커넥션 반납이 지연됨

계산해 보면 금방 보인다. 커넥션 하나를 10초 붙드는 요청이 초당 10건 들어오면 동시에 필요한 커넥션은 100개다. 풀이 거기서 끝난다.
같은 요청이 커넥션을 50ms 만 쓰면 초당 10건이어도 동시에 1개 남짓이면 된다. 풀 크기를 늘리기 전에 "누가 왜 오래 붙드나"를 먼저 본다.

증상은 `Timeout expired. The timeout period elapsed prior to obtaining a connection from the pool.`
**이 에러 메시지를 보면 커넥션 누수를 의심해라.**

이름이 비슷해서 헷갈리는 것이 하나 있다. `AddDbContextPool` 은 커넥션 풀이 아니라 `DbContext` **객체**를 재사용하는 풀이다. 객체 생성 비용을 아끼는 최적화일 뿐이고 DB 커넥션 수와는 별개다.

서버를 여러 대로 늘리면 "서버 수 × 풀 크기"가 DB 의 최대 커넥션 수를 넘을 수 있다. 이 계산은 `07-db-infra/05-infra.md` 7절에서 다룬다.

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

Offset 방식은 "앞에서 N개 건너뛰고 20개"다(`OFFSET 10000 LIMIT 20`). 건너뛸 행도 일단 읽어야 하므로 페이지가 뒤로 갈수록 느려진다.
Keyset 방식은 "마지막으로 본 값보다 큰 것 20개"다. 인덱스에서 그 값의 위치로 바로 가서 20개만 읽으니 몇 페이지째든 비용이 같다.

| 페이지 | Offset 이 읽는 행 | Keyset 이 읽는 행 |
| --- | --- | --- |
| 1 | 20 | 20 |
| 50 | 1,000 | 20 |
| 500 | 10,000 | 20 |

Offset 은 또 하나의 문제가 있다: 1페이지를 보는 동안 새 데이터가 들어오면 **2페이지에서 항목이 중복되거나 누락된다.**
무한 스크롤에는 keyset 이 맞다. (프론트에서 `useInfiniteQuery` 의 `cursor` 가 바로 이것)

최신순 목록에서 새 글 3개가 들어오면 기존 글이 전부 3칸씩 뒤로 밀린다. 그러면 1페이지 끝에 있던 3개가 2페이지 앞에 다시 나온다. Keyset 은 "이 글보다 오래된 것"을 기준으로 하므로 앞에 뭐가 끼어들어도 경계가 그대로다.

### 정렬 기준이 유일하지 않을 때

실제 목록은 `Id` 가 아니라 `CreatedAt` 최신순인 경우가 많다. 그런데 `CreatedAt` 은 같은 값이 여러 개일 수 있어서 그것만으로는 경계가 모호하다.
그래서 `(CreatedAt, Id)` 두 개를 같이 커서로 쓴다. `Id` 가 동점일 때 순서를 확정하는 타이브레이커다.

```csharp
// 다음 페이지: 마지막으로 본 (createdAt, id) 보다 "더 오래된" 것
_db.Pets
    .Where(p => p.TenantId == t)
    .Where(p => p.CreatedAt < lastCreatedAt
             || (p.CreatedAt == lastCreatedAt && p.Id < lastId))
    .OrderByDescending(p => p.CreatedAt).ThenByDescending(p => p.Id)
    .Take(20)
```

```sql
-- PostgreSQL 에서는 행 값 비교로 같은 조건을 짧게 쓸 수 있다
WHERE tenant_id = $1 AND (created_at, id) < ($2, $3)
ORDER BY created_at DESC, id DESC
LIMIT 20;
-- 이 쿼리를 받쳐 줄 인덱스: (tenant_id, created_at, id)
```

API 응답에는 `nextCursor` 로 마지막 행의 `(createdAt, id)` 를 base64 같은 불투명한 문자열로 감싸 내려 준다. 프론트는 그 값을 해석하지 않고 다음 요청에 그대로 돌려보내기만 한다.

Keyset 에도 약점이 있다. "37페이지로 바로 가기"가 안 되고 전체 개수도 따로 세야 한다. 그래서 페이지 번호가 필요한 관리자 표에는 offset 이, 무한 스크롤이나 대량 데이터에는 keyset 이 맞다.
Offset 을 쓸 때도 `OrderBy` 에 타이브레이커를 넣어야 한다는 점은 같다(`02-csharp-dotnet/03-ef-core.md` 2절 페이지네이션).

---

## 6. 관계형 vs 문서형 — 언제 뭘 쓰나

| | 관계형 (PostgreSQL, MSSQL) | 문서형 (MongoDB) |
| --- | --- | --- |
| 강점 | 조인, 제약조건, 트랜잭션, 정확성 | 스키마 유연성, 중첩 구조 저장 |
| 약할 때 | 스키마가 자주 바뀌는 반정형 데이터 | 여러 컬렉션에 걸친 일관성 |
| 쓰는 곳 | 사용자·권한·주문·결제 — **틀리면 안 되는 것** | 로그, 대화 이력, 크롤링 원문, 스키마가 제각각인 고객사 데이터 |

관계형 DB 는 데이터를 미리 정한 컬럼 구조(스키마)의 표에 나눠 담고 키로 잇는다. 문서형 DB 는 JSON 같은 문서 하나에 중첩 구조째로 통째로 담는다.
반정형 데이터는 "대략 비슷하지만 필드가 문서마다 조금씩 다른" 데이터다. 고객사마다 다른 형식의 문서 메타데이터가 전형적이다.

랭코드 스택에 **PostgreSQL + MongoDB + Vector DB + MSSQL** 이 다 있는 건
"고객사 시스템이 제각각"이라는 제품 성격 때문일 가능성이 높다.
회사 스택 표 기준으로 저장소마다 왜 골랐고 무엇을 어디에 두는지는 `07-db-infra/07-our-stack.md` 에서 다룬다.

> 참고: PostgreSQL 의 `jsonb` 는 문서형의 상당 부분을 대체한다. 인덱스(GIN)도 걸린다.
> "반정형이니까 무조건 Mongo" 는 옛날 이야기다.

`jsonb` 는 JSON 을 파싱된 이진 형태로 저장하는 PostgreSQL 컬럼 타입이다. `metadata->>'source' = 'sharepoint'` 처럼 안쪽 필드로 조회할 수 있다.
GIN 은 "이 키·값을 포함한 행이 어디 있나"를 빨리 찾는 인덱스 종류로, `jsonb` 나 배열, 전문 검색에 쓴다. 일반 컬럼에 쓰는 B-Tree 와는 용도가 다르다.

---

## 7. 마이그레이션

스키마 변경을 코드로 버전 관리하는 것. EF Core 는 이렇게 한다.

```bash
dotnet ef migrations add AddPetStatus      # 변경분을 C# 코드로 생성
dotnet ef database update                  # 적용
```

스키마는 "어떤 테이블에 어떤 컬럼이 어떤 타입으로 있나"라는 DB 의 구조 정의다.
마이그레이션 파일 하나는 "이전 버전에서 이번 버전으로 가는 변경 한 단계"이고 Git 커밋처럼 순서대로 쌓인다. DB 는 어디까지 적용했는지를 `__EFMigrationsHistory` 테이블에 기록한다.
운영 DB 에는 `database update` 를 직접 돌리기보다 `dotnet ef migrations script --idempotent` 로 SQL 파일을 뽑아 검토한 뒤 적용하는 팀이 많다. `--idempotent` 는 "이미 적용된 단계는 건너뛰는" SQL 을 만든다.

**운영에서 주의할 것:**
- 컬럼 삭제·이름 변경은 배포 중 순간에 구버전 앱이 죽는다 → **확장/수축 패턴**
  (① 새 컬럼 추가 → ② 양쪽에 쓰기 → ③ 읽기를 새 컬럼으로 → ④ 구 컬럼 삭제)
- 큰 테이블에 인덱스 추가는 락을 건다 → PostgreSQL 은 `CREATE INDEX CONCURRENTLY`
- 마이그레이션은 되돌릴 수 있게 작성하되, **데이터를 지우는 마이그레이션은 되돌릴 수 없다**

확장/수축이 왜 필요한지는 배포 순간을 떠올리면 보인다. 서버 여러 대를 순서대로 바꾸는 동안에는 구버전 앱과 신버전 앱이 같은 DB 를 동시에 쓴다.
`name` 컬럼을 `full_name` 으로 한 번에 바꾸면 아직 안 바뀐 구버전 서버가 `name` 을 찾다가 500 을 낸다. 네 단계로 나누면 어느 순간에도 두 버전이 다 동작한다.

| 단계 | 배포 내용 | 구버전 앱 | 신버전 앱 |
| --- | --- | --- | --- |
| ① 확장 | `full_name` 컬럼 추가 (NULL 허용) | `name` 만 씀. 문제없음 | |
| ② | 앱이 `name`, `full_name` 둘 다 씀. 기존 행은 일괄 복사 | | 양쪽에 씀 |
| ③ | 앱이 `full_name` 에서 읽음 | | `full_name` 읽음 |
| ④ 수축 | 구버전이 다 사라진 뒤 `name` 삭제 | (없음) | 문제없음 |

`CREATE INDEX CONCURRENTLY` 는 테이블 쓰기를 막지 않고 인덱스를 만드는 대신, 트랜잭션 안에서는 실행할 수 없다. EF Core 는 마이그레이션을 트랜잭션으로 감싸므로
`migrationBuilder.Sql("CREATE INDEX CONCURRENTLY ...", suppressTransaction: true)` 처럼 트랜잭션 밖에서 돌게 지정해야 한다. 배포와 마이그레이션의 순서는 `07-db-infra/05-infra.md` 6절에서 이어진다.

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
7. `WHERE tenant_id = X AND created_at > '2026-09-01'` 을 자주 쓴다. `(tenant_id, created_at)` 과 `(created_at, tenant_id)` 중 어느 인덱스가 맞나? 왜?
8. 로컬 DB 에서 `EXPLAIN` 을 했더니 인덱스가 있는데도 `Seq Scan` 이 나왔다. 반드시 문제인가?
9. 두 사람이 같은 차트를 동시에 저장했다. 낙관적 동시성이 없으면 무슨 일이 생기고 있으면 어떻게 되나?
10. `name` 컬럼을 `full_name` 으로 바꾸는 마이그레이션을 한 번에 배포하면 무엇이 깨지나?
