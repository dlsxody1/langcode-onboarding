# .NET 8 → 11 — 버전마다 무엇이 바뀌었나

회사 코드는 한 버전에 머물러 있지 않다. 오래된 서비스는 .NET 8, 새 서비스는 .NET 10, 실험은 .NET 11 일 수 있다.
버전마다 **코드 모양이 다르고**(C# 문법), **기본 동작이 다르다**(업그레이드하면 깨지는 것). 이 문서는 두 가지를 본다.

1. 처음 보는 문법이 나왔을 때 "몇 버전 기능이구나" 하고 알아보기
2. 업그레이드할 때 무엇이 깨지는지 미리 알기

**지금(2026년 10월) 상황.** .NET 8 · 9 는 **2026-11-10** 에 지원이 끝나고, .NET 10(LTS)이 주력이며, .NET 11 은 RC 단계로 11월 출시 예정이다 (`06-lifecycles.md` 5절).

> 이 문서는 learn.microsoft.com 의 "What's new" 문서를 실무 관점에서 추린 것이다. 전체 목록은 원문을 본다.
> [.NET 10 새 기능](https://learn.microsoft.com/ko-kr/dotnet/core/whats-new/dotnet-10/overview) ·
> [.NET 11 새 기능](https://learn.microsoft.com/ko-kr/dotnet/core/whats-new/dotnet-11/overview) ·
> [ASP.NET Core 10](https://learn.microsoft.com/ko-kr/aspnet/core/release-notes/aspnetcore-10.0) ·
> [ASP.NET Core 11](https://learn.microsoft.com/ko-kr/aspnet/core/release-notes/aspnetcore-11) ·
> [EF Core 10](https://learn.microsoft.com/ko-kr/ef/core/what-is-new/ef-core-10.0/whatsnew) ·
> [EF Core 11](https://learn.microsoft.com/ko-kr/ef/core/what-is-new/ef-core-11.0/whatsnew)

---

## 0. 지금 보는 코드가 몇 버전인가

| 어디를 보나 | 무엇이 보이나 |
| --- | --- |
| 프로젝트 파일(`*.csproj`) | `<TargetFramework>net10.0</TargetFramework>` — 이 프로젝트가 도는 런타임 |
| 저장소 루트의 `global.json` | 빌드에 쓰는 SDK 버전 고정 |
| `Directory.Build.props` | 여러 프로젝트에 공통으로 적용되는 설정 (`LangVersion`, `Nullable` 등) |
| `dotnet --info` | 내 PC 에 깔린 SDK · 런타임 목록 |

**C# 언어 버전은 런타임 버전을 따라간다.** .NET 8 = C# 12, .NET 9 = C# 13, .NET 10 = C# 14, .NET 11 = C# 15.
`net8.0` 프로젝트에서 C# 14 문법을 쓰면 빌드가 안 된다.

---

## 1. C# — 코드 모양이 바뀌는 곳

회사 코드에서 자주 보게 될 것 위주다. 낯선 문법이 나오면 이 표에서 찾는다.

### C# 12 (.NET 8)

```csharp
// 기본 생성자 (primary constructor): 클래스 선언에 생성자 매개변수를 바로 쓴다. DI 코드에서 가장 많이 보인다
public class OrderService(AppDbContext db, ILogger<OrderService> log)
{
    public Task<Order?> GetAsync(int id) => db.Orders.FindAsync(id).AsTask();   // db 를 필드처럼 쓴다
}

// 컬렉션 식 (collection expression): [] 로 배열·리스트·Span 을 만든다. .. 는 펼치기 (TS 의 ...)
int[] ids = [1, 2, 3];
List<string> all = [.. defaults, "extra"];
```

> 기본 생성자 매개변수는 `readonly` 필드가 아니다. 클래스 안에서 다시 대입할 수 있으니 실수로 덮어쓰지 않게 주의한다.

### C# 13 (.NET 9)

| 기능 | 모양 | 의미 |
| --- | --- | --- |
| `params` 컬렉션 | `void Log(params ReadOnlySpan<string> parts)` | `params` 에 배열 말고 `List`, `Span` 등도 |
| 새 `Lock` 타입 | `private readonly Lock _gate = new(); lock (_gate) { ... }` | `object` 대신 전용 잠금 객체. 더 빠르고 의도가 분명 |
| `\e` 이스케이프 | `"\e[31m"` | 터미널 색상 코드용 ESC 문자 |
| `partial` 속성 | `public partial string Name { get; set; }` | 소스 생성기가 구현을 채울 때 |

### C# 14 (.NET 10) — 현재 LTS 의 언어

```csharp
// field 키워드: 자동 속성에 검증만 끼우고 싶을 때, 따로 필드를 선언하지 않는다
public string Name
{
    get;
    set => field = value?.Trim() ?? throw new ArgumentNullException(nameof(value));
}

// null 조건 대입: 왼쪽이 null 이 아니면 대입 (TS 에는 없는 문법)
customer?.LastOrderedAt = DateTime.UtcNow;

// extension 블록: 확장 메서드뿐 아니라 확장 "속성"과 정적 확장도
public static class OrderExtensions
{
    extension(Order order)
    {
        public bool IsEmpty => order.Items.Count == 0;   // order.IsEmpty 처럼 쓴다
    }
}
```

그 밖에: `nameof(List<>)` (제네릭 인자 없이), 람다 매개변수에 타입 없이 `ref`/`out` 붙이기, `Span<T>` 암시적 변환, 사용자 정의 `+=` 연산자.

### C# 15 (.NET 11, 프리뷰)

```csharp
// 유니언 타입: "이 셋 중 하나". switch 가 모든 경우를 다뤘는지 컴파일러가 검사한다 (TS 의 A | B | C 와 비슷)
public record class Approved(int OrderId);
public record class Rejected(string Reason);
public record class Pending();
public union ReviewResult(Approved, Rejected, Pending);

string Describe(ReviewResult r) => r switch
{
    Approved a => $"승인 {a.OrderId}",
    Rejected x => $"거절: {x.Reason}",
    Pending    => "대기",
};   // 하나를 빼먹으면 경고

// 컬렉션 식 인자: 용량·비교자를 [] 안에서
HashSet<string> tags = [with(StringComparer.OrdinalIgnoreCase), "AI", "ai"];   // 요소 1개
```

그 밖에: `closed` 클래스(같은 어셈블리 안에서만 상속 → switch 완전성 검사), 레이블 붙은 `break outer;` / `continue outer;`, 확장 인덱서, 메모리 안전 규칙 정비(프리뷰).

**유니언이 왜 반가운가.** 지금은 업무 실패를 예외로 던지거나 `Result<T>` 라이브러리를 쓴다(`02-aspnet-core.md` 6절). 유니언이 정착하면
"성공 | 검증 실패 | 권한 없음"을 언어 차원에서 표현하고, 빠뜨린 경우를 컴파일러가 잡는다. ASP.NET Core 11 은 유니언을 JSON 본문·응답에서 지원한다.

---

## 2. ASP.NET Core — API 서버에 닿는 변화

| 버전 | 실무에서 의미 있는 것 |
| --- | --- |
| **8** | **keyed services**(같은 인터페이스 구현 여럿 — `06-lifecycles.md` 3절 규칙 6) · `IExceptionHandler`(예외 → 응답 변환을 클래스로) · Identity API 엔드포인트 · 요청 타임아웃 미들웨어 · 라우팅 단락(`.ShortCircuit()`) · Native AOT 지원 확대 |
| **9** | **OpenAPI 문서 생성 내장**(`AddOpenApi()` — 템플릿에서 Swashbuckle 이 빠졌다) · `HybridCache`(메모리 + Redis 2단 캐시, `07-db-infra/02-caching.md`) · 정적 파일 최적화 `MapStaticAssets` · `TypedResults.InternalServerError` |
| **10** | **Minimal API 검증 내장**(`AddValidation()` — 실패 시 자동 400) · **SSE 응답 내장** `TypedResults.ServerSentEvents(...)` (채팅 스트리밍을 직접 쓰지 않아도 된다, `05-realtime-ui/01-sse-vs-websocket.md`) · OpenAPI 3.1 기본 + YAML · 패스키(WebAuthn) 로그인 · 인증·인가 메트릭 · JSON 역직렬화가 `PipeReader` 기반으로 |
| **11** (RC) | **비동기 검증**(`AsyncValidationAttribute` — "이미 있는 이메일인가" 같은 DB 검사를 검증 단계에서) · `[ShortCircuit]` 특성 · 바인딩 실패에도 엔드포인트 필터가 돌아 400 응답을 직접 꾸밀 수 있음 · C# 유니언 지원 · OpenAPI 3.2 · SignalR 연결을 끊지 않고 토큰 갱신 · 실험적 AI 채팅 컴포넌트(Blazor) |

### SSE 내장 — 우리 채팅에 직접 닿는 변화

```csharp
// .NET 10+: 이벤트 스트림을 IAsyncEnumerable 로 넘기면 끝
app.MapPost("/chat", (ChatRequest req, IChatService chat, CancellationToken ct) =>
    TypedResults.ServerSentEvents(chat.StreamAsync(req, ct), eventType: "delta"));
```

그 전에는 `Content-Type: text/event-stream` 헤더, `data:` 줄 형식, 빈 줄 구분, 버퍼 비우기를 직접 써야 했다. 실습 3의 `/api/lab/chat` 이 손으로 한 바로 그 일이다.

---

## 3. EF Core — 쿼리와 RAG 에 닿는 변화

| 버전 | 실무에서 의미 있는 것 |
| --- | --- |
| **8** | **complex types**(식별자 없는 값 묶음 — DDD 의 값 객체를 그대로 매핑, `01-backend-basics/06-architecture.md`) · **기본 타입 컬렉션**(`List<string> Tags` 를 JSON 열로) · 매핑 안 된 타입으로 원시 SQL 결과 받기(`SqlQuery<T>`) |
| **9** | 매개변수 컬렉션 번역 방식 선택 · 시드 데이터 API(`UseSeeding`/`UseAsyncSeeding`) · 마이그레이션 동시 실행 잠금 · 컴파일된 모델 자동화 |
| **10** (LTS) | **벡터 검색**(SQL Server 2025 · Azure SQL 의 `vector` 타입 + `EF.Functions.VectorDistance`) · SQL Server `json` 타입 · complex type 을 JSON 열로 + 선택적(nullable) complex type · **이름 있는 쿼리 필터** · **`LeftJoin`/`RightJoin`** · `ExecuteUpdateAsync` 에 일반 람다 · 로그에서 인라인 상수 가리기 · 원시 SQL 문자열 연결 경고 |
| **11** (RC) | **근사 벡터 검색**(`VectorSearch()` + 벡터 인덱스, `WithApproximate()`) · 벡터 열을 기본으로 SELECT 하지 않음(9배 이상 빨라진 사례) · **전문 검색 테이블 함수 + 하이브리드 검색**(`FreeTextTable` + `VectorSearch` + `FullJoin` → RRF) · `JSON_CONTAINS` · `MaxBy`/`MinBy` 번역 · to-one 조인 SQL 개선 · 마이그레이션 ID 를 스냅숏에 기록(브랜치 충돌 감지) · `dotnet ef` 설정 파일 |

### 이름 있는 쿼리 필터 (EF 10) — 테넌트 격리에 쓰는 기능

```csharp
modelBuilder.Entity<Document>()
    .HasQueryFilter("Tenant", d => d.TenantId == _tenant.Id)   // 모든 쿼리에 자동으로 붙는다
    .HasQueryFilter("SoftDelete", d => !d.IsDeleted);

// 관리자 화면: 삭제된 것까지 보되, 테넌트 필터는 절대 끄지 않는다
var all = await db.Documents.IgnoreQueryFilters(["SoftDelete"]).ToListAsync(ct);
```

EF 9 까지는 엔터티당 필터가 하나뿐이라, 소프트 삭제만 끄려고 `IgnoreQueryFilters()` 를 쓰면 **테넌트 필터까지 같이 꺼지는** 사고가 날 수 있었다.
이름을 붙여 하나만 끌 수 있게 된 것이 멀티테넌트 서비스에서 큰 차이다 (`01-backend-basics/04-auth.md` 5절).

### 벡터 · 하이브리드 검색 (EF 10 · 11) — RAG 가 EF Core 안으로

`03-rag/` 에서 본 벡터 검색과 하이브리드 검색(RRF)을 **SQL Server 에서 LINQ 로** 쓸 수 있게 됐다.

```csharp
// EF 10: 정확한 거리 계산 (모든 행과 비교 — 작은 데이터)
var top = await db.Chunks
    .OrderBy(c => EF.Functions.VectorDistance("cosine", c.Embedding, queryVector))
    .Take(5).ToListAsync(ct);

// EF 11: 벡터 인덱스로 근사 검색 (ANN — 03-rag/01-pipeline.md 3절)
var approx = await db.Chunks
    .VectorSearch(c => c.Embedding, queryVector, "cosine")
    .OrderBy(r => r.Distance).Take(5).WithApproximate()
    .ToListAsync(ct);
```

회사가 MSSQL 을 쓰고(`07-db-infra/01-relational-basics.md` 9절) Azure 중심이므로 의미가 크다. 다만 SQL Server 의 벡터 인덱스는 아직 **실험 기능**이고,
PostgreSQL 쪽은 pgvector 와 Npgsql 제공자를 쓰므로 API 가 다르다.

> ❓ 입사 후 확인: 벡터 저장소가 SQL Server · pgvector · Azure AI Search 중 무엇인가? SQL Server 라면 EF 의 벡터 API 를 쓰나, 직접 SQL 을 쓰나?

---

## 4. 런타임 · 라이브러리 — 알아 두면 코드가 짧아지는 것

| 버전 | 기능 | 한 줄 |
| --- | --- | --- |
| 8 | `TimeProvider` | `DateTime.UtcNow` 대신 주입받는 시계 → 테스트에서 시간을 멈추거나 돌릴 수 있다 |
| 8 | `FrozenDictionary` / `FrozenSet` | 한 번 만들고 읽기만 하는 조회표를 더 빠르게 |
| 9 | `Guid.CreateVersion7()` | **시간순으로 정렬되는 GUID.** GUID 를 PK 로 쓸 때 인덱스 조각화를 줄인다 (`07-db-infra/01-relational-basics.md` PK 논의) |
| 9 | `Task.WhenEach` | 여러 작업을 **끝나는 순서대로** 처리 (여러 LLM 호출을 병렬로 보내고 먼저 온 것부터) |
| 9 | LINQ `CountBy` · `AggregateBy` · `Index` | 그룹별 개수·합계를 `GroupBy` 없이, 순번 붙이기 |
| 10 | LINQ `LeftJoin` / `RightJoin` | 복잡하던 `GroupJoin + DefaultIfEmpty` 대신 |
| 10 | JSON 엄격 모드 · 중복 속성 거부 | 외부 입력 JSON 을 더 엄격하게 |
| 11 | **Runtime Async** | `async` 를 런타임이 직접 처리 → 스택 트레이스가 깔끔해지고 오버헤드가 줄어든다. `net11.0` 에서 기본 |
| 11 | LINQ `FullJoin` · Zstandard 압축 · `Decimal32/64/128` · 비동기 검증 · JSON Lines 출력 | |

**AI 쪽 공통 추상화: `Microsoft.Extensions.AI`.** `IChatClient`, `IEmbeddingGenerator` 같은 인터페이스로 LLM 공급자(Azure OpenAI, OpenAI, 로컬 모델)를 갈아 끼운다.
EF 10 의 벡터 예제도 이 인터페이스로 임베딩을 만들고, MAF(`04-agent/02-maf.md`)도 이 위에 서 있다. "벤더 중립"을 코드로 옮긴 모양이다.

---

## 5. .NET 10 으로 올릴 때 확인할 것 (8 · 9 → 10)

업그레이드는 `TargetFramework` 한 줄을 바꾸는 것으로 시작하지만, **기본 동작이 바뀐 곳**에서 조용히 깨진다. 공식 "호환성이 손상되는 변경(breaking changes)" 문서를 꼭 본다.
아래는 API 서버에서 특히 걸리기 쉬운 것들이다.

| 영역 | 무엇이 바뀌었나 | 증상 |
| --- | --- | --- |
| 인증 (ASP.NET Core 10) | 쿠키 인증을 쓰는 **API 엔드포인트**가 로그인 페이지로 리다이렉트하지 않고 **401/403** 을 돌려준다 | 프론트가 302 를 기대하고 짠 로그인 이동 로직이 바뀐다 (대신 동작은 더 올바르다) |
| OpenAPI | OpenAPI.NET 라이브러리 2.0 · 문서 기본 3.1 | 문서 변환기(transformer) 코드가 컴파일 안 됨, 클라이언트 생성기 호환성 |
| JSON | 요청 본문 역직렬화가 `PipeReader` 기반 | **직접 만든 `JsonConverter`** 가 특정 입력에서 깨질 수 있다 |
| 예외 처리 | 처리된 예외를 기본으로 로그에 남기지 않음 | "에러 로그가 사라졌다" |
| EF Core 10 | 매개변수 컬렉션(`ids.Contains(x)`) 번역이 "값마다 매개변수"로 | 생성 SQL 이 달라짐. 실행 계획 변화 |
| EF Core 10 | SQL Server 호환성 수준 170 이상이면 JSON 열이 `nvarchar` → `json` 타입으로 | **다음 마이그레이션이 열 타입을 바꾼다.** 원치 않으면 열 타입을 명시 |
| EF Core 11 (나중에) | SQL Server 기본 호환성 수준이 160(2022)으로 | 오래된 SQL Server 에서 `LEAST`/`GREATEST` 같은 함수 오류 |

순서는 보통 이렇다. ① SDK 설치와 `global.json` 갱신 → ② `TargetFramework` 와 패키지 버전 올리기 → ③ 빌드 경고·분석기 메시지 정리 →
④ breaking changes 목록 대조 → ⑤ **EF 마이그레이션을 새로 만들어 보고 의도치 않은 변경이 없는지 확인** → ⑥ 통합 테스트 · 스테이징.

---

## 6. 공식 문서로 딥다이브하는 법

learn.microsoft.com 은 양이 많다. 목적별로 들어갈 곳이 다르다.

| 목적 | 어디 |
| --- | --- |
| 개념을 처음부터 (DI, 설정, 로깅, 호스트) | [.NET 기본 사항 → 확장(Extensions)](https://learn.microsoft.com/ko-kr/dotnet/core/extensions/dependency-injection) |
| 웹 API 의 모든 것 | [ASP.NET Core 기본 사항](https://learn.microsoft.com/ko-kr/aspnet/core/fundamentals/) (미들웨어, 라우팅, 호스트, 설정, 오류 처리) |
| EF Core 동작 원리 | [EF Core 문서](https://learn.microsoft.com/ko-kr/ef/core/) → 쿼리 작동 방식, 변경 추적, 성능 |
| 버전별 변화 | 각 제품의 "새로운 기능(What's new)" + "호환성이 손상되는 변경" |
| C# 문법 | [C# 의 새로운 기능](https://learn.microsoft.com/ko-kr/dotnet/csharp/whats-new/) (버전별) |
| 지원 기간 | [.NET 지원 정책](https://dotnet.microsoft.com/ko-kr/platform/support/policy/dotnet-core) |

**읽는 순서 추천 (입사 후 2주).**
1. DI → [서비스 수명](https://learn.microsoft.com/ko-kr/dotnet/core/extensions/dependency-injection#service-lifetimes)과 [DI 지침](https://learn.microsoft.com/ko-kr/dotnet/core/extensions/dependency-injection-guidelines) (`06-lifecycles.md` 3절의 근거)
2. [제네릭 호스트](https://learn.microsoft.com/ko-kr/dotnet/core/extensions/generic-host)와 [호스티드 서비스](https://learn.microsoft.com/ko-kr/aspnet/core/fundamentals/host/hosted-services) (`06-lifecycles.md` 1절)
3. ASP.NET Core 미들웨어 · 오류 처리 · 설정
4. EF Core 쿼리 작동 방식과 성능 (`03-ef-core.md` 와 대조하며)
5. 회사 `TargetFramework` 에 맞는 "새로운 기능" 문서

> 한국어 문서는 기계 번역이 섞여 있어 용어가 어색할 때가 있다. 막히면 주소의 `ko-kr` 를 `en-us` 로 바꿔 원문을 본다. 최신 내용도 영어 쪽이 먼저 반영된다.

## 스스로 답해보기

1. 처음 보는 저장소에서 .NET 버전과 C# 언어 버전을 확인하려면 어떤 파일을 보나?
2. `public class OrderService(AppDbContext db)` 는 몇 버전 문법이고, 무엇을 줄여 쓴 것인가? 주의할 점은?
3. `customer?.LastOrderedAt = DateTime.UtcNow;` 는 무슨 뜻인가?
4. C# 15 의 유니언 타입이 지금의 "업무 실패를 예외로 던지기" 방식을 어떻게 바꿀 수 있나?
5. .NET 10 에서 SSE 를 보내는 코드가 그 전과 어떻게 달라졌나?
6. EF 10 의 "이름 있는 쿼리 필터"가 멀티테넌트 서비스에서 막아 주는 사고는?
7. EF 10 의 `VectorDistance` 와 EF 11 의 `VectorSearch(...).WithApproximate()` 의 차이를 `03-rag` 의 용어(정확 탐색, ANN)로 설명해 보라.
8. GUID 를 PK 로 쓸 때 `Guid.CreateVersion7()` 이 나은 이유는?
9. .NET 8 에서 10 으로 올렸더니 프론트의 "로그인 안 됐으면 로그인 페이지로" 로직이 이상해졌다. 무엇이 바뀐 것인가?
10. EF Core 10 으로 올린 뒤 처음 만든 마이그레이션에 손대지 않은 열의 타입 변경이 들어 있다. 무엇을 의심하나?
