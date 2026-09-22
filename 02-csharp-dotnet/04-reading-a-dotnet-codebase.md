# 처음 보는 .NET 코드베이스 읽는 법

입사 첫 주에 실제로 할 일. **문법을 몰라서 못 읽는 게 아니라, 어디부터 봐야 할지 몰라서 못 읽는다.**

---

## 1. 솔루션 구조부터

```bash
find . -name "*.sln" -o -name "*.csproj" | head -30
```

전형적인 구조:

```
Cxp.sln
├── src/
│   ├── Cxp.Api/              ← 웹 진입점. Program.cs, Controllers/
│   ├── Cxp.Application/      ← 서비스, 유스케이스, DTO
│   ├── Cxp.Domain/           ← 엔티티, 도메인 규칙. 의존성 없음
│   ├── Cxp.Infrastructure/   ← DbContext, 외부 API 클라이언트, 파일 저장소
│   └── Cxp.Worker/           ← 백그라운드 잡
└── tests/
    ├── Cxp.UnitTests/
    └── Cxp.IntegrationTests/
```

**의존 방향을 확인해라.** `.csproj` 의 `<ProjectReference>` 를 보면 된다.

```bash
grep -r "ProjectReference" --include="*.csproj" .
```

`Domain` 이 아무것도 참조하지 않고, `Api` 가 전부를 참조하면 **클린 아키텍처 계열**이다.
프로젝트가 하나뿐이면 폴더로만 나눈 단순 구조.

> FSD 의 레이어 규칙과 같은 것을 **프로젝트 참조로 강제**하고 있는 것이다.
> `Domain` 에서 `Infrastructure` 를 참조하려 하면 컴파일이 안 된다. 린트가 아니라 컴파일러가 막는다.

---

## 2. 읽는 순서 (첫날 2시간)

### ① `Program.cs`
서비스 전체의 요약본이다. 여기서 알아낼 것:
- 어떤 DB 를 쓰나 (`AddDbContext` 의 `UseNpgsql` / `UseSqlServer`)
- 인증 방식은 (`AddJwtBearer` / `AddAuthentication` 스킴)
- 외부 의존성은 (`AddHttpClient<...>`)
- 백그라운드 작업이 있나 (`AddHostedService`)
- 미들웨어 순서

### ② `appsettings.json`
**연결하는 모든 외부 시스템 목록**이다. LLM 프로바이더, 스토리지, 고객사 API, 벡터 DB.

### ③ 엔드포인트 목록 뽑기

```bash
grep -rn "\[Http\(Get\|Post\|Put\|Delete\|Patch\)" --include="*.cs" src/ | head -50
# Minimal API 라면
grep -rn "app\.Map\(Get\|Post\|Put\|Delete\)" --include="*.cs" src/
```

또는 앱을 띄우고 `/openapi/v1.json` (또는 `/swagger`) 을 열면 전부 나온다. **이게 제일 빠르다.**

### ④ 세로로 한 줄기 관통하기
관심 있는 엔드포인트 하나를 골라 **Controller → Service → Repository → 엔티티** 까지 끝까지 따라간다.
Cmd+클릭(Go to Definition)으로 내려가면서, 각 층이 뭘 하는지 한 문장씩 적는다.

한 줄기를 완주하면 나머지는 대부분 같은 모양이다.

### ⑤ `DbContext`
`DbSet<T>` 목록 = 이 제품의 도메인 모델 전체. 10분이면 도메인 지도가 생긴다.

### ⑥ 마이그레이션 폴더
파일명이 날짜순이라 **제품이 어떻게 변해 왔는지의 역사**다. 최근 5개만 봐도 지금 뭘 하고 있는지 보인다.

---

## 3. 코드에서 만나는 것들 — 빠른 해독표

| 보이는 것 | 의미 |
| --- | --- |
| `IServiceCollection` 확장 메서드 (`services.AddCxpCore()`) | 등록 코드를 모듈별로 묶은 것. 정의를 따라가면 실제 등록 목록 |
| `[FromKeyedServices("openai")]` | 같은 인터페이스의 여러 구현 중 이름으로 선택 (.NET 8+) |
| `IHostedService` / `BackgroundService` | 백그라운드 워커 |
| `IAsyncEnumerable<T>` + `yield return` | **스트리밍.** LLM 토큰 스트림이 거의 항상 이 타입 |
| `ValueTask<T>` | 대부분 동기로 끝나는 경우의 최적화. `Task` 처럼 `await` |
| `record struct` | 값 타입 record. 성능 최적화 |
| `Span<T>` / `Memory<T>` | 할당 없는 버퍼 조작. 성능 코드 |
| `sealed` | 상속 금지 |
| `partial class` | 파일 여러 개로 쪼갠 클래스. 자동 생성 코드에서 흔함 |
| `[GeneratedRegex]` | 컴파일 타임 정규식 생성 |
| `#region` | 접기용 구분. 무시해도 된다 |
| `CancellationToken ct = default` | 취소 토큰. **전파되고 있는지 확인** |
| `ConfigureAwait(false)` | 라이브러리 코드에서 봄. ASP.NET Core 앱 코드에는 불필요 |
| `ILogger<T>` | 구조화 로깅 |
| `IOptions<T>` / `IOptionsSnapshot<T>` | 설정 주입 |
| `MediatR` / `ISender.Send(...)` | CQRS 라이브러리. 컨트롤러가 서비스 대신 커맨드 객체를 보냄 |

### `IAsyncEnumerable` — AI 제품에서 반드시 만난다

```csharp
public async IAsyncEnumerable<string> StreamAsync(
    string prompt, [EnumeratorCancellation] CancellationToken ct = default)
{
    await foreach (var chunk in _llm.CompleteStreamAsync(prompt, ct))
        yield return chunk.Text;
}

// 소비
await foreach (var token in svc.StreamAsync(prompt, ct))
    await Response.WriteAsync($"data: {token}\n\n", ct);
```

JS 의 async generator (`async function*` + `for await`) 와 **정확히 같은 개념**이다.
LLM 스트리밍 엔드포인트는 거의 다 이렇게 생겼다.

---

## 4. 빠른 대조표 (TS / Spring → C#)

Spring Boot 를 해봤으면 이 표 하나로 대부분 건너뛸 수 있다.

| 개념 | Spring Boot | ASP.NET Core |
| --- | --- | --- |
| 진입점 | `@SpringBootApplication` | `Program.cs` |
| 컨트롤러 | `@RestController` | `[ApiController]` + `ControllerBase` |
| 라우트 | `@GetMapping("/x")` | `[HttpGet("x")]` |
| 바디 바인딩 | `@RequestBody` | `[FromBody]` |
| 서비스 등록 | `@Service` | `services.AddScoped<I,Impl>()` |
| 주입 | 생성자 / `@Autowired` | 생성자 |
| 싱글톤/요청스코프 | `@Scope("singleton"/"request")` | `AddSingleton` / `AddScoped` |
| ORM | JPA / Hibernate | EF Core |
| 엔티티 | `@Entity` | `DbSet<T>` + Fluent API |
| 리포지토리 | `JpaRepository<T,ID>` | `DbSet<T>` + LINQ (직접 작성) |
| 지연로딩 | `@ManyToOne(fetch=LAZY)` | 기본 비활성. `Include` 명시 |
| 영속성 컨텍스트 | `EntityManager` | `DbContext` |
| flush/commit | `@Transactional` | `SaveChangesAsync()` |
| 설정 | `application.yml` | `appsettings.json` |
| 프로파일 | `@Profile("dev")` | `appsettings.Development.json` + `IsDevelopment()` |
| 필터/인터셉터 | `Filter`, `HandlerInterceptor` | 미들웨어, 액션 필터 |
| 검증 | `@Valid` + Bean Validation | `[ApiController]` 자동 + FluentValidation |
| 예외 처리 | `@ControllerAdvice` | `IExceptionHandler` |
| 테스트 | `@SpringBootTest` | `WebApplicationFactory<Program>` |
| 목 | Mockito | NSubstitute / Moq |
| 빌드 | Gradle / Maven | `dotnet build` / `.csproj` |

**거의 1:1 이다.** 개념을 새로 배우는 게 아니라 이름을 바꿔 부르는 것에 가깝다.

---

## 5. 첫 주에 물어볼 목록 (`> ❓` 모음)

문서들에 흩어 놓은 질문들. 입사하면 여기에 답을 채운다.

- [ ] 에러 응답 포맷은 `ProblemDetails` 인가 자체 포맷인가
- [ ] 서비스에 인터페이스를 항상 두는 컨벤션인가
- [ ] 컨트롤러 vs Minimal API — 신규 엔드포인트 기준
- [ ] 마이그레이션은 누가 언제 적용하나. 고객사 온프레미스 설치본은?
- [ ] 백그라운드 작업(에이전트 실행)은 인프로세스인가 별도 워커인가. 큐는 뭘 쓰나
- [ ] Vector DB 는 pgvector 인가 별도 제품인가
- [ ] 멀티테넌시 격리는 행 단위인가 스키마/DB 분리인가
- [ ] 고객사 문서 권한을 어떻게 가져와 검색 필터로 쓰나. 동기화 주기는
- [ ] 토큰은 어디 보관하나. 고객사 SSO 연동 방식은
- [ ] 프롬프트는 어디서 버전 관리되나 (코드? DB? 별도 도구?)
- [ ] MAF 와 자체 Agentic 코어의 경계는 어디인가
- [ ] 로컬에서 전체 스택을 어떻게 띄우나 (docker compose 가 있나)

---

## 6. 막혔을 때

- **`dotnet watch run`** 으로 띄우고 Swagger/OpenAPI 에서 직접 호출해 본다. 읽는 것보다 빠르다
- **SQL 로깅을 켜고** 화면 하나를 눌러본다. 어떤 쿼리가 나가는지가 곧 그 기능의 구조다
- **디버거로 중단점** — VS Code 에서 F5. 요청 하나가 실제로 어떤 경로로 가는지 눈으로 본다
- **Claude 에게 파일을 통째로 주고 "이 코드가 하는 일을 한국어로 설명해줘"** — 문법 해석은 이게 제일 빠르다.
  다만 **왜 이렇게 설계했는지는 물어봐도 모른다.** 그건 사람에게 물어라
