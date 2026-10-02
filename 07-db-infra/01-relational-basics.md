# 관계형 DB 기초

`01-backend-basics/03-database.md` 는 인덱스부터 시작한다. 이 문서는 그 앞 단계를 다룬다. **테이블이 무엇이고, 테이블끼리 어떻게 이어지며, SQL 이 어떤 순서로 실행되는가.**
EF Core 가 SQL 을 대신 써 주더라도 로그에 찍힌 SQL 을 읽을 수 없으면 디버깅이 안 된다.

마지막 10절에는 실행 계획(EXPLAIN) 읽는 법과 쿼리를 빠르게 쓰는 습관 몇 가지를 모았다. 인덱스 · 트랜잭션 · N+1 · 커넥션 풀 · 페이지네이션은 `01-backend-basics/03-database.md` 에서 자세히 다루므로 여기서는 겹치지 않는 부분만 쓴다.

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
| 스키마 | `type Pet` | 테이블 구조(컬럼 이름 · 타입 · 제약)의 정의. 바꾸려면 마이그레이션이 필요하다 (`01/03` 7절) |

위 SQL 의 `NOT NULL` · `CHECK` · `REFERENCES` 를 **제약(constraint)** 이라고 부른다. DB 가 지키는 규칙이라서 앱 코드에 버그가 있어도 규칙을 어기는 값은 저장되지 않는다.

TS 의 타입은 컴파일이 끝나면 사라지지만 **DB 스키마는 운영 중에도 계속 값을 검사한다.** 이게 가장 큰 차이다.

---

## 2. 키 — 행을 가리키는 방법

### 기본 키 (Primary Key)

행 하나를 유일하게 가리키는 컬럼이다. 줄여서 **PK** 라고 부른다. 절대 중복되지 않고 NULL 이 될 수 없다.
React 에서 리스트를 그릴 때 쓰는 `key` 와 비슷하다. 그 값만 알면 정확히 한 행을 집어낼 수 있다.

| 방식 | 예 | 장점 | 단점 |
| --- | --- | --- | --- |
| 자동 증가 정수 | `1, 2, 3 ...` | 작고 빠르다 | URL 에 노출하면 전체 개수·다음 ID 가 추측된다. 여러 DB 를 합칠 때 충돌 |
| UUID v4 (랜덤) | `3f2a...` | 어디서 만들어도 안 겹친다 | 순서가 없어 **인덱스 끝이 아니라 중간에 계속 끼어든다** → 삽입이 느려지고 단편화 |
| **UUID v7 (시간순)** | `0192...` | 안 겹치면서 시간 순서로 증가 | 생성 시각이 ID 에 드러난다 |

"중간에 끼어든다"가 왜 느린지 보자. DB 는 데이터를 **페이지**(PostgreSQL · SQL Server 모두 8KB)라는 단위로 디스크에 읽고 쓴다.
인덱스는 키 순서로 정렬돼 있어서 새 키가 항상 맨 뒤에 붙으면 마지막 페이지만 채우면 된다.
랜덤 키는 이미 가득 찬 중간 페이지에 들어가야 하니 페이지를 둘로 쪼개고(페이지 분할) 반쯤 빈 페이지가 여기저기 생긴다. 이렇게 흩어진 상태를 **단편화**라고 한다.

.NET 9 에는 `Guid.CreateVersion7()` 이 있다. 새로 만드는 테이블이면 v7 이 무난한 기본값이다.
특히 **SQL Server 는 기본 키가 곧 행의 물리적 정렬 순서**(클러스터드 인덱스)라서, 랜덤 UUID 를 기본 키로 쓰면 삽입마다 페이지를 쪼갠다.

**클러스터드 인덱스(clustered index)** 는 테이블의 행 자체를 그 키 순서대로 정렬해 저장하는 방식이다. 국어사전을 떠올리면 된다. 따로 색인이 있는 게 아니라 본문이 가나다순이다. 그래서 테이블당 하나만 둘 수 있다.
SQL Server 는 따로 지정하지 않으면 PK 를 클러스터드 인덱스로 만든다. PostgreSQL 테이블은 행을 정렬해 두지 않고 PK 인덱스도 별도 구조로 만든다. 그래도 랜덤 UUID 가 B-Tree 인덱스 곳곳에 흩어져 들어가는 문제는 PostgreSQL 에서도 똑같이 생긴다.

> ❓ 입사 후 확인: 회사 테이블의 PK 는 int 인가 Guid 인가? Guid 라면 어떻게 생성하나?

### 외래 키 (Foreign Key) — 테이블끼리 잇는 선

```sql
owner_id uuid NOT NULL REFERENCES owners(id)
```

"`pets.owner_id` 에는 **`owners` 에 실제로 있는 id 만** 들어갈 수 있다"는 약속이다. 줄여서 **FK** 라고 부른다.
TS 로 치면 `ownerId: Owner["id"]` 라고 타입을 적는 데서 그치지 않고 **그 id 를 가진 Owner 가 실제로 존재하는지**까지 DB 가 확인해 준다.
없는 보호자를 가리키는 펫(고아 행)이 DB 수준에서 불가능해진다.

**보호자를 지우면 그 보호자의 펫은?** 이걸 미리 정해야 한다.

| 옵션 | 동작 | 쓰는 곳 |
| --- | --- | --- |
| `ON DELETE RESTRICT` (기본) | 펫이 있으면 보호자 삭제 자체가 실패 | 실수로 지우면 안 되는 것 |
| `ON DELETE CASCADE` | 보호자를 지우면 펫도 같이 삭제 | 부모 없이는 의미 없는 자식 (주문 → 주문 항목) |
| `ON DELETE SET NULL` | 펫의 `owner_id` 를 NULL 로 | 관계만 끊고 자식은 남길 때 |

(표의 "기본"은 옵션을 안 적었을 때의 동작이다. 정확히는 `NO ACTION` 인데, 삭제가 실패한다는 결과는 `RESTRICT` 와 같다.)

**EF Core 는 필수 관계(`NOT NULL` FK)에 기본으로 CASCADE 를 건다.**
마이그레이션 파일에서 `onDelete: ReferentialAction.Cascade` 를 보면 "이걸 지우면 무엇이 같이 사라지나"를 한 번 확인하는 습관을 들인다.

FK 컬럼에는 보통 인덱스도 필요하다. PostgreSQL 은 FK 에 인덱스를 자동으로 만들어 주지 않는다 (`01/03` 1절).

---

## 3. 관계 세 가지

| 관계 | 예 | 테이블로 표현하면 |
| --- | --- | --- |
| **1 : N** | 보호자 1명 — 펫 여러 마리 | **N 쪽**(`pets`)에 FK(`owner_id`)를 둔다 |
| **1 : 1** | 사용자 — 사용자 설정 | 한쪽에 FK + `UNIQUE` |
| **N : M** | 펫 — 예방접종 (한 펫이 여러 접종, 한 접종을 여러 펫이) | **중간 테이블**을 만든다 |

N : M 은 컬럼 하나로 표현할 수 없다. 배열 컬럼에 넣고 싶어지는데, 그러면 FK 검사도 인덱스도 JOIN 도 제대로 안 된다.

```sql
CREATE TABLE pet_vaccinations (
  pet_id         uuid REFERENCES pets(id) ON DELETE CASCADE,
  vaccination_id uuid REFERENCES vaccinations(id),
  given_at       date NOT NULL,              -- 관계 자체에 붙는 정보는 여기에
  PRIMARY KEY (pet_id, vaccination_id)
);
```

`PRIMARY KEY (pet_id, vaccination_id)` 처럼 컬럼 두 개를 묶은 키를 **복합 키**라고 한다. "같은 펫에 같은 접종이 두 번 들어갈 수 없다"는 뜻이다.

중간 테이블에는 **관계 자체의 정보**(접종일, 담당 수의사)가 자연스럽게 들어간다.
RAG 문서의 `acl_groups` 를 배열 컬럼으로 둔 것(`03-rag/02` 7절)은 조회 속도를 위해 일부러 이 원칙을 깬 예다. 원칙을 알고 깨는 것과 모르고 깨는 것은 다르다. (배열 컬럼을 검색할 때 쓰는 GIN 인덱스는 10절에서 다룬다.)

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

**박서준이 없다.** 펫이 없으니 짝지을 행이 없어서다. 그냥 `JOIN` 이라고 쓰면 `INNER JOIN` 이다.

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
JOIN 을 두 개(펫 3마리 × 접종 5건) 붙이면 한 사람이 15행이 된다. 붙인 테이블의 행 수가 서로 곱해져서 결과가 폭증하는 현상이고 `02-csharp-dotnet/03-ef-core.md` 의 **카테시안 폭발**이 바로 이것이다.

"펫이 있는 보호자 목록"처럼 존재 여부만 궁금할 때 JOIN 을 쓰면 김민수가 두 번 나와서 `DISTINCT` 를 붙이게 된다. 이럴 때는 `EXISTS` 가 더 맞는 도구다 (10절).

### EF Core 에서는

```csharp
_db.Owners.Select(o => new { o.Name, PetCount = o.Pets.Count() })
// → LEFT JOIN 또는 서브쿼리로 번역된다. 펫 없는 보호자도 PetCount = 0 으로 나온다
```

내비게이션 프로퍼티(`o.Pets`)를 따라가면 EF Core 가 JOIN 을 만들어 준다. 내비게이션 프로퍼티는 FK 로 이어진 다른 엔티티를 객체 프로퍼티처럼 따라갈 수 있게 해 주는 것이다. 그래도 **어떤 JOIN 이 나가는지는 로그로 확인한다.**

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

`COUNT` · `SUM` · `AVG` 처럼 여러 행을 하나의 값으로 줄이는 함수를 **집계 함수**라고 한다. 집계는 ③에서 그룹이 만들어진 뒤에야 계산할 수 있다.

이 순서를 알면 흔한 에러가 전부 설명된다.

- **`WHERE pet_count >= 2` 가 에러인 이유** — `pet_count` 는 ⑤에서 생기는데 `WHERE` 는 ②다. 집계로 거르려면 `HAVING`
- **`WHERE` 와 `HAVING` 의 차이** — 행을 거르나, 그룹을 거르나
- **`ORDER BY` 에서는 별칭을 쓸 수 있는 이유** — ⑤ 다음이라서

JS 로 비유하면 `rows.filter(WHERE) → groupBy → filter(HAVING) → map(SELECT) → sort → slice` 다.

이건 **논리적인** 순서다. 실제로 DB 는 결과가 같은 범위에서 순서를 바꾸거나 단계를 합쳐 더 빠른 방법을 고른다. 그 "실제 방법"을 보여주는 게 10절의 실행 계획이다.

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

`WHERE` 는 조건이 **참인 행만** 남긴다. 거짓도 빠지고 "알 수 없음(NULL)"도 빠진다. 위 표의 결과는 전부 이 규칙에서 나온다.

마지막 줄이 실무에서 가장 자주 터진다. "입양 안 된 펫" 목록에서 상태가 비어 있는 펫이 사라진다.
그래서 **NULL 이 의미 없는 컬럼에는 처음부터 `NOT NULL` 을 건다.** NULL 을 허용하는 건 "모름"이 정말 의미 있는 상태일 때만이다.
같은 규칙 때문에 `NOT IN` 에도 함정이 있다 (10절).

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

고객 전화번호가 주문마다 복사돼 있다. 번호를 바꾸면 **모든 주문 행을 고쳐야 하고** 하나라도 놓치면 사실이 두 개가 된다.

```
✅ customers (id, name, phone)      orders (id, customer_id → customers, product)
```

**정규화(normalization)** 는 이런 중복을 없애려고 테이블을 나누는 설계 작업이다. 원칙은 **"한 사실은 한 행에만 저장하고, 나머지는 키로 가리킨다"** 한 문장이다.
프론트에서 Redux 상태를 `{ byId: {...}, allIds: [...] }` 로 "정규화"하라는 조언을 들어 봤다면 같은 발상이다. 같은 객체를 여러 곳에 복사해 두면 하나만 고쳐지고 나머지는 옛 값으로 남는다.

1NF · 2NF · 3NF 라는 단계 이름이 있지만 실무에서는 위 한 문장으로 충분하다. 굳이 외운다면 이 정도다.

| 단계 | 한 줄 | 어기는 예 |
| --- | --- | --- |
| 1NF | 한 칸에는 값 하나 | `tags = 'a,b,c'` 처럼 쉼표로 이어 붙인 문자열 |
| 2NF · 3NF | 키가 아닌 컬럼은 **그 행의 키**에만 기대야 한다 | 주문 행에 고객 전화번호. 전화번호는 주문이 아니라 고객에 딸린 사실이다 |

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

소프트 삭제는 행을 실제로 지우지 않고 "지웠다"는 표시(`deleted_at` 에 시각)만 남기는 방식이다. 반대로 행을 진짜 지우는 건 하드 삭제라고 부른다.
멀티테넌시는 고객사(테넌트) 여러 곳이 같은 서버와 DB 를 나눠 쓰는 구조다. 그래서 행마다 "어느 고객사 것인지"를 `tenant_id` 로 적어 둔다.

소프트 삭제는 공짜가 아니다. `UNIQUE(email)` 이 걸려 있으면 탈퇴한 사람의 이메일로 재가입이 안 된다
→ `WHERE deleted_at IS NULL` 조건부 유니크 인덱스(PostgreSQL partial index)가 필요하다. 만드는 법은 10절에 있다.

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

**콜레이션(collation)** 은 문자열을 비교하고 정렬하는 규칙 묶음이다. 대소문자를 같은 글자로 볼지, 어떤 언어 순서로 정렬할지, `varchar` 에 어떤 문자 집합을 담을지가 여기서 정해진다.
JS 의 `localeCompare("a", "B", "ko", { sensitivity: "base" })` 에 넘기는 옵션을 DB 가 컬럼마다 기본값으로 들고 있다고 보면 된다.

**PostgreSQL + EF Core 에서 한 번은 겪는 일:** EF Core(Npgsql)는 기본으로 C# 이름 그대로 `"Pets"`, `"OwnerId"` 처럼 **따옴표 친 대문자 이름**을 만든다.
그래서 psql 에서 `SELECT * FROM pets;` 를 치면 "relation does not exist" 가 뜬다. `SELECT * FROM "Pets";` 라고 써야 한다.
(`UseSnakeCaseNamingConvention()` 을 쓰는 프로젝트라면 `pets`, `owner_id` 로 만들어진다.)

> ❓ 입사 후 확인: 어떤 서비스가 PostgreSQL 이고 어떤 게 MSSQL 인가? 고객사 DB 에 직접 붙는 경우도 있나? 이름 규칙은?

---

## 10. 쿼리를 빠르게 — 실행 계획 읽기와 몇 가지 습관

인덱스를 왜 거는지, 복합 인덱스 순서, 인덱스가 무시되는 경우, N+1 은 `01-backend-basics/03-database.md` 1 · 3절에 있다.
이 절은 그 다음 단계다. **느린 쿼리를 만났을 때 원인을 어떻게 확인하고, 처음부터 어떻게 덜 느리게 쓰는가.**

### 실행 계획(EXPLAIN) 읽는 법

DB 는 SQL 을 받으면 **어떤 인덱스를 쓰고, 어떤 순서로 테이블을 붙일지** 계획을 먼저 세운다. 이 계획을 짜는 부분을 옵티마이저(플래너)라고 부르고 그 결과물이 **실행 계획**이다.
`EXPLAIN` 은 계획만 보여주고 `EXPLAIN ANALYZE` 는 **실제로 실행한 뒤** 예상과 실제를 나란히 보여준다.

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, name FROM pets WHERE owner_id = '0192...';
```

인덱스가 없을 때 (숫자는 예시):

```
Seq Scan on pets  (cost=0.00..21450.00 rows=48 width=40) (actual time=0.020..85.310 rows=52 loops=1)
  Filter: (owner_id = '0192...'::uuid)
  Rows Removed by Filter: 999948
  Buffers: shared hit=1204 read=7130
Execution Time: 85.400 ms
```

`owner_id` 에 인덱스를 만든 뒤:

```
Index Scan using ix_pets_owner_id on pets  (cost=0.42..52.10 rows=48 width=40) (actual time=0.025..0.110 rows=52 loops=1)
  Index Cond: (owner_id = '0192...'::uuid)
  Buffers: shared hit=55
Execution Time: 0.140 ms
```

| 항목 | 뜻 | 볼 점 |
| --- | --- | --- |
| `Seq Scan` | 테이블 전체를 처음부터 끝까지 읽는다 | 큰 테이블에서 몇 행만 찾는데 이게 나오면 인덱스가 없거나 안 쓰이는 것 |
| `Index Scan` | 인덱스로 위치를 찾고 테이블에서 행을 읽는다 | 보통 원하는 결과 |
| `Index Only Scan` | 인덱스만 읽고 테이블은 들르지 않는다 | 가장 빠르다. 아래 커버링 인덱스 참고 |
| `Bitmap Heap Scan` | 인덱스로 위치를 모은 뒤 테이블을 한꺼번에 읽는다 | 중간 규모 결과에서 흔하다. 나쁜 신호 아님 |
| `cost=0.42..52.10` | 옵티마이저가 매긴 상대 점수 (시작..끝) | 단위가 ms 가 아니다. 같은 쿼리의 계획끼리 비교할 때만 쓴다 |
| `rows=48` vs `actual ... rows=52` | 예상 행 수 vs 실제 행 수 | **둘이 10배 이상 차이 나면** 통계가 오래됐거나 옵티마이저가 잘못 짐작한 것 |
| `loops=N` | 이 단계가 몇 번 반복됐나 | 실제 시간 · 행 수는 **한 번 기준**이다. 전체는 loops 를 곱해서 본다 |
| `Rows Removed by Filter` | 읽었다가 조건에 안 맞아 버린 행 | 이 숫자가 크면 쓸데없이 많이 읽은 것 |
| `Buffers: hit / read` | 메모리에서 찾은 페이지 / 디스크에서 읽은 페이지 | `read` 가 크면 디스크 I/O 가 병목 |

**읽는 순서:** 계획은 트리다. 들여쓰기가 가장 깊은 줄이 먼저 실행되고 그 결과가 바깥 줄로 올라간다. 시간이 가장 많이 늘어나는 단계를 찾으면 그곳이 병목이다.

JOIN 이 있으면 테이블을 붙이는 방법도 나온다.

| JOIN 방식 | 동작 | 언제 고르나 |
| --- | --- | --- |
| `Nested Loop` | 바깥 행마다 안쪽을 찾는다 (이중 `for`) | 바깥이 작고 안쪽에 인덱스가 있을 때 |
| `Hash Join` | 한쪽으로 해시 표(`Map`)를 만들고 다른 쪽을 훑으며 찾는다 | 양쪽이 크고 `=` 조건일 때 |
| `Merge Join` | 양쪽을 정렬해 두고 지퍼처럼 맞춘다 | 이미 정렬돼 있을 때 |

JS 로 치면 Nested Loop 는 `a.map(x => b.find(...))`, Hash Join 은 `b` 로 `Map` 을 먼저 만든 뒤 `a` 를 돌며 `map.get()` 하는 방식이다.
`Nested Loop` 인데 안쪽 `loops` 가 수만 번이면 의심한다. 예상 행 수가 틀려서 옵티마이저가 작은 표라고 착각한 경우가 많다.

**주의할 점:**

- **`EXPLAIN ANALYZE` 는 쿼리를 정말 실행한다.** `UPDATE` · `DELETE` 에 붙이면 데이터가 바뀐다. 확인만 하려면 `BEGIN; EXPLAIN ANALYZE ...; ROLLBACK;` 으로 감싼다.
- 예상 행 수가 엉뚱하면 `ANALYZE pets;` 로 통계를 새로 모은다. 평소에는 autovacuum 이 알아서 하지만 대량 적재 직후에는 늦을 수 있다.
- 행이 몇백 개뿐인 개발 DB 에서는 인덱스가 있어도 `Seq Scan` 이 나온다. 작은 테이블은 통째로 읽는 편이 더 싸기 때문이다. 실행 계획은 **운영과 비슷한 데이터 양**에서 봐야 의미가 있다.
- SQL Server 는 SSMS 에서 "실제 실행 계획 포함"(Ctrl+M)을 켜고 실행한다. `SET STATISTICS IO, TIME ON;` 을 같이 켜면 읽은 페이지 수와 시간이 메시지 탭에 나온다.
- EF Core 에서 어떤 SQL 이 나가는지 보려면 LINQ 쿼리에 `.ToQueryString()` 을 붙인다. 나온 SQL 을 그대로 `EXPLAIN` 에 넣으면 된다.

### 인덱스 종류 — B-Tree 말고도 있다

인덱스 얘기를 하기 전에 용어 두 개를 정리한다.

- **카디널리티(cardinality)**: 컬럼에 들어 있는 **서로 다른 값의 개수**. `email` 은 행 수만큼 다양하고(높음), `status` 는 `active` / `adopted` 두 개뿐이다(낮음).
- **선택도(selectivity)**: 조건 하나가 전체 행 중 얼마나 적게 골라내는가. `email = ?` 는 100만 행 중 1행이라 선택도가 높고 `status = 'active'` 는 절반을 고르니 낮다. 값이 다양할수록(카디널리티가 높을수록) 선택도가 높아진다.

인덱스는 **선택도가 높은 조건**에서 효과가 크다. 절반을 고르는 조건이면 인덱스를 오가느니 테이블을 통째로 읽는 편이 빨라서 옵티마이저가 인덱스를 안 쓰기도 한다. 복합 인덱스에서 "값이 다양한 컬럼을 앞에" 두라는 `01/03` 1절의 조언도 같은 이유다.

PostgreSQL 은 용도에 따라 인덱스 종류를 고를 수 있다.

| 종류 | 잘하는 것 | 예 |
| --- | --- | --- |
| **B-Tree** (기본) | `=`, `<`, `>`, `BETWEEN`, 정렬(`ORDER BY`) | `CREATE INDEX` 라고만 쓰면 이것 |
| **GIN** | 값 하나에 원소가 여러 개 든 것 — 배열, `jsonb`, 전문 검색 | `acl_groups && ARRAY['hr']`, `metadata @> '{"type":"pdf"}'` |
| **부분 인덱스** (partial) | 조건에 맞는 행만 인덱스에 넣는다 | 삭제 안 된 행만, `status = 'pending'` 인 행만 |
| **커버링 인덱스** (`INCLUDE`) | 조회에 필요한 컬럼까지 인덱스에 같이 담는다 | `Index Only Scan` 이 가능해진다 |
| **식 인덱스** | 컬럼에 함수를 씌운 결과로 정렬 | `LOWER(email)` (`01/03` 1절) |

```sql
-- 부분 + 유니크: 8절의 "탈퇴한 이메일로 재가입" 문제를 푼다
CREATE UNIQUE INDEX ux_users_email_alive ON users (email) WHERE deleted_at IS NULL;

-- 커버링: owner_id 로 찾고 name · status 만 읽는 쿼리는 테이블을 안 들른다
CREATE INDEX ix_pets_owner_cover ON pets (owner_id) INCLUDE (name, status);

-- GIN: 배열 컬럼 검색 (03-rag/02 7절의 acl_groups)
CREATE INDEX ix_chunks_acl ON chunks USING GIN (acl_groups);
SELECT id FROM chunks WHERE acl_groups && ARRAY['hr', 'all'];   -- 두 배열에 겹치는 원소가 있나
```

SQL Server 도 `INCLUDE` 를 지원하고 부분 인덱스는 "필터링된 인덱스"(`CREATE INDEX ... WHERE ...`)라는 이름으로 있다.

EF Core 에서는 이렇게 쓴다.

```csharp
b.HasIndex(u => u.Email).IsUnique().HasFilter("deleted_at IS NULL");   // 필터 안은 SQL 그대로라 실제 컬럼 이름을 쓴다
b.HasIndex(p => p.OwnerId).IncludeProperties(p => new { p.Name, p.Status });
b.HasIndex(c => c.AclGroups).HasMethod("gin");                          // Npgsql 전용
```

인덱스는 쓰기를 느리게 하고 디스크를 먹는다 (`01/03` 1절). 한 번도 안 쓰이는 인덱스는 비용만 남는다.

```sql
-- PostgreSQL: 통계 수집 이후 한 번도 안 쓰인 인덱스
SELECT relname AS table_name, indexrelname AS index_name, idx_scan
FROM pg_stat_user_indexes
WHERE idx_scan = 0
ORDER BY pg_relation_size(indexrelid) DESC;
```

유니크 · PK 인덱스는 조회에 안 쓰여도 제약을 지키는 역할이 있으니 지우면 안 된다.

### `SELECT *` 를 피한다

```sql
SELECT * FROM chunks WHERE document_id = '...';             -- ❌
SELECT id, chunk_index, content FROM chunks WHERE document_id = '...';  -- ✅
```

`SELECT *` 가 손해인 이유는 세 가지다.

- **안 쓰는 데이터까지 나른다.** RAG 의 청크 테이블(`03-rag/02`)에는 `embedding vector(1536)` 컬럼이 있다. 숫자 하나가 4바이트라 행 하나에 약 6KB 다. 목록 화면에서 `*` 를 쓰면 화면에 안 보이는 벡터를 수천 개씩 DB → 서버로 옮긴다.
- **`Index Only Scan` 을 못 쓴다.** 인덱스에 없는 컬럼까지 달라고 하니 테이블을 들러야 한다.
- **나중에 컬럼이 추가되면 응답이 조용히 커진다.** 큰 컬럼 하나가 생기는 순간 모든 화면이 느려진다.

GraphQL 에서 필요한 필드만 요청하는 것과 같은 감각이다. EF Core 에서 엔티티를 통째로 읽으면 사실상 `SELECT *` 가 나간다. 읽기 전용 조회는 `.Select(...)` 로 필요한 컬럼만 고른다 (`01/03` 3절 Projection).

### `IN` · `EXISTS` · `NOT IN`

"펫이 있는 보호자"를 구하는 방법은 여러 가지다.

```sql
-- JOIN: 펫 수만큼 보호자가 반복된다 → DISTINCT 가 필요해진다 (4절)
SELECT DISTINCT o.* FROM owners o JOIN pets p ON p.owner_id = o.id;

-- IN
SELECT * FROM owners WHERE id IN (SELECT owner_id FROM pets);

-- EXISTS: "하나라도 있나"만 확인하고 멈춘다
SELECT * FROM owners o WHERE EXISTS (SELECT 1 FROM pets p WHERE p.owner_id = o.id);
```

존재 여부만 궁금하면 `EXISTS` 가 의도를 가장 정확히 표현한다. 행이 불어나지 않고 하나를 찾으면 더 보지 않는다.
요즘 PostgreSQL · SQL Server 옵티마이저는 `IN (서브쿼리)` 와 `EXISTS` 를 같은 계획으로 바꾸는 경우가 많아서 속도 차이는 크지 않다. **진짜 차이는 `NOT IN` 에서 난다.**

```sql
-- "입양 기록이 없는 펫"
SELECT * FROM pets WHERE id NOT IN (SELECT pet_id FROM adoptions);         -- ❌ 함정
SELECT * FROM pets p WHERE NOT EXISTS (SELECT 1 FROM adoptions a WHERE a.pet_id = p.id);  -- ✅
```

`adoptions.pet_id` 에 NULL 이 **하나라도** 있으면 `NOT IN` 쿼리는 **0행**을 돌려준다.
`id NOT IN (1, 2, NULL)` 은 `id <> 1 AND id <> 2 AND id <> NULL` 이고 마지막 비교가 항상 "알 수 없음"이라 전체가 참이 될 수 없다. 6절의 NULL 규칙 그대로다.
그래서 "없는 것 찾기"는 `NOT EXISTS` 로 쓴다. EF Core 의 `.Any()` · `!.Any()` 는 `EXISTS` · `NOT EXISTS` 로 번역된다.

### 여러 행은 한 번에 쓴다

1000행을 넣을 때 `INSERT` 를 1000번 보내면 DB 왕복도 1000번이다. 왕복 한 번이 1ms 여도 1초가 그냥 사라진다.
`fetch` 를 `for` 문 안에서 1000번 부르는 것과 같은 문제다.

```sql
INSERT INTO pets (id, name, owner_id, status) VALUES
  ('...', '초코', '...', 'active'),
  ('...', '보리', '...', 'active'),
  ('...', '콩이', '...', 'active');      -- 한 문장, 한 번의 왕복
```

| 상황 | EF Core 에서 |
| --- | --- |
| 수십 \~ 수천 행 추가 | `AddRange` 후 `SaveChangesAsync()` **한 번.** EF Core 가 여러 문장을 묶어(batch) 적은 왕복으로 보낸다. 반복문 안에서 `SaveChangesAsync()` 를 부르지 않는다 |
| 조건에 맞는 행을 일괄 수정 · 삭제 | `ExecuteUpdateAsync` · `ExecuteDeleteAsync` (EF Core 7+). 엔티티를 메모리로 읽지 않고 `UPDATE ... WHERE` 한 문장을 보낸다 |
| 수십만 행 이상 적재 | PostgreSQL `COPY` (Npgsql `BeginBinaryImport`), SQL Server `SqlBulkCopy` |

```csharp
// 30일 지난 임시 업로드를 한 문장으로 삭제
await _db.Uploads
    .Where(u => u.CreatedAt < DateTime.UtcNow.AddDays(-30))
    .ExecuteDeleteAsync(ct);
```

`ExecuteUpdateAsync` · `ExecuteDeleteAsync` 는 변경 추적을 거치지 않는다. 이미 메모리에 올라온 엔티티는 바뀐 사실을 모른다. 전역 쿼리 필터(소프트 삭제 등)는 적용되지만 `SaveChanges` 에 걸어 둔 훅(예: `updated_at` 자동 갱신)은 돌지 않는다.
너무 큰 일괄 작업은 한 트랜잭션이 오래 락을 잡으니 1,000 \~ 10,000행 단위로 나눠 돌린다.

### 느린 쿼리 찾기

어떤 쿼리가 느린지 모를 때는 DB 가 모아 둔 통계부터 본다.

```sql
-- PostgreSQL: pg_stat_statements 확장이 켜져 있어야 한다 (PG 13+ 컬럼 이름)
SELECT query, calls, mean_exec_time, total_exec_time
FROM pg_stat_statements
ORDER BY total_exec_time DESC
LIMIT 10;
```

`total_exec_time`(총 소요 시간) 순으로 보는 게 요령이다. 한 번에 2초 걸리는 쿼리보다 **5ms 짜리가 하루 100만 번** 도는 쪽이 DB 를 더 괴롭힌다.
SQL Server 는 **쿼리 저장소(Query Store)** 가 같은 역할을 한다. SQL Server 2022 와 Azure SQL 은 새 DB 에서 기본으로 켜져 있다.

> ❓ 입사 후 확인: 운영 DB 에 `pg_stat_statements` 나 Query Store 가 켜져 있나? 실행 계획을 보려면 어떤 DB(운영 사본?)에 붙어야 하나?

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
9. `EXPLAIN ANALYZE` 결과에서 예상 `rows=10` 인데 실제 `rows=200000` 이었다. 무엇을 의심하고 무엇을 해 보나?
10. `WHERE id NOT IN (SELECT pet_id FROM adoptions)` 가 갑자기 0행을 돌려준다. 데이터에 무슨 일이 생겼을까? 어떻게 고쳐 쓰나?
11. 업로드한 CSV 5,000행을 `foreach` 안에서 `Add` → `SaveChangesAsync()` 로 넣었더니 느리다. 어떻게 바꾸나?
12. 목록 API 가 청크 테이블을 `SELECT *` 로 읽는다. 무엇이 낭비되나?
