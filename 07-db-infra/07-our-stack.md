# 우리 스택은 왜 이렇게 생겼나

회사 기술 스택 문서에 이런 표가 있다.

| 구분 | 서비스 | 비고 |
| --- | --- | --- |
| Database | PostgreSQL | RDB |
| | MongoDB | NoSQL |
| | Redis | 캐싱 용도 |
| Storage | Blob Storage | 고객사별 니즈에 맞는 스토리지 사용 예정 |
| 인증 | ~~Keycloak~~ | ~~IdentityServer → Keycloak 으로 변경 (속도 향상 및 확장성 용이)~~ |
| LLM | Azure AI Foundry | Amazon Bedrock · Gemini 등 엔드포인트 연동 대응 가능. 프로바이더별 LLM 연동 & 연동 가능한 LLM 목록·버전을 사용자가 추가 가능 |
| 배포 | Azure Container Apps / Container Registry | 테스트 용도로 Azure 리소스 사용 중 |

이름은 다 들어 봤을 것이다. 이 문서는 **"왜 하필 이것이고, 왜 이 조합인가"** 를 다룬다.
이유를 알아야 "이 데이터는 Postgres 에 넣나 Mongo 에 넣나", "이건 Redis 에 캐시해도 되나" 같은 판단을 혼자 할 수 있다.

> ⚠️ 여기 적은 이유는 **이런 스택을 고르는 일반적인 이유**와 표의 비고에서 읽어 낸 것이다. 랭코드가 실제로 어떤 논의를 거쳐 골랐는지는 아니다.
> 각 절 끝의 ❓ 항목을 입사 후 확인해서 고쳐 써라.

---

## 1. 먼저 큰 그림 — 이 표를 관통하는 한 가지

표를 다시 보면 **"고객사마다 다르다"** 는 말이 두 번 나온다.

- Storage: "고객사별 니즈에 맞는 스토리지"
- LLM: "Bedrock · Gemini 등 엔드포인트 연동", "LLM 목록·버전을 사용자가 추가"

그리고 배포는 "**테스트**하기 위한 용도로 Azure 를 쓴다"고 했다. 운영은 Azure 가 아닐 수도 있다는 뜻이다.

랭코드의 고객은 대기업·금융권이다. 이런 고객사는 이렇게 말한다.

```
A 은행  : "우리는 AWS 만 쓴다. 데이터는 우리 계정 밖으로 못 나간다. LLM 은 Bedrock."
B 그룹사 : "우리 IDC(사내 서버실)에 설치해 달라. 인터넷은 막혀 있다."
C 제조사 : "Azure 쓰고 있으니 그냥 Azure 로. LLM 은 Azure OpenAI."
```

같은 제품을 세 군데에 깔아야 한다. 그러면 스택을 고르는 기준이 하나로 모인다.

> **어디에나 설치할 수 있어야 한다 (이식성).**
> 어디에나 깔 수 없는 부분은 **갈아 끼울 수 있게** 만든다.

이 눈으로 표를 다시 나누면 이렇게 된다.

| 분류 | 항목 | 왜 이렇게 |
| --- | --- | --- |
| **어디서나 똑같이 돈다** | PostgreSQL · MongoDB · Redis · Keycloak | 전부 오픈소스. 컨테이너 하나로 어느 클라우드, 어느 IDC 에서든 뜬다. 모든 클라우드에 관리형 버전도 있다 |
| **고객사마다 갈아 끼운다** | Blob Storage · LLM | 클라우드마다 서비스가 다르다(Azure Blob / AWS S3, Azure OpenAI / Bedrock / Gemini). 그래서 **인터페이스 뒤에 숨긴다** |
| **지금은 Azure, 나중엔 모름** | Container Apps · Container Registry | 배포 단위가 **컨테이너 이미지**라서, 실행하는 곳만 바꾸면 된다 |

DB 를 SQL Server 나 Cosmos DB 처럼 특정 회사·특정 클라우드에 묶인 것으로 골랐다면 A 은행(AWS)과 B 그룹사(IDC)에서 막힌다.
나머지 절은 이 큰 그림을 항목별로 풀어 쓴 것이다.

> ❓ 입사 후 확인: 실제 고객사 설치는 어떤 형태인가? (우리가 운영하는 SaaS / 고객사 클라우드 계정에 설치 / 고객사 IDC 설치) 비율은?

---

## 2. 요청 하나가 이 스택을 지나가는 길

추상적으로 말하면 안 붙는다. 사용자가 채팅창에 "연차 규정 알려줘"를 보냈을 때 어디를 거치는지 따라가 본다.

```
브라우저
  │  ① 로그인은 이미 됨 — 인증 서버(Keycloak 등)가 발급한 토큰을 들고 온다
  ▼
API 서버 (Container Apps 위의 컨테이너, 여러 대)
  │
  ├─② Redis      : 이 테넌트 설정 · 이 테넌트가 쓸 수 있는 LLM 목록 (캐시)
  │                 이 사용자의 분당 호출 횟수 (레이트 리밋 카운터)
  │
  ├─③ PostgreSQL : 사용자 권한 · 대화방 정보 · 문서 메타데이터와 ACL
  │                 (+ pgvector 라면 벡터 검색까지 여기서)
  │
  ├─④ LLM        : 테넌트 설정에 적힌 프로바이더로 — Azure AI Foundry / Bedrock / Gemini
  │                 스트리밍으로 받아 SSE 로 브라우저에 흘린다
  │
  ├─⑤ MongoDB    : 질문 · 답변 · 인용 · 도구 호출 기록 · 토큰 사용량을 문서로 쌓는다
  │
  └─⑥ Blob       : 답변에 인용된 원문 PDF 를 열 때 — 서명된 임시 URL 을 내려준다
```

| 저장소 | 이 요청에서 맡은 일 | 성격 |
| --- | --- | --- |
| Redis | 자주 읽고 거의 안 바뀌는 것, 서버끼리 공유해야 하는 카운터 | **빠르고, 잃어도 된다** |
| PostgreSQL | 권한 · 관계 · 틀리면 안 되는 것 | **정확하고, 서로 엮여 있다** |
| MongoDB | 한 덩어리로 쓰고 한 덩어리로 읽는 기록 | **많고, 모양이 제각각이다** |
| Blob | 큰 파일 원본 | **크고, 통째로 읽는다** |

**규칙: 데이터의 성격을 먼저 보고 저장소를 고른다.** "Mongo 가 편하니까", "Redis 가 빠르니까"로 고르면 6절의 사고가 난다.

---

## 3. PostgreSQL — 왜 관계형은 이것인가

### 관계형이 필요한 데이터가 있다

사용자 · 테넌트 · 권한 · 문서 ACL · 과금처럼 **서로 엮여 있고, 틀리면 사고가 나는 데이터**는 관계형 DB 에 둔다.
외래 키가 "없는 사용자의 권한" 같은 고아 데이터를 막고, 트랜잭션이 "권한은 바뀌었는데 감사 로그는 안 남은" 상태를 막는다.
(`01-relational-basics.md`, `01-backend-basics/03-database.md` 2절)

그럼 관계형 중에서 왜 PostgreSQL 인가.

### 이유 1. 어디서나 돌고, 라이선스 비용이 없다

| | PostgreSQL | SQL Server | Oracle |
| --- | --- | --- | --- |
| 라이선스 | 오픈소스, 무료 | 코어 수 기준 유료 (Express 는 크기 제한) | 유료, 비쌈 |
| Azure | Flexible Server | Azure SQL | — |
| AWS | RDS / Aurora | RDS | RDS |
| GCP | Cloud SQL / AlloyDB | Cloud SQL | — |
| 고객사 IDC | 컨테이너 하나로 끝 | 라이선스 협의 필요 | 라이선스 협의 필요 |

1절의 이식성 기준에 가장 잘 맞는다. 고객사 서버 100곳에 깔 때마다 DB 라이선스 비용이 붙지 않는다는 것도 B2B 설치형 제품에서는 크다.

### 이유 2. 한 DB 로 여러 역할을 한다

PostgreSQL 은 **확장(extension)** 으로 기능을 붙일 수 있다. 이 회사에서 의미 있는 것만 골랐다.

| 필요 | PostgreSQL 에서 | 없었다면 |
| --- | --- | --- |
| 벡터 검색 (RAG) | **pgvector** 확장 (`03-rag/00-foundations.md`) | 벡터 DB 를 하나 더 운영 |
| 고객사마다 다른 메타데이터 | **`jsonb`** + GIN 인덱스 (`01-backend-basics/03-database.md` 6절) | 문서형 DB 로 따로 |
| 테넌트 격리를 DB 가 강제 | **RLS** (Row Level Security, `01-backend-basics/04-auth.md` 5절) | 앱 코드만 믿어야 함 |
| 한국어 키워드 검색 | 전문 검색 + 형태소 분석 확장 | 검색 엔진을 따로 |
| 간단한 작업 큐 | `SELECT ... FOR UPDATE SKIP LOCKED` (`01-backend-basics/05-long-running-jobs.md`) | 메시지 큐를 따로 |

**"권한 필터와 벡터 검색을 한 쿼리에서"** 가 특히 중요하다. 문서 ACL 이 Postgres 에 있고 벡터도 Postgres 에 있으면,
"이 사용자가 볼 수 있는 문서 중에서 가장 비슷한 청크 10개"를 SQL 하나로 뽑는다. 벡터 DB 가 따로 있으면 권한을 두 시스템에 맞춰 두는 일이 생긴다.

### 이유 3. .NET 에서 잘 붙는다

EF Core 의 PostgreSQL 프로바이더(**Npgsql**)는 공식 수준으로 관리되고, pgvector 와 `jsonb` 매핑도 지원한다. (`02-csharp-dotnet/03-ef-core.md`)
"SQL Server 가 .NET 의 짝꿍"이던 시절이 있었지만 지금은 Postgres 를 골라도 손해 보는 게 거의 없다.

### 대신 알아 둘 약점

| 약점 | 어떻게 다루나 |
| --- | --- |
| 커넥션 하나 = 프로세스 하나. 커넥션 수를 무작정 못 늘린다 | PgBouncer 같은 풀러 (`05-infra.md` 7절) |
| 수정·삭제한 행이 바로 안 지워지고 쌓인다 (MVCC) | VACUUM 이 치운다. 관리형 DB 는 자동. 대량 삭제 뒤 테이블이 안 줄어드는 이유가 이것 |
| 쓰기를 여러 서버로 나누기(샤딩)가 기본 기능이 아니다 | 대부분의 B2B 규모에서는 필요 없다. 쌓이기만 하는 대용량 기록은 Mongo 로 뺀다 (4절) |
| 따옴표 없는 이름은 소문자로 바뀐다 | `01-relational-basics.md` 9절 |

MVCC(다중 버전 동시성 제어)는 행을 고칠 때 덮어쓰지 않고 새 버전을 만드는 방식이다. 읽는 쪽이 쓰는 쪽을 기다리지 않아도 되는 대신, 옛 버전이 쓰레기로 남는다.

> ❓ 입사 후 확인: 이 표에는 MSSQL 이 없다. 이 레포의 다른 문서(`01-relational-basics.md` 9절)는 MSSQL 도 쓴다고 가정했다. MSSQL 은 고객사 시스템 쪽에만 있는 건가, 우리 서비스에도 있나?
> ❓ 벡터는 pgvector 에 두나, 따로 두나(Azure AI Search 등)?

---

## 4. MongoDB — 왜 관계형 DB 가 있는데 NoSQL 을 또 쓰나

가장 많이 나오는 질문이다. "Postgres 에 `jsonb` 가 있는데 왜 Mongo 를?"

### 이렇게 여러 저장소를 섞는 것을 부르는 말

**폴리글랏 퍼시스턴스(polyglot persistence)** — 데이터 성격마다 맞는 저장소를 골라 같이 쓰는 설계다.
프론트에서 서버 상태는 TanStack Query, 폼 상태는 react-hook-form, 전역 UI 상태는 Zustand 로 나눠 쓰는 것과 같은 발상이다. 하나로 다 할 수는 있지만 각자 잘하는 게 다르다.

### MongoDB 에 들어갈 법한 데이터

이 제품(AI 에이전트 · RAG)에서 문서형이 맞는 데이터는 꽤 분명하다.

| 데이터 | 왜 문서형이 맞나 |
| --- | --- |
| **대화 이력** (메시지 · 인용 · 피드백) | 대화 하나를 통째로 쓰고 통째로 읽는다. JOIN 할 일이 없다 |
| **에이전트 실행 기록** (어떤 도구를 어떤 인자로 불렀고 무엇이 돌아왔나) | 도구마다 인자·결과 모양이 다르다. 테이블로 만들면 도구 수만큼 테이블이 생긴다 |
| **LLM 요청·응답 원본 로그** | **프로바이더마다 응답 JSON 모양이 다르다.** Azure OpenAI · Bedrock · Gemini 의 응답을 그대로 저장하려면 고정 스키마가 맞지 않는다 |
| **문서 파싱 결과 원문** | 고객사마다, 파일 형식마다 뽑히는 필드가 다르다 (반정형) |
| **고객사 시스템에서 가져온 데이터** | 고객사 ERP · 그룹웨어의 응답 모양을 우리가 정할 수 없다 |

공통점은 셋이다. **양이 많고(쌓이기만 한다), 모양이 제각각이고, 다른 데이터와 엮어서 조회할 일이 적다.**

```json
// 메시지 하나 — 관계형이었다면 messages, citations, tool_calls, usage 네 테이블
{
  "_id": "6703f1...",
  "tenantId": "acme",
  "conversationId": "conv_42",
  "role": "assistant",
  "content": "연차는 15일입니다 [1]",
  "citations": [{ "docId": "d_881", "section": "제15조", "score": 0.82 }],
  "toolCalls": [{ "name": "search_policy", "args": { "q": "연차" }, "ms": 340 }],
  "model": { "provider": "bedrock", "id": "anthropic.claude-...", "version": "..." },
  "usage": { "inputTokens": 1840, "outputTokens": 96 },
  "createdAt": "2026-10-07T09:14:03Z"
}
```

### 그래도 `jsonb` 로 되지 않나? — 된다. 그래서 이유는 따로 있다

솔직히 위 데이터 대부분은 Postgres `jsonb` 컬럼으로도 담을 수 있다. 그럼에도 따로 두는 이유는 **데이터 모양보다 부하와 운영**에 있다.

| 이유 | 설명 |
| --- | --- |
| **부하를 떼어 낸다** | 대화·로그 쓰기는 권한 조회보다 훨씬 많다. 같은 DB 에 두면 로그 폭주가 로그인·권한 조회를 느리게 만든다. 커넥션 풀도 같이 말린다 |
| **커지는 방식이 다르다** | 기록성 데이터는 끝없이 쌓인다. MongoDB 는 샤딩(데이터를 여러 서버로 나누기)이 기본 기능이다 |
| **자동 만료** | TTL 인덱스를 걸면 "90일 지난 로그"를 DB 가 알아서 지운다. 고객사마다 다른 보관 기간 정책을 맞추기 쉽다 |
| **스키마 변경이 가볍다** | 새 필드를 넣는데 마이그레이션이 필요 없다. 프로바이더가 응답에 필드를 추가해도 그냥 저장된다 |
| **팀 경험** | 이미 Mongo 로 만든 코드·운영 경험이 있다면 그 자체가 이유다 |

**반대로, Mongo 에 넣으면 안 되는 것:** 권한 · 과금 · 테넌트 설정처럼 여러 엔티티를 한 번에 정확하게 바꿔야 하는 데이터.
MongoDB 도 여러 문서 트랜잭션을 지원하지만, 그걸 자주 써야 하는 데이터라면 처음부터 관계형이 맞다는 신호다.

### 두 DB 를 같이 쓰는 대가

저장소가 둘이면 **두 DB 를 하나의 트랜잭션으로 묶을 수 없다.** 이게 가장 큰 비용이다.

```
① Postgres 에 대화방 행 생성        ✅
② Mongo 에 첫 메시지 저장           ❌ 네트워크 오류
→ 메시지 없는 빈 대화방이 목록에 뜬다
```

| 대응 | 방법 |
| --- | --- |
| 순서를 정한다 | "주인"이 되는 쪽(Postgres)을 먼저 쓰고, 다른 쪽은 실패하면 재시도한다 |
| 다시 해도 같게 (멱등) | Mongo 쓰기를 같은 id 로 여러 번 해도 결과가 같게 만든다 (upsert) |
| 아웃박스 패턴 | Postgres 트랜잭션 안에 "Mongo 에 쓸 일"을 같이 적어 두고, 워커가 꺼내서 처리한다 (`01-backend-basics/05-long-running-jobs.md`) |
| 화면이 견디게 | 잠깐 어긋나도 이상하지 않은 UI (최종 일관성) |

그 외에 늘어나는 일도 있다.

- **테넌트 격리를 두 군데서** 지켜야 한다. Postgres 의 RLS 는 Mongo 를 지켜 주지 않는다. Mongo 쿼리마다 `tenantId` 조건이 빠지면 안 된다.
- **백업 시점이 다르다.** 둘을 같은 시각으로 복구하기 어렵다.
- **운영할 DB 가 하나 더** 생긴다. 모니터링 · 업그레이드 · 장애 대응 전부 두 배.

### .NET 에서

```csharp
// MongoClient 도 CosmosClient 처럼 하나만 만들어 재사용한다 (Singleton, 안에 커넥션 풀)
builder.Services.AddSingleton<IMongoClient>(_ =>
    new MongoClient(builder.Configuration.GetConnectionString("Mongo")));

var messages = client.GetDatabase("chat").GetCollection<Message>("messages");

// tenantId 를 빠뜨리지 않는다 — Postgres 의 RLS 같은 안전망이 없다
var list = await messages
    .Find(m => m.TenantId == tenantId && m.ConversationId == conversationId)
    .SortBy(m => m.CreatedAt)
    .Limit(50)
    .ToListAsync(ct);
```

공식 드라이버(`MongoDB.Driver`)는 LINQ 를 지원해서 EF Core 와 비슷하게 읽힌다. EF Core 용 MongoDB 프로바이더도 있다.
**복합 인덱스는 직접 만들어야 한다.** `{ tenantId: 1, conversationId: 1, createdAt: 1 }` 같은 인덱스가 없으면 컬렉션 전체를 훑는다. 원리는 관계형 복합 인덱스와 같다 (`01-backend-basics/03-database.md` 1절).

> ✅ 팀 기술 목록에서 확인된 것: MongoDB 는 **챗 메시지 등**에 쓰고, DB 는 **Docker 에 띄워서** 쓰며, **Cosmos DB 는 쓰지 않는다** (`02-csharp-dotnet/05-team-tech-list.md`).
> ❓ 입사 후 확인: 챗 메시지 말고 Mongo 에 들어가는 것은? 운영(고객사) 환경에서도 컨테이너로 띄우나, 관리형(Atlas 등)을 쓰나?
> ❓ Postgres 와 Mongo 에 걸친 쓰기는 어떻게 맞추나? 아웃박스를 쓰나?

---

## 5. Redis — 왜 캐시는 이것인가

### 캐시가 왜 서버 밖에 있어야 하나

`IMemoryCache` 는 서버 메모리에 둔다. 서버가 여러 대면 서버마다 다른 값을 들고 있고, 하나를 무효화해도 나머지는 옛 값을 계속 준다.
(`05-infra.md` 2절 무상태, `02-caching.md`) 그래서 **모든 서버가 같이 보는 캐시**가 필요하다.

### 그중 왜 Redis 인가

| 후보 | 탈락 이유 |
| --- | --- |
| 서버 메모리 (`IMemoryCache`) | 서버마다 따로. 위에서 본 문제 |
| PostgreSQL 에 캐시 테이블 | 캐시는 DB 부하를 덜려고 쓰는 건데, 그 DB 에 다시 부하를 준다 |
| Memcached | 빠르지만 문자열 키-값밖에 없다. 카운터 · 목록 · pub/sub 이 없다 |
| **Redis** | 메모리라서 1ms 미만. 자료구조가 다양하다. 모든 클라우드에 관리형이 있고 컨테이너로도 뜬다 |

결정적인 건 **캐시 말고도 쓸 데가 많다**는 점이다. 이 제품에서 Redis 가 맡을 법한 일:

| 쓰임 | Redis 기능 | 이 제품에서의 예 |
| --- | --- | --- |
| 캐시 | 문자열 + TTL | 테넌트 설정, **사용 가능한 LLM 목록**(7절), 권한 목록 |
| 레이트 리밋 | `INCR` + 만료 (원자적 증가) | 사용자·테넌트별 분당 질문 수, **LLM 토큰 예산** |
| 분산 락 | `SET key value NX PX` | "이 문서 재색인은 한 서버만" |
| 실시간 중계 | pub/sub · Streams | SignalR 백플레인, 끊긴 SSE 스트림 이어 받기 |
| 순위 | Sorted Set | 많이 본 문서, 자주 묻는 질문 |

`NX` 는 "키가 없을 때만 써라", `PX` 는 "몇 ms 뒤 만료"라는 옵션이다. 둘을 합치면 "아무도 안 잡았을 때만 잡고, 내가 죽어도 일정 시간 뒤 풀리는 락"이 된다.

**왜 이게 중요한가:** Redis 하나로 캐시 · 카운터 · 락 · 중계를 다 하면, 서버를 무상태로 만드는 데 필요한 공용 상태가 한 곳에 모인다.
`05-infra.md` 2절 표에서 "어디로 옮기나" 칸에 Redis 가 반복해서 나왔던 이유다.

### .NET 에서

```csharp
// L1(서버 메모리) + L2(Redis) 를 묶어 주는 HybridCache — 02-caching.md 5절
builder.Services.AddStackExchangeRedisCache(o =>
    o.Configuration = builder.Configuration.GetConnectionString("Redis"));
builder.Services.AddHybridCache();

// 키에 tenantId 를 반드시 넣는다 — 빠뜨리면 A 고객사 설정이 B 고객사에게 간다 (02-caching.md 4절)
var models = await cache.GetOrCreateAsync(
    $"tenant:{tenantId}:llm-models",
    async ct => await db.LlmModels.Where(m => m.TenantId == tenantId).ToListAsync(ct),
    new HybridCacheEntryOptions { Expiration = TimeSpan.FromMinutes(10) });
```

### Redis 사용 원칙

- **Redis 는 DB 가 아니다.** 재시작이나 메모리 부족으로 지워져도 **원본(Postgres)에서 다시 만들 수 있는 것만** 넣는다. "Redis 에만 있는 데이터"가 생기면 설계가 잘못된 것이다.
- **Redis 가 죽어도 서비스는 돌아야 한다.** 캐시 조회가 실패하면 DB 로 바로 가게(느려질 뿐 멈추지 않게) 만든다. 레이트 리밋 카운터처럼 Redis 가 없으면 판단을 못 하는 기능은 "통과시킬지 막을지"를 미리 정해 둔다.
- **키 이름 규칙을 정한다.** `tenant:{id}:...` 처럼 앞에 범위를 둬야 "이 테넌트 캐시 전부 삭제"가 된다.

### 라이선스 이야기 — 들으면 당황하지 않게

Redis 는 2024년에 라이선스를 오픈소스가 아닌 쪽으로 바꿨다가, 이후 버전에서 AGPL 을 다시 추가했다.
그 사이 리눅스 재단 쪽에서 원래 코드를 이어받은 **Valkey** 가 나왔고, 여러 클라우드가 관리형 서비스를 Valkey 로 옮기거나 둘 다 제공한다.
명령어 · 프로토콜이 같아서 **앱 코드(StackExchange.Redis)는 거의 그대로 붙는다.** "Redis 대신 Valkey 쓰자"는 말이 나와도 코드 이야기가 아니라 운영·라이선스 이야기다.

Azure 쪽도 기존 Azure Cache for Redis 에서 **Azure Managed Redis** 로 옮겨 가는 흐름이다. 정확한 일정은 Azure 공식 문서로 확인한다.

> ✅ 팀 기술 목록: Redis 는 캐싱 용도이고, **무엇을 캐시할지(객체)는 추후 정할 예정**이다.
> ❓ 입사 후 확인: Redis 는 어디서 도나? (Azure Managed Redis / 컨테이너 / 고객사 설치 시엔?) 캐시 말고 무엇에 쓰나? Redis 장애 시 동작은 정해져 있나?

---

## 6. 저장소를 잘못 고르면 생기는 일

2절의 "데이터 성격을 먼저 본다"를 어기면 이렇게 된다.

| 잘못된 선택 | 증상 |
| --- | --- |
| 권한을 Mongo 에 | 권한 변경과 감사 로그를 한 트랜잭션으로 못 묶는다. 컬렉션마다 권한 모양이 미묘하게 달라진다 |
| 대화 로그를 Postgres 같은 테이블에 계속 | 로그 테이블이 수억 행이 되며 VACUUM · 백업 · 인덱스가 느려지고, 로그인까지 느려진다 |
| 원본만 Redis 에 (예: 진행 중인 에이전트 상태) | Redis 재시작 한 번에 진행 중이던 작업이 전부 사라진다 |
| 파일을 DB 에 바이트로 | DB 가 수백 GB 로 불어나 백업·복구가 몇 시간 걸린다 (8절) |
| 캐시 키에 tenantId 누락 | 다른 고객사 데이터가 보인다. **가장 큰 사고** (`02-caching.md` 4절) |

**고르는 순서:**

```
틀리면 사고인가? 다른 데이터와 엮여 있나?         → PostgreSQL
한 덩어리로 쓰고 읽나? 모양이 제각각이고 많이 쌓이나?  → MongoDB
원본은 따로 있고 빨리 읽기만 하면 되나? 서버끼리 공유?  → Redis
수 MB 이상의 파일인가?                           → Blob (+ 메타데이터는 PostgreSQL)
```

---

## 7. LLM — 왜 Azure AI Foundry 이고, 왜 갈아 끼울 수 있게 만드나

### Azure AI Foundry 가 무엇인가

Azure 에서 **AI 모델을 고르고 배포하고 호출하는 곳**이다. OpenAI 모델뿐 아니라 여러 회사 모델이 카탈로그에 있고,
배포(deployment)를 만들면 그 모델을 부를 엔드포인트가 생긴다. 랭코드는 MS 파트너이고 백엔드가 .NET 이라 출발점으로 자연스럽다 (`04-agent/02-maf.md`).

### 그런데 왜 Bedrock · Gemini 까지

1절의 A 은행 이야기다. **고객사가 이미 계약한 클라우드의 LLM 을 써야 하는 경우가 많다.**

| 고객사 사정 | 필요한 연동 |
| --- | --- |
| Azure 를 쓴다 | Azure AI Foundry / Azure OpenAI |
| AWS 만 쓴다. 데이터가 AWS 밖으로 나가면 안 된다 | **Amazon Bedrock** |
| Google Cloud 를 쓴다 | **Gemini** (Vertex AI) |
| 인터넷이 막힌 IDC | 고객사 안에 띄운 모델 (OpenAI 호환 API 인 경우가 많다) |

그래서 비고에 "프로바이더별 LLM 연동"이 있다. 코드는 **특정 프로바이더를 직접 부르지 않고 인터페이스를 부른다.**

```csharp
// 04-agent/02-maf.md 의 IChatClient — 프로바이더 중립 추상
public interface IChatClientFactory
{
    IChatClient Create(LlmModel model);   // 모델 설정을 보고 알맞은 구현을 돌려준다
}

// 사용하는 쪽은 Azure 인지 Bedrock 인지 모른다
var client = factory.Create(tenantModel);
await foreach (var update in client.GetStreamingResponseAsync(messages, cancellationToken: ct))
    yield return update.Text;
```

`01-backend-basics/06-architecture.md` 의 의존성 역전이 실제로 돈이 되는 자리다. 새 프로바이더를 붙일 때 구현 클래스 하나만 추가하고 나머지 코드는 건드리지 않는다.

### "LLM 목록·버전을 사용자가 추가" — 모델 레지스트리

비고의 이 문장은 **어떤 모델을 쓸지가 코드가 아니라 데이터**라는 뜻이다. 관리자 화면에서 모델을 등록하면 DB 에 행이 생긴다.

```
llm_models (PostgreSQL)
  tenant_id       acme
  provider        bedrock | azure-foundry | gemini | openai-compatible
  display_name    "Claude (사내 승인)"
  model_id        실제 호출에 쓰는 모델 이름
  version         버전을 고정한다 (아래 참고)
  endpoint        https://...
  secret_ref      Key Vault 의 비밀 이름 — API 키 자체는 DB 에 넣지 않는다
  context_window  최대 입력 토큰
  supports_tools  도구 호출 지원 여부
  supports_vision 이미지 입력 지원 여부
  enabled         true
```

이 표 하나에 이 문서 전체가 겹친다.

- **PostgreSQL** 에 둔다. 테넌트 · 권한과 엮여 있고 틀리면 안 되는 설정이다.
- **Redis** 에 캐시한다. 요청마다 읽지만 거의 안 바뀐다. 관리자가 수정하면 해당 테넌트 키를 지운다.
- **API 키는 Key Vault** 에 두고 DB 에는 이름만 둔다 (`05-infra.md` 5절). 고객사의 LLM 키는 고객사 자산이다.
- 호출 결과 · 토큰 사용량은 **MongoDB** 에 쌓는다 (4절).

**버전을 고정하는 이유:** 모델 이름만 적어 두면 프로바이더가 그 이름이 가리키는 모델을 바꿀 때 우리 답변 품질이 예고 없이 바뀐다.
RAG 평가셋 점수(`03-rag/03-retrieval-quality.md`)가 어느 날 떨어졌는데 우리 코드는 그대로인 상황이 생긴다. 날짜·버전이 박힌 이름으로 고정하고, 바꿀 땐 평가를 돌린 뒤 바꾼다.

### 프로바이더가 달라지면 실제로 달라지는 것

인터페이스로 감싸도 차이가 다 사라지지는 않는다. 그래서 레지스트리에 `supports_tools` 같은 능력 표시가 필요하다.

| 차이 | 영향 |
| --- | --- |
| 도구 호출 형식 · 지원 여부 | 도구를 못 쓰는 모델이면 에이전트 기능을 끈다 |
| 구조화 출력(JSON 스키마) 지원 | 지원 안 하면 파싱 실패에 대비한 재시도가 필요하다 |
| 최대 입력 토큰 | RAG 에서 넣을 청크 수가 달라진다 |
| 토큰 세는 방식 | 같은 문장도 모델마다 토큰 수가 다르다. 과금 · 한도 계산이 달라진다 |
| 호출 제한과 429 모양 | 재시도 대기 시간을 알려주는 방식이 다르다 (`03-resilience.md`) |
| 콘텐츠 필터 | 같은 질문이 어떤 프로바이더에선 막힌다. 에러 모양도 다르다 |

**프론트와 맞닿는 부분:** 모델 선택 드롭다운은 이 레지스트리를 읽는 API 에서 그린다. "이미지 첨부" 버튼은 `supports_vision` 이 false 인 모델에서 숨긴다.
프론트가 모델 이름을 하드코딩하면 관리자가 모델을 추가해도 화면에 안 나온다.

> ❓ 입사 후 확인: 프로바이더 추상은 `IChatClient` 인가, 자체 인터페이스인가? 모델 레지스트리는 테넌트별인가 전역인가? 고객사 LLM 키는 어디에 보관하나?

---

## 8. Blob Storage — 왜 파일은 DB 에 넣지 않나

### 파일은 따로 둔다

| DB 에 파일을 넣으면 | Blob 에 두면 |
| --- | --- |
| DB 크기가 파일 크기만큼 불어난다 | DB 에는 경로 · 크기 · 해시 · 권한만 |
| 백업·복구가 파일 때문에 몇 시간 | 파일은 Blob 이 따로 복제·보관 |
| 파일을 내려줄 때 API 서버 메모리·커넥션을 잡아먹는다 | 브라우저가 Blob 에서 **직접** 받는다 |
| GB 당 비용이 비싸다 (DB 스토리지) | GB 당 비용이 훨씬 싸다. 오래된 파일은 더 싼 등급으로 |

RAG 제품이라 원본 파일이 많다. 고객사가 올린 규정집 PDF, 매뉴얼, 회의록. 이 원본이 Blob 에 있고, 파싱 결과는 Mongo, 청크와 벡터와 ACL 은 Postgres 에 있는 식으로 나뉜다.

### 서명된 URL — 프론트가 알아야 할 것

파일을 API 서버를 거쳐 주고받지 않는다. 서버는 **"이 파일을 10분 동안 읽을 수 있는 임시 URL"** 만 만들어 준다.

```
업로드:  브라우저 ──"올릴게요"──▶ API  : 권한 확인 → 쓰기용 임시 URL 발급
         브라우저 ──파일 본문──────────▶ Blob (직접)
         브라우저 ──"다 올렸어요"──▶ API : 메타데이터 저장, 파싱 작업 등록

다운로드: 브라우저 ──"이 문서 열래요"──▶ API : 권한 확인 → 읽기용 임시 URL (10분)
          브라우저 ──────────────────────▶ Blob (직접)
```

Azure 에서는 **SAS URL**, AWS S3 에서는 **presigned URL** 이라고 부른다. 같은 개념이다.
**권한 확인은 URL 을 발급할 때 한 번** 한다. 그래서 만료 시간을 짧게 두고, URL 을 로그나 공유 링크에 남기지 않는다.

### "고객사별 니즈에 맞는 스토리지" — 이것도 인터페이스 뒤로

```csharp
public interface IFileStorage
{
    Task<Uri> GetUploadUrlAsync(string tenantId, string key, TimeSpan ttl, CancellationToken ct);
    Task<Uri> GetDownloadUrlAsync(string tenantId, string key, TimeSpan ttl, CancellationToken ct);
    Task<Stream> OpenReadAsync(string tenantId, string key, CancellationToken ct);   // 파싱 워커용
}

// 구현: AzureBlobStorage · S3Storage · (IDC 라면) MinIO 같은 S3 호환 저장소
```

S3 API 는 사실상 업계 표준이라 IDC 에 설치할 때는 **S3 호환 저장소**(MinIO 등)를 띄우는 경우가 많다. 그러면 구현은 "Azure Blob" 과 "S3 계열" 둘로 대부분 커버된다.
DB 에는 **어느 저장소의 어떤 키인지**만 적는다. 전체 URL 을 저장하면 저장소를 옮길 때 DB 를 전부 고쳐야 한다.

> ❓ 입사 후 확인: 파일 저장 추상화가 있나? 업로드는 서버 경유인가 서명된 URL 직접 업로드인가? 테넌트별로 컨테이너(버킷)를 나누나, 경로로 나누나?

---

## 9. 인증 — 취소선이 그어진 Keycloak

표에서 인증 줄 전체에 **취소선**이 있다. 보통 "이 내용은 더 이상 유효하지 않다(철회 · 보류)"는 뜻이다.
그러니 **"인증은 Keycloak 이다"라고 단정하지 말고, 지금 무엇으로 정해졌는지 입사 후 확인해야 하는 항목**으로 둔다.
다만 비교 대상이 된 두 이름은 알아 둬야 대화가 된다.

### 둘 다 같은 일을 한다

IdentityServer 와 Keycloak 은 둘 다 **우리가 직접 운영하는 IdP(인증 서버)** 다. 로그인 화면을 띄우고, 사용자를 확인하고, OIDC 토큰을 발급한다.
(OIDC · IdP · SSO 는 `01-backend-basics/04-auth.md` 3절)

왜 직접 운영하는 인증 서버가 필요한가. 고객사마다 로그인 방식이 다르기 때문이다.

```
A 고객사 직원 ─▶ A 사 Entra ID ─┐
B 고객사 직원 ─▶ B 사 SAML IdP ─┼─▶ [우리 인증 서버] ─▶ 우리 앱은 토큰 한 종류만 검증
C 고객사 직원 ─▶ 아이디/비밀번호 ─┘
```

우리 인증 서버가 **고객사 IdP 들을 대신 상대해 주는 중개자(브로커)** 노릇을 하면, 우리 API 는 고객사가 몇 곳이든 토큰 한 종류만 검증하면 된다.

### 무엇이 다른가

| | IdentityServer (Duende) | Keycloak |
| --- | --- | --- |
| 형태 | **.NET 라이브러리.** 우리 ASP.NET Core 앱 안에 코드로 짜 넣는다 | **완성된 서버.** 컨테이너로 띄우고 관리 화면에서 설정한다 (Java) |
| 라이선스 | 상용. 매출 규모 이상이면 유료 | 오픈소스 (Apache 2.0) |
| 외부 IdP 연동 · 관리 화면 | 직접 만들어야 하는 부분이 많다 | 기본으로 들어 있다 (SAML · OIDC 브로커, 사용자·그룹 관리) |
| 테넌트 분리 | 직접 설계 | **realm** 단위로 나눌 수 있다 |
| 맞춤 자유도 | 코드라서 무엇이든 | 설정 범위 밖은 확장(SPI)을 Java 로 짜야 한다 |

realm 은 Keycloak 안의 독립된 공간이다. 사용자 · 설정 · 연동 IdP 가 realm 마다 따로라서 고객사 하나를 realm 하나로 두는 설계가 가능하다.

비고에 적혔던 "속도 향상 및 확장성"은 이런 맥락일 가능성이 높다. 직접 짜던 것을 완성품으로 바꾸면 **개발 속도**가 오르고, 고객사가 늘 때 realm · IdP 연동을 설정으로 **확장**할 수 있다.
그리고 컨테이너로 어디에나 뜨는 오픈소스라 1절의 이식성 기준에도 맞는다. 그래도 취소선이 그어졌다는 건 이 결정이 바뀌었거나 아직 열려 있다는 뜻이다.

**우리 API 쪽 코드는 어느 쪽이든 거의 같다.** ASP.NET Core 는 표준 OIDC/JWT 를 검증할 뿐이라, 바뀌는 건 발급자 주소(Authority)와 클레임 이름 정도다.

```csharp
builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(o =>
    {
        o.Authority = builder.Configuration["Auth:Authority"];   // 인증 서버 주소 — 여기만 바뀐다
        o.Audience  = builder.Configuration["Auth:Audience"];
    });
```

> ❓ 입사 후 확인: 인증은 지금 무엇으로 하나? (IdentityServer 유지 / Keycloak / Entra ID 직접 / 기타) Keycloak 줄에 취소선이 그어진 이유는? 고객사 SSO 연동은 누가 어떻게 설정하나?

---

## 10. 배포 — Container Apps 와 Container Registry

### 두 개가 하는 일

| 서비스 | 역할 | 프론트 경험에 대 보면 |
| --- | --- | --- |
| **Azure Container Registry (ACR)** | 빌드한 컨테이너 이미지를 올려 두는 **저장소** | npm 레지스트리. `myapi:1.4.2` 처럼 태그로 버전 관리 |
| **Azure Container Apps (ACA)** | 이미지를 받아 **실행**하고, HTTPS · 확장 · 재시작을 알아서 | Vercel 에 가깝다. 컨테이너를 올리면 나머지를 해 준다 |

```
코드 푸시 ─▶ CI: 빌드 · 테스트 · 이미지 빌드 ─▶ ACR 에 푸시 ─▶ ACA 가 새 이미지로 교체 (롤링)
```

(`05-infra.md` 3절 컨테이너, 4절 Azure 서비스, 6절 배포 파이프라인)

### 왜 App Service 나 AKS 가 아니라 Container Apps 인가

| 선택지 | 이 회사 상황에서 |
| --- | --- |
| App Service | 단일 웹앱엔 좋지만 API · 워커 · Keycloak · 파서 같은 컨테이너 여러 개를 묶기엔 덜 자연스럽다 |
| AKS (Kubernetes) | 다 할 수 있지만 클러스터 운영 전담 인원이 필요하다. 테스트 환경엔 과하다 |
| **Container Apps** | 컨테이너 여러 개를 Kubernetes 운영 없이. 요청 없으면 0대까지 줄여 비용을 아낀다 → **테스트 용도에 딱 맞다** |

0대까지 줄이는 걸 scale to zero 라고 한다. 대신 첫 요청이 컨테이너가 뜨기를 기다려야 해서(콜드 스타트) 몇 초 느릴 수 있다. 테스트 환경에서 "처음 한 번만 느린" 현상이 보이면 이것이다.

### "테스트 용도"라는 말의 의미

배포 단위가 **컨테이너 이미지**라는 게 핵심이다. 같은 이미지를 Container Apps 에서도, 고객사 AWS 의 ECS · EKS 에서도, IDC 의 Kubernetes · docker compose 에서도 돌릴 수 있다.
그래서 지금 Azure 에서 테스트해도 나중에 고객사 환경으로 옮길 때 앱 코드는 바뀌지 않는다. 바뀌는 건 **설정**(DB 주소 · 저장소 종류 · LLM 프로바이더 · 인증 서버 주소)뿐이어야 한다.

이게 1절의 이식성이 코드에 요구하는 것이다.

```
[ ] 클라우드 전용 SDK 를 비즈니스 코드에서 직접 부르지 않는다 → 인터페이스 뒤로 (7·8절)
[ ] 환경마다 다른 값은 전부 설정으로 (05-infra.md 5절)
[ ] 컨테이너 안 로컬 디스크에 아무것도 기억하지 않는다 (05-infra.md 2절)
[ ] Managed Identity 처럼 Azure 에만 있는 인증 방식은 "Azure 일 때"의 구현으로 둔다
```

마지막 줄이 미묘하다. `05-infra.md` 5절에서 Managed Identity 를 기본값이라 했는데, 고객사 IDC 에는 Managed Identity 가 없다.
`DefaultAzureCredential` 을 비즈니스 코드 곳곳에 뿌려 두면 Azure 밖으로 나갈 때 전부 찾아 고쳐야 한다. 설정 계층에서 한 번만 고르게 둔다.

> ❓ 입사 후 확인: 운영(고객사) 배포는 어떤 형태인가? 이미지 하나로 모든 환경을 커버하나? 로컬 개발용 docker compose 가 있나?

---

## 11. 로컬에서 이 스택을 한 번에 띄우면

이 문서의 모든 저장소가 오픈소스 컨테이너라서 로컬에서는 이렇게 생긴다. 회사 레포에도 비슷한 파일이 있을 것이다.

```yaml
# docker-compose.yml (예시)
services:
  postgres:
    image: pgvector/pgvector:pg17          # Postgres + pgvector
    environment: { POSTGRES_PASSWORD: dev }
    ports: ["5432:5432"]
  mongo:
    image: mongo:8
    ports: ["27017:27017"]
  redis:
    image: redis:8
    ports: ["6379:6379"]
  azurite:                                  # Azure Blob 을 흉내 내는 로컬 에뮬레이터
    image: mcr.microsoft.com/azure-storage/azurite
    ports: ["10000:10000"]
  keycloak:                                 # 인증 서버를 무엇으로 하든, 로컬에서도 하나 띄운다
    image: quay.io/keycloak/keycloak:latest
    command: start-dev
    ports: ["8080:8080"]
```

**LLM 만 컨테이너로 못 띄운다.** 로컬에서도 실제 엔드포인트(개발용 키)를 쓰거나, OpenAI 호환 로컬 모델을 붙인다.
7절의 인터페이스가 있으면 테스트에서는 가짜 `IChatClient` 를 넣어 LLM 없이 돌릴 수 있다.

---

## 12. 정리

| 항목 | 한 줄 이유 | 주의할 점 |
| --- | --- | --- |
| PostgreSQL | 어디서나 돌고, 관계 · 권한 · 벡터 · jsonb 를 한 DB 로 | 커넥션 수, 테넌트 격리(RLS) |
| MongoDB | 많이 쌓이고 모양이 제각각인 기록을 떼어 내서 | 두 DB 사이 정합성, `tenantId` 조건, 인덱스 |
| Redis | 서버 여러 대가 같이 보는 빠른 상태 (캐시 · 카운터 · 락) | 원본은 따로, 죽어도 서비스는 돌게, 키에 `tenantId` |
| Blob | 파일은 싸고 크게, 브라우저가 직접 | 서명된 URL 은 짧게, 저장소는 인터페이스 뒤로 |
| 인증 서버 | 고객사 IdP 를 대신 상대하는 중개자 | 무엇으로 정해졌는지 확인부터 |
| LLM | 고객사 클라우드에 맞춰 갈아 끼운다 | 모델은 데이터(레지스트리), 버전 고정, 능력 차이 |
| Container Apps / ACR | 이미지 하나를 어디서나, 지금은 테스트로 Azure | 클라우드 전용 코드는 설정 계층에만 |

**한 문장으로:** 고객사 환경이 제각각이라서, 어디서나 도는 것을 고르고 어디서나 돌 수 없는 것은 갈아 끼울 수 있게 만든다.

## 스스로 답해보기

1. 이 스택 표에서 "어디서나 똑같이 도는 것"과 "고객사마다 갈아 끼우는 것"을 나눠 보라. 그렇게 나뉘는 이유는?
2. 관계형 DB 로 SQL Server 대신 PostgreSQL 을 고를 때, 고객사 IDC 설치 상황에서 특히 유리한 점 두 가지는?
3. 문서 ACL 과 벡터가 같은 Postgres 에 있을 때 RAG 검색에서 얻는 이득은?
4. Postgres 에 `jsonb` 가 있는데도 대화 이력 · LLM 호출 로그를 MongoDB 에 따로 두는 이유를 데이터 모양 말고 **부하와 운영** 관점에서 설명해 보라.
5. 대화방은 Postgres 에, 메시지는 Mongo 에 저장한다. 두 번째 쓰기가 실패하면 무슨 일이 생기고, 어떻게 막나?
6. 캐시를 `IMemoryCache` 가 아니라 Redis 에 두는 이유는? Postgres 캐시 테이블은 왜 안 되나?
7. Redis 가 10분 동안 죽었다. 캐시 · 레이트 리밋 각각 어떻게 동작해야 하나?
8. 모델 레지스트리에 모델 이름만 적고 버전을 고정하지 않으면 어떤 일이 생길 수 있나? RAG 평가와 어떤 관계가 있나?
9. 고객사 LLM API 키를 `llm_models` 테이블 컬럼에 그대로 저장하면 안 되는 이유는? 대신 어디에 두나?
10. PDF 다운로드를 API 서버가 파일을 읽어 그대로 내려주는 방식 대신 서명된 URL 로 바꾸면 무엇이 좋아지나? 조심할 점은?
11. DB 에 파일 위치를 전체 URL 로 저장하면 나중에 무엇이 곤란해지나?
12. Keycloak 같은 인증 서버를 두면, 고객사가 10곳으로 늘어도 우리 API 의 토큰 검증 코드가 거의 안 바뀌는 이유는?
13. 지금은 Container Apps 에서 테스트한다. 같은 제품을 AWS 만 쓰는 고객사에 설치할 때 **코드**가 바뀌지 않으려면 무엇을 지켜 왔어야 하나?
