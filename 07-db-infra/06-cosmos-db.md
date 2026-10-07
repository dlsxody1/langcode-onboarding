# Cosmos DB

Azure 를 쓰는 회사에서 "DB 를 하나 더 붙이자"는 말이 나오면 PostgreSQL 다음으로 자주 나오는 이름이다.
**Cosmos DB 는 Azure 가 운영해 주는 문서형(NoSQL) DB 다.** JSON 문서를 그대로 저장하고, 전 세계 여러 리전에 복제할 수 있으며,
얼마나 빨리 읽고 쓸지를 **돈(RU)으로 미리 정한다.**

관계형 DB 와 생각하는 방식이 완전히 다르다. SQL 비슷한 쿼리를 쓸 수 있어서 처음엔 같은 것처럼 보이는데,
그 착각 때문에 비용이 폭발하거나 느려지는 일이 생긴다. 이 문서는 그 차이를 중심으로 쓴다.

> 관계형 기초(`07-db-infra/01-relational-basics.md`)와 `01-backend-basics/03-database.md` 6절 "관계형 vs 문서형"을 먼저 읽으면 좋다.

---

## 1. 한 장 요약

| 질문 | 답 |
| --- | --- |
| 무엇을 저장하나 | JSON 문서. 문서 하나 최대 2MB |
| 어떻게 찾나 | **파티션 키 + id** 로 찾으면 가장 싸고 빠르다. SQL 비슷한 쿼리도 된다 |
| JOIN 은 | **문서끼리는 안 된다.** 한 문서 안의 배열을 펼치는 JOIN 만 있다 |
| 트랜잭션은 | **같은 파티션 키 안에서만** |
| 비용은 무엇으로 | 저장 용량 + **RU(요청 단위)** |
| 잘 맞는 곳 | 대화 이력, 세션, 사용자·테넌트별 문서, 이벤트 로그, 전 세계 저지연 읽기 |
| 안 맞는 곳 | 여러 테이블을 엮는 조회, 임의 조건 분석 쿼리, 여러 엔티티에 걸친 트랜잭션 |

---

## 2. 구조 — 계정 · 데이터베이스 · 컨테이너 · 아이템

```
Cosmos DB 계정 (account)        ← 리전·일관성 수준 같은 큰 설정
 └─ 데이터베이스 (database)
     └─ 컨테이너 (container)    ← 관계형의 "테이블"에 가까움. 파티션 키를 여기서 정한다
         └─ 아이템 (item)       ← JSON 문서 한 개 = 관계형의 "행"
```

```json
{
  "id": "msg_01J9...",
  "tenantId": "acme",
  "conversationId": "conv_42",
  "role": "assistant",
  "content": "연차는 15일입니다 [1]",
  "citations": [{ "doc": "사내규정.md", "section": "제15조" }],
  "createdAt": "2026-10-02T09:14:03Z"
}
```

관계형이었다면 `citations` 는 별도 테이블이 됐을 것이다. 문서형에서는 **같이 읽는 데이터를 한 문서에 넣는다.**
메시지를 보여줄 때 인용도 항상 같이 보여주니, 한 번 읽기로 끝나게 만드는 것이다.

---

## 3. 파티션 키 — 가장 중요한 결정

Cosmos DB 는 데이터를 **파티션 키 값에 따라 여러 물리 서버에 나눠 담는다.** 그래서 수평으로 거의 무한히 커질 수 있다.
대신 파티션 키를 잘못 고르면 그 장점이 전부 사라진다.

**파티션 키는 컨테이너를 만들 때 정하고, 나중에 바꿀 수 없다.** 바꾸려면 새 컨테이너를 만들어 데이터를 전부 옮겨야 한다.

### 좋은 파티션 키의 조건

| 조건 | 왜 |
| --- | --- |
| **값의 종류가 많다** (카디널리티가 높다) | 값이 3개뿐이면 서버 3대 이상으로 못 나눈다 |
| **요청이 고르게 퍼진다** | 한 값에 요청이 몰리면 그 파티션만 한계에 닿는다 (**핫 파티션**) |
| **자주 하는 조회에 들어간다** | 쿼리에 파티션 키가 있으면 해당 파티션만 본다. 없으면 **전체 파티션을 훑는다** |

### 예: 채팅 메시지

| 후보 | 평가 |
| --- | --- |
| `role` (user/assistant) | ❌ 값이 2개. 나눌 수가 없다 |
| `createdAt` 날짜 | ❌ 오늘 날짜 파티션에만 쓰기가 몰린다 |
| `tenantId` | △ 조회에 늘 들어가서 좋다. 하지만 큰 고객사 하나가 핫 파티션이 될 수 있다 |
| `conversationId` | ✅ 값이 많고 고르게 퍼진다. "이 대화의 메시지 목록"이 한 파티션 안에서 끝난다 |
| `tenantId` → `conversationId` (계층형) | ✅ 테넌트 단위 조회도, 대화 단위 조회도 효율적. 계층형 파티션 키(최대 3단계)로 만든다 |

**규칙: "가장 자주 하는 조회에 무엇이 들어가나"에서 출발한다.** 관계형처럼 데이터 모양부터 정하지 않는다.

> 논리 파티션(같은 파티션 키 값을 가진 아이템 묶음) 하나는 **최대 20GB** 다. 한 키에 데이터가 끝없이 쌓이는 설계(예: `tenantId` 하나에 몇 년치 로그)는 언젠가 벽에 닿는다.

---

## 4. RU — 성능을 돈으로 산다

**RU(Request Unit, 요청 단위)** 는 Cosmos DB 의 화폐다. CPU·메모리·IO 를 하나의 숫자로 묶었다.

| 작업 | 대략의 RU |
| --- | --- |
| 1KB 문서를 **id + 파티션 키**로 읽기 (point read) | **약 1 RU** — 가장 싸다 |
| 1KB 문서 쓰기 | 약 5 RU 이상 (인덱스가 많을수록 더) |
| 파티션 키 없는 쿼리 | 파티션 수만큼 곱해진다. 수십\~수천 RU |

모든 응답 헤더에 그 요청이 쓴 RU 가 찍힌다(`x-ms-request-charge`). **개발 중에 이 숫자를 보는 습관**이 비용을 지킨다.

### 처리량 모드

| 모드 | 동작 | 맞는 곳 |
| --- | --- | --- |
| 프로비저닝 (수동) | 초당 RU 를 정해 두고 그만큼 돈을 낸다 | 트래픽이 일정할 때 |
| 프로비저닝 (자동 확장) | 최대치를 정하면 그 10%\~100% 사이에서 자동 조절 | 낮밤 차이가 클 때 |
| 서버리스 | 쓴 RU 만큼 낸다 | 개발·소규모·간헐적 트래픽 |

### 한도를 넘으면 429

정해 둔 초당 RU 를 넘으면 Cosmos DB 는 **`429 Too Many Requests`** 와 함께 "몇 ms 뒤에 다시 하라"를 돌려준다.
.NET SDK 는 이걸 **기본으로 몇 번 자동 재시도**한다. 그래서 개발 중에는 잘 안 보이다가, 운영에서 재시도로도 못 버틸 때 터진다.
`07-db-infra/03-resilience.md` 의 재시도·백오프 이야기가 그대로 적용된다. 429 가 자주 보이면 RU 를 올리기 전에 **어떤 쿼리가 RU 를 많이 먹는지**부터 본다.

---

## 5. 쿼리 — SQL 처럼 보이지만 SQL 이 아니다

```sql
SELECT c.id, c.content, c.createdAt
FROM c
WHERE c.conversationId = @conv           -- 파티션 키 → 한 파티션만 본다
ORDER BY c.createdAt DESC
OFFSET 0 LIMIT 50
```

| 관계형 습관 | Cosmos DB 에서는 |
| --- | --- |
| 테이블끼리 JOIN | **불가.** 필요한 데이터를 한 문서에 넣거나, 두 번 읽는다 |
| `SELECT *` | 그대로 되지만 문서가 크면 RU 가 커진다. 필요한 필드만 고른다 |
| 아무 조건으로나 WHERE | 파티션 키 없는 조건은 **모든 파티션을 훑는다 (cross-partition query)** |
| `COUNT(*)` 를 자주 | 전체를 세면 비싸다. 집계값은 따로 문서로 저장해 두는 경우가 많다 |
| `OFFSET` 으로 깊은 페이지 | 뒤로 갈수록 비싸다. **continuation token** 으로 이어 읽는다 (keyset 과 같은 발상) |

### 인덱스는 기본으로 전부 걸린다

관계형과 반대다. Cosmos DB 는 **모든 필드에 자동으로 인덱스를 건다.** 그래서 어떤 조건으로든 쿼리가 되지만, 쓸 때마다 인덱스 갱신 비용(RU)이 붙는다.
조회에 안 쓰는 큰 필드(`content` 본문 같은 것)는 **인덱싱 정책에서 제외**하면 쓰기 RU 가 줄어든다.
여러 필드로 정렬하는 쿼리(`ORDER BY a, b`)는 **복합 인덱스**를 따로 만들어야 한다.

---

## 6. 일관성 수준 — 복제본을 얼마나 믿을 것인가

Cosmos DB 는 여러 리전에 복제할 수 있다. 그러면 "방금 쓴 값을 다른 리전에서 바로 읽으면 보이나?" 라는 문제가 생긴다.
(`07-db-infra/05-infra.md` 7절 읽기 복제본 지연과 같은 문제다.) Cosmos DB 는 이걸 **다섯 단계**로 고르게 한다.

| 수준 | 보장 | 비용·지연 |
| --- | --- | --- |
| Strong | 항상 최신 값 | 가장 비싸고 느리다 |
| Bounded staleness | 최대 N초(또는 N버전)까지만 뒤처짐 | |
| **Session** (기본값) | **내가 쓴 건 내가 바로 읽는다.** 남이 쓴 건 잠시 늦을 수 있다 | 대부분 이걸로 충분 |
| Consistent prefix | 순서는 지키지만 늦을 수 있다 | |
| Eventual | 언젠가는 맞아진다 | 가장 싸고 빠르다 |

채팅 앱이라면 **Session** 이 딱 맞다. 사용자가 보낸 메시지가 자기 화면에서 사라지는 일은 없고, 다른 사람 화면에는 수십 ms 늦게 보여도 괜찮다.

---

## 7. 트랜잭션과 Change Feed

### 트랜잭션은 파티션 안에서만

같은 파티션 키 값을 가진 아이템끼리는 **트랜잭션 배치(transactional batch)** 로 여러 쓰기를 원자적으로 묶을 수 있다.
파티션이 다르면 묶을 수 없다. "주문 생성 + 재고 차감 + 결제 기록"처럼 서로 다른 엔티티를 함께 바꿔야 하는 일은 관계형 DB 가 맞다.

### Change Feed — 변경을 흘려보내는 파이프

컨테이너에 쓰기가 일어날 때마다 그 변경을 **순서대로 흘려주는 스트림**이다. 다른 시스템이 이걸 구독해서 따라 움직인다.

```
문서 저장 ──▶ Cosmos DB ──Change Feed──▶ 워커 (Azure Functions 등)
                                          ├─ 임베딩 생성 → 벡터 인덱스 갱신   (03-rag 증분 인덱싱)
                                          ├─ Azure AI Search 에 반영
                                          └─ 통계 문서 갱신
```

RAG 의 증분 인덱싱(`03-rag/02-chunking-embedding.md` 8절)을 "폴링" 없이 만드는 흔한 방법이다.
단, 기본 모드는 **삭제를 흘려주지 않는다.** 삭제는 `deleted: true` 로 표시만 하고 TTL 로 나중에 지우는 소프트 삭제 패턴을 쓴다.

### TTL

아이템이나 컨테이너에 TTL(초)을 걸면 그 시간이 지난 문서를 **Cosmos DB 가 알아서 지운다.**
세션, 임시 대화, "30일 뒤 삭제" 같은 보관 정책을 코드 없이 만든다.

---

## 8. API 종류 — "Cosmos DB 쓴다"가 다 같은 뜻은 아니다

Cosmos DB 는 여러 "말투(API)"로 접속할 수 있다. 계정을 만들 때 고르고, 나중에 바꿀 수 없다.

| API | 뜻 |
| --- | --- |
| **NoSQL** | Cosmos DB 고유 API. 이 문서의 SQL 비슷한 쿼리가 이것. 새 기능이 가장 먼저 들어온다 |
| **MongoDB** | MongoDB 드라이버로 접속한다. 기존 Mongo 코드를 거의 그대로 옮길 수 있다 |
| Cassandra · Gremlin · Table | 각각 Cassandra, 그래프, 키-값 호환 |

`01-backend-basics/03-database.md` 6절에 회사 스택으로 MongoDB 가 나온다. 그 MongoDB 가 **직접 운영하는 Mongo 인지, Cosmos DB 의 MongoDB API 인지**에 따라 운영 방식과 비용 구조가 완전히 달라진다.

> ✅ 팀 기술 목록에 **"코스모스 안 씀"** 이 명시돼 있다. MongoDB 는 Docker 로 띄워 챗 메시지 등에 쓴다 (`02-csharp-dotnet/05-team-tech-list.md`).
> 그래서 이 문서는 "Azure 에서 문서형 DB 를 고르면 어떻게 생각하나"를 배우는 참고용으로 읽는다. 접근 패턴부터 설계하는 발상은 MongoDB 에도 그대로 통한다.

### 벡터 검색

Cosmos DB for NoSQL 은 벡터 인덱스와 `VectorDistance()` 함수로 **문서와 임베딩을 한 컨테이너에 같이 두고** 벡터 검색을 할 수 있다.
"대화 이력·문서 메타데이터는 Cosmos DB, 벡터는 따로" 대신 한 곳에 둘 수 있다는 뜻이다.
다만 pgvector·Azure AI Search 와 기능(하이브리드 검색, 한국어 분석기)을 비교해 보고 정한다.

> ❓ 입사 후 확인: 벡터 검색은 어디서 하나? (pgvector / Azure AI Search / Cosmos DB)

---

## 9. .NET 에서 쓰는 모습

```csharp
// Program.cs — CosmosClient 는 반드시 하나만 만들어 재사용한다 (Singleton)
builder.Services.AddSingleton(_ =>
    new CosmosClient(builder.Configuration["Cosmos:Endpoint"], new DefaultAzureCredential()));
```

```csharp
public async Task<Message?> GetAsync(string conversationId, string id)
{
    var container = _client.GetContainer("chat", "messages");
    try
    {
        // point read — id + 파티션 키. 약 1 RU
        var res = await container.ReadItemAsync<Message>(id, new PartitionKey(conversationId));
        _logger.LogInformation("Cosmos read {RequestCharge} RU", res.RequestCharge);
        return res.Resource;
    }
    catch (CosmosException e) when (e.StatusCode == HttpStatusCode.NotFound)
    {
        return null;
    }
}
```

| 포인트 | 이유 |
| --- | --- |
| `CosmosClient` 는 **Singleton** | 내부에 연결 풀이 있다. 요청마다 만들면 연결이 고갈된다 (`01-backend-basics/02-layers-and-di.md` 4절 생명주기) |
| `DefaultAzureCredential` | 키 대신 Managed Identity 로 접속 (`07-db-infra/05-infra.md` 5절) |
| 없으면 **예외(404)** 로 온다 | null 이 아니다. 위처럼 잡아서 null 로 바꾸는 게 흔한 패턴 |
| `RequestCharge` 로깅 | 비싼 쿼리를 운영 전에 찾는다 (`07-db-infra/04-observability.md`) |

EF Core 에도 Cosmos DB 프로바이더(`Microsoft.EntityFrameworkCore.Cosmos`)가 있다. 다만 JOIN 이 안 되는 등 관계형 EF Core 와 할 수 있는 일이 달라서,
성능이 중요한 곳은 SDK 를 직접 쓰는 경우가 많다.

---

## 10. 멀티테넌시 — 고객사를 어떻게 나누나

| 방식 | 격리 | 비용 | 언제 |
| --- | --- | --- | --- |
| 한 컨테이너 + 파티션 키에 `tenantId` | 낮음 (코드로 지킨다) | 가장 쌈 | 고객사가 많고 작을 때 |
| 고객사별 컨테이너 | 중간 | RU 를 고객사별로 줄 수 있다 | 큰 고객사가 남의 성능을 먹지 않게 할 때 |
| 고객사별 계정 | 높음 (키·네트워크까지 분리) | 비쌈 | 계약상 물리적 분리를 요구할 때 |

첫 번째 방식이면 **모든 쿼리에 `tenantId` 조건이 빠지면 안 된다.** 관계형의 `WHERE tenant_id` 와 같은 규칙이고(`01-backend-basics/04-auth.md` 5절),
파티션 키에 들어가 있으면 빠뜨렸을 때 cross-partition 쿼리가 되어 RU 가 튀므로 오히려 빨리 발견되기도 한다.

---

## 11. PostgreSQL 이냐 Cosmos DB 냐

| 상황 | 고를 것 |
| --- | --- |
| 사용자·권한·주문처럼 서로 엮이고 틀리면 안 되는 데이터 | PostgreSQL / Azure SQL |
| 대화 이력·세션처럼 "한 덩어리로 쓰고 한 덩어리로 읽는" 데이터 | **Cosmos DB** 가 잘 맞는다 |
| 전 세계 여러 리전에서 수 ms 로 읽어야 함 | **Cosmos DB** |
| 이리저리 조건을 바꿔 가며 분석 | 관계형 또는 분석 전용 (Power BI 등으로 연결) |
| 팀에 Cosmos DB 경험이 없다 | 먼저 PostgreSQL `jsonb` 로 충분한지 본다 |

**설계 순서가 반대라는 것만 기억하면 된다.**
관계형은 "데이터가 어떻게 생겼나"(정규화)에서 출발하고, Cosmos DB 는 **"어떻게 읽을 건가"(접근 패턴)** 에서 출발한다.

---

## 스스로 답해보기

1. 채팅 메시지 컨테이너의 파티션 키로 `role` 이 나쁜 이유는? `conversationId` 는 왜 괜찮은가?
2. 파티션 키를 잘못 골랐다는 걸 출시 후에 알았다. 어떻게 바꾸나?
3. point read 와 파티션 키 없는 쿼리의 RU 차이가 큰 이유는?
4. 운영에서 429 가 늘었다. RU 를 올리기 전에 확인할 것은?
5. 관계형에서는 인덱스를 "필요한 곳에 건다". Cosmos DB 는 기본이 무엇이고, 그 대가는?
6. 채팅 서비스에 Session 일관성이 잘 맞는 이유는?
7. Change Feed 로 RAG 증분 인덱싱을 만들 때 삭제는 어떻게 처리하나?
8. `CosmosClient` 를 요청마다 새로 만들면 무슨 일이 생기나?
