# 관계형 DB 기초

`01-backend-basics/03-database.md` 는 인덱스부터 시작한다. 이 문서는 그 앞 — **테이블이 무엇이고, 테이블끼리 어떻게 이어지며, SQL 이 어떤 순서로 실행되는가.**
EF Core 가 SQL 을 대신 써 주더라도, 로그에 찍힌 SQL 을 읽을 수 없으면 디버깅이 안 된다.

---

## 1. 테이블 · 행 · 컬럼

TS 로 치면 **테이블 = 타입이 고정된 객체 배열**이다.

```ts
type Pet = { id: string; name: string; ownerId: string; status: "active" | "adopted" };
const pets: Pet[] = [...];      // ← 이게 테이블
```

```sql
CREATE TABLE pets (
  id        uuid PRIMARY KEY,
  name      text NOT NULL,
  owner_id  uuid NOT NULL REFERENCES owners(id),
  status    text NOT NULL CHECK (status IN ('active', 'adopted'))
);
```

| 용어 | TS 대응 | 차이 |
| --- | --- | --- |
| 테이블 | `Pet[]` | 디스크에 있고, 수백만 행이어도 일부만 읽을 수 있다 |
| 행 (row) | 배열 원소 하나 | |
| 컬럼 | 프로퍼티 | **타입을 DB 가 강제한다.** 런타임에 어긋나는 값은 들어가지도 않는다 |
| 스키마 | `type Pet` | 바꾸려면 마이그레이션이 필요하다 (`01/03` 7절) |

TS 의 타입은 컴파일이 끝나면 사라지지만, **DB 스키마는 운영 중에도 계속 값을 검사한다.** 이게 가장 큰 차이다.

---

## 2. 키 — 행을 가리키는 방법

### 기본 키 (Primary Key)

행 하나를 유일하게 가리키는 컬럼. **절대 중복되지 않고, NULL 이 될 수 없다.**

| 방식 | 예 | 장점 | 단점 |
| --- | --- | --- | --- |
| 자동 증가 정수 | `1, 2, 3 ...` | 작고 빠르다 | URL 에 노출하면 전체 개수·다음 ID 가 추측된다. 여러 DB 를 합칠 때 충돌 |
| UUID v4 (랜덤) | `3f2a...` | 어디서 만들어도 안 겹친다 | 순서가 없어 **인덱스 끝이 아니라 중간에 계속 끼어든다** → 삽입이 느려지고 단편화 |
| **UUID v7 (시간순)** | `0192...` | 안 겹치면서 시간 순서로 증가 | 생성 시각이 ID 에 드러난다 |

.NET 9 에는 `Guid.CreateVersion7()` 이 있다. 새로 만드는 테이블이면 v7 이 무난한 기본값이다.
특히 **SQL Server 는 기본 키가 곧 행의 물리적 정렬 순서**(클러스터드 인덱스)라서, 랜덤 UUID 를 기본 키로 쓰면 삽입마다 페이지를 쪼갠다.

> ❓ 입사 후 확인: 회사 테이블의 PK 는 int 인가 Guid 인가? Guid 라면 어떻게 생성하나?

### 외래 키 (Foreign Key) — 테이블끼리 잇는 선

```sql
owner_id uuid NOT NULL REFERENCES owners(id)
```

"`pets.owner_id` 에는 **`owners` 에 실제로 있는 id 만** 들어갈 수 있다"는 약속이다.
없는 보호자를 가리키는 펫(고아 행)이 DB 수준에서 불가능해진다.

**보호자를 지우면 그 보호자의 펫은?** 이걸 미리 정해야 한다.

| 옵션 | 동작 | 쓰는 곳 |
| --- | --- | --- |
| `ON DELETE RESTRICT` (기본) | 펫이 있으면 보호자 삭제 자체가 실패 | 실수로 지우면 안 되는 것 |
| `ON DELETE CASCADE` | 보호자를 지우면 펫도 같이 삭제 | 부모 없이는 의미 없는 자식 (주문 → 주문 항목) |
| `ON DELETE SET NULL` | 펫의 `owner_id` 를 NULL 로 | 관계만 끊고 자식은 남길 때 |

**EF Core 는 필수 관계(`NOT NULL` FK)에 기본으로 CASCADE 를 건다.**
마이그레이션 파일에서 `onDelete: ReferentialAction.Cascade` 를 보면, "이걸 지우면 무엇이 같이 사라지나"를 한 번 확인하는 습관을 들인다.

---

## 3. 관계 세 가지

| 관계 | 예 | 테이블로 표현하면 |
| --- | --- | --- |
| **1 : N** | 보호자 1명 — 펫 여러 마리 | **N 쪽**(`pets`)에 FK(`owner_id`)를 둔다 |
| **1 : 1** | 사용자 — 사용자 설정 | 한쪽에 FK + `UNIQUE` |
| **N : M** | 펫 — 예방접종 (한 펫이 여러 접종, 한 접종을 여러 펫이) | **중간 테이블**을 만든다 |

N : M 은 컬럼 하나로 표현할 수 없다. 배열 컬럼에 넣고 싶어지는데, 그러면 FK 검사도, 인덱스도, JOIN 도 안 된다.

```sql
CREATE TABLE pet_vaccinations (
  pet_id         uuid REFERENCES pets(id) ON DELETE CASCADE,
  vaccination_id uuid REFERENCES vaccinations(id),
  given_at       date NOT NULL,              -- 관계 자체에 붙는 정보는 여기에
  PRIMARY KEY (pet_id, vaccination_id)
);
```

중간 테이블에는 **관계 자체의 정보**(접종일, 담당 수의사)가 자연스럽게 들어간다.
RAG 문서의 `acl_groups` 를 배열 컬럼으로 둔 것(`03-rag/02` 7절)은 조회 속도를 위해 일부러 이 원칙을 깬 예다. 원칙을 알고 깨는 것과 모르고 깨는 것은 다르다.

---

## 4. JOIN — 이어진 테이블을 같이 읽기

예시 데이터:

```
owners                      pets
id | name                   id | name  | owner_id
---+------                  ---+-------+---------
o1 | 김민수                  p1 | 초코  | o1
o2 | 이지은                  p2 | 보리  | o1
o3 | 박서준                  p3 | 콩이  | o2
```

### INNER JOIN — 양쪽에 다 있는 것만

```sql
SELECT o.name AS owner, p.name AS pet
FROM owners o
JOIN pets p ON p.owner_id = o.id;
```

```
owner  | pet
-------+-----
김민수 | 초코
김민수 | 보리
이지은 | 콩이
```

**박서준이 없다.** 펫이 없으니 짝지을 행이 없어서다.

### LEFT JOIN — 왼쪽은 전부, 짝이 없으면 NULL

```sql
SELECT o.name AS owner, p.name AS pet
FROM owners o
LEFT JOIN pets p ON p.owner_id = o.id;
```

```
owner  | pet
-------+------
김민수 | 초코
김민수 | 보리
이지은 | 콩이
박서준 | NULL     ← 펫이 없는 보호자도 나온다
```

**"전체 보호자 목록 + 펫 수"** 같은 화면은 LEFT JOIN 이어야 한다. INNER 로 쓰면 펫 없는 보호자가 목록에서 조용히 사라진다.
버그 리포트가 "가끔 목록에서 사람이 빠져요"라면 제일 먼저 의심할 곳이다.

### JOIN 하면 행이 불어난다

김민수가 **두 번** 나왔다. 1 : N 을 JOIN 하면 1 쪽이 N 번 복제된다.
JOIN 을 두 개(펫 3마리 × 접종 5건) 붙이면 한 사람이 15행이 된다. 이게 `02-csharp-dotnet/03-ef-core.md` 의 **카테시안 폭발**이다.

### EF Core 에서는

```csharp
_db.Owners.Select(o => new { o.Name, PetCount = o.Pets.Count() })
// → LEFT JOIN 또는 서브쿼리로 번역된다. 펫 없는 보호자도 PetCount = 0 으로 나온다
```

내비게이션 프로퍼티(`o.Pets`)를 따라가면 EF Core 가 JOIN 을 만들어 준다. 그래도 **어떤 JOIN 이 나가는지는 로그로 확인한다.**

---

## 5. SQL 은 쓴 순서대로 실행되지 않는다

```sql
SELECT   o.name, COUNT(*) AS pet_count     -- ⑤
FROM     owners o                          -- ①
JOIN     pets p ON p.owner_id = o.id       -- ①
WHERE    p.status = 'active'               -- ②
GROUP BY o.name                            -- ③
HAVING   COUNT(*) >= 2                     -- ④
ORDER BY pet_count DESC                    -- ⑥
LIMIT    10;                               -- ⑦
```

| 순서 | 절 | 하는 일 |
| ---: | --- | --- |
| ① | `FROM` / `JOIN` | 테이블을 이어 붙여 큰 표를 만든다 |
| ② | `WHERE` | **행**을 거른다 (그룹 만들기 전) |
| ③ | `GROUP BY` | 같은 값끼리 묶는다 |
| ④ | `HAVING` | **그룹**을 거른다 (집계 결과로) |
| ⑤ | `SELECT` | 보여줄 컬럼을 고르고 계산한다 |
| ⑥ | `ORDER BY` | 정렬 |
| ⑦ | `LIMIT` | 잘라낸다 |

이 순서를 알면 흔한 에러가 전부 설명된다.

- **`WHERE pet_count >= 2` 가 에러인 이유** — `pet_count` 는 ⑤에서 생기는데 `WHERE` 는 ②다. 집계로 거르려면 `HAVING`
- **`WHERE` 와 `HAVING` 의 차이** — 행을 거르나, 그룹을 거르나
- **`ORDER BY` 에서는 별칭을 쓸 수 있는 이유** — ⑤ 다음이라서

JS 로 비유하면 `rows.filter(WHERE) → groupBy → filter(HAVING) → map(SELECT) → sort → slice` 다.

---

## 6. NULL — "값이 없음"이 아니라 "모름"

SQL 의 NULL 은 JS 의 `null` 과 다르게 동작한다. **"알 수 없는 값"** 이라서 비교 결과도 "알 수 없음"이 된다.

| 식 | 결과 | 왜 |
| --- | --- | --- |
| `NULL = NULL` | NULL (참 아님) | 모르는 값 두 개가 같은지는 모른다 |
| `WHERE deleted_at = NULL` | **0행** | 항상 참이 아니므로 아무것도 안 나온다 |
| `WHERE deleted_at IS NULL` | ✅ 의도대로 | NULL 검사는 반드시 `IS NULL` |
| `COUNT(*)` vs `COUNT(owner_id)` | 다를 수 있다 | `COUNT(컬럼)` 은 NULL 을 세지 않는다 |
| `WHERE status <> 'adopted'` | status 가 NULL 인 행은 **빠진다** | NULL 과의 비교는 참이 아니다 |

마지막 줄이 실무에서 가장 자주 터진다. "입양 안 된 펫" 목록에서 상태가 비어 있는 펫이 사라진다.
그래서 **NULL 이 의미 없는 컬럼에는 처음부터 `NOT NULL` 을 건다.** NULL 을 허용하는 건 "모름"이 정말 의미 있는 상태일 때만이다.

> C# 의 nullable 참조 타입(`string?`)과 DB 의 `NULL` 허용 여부는 EF Core 가 맞춰 준다.
> `string Name` 이면 `NOT NULL`, `string? Name` 이면 NULL 허용 컬럼이 된다. (`02-csharp-dotnet/01` 3절)

---

## 7. 정규화 — 같은 사실은 한 곳에만

```
❌ orders
id | customer_name | customer_phone | product
---+---------------+----------------+--------
1  | 김민수        | 010-1111-2222  | 사료
2  | 김민수        | 010-1111-2222  | 간식
3  | 김민수        | 010-9999-0000  | 장난감   ← 어느 번호가 맞나?
```

고객 전화번호가 주문마다 복사돼 있다. 번호를 바꾸면 **모든 주문 행을 고쳐야 하고**, 하나라도 놓치면 사실이 두 개가 된다.

```
✅ customers (id, name, phone)      orders (id, customer_id → customers, product)
```

정규화는 결국 **"한 사실은 한 행에만 저장하고, 나머지는 키로 가리킨다"** 는 원칙이다.
1NF · 2NF · 3NF 라는 단계 이름이 있지만, 실무에서는 이 한 문장으로 충분하다.

### 일부러 깨는 경우 (비정규화)

| 상황 | 이유 |
| --- | --- |
| 주문 시점의 가격·주소 | **그때의 값**이 사실이다. 상품 가격이 바뀌어도 과거 주문 금액은 그대로여야 한다 |
| 목록 화면용 집계 (`post.comment_count`) | 매번 `COUNT` 하면 느리다. 대신 갱신을 빠뜨리면 숫자가 틀어진다 |
| 검색·분석용 사본 | 원본은 정규화, 읽기 전용 사본은 펼쳐 둔다 |

첫 줄은 비정규화라기보다 **"다른 사실"** 이다. "현재 가격"과 "주문 당시 가격"은 다른 데이터다. 이 구분을 못 하면 과거 영수증 금액이 바뀌는 버그가 난다.

---

## 8. 실무에서 자주 만나는 설계 관례

| 관례 | 이유 |
| --- | --- |
| `created_at`, `updated_at` | 장애 분석의 시작점. "언제부터 이상했나" |
| 시각은 `timestamptz` (MSSQL `datetimeoffset`) | 시간대 없는 시각은 서버 위치에 따라 9시간씩 틀어진다 |
| 금액은 `decimal` / `numeric` | `float` 는 `0.1 + 0.2 ≠ 0.3`. 돈에 쓰면 원 단위가 어긋난다 |
| **소프트 삭제** `deleted_at` | 실수 복구·감사 추적. 대신 **모든 조회에 `deleted_at IS NULL` 을 붙여야 한다** (EF Core 전역 쿼리 필터) |
| `tenant_id` 를 모든 테이블에 | 멀티테넌시 격리 (`01-backend-basics/04-auth.md` 5절) |
| 상태는 `CHECK` 나 enum 으로 | 오타(`'actvie'`)가 DB 에 들어가는 걸 막는다 |

소프트 삭제는 공짜가 아니다. `UNIQUE(email)` 이 걸려 있으면 탈퇴한 사람의 이메일로 재가입이 안 된다
→ `WHERE deleted_at IS NULL` 조건부 유니크 인덱스(PostgreSQL partial index)가 필요하다.

---

## 9. PostgreSQL vs SQL Server — 랭코드는 둘 다 쓴다

`01/03` 6절에서 본 것처럼 회사 스택에 PostgreSQL 과 MSSQL 이 같이 있다. 문법이 조금씩 다르다.

| | PostgreSQL | SQL Server (MSSQL) |
| --- | --- | --- |
| 상위 N 개 | `LIMIT 10 OFFSET 20` | `TOP 10` 또는 `OFFSET 20 ROWS FETCH NEXT 10 ROWS ONLY` |
| UUID 타입 | `uuid` | `uniqueidentifier` |
| 문자열 | `text` (UTF-8, 한글 OK) | **`nvarchar`** — `varchar` 는 콜레이션에 따라 한글이 `??` 로 깨질 수 있다 |
| 대소문자 무시 검색 | `ILIKE` | 기본 콜레이션이 대소문자를 무시하는 경우가 많다 |
| 자동 증가 | `GENERATED ... AS IDENTITY` | `IDENTITY(1,1)` |
| 식별자 대소문자 | 따옴표 없으면 **소문자로 바뀐다** | 그대로 |
| JSON | `jsonb` + GIN 인덱스 | `nvarchar` + JSON 함수 |
| 벡터 | pgvector 확장 | 최신 버전/Azure SQL 에서 벡터 타입 지원 |

**PostgreSQL + EF Core 에서 한 번은 겪는 일:** EF Core(Npgsql)는 기본으로 C# 이름 그대로 `"Pets"`, `"OwnerId"` 처럼 **따옴표 친 대문자 이름**을 만든다.
그래서 psql 에서 `SELECT * FROM pets;` 를 치면 "relation does not exist" 가 뜬다. `SELECT * FROM "Pets";` 라고 써야 한다.
(`UseSnakeCaseNamingConvention()` 을 쓰는 프로젝트라면 `pets`, `owner_id` 로 만들어진다.)

> ❓ 입사 후 확인: 어떤 서비스가 PostgreSQL 이고 어떤 게 MSSQL 인가? 고객사 DB 에 직접 붙는 경우도 있나? 이름 규칙은?

---

## 스스로 답해보기

1. UUID v4 를 기본 키로 쓰면 삽입이 느려지는 이유는? v7 은 왜 괜찮은가?
2. `ON DELETE CASCADE` 가 걸린 보호자를 지웠다. 무엇이 같이 사라지나? 그게 위험한 테이블은?
3. 펫과 예방접종의 N : M 관계를 배열 컬럼 대신 중간 테이블로 만드는 이유는?
4. "보호자 목록 + 펫 수" 화면에서 펫 없는 보호자가 빠졌다. 어떤 JOIN 을 썼을 가능성이 높나?
5. `WHERE COUNT(*) >= 2` 가 에러인 이유를 SQL 실행 순서로 설명해 보라.
6. `WHERE status <> 'adopted'` 에서 status 가 NULL 인 펫은 결과에 나오나?
7. 주문 테이블에 "주문 당시 가격"을 따로 저장하는 건 정규화 위반인가?
8. EF Core 로 만든 PostgreSQL 테이블에 `SELECT * FROM pets` 를 쳤더니 테이블이 없다고 나온다. 왜?
