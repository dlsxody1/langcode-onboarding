# 처음 보는 .NET 코드베이스 읽는 법

입사 첫 주에 실제로 할 일. **문법을 몰라서 못 읽는 게 아니라, 어디부터 봐야 할지 몰라서 못 읽는다.**

프론트 저장소를 처음 받으면 `package.json` 의 스크립트를 보고 `app/` 폴더 구조를 훑은 뒤 페이지 하나를 골라 데이터가 어디서 오는지 따라간다. .NET 저장소도 순서는 같다. 파일 이름이 다를 뿐이다. 이 문서는 그 순서를 .NET 이름으로 바꿔 적은 것이다.

---

## 1. 솔루션 구조부터

```bash
find . -name "*.sln" -o -name "*.slnx" -o -name "*.csproj" | head -30
```

**솔루션**(`.sln`, 최신 SDK 는 XML 형식의 `.slnx` 도 쓴다)은 프로젝트 여러 개를 묶는 파일이다. **프로젝트**(`.csproj`)는 빌드 결과물(`.dll`) 하나를 만드는 단위다. pnpm 워크스페이스의 루트 설정과 각 패키지의 `package.json` 관계와 같다.

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

`Domain` 이 아무것도 참조하지 않고 `Api` 가 전부를 참조하면 **클린 아키텍처 계열**이다.
프로젝트가 하나뿐이면 폴더로만 나눈 단순 구조.

**클린 아키텍처**는 업무 규칙(Domain)을 가운데 두고 DB·HTTP·외부 API 같은 기술 세부사항을 바깥에 두는 설계다. 규칙은 하나다. **안쪽은 바깥쪽을 모른다.** Domain 은 EF Core 도 ASP.NET Core 도 참조하지 않는다. 그래서 DB 를 바꾸거나 같은 로직을 웹 API 와 백그라운드 워커에서 같이 써도 Domain 은 그대로다. 각 층의 역할은 `01-backend-basics/02-layers-and-di.md` 1절과 같다.

| 프로젝트 | 무엇을 참조하나 | 여기서 찾을 것 |
| --- | --- | --- |
| `Domain` | 없음 | 엔티티, 값 객체, 도메인 예외 |
| `Application` | Domain | 서비스, DTO, 인터페이스(`IPetRepository` 같은 "필요한 것"의 목록) |
| `Infrastructure` | Application, Domain | DbContext, 리포지토리 구현, 외부 API 클라이언트 |
| `Api` | 전부 | `Program.cs`, 컨트롤러/엔드포인트, DI 조립 |

> FSD 의 레이어 규칙과 같은 것을 **프로젝트 참조로 강제**하고 있는 것이다.
> `Domain` 에서 `Infrastructure` 를 참조하려 하면 컴파일이 안 된다. 린트가 아니라 컴파일러가 막는다.

### `.csproj` 와 저장소 루트 파일에서 볼 것

`.csproj` 는 생각보다 짧다. 몇 줄만 보면 그 프로젝트의 성격이 나온다.

```xml
<Project Sdk="Microsoft.NET.Sdk.Web">              <!-- Web: ASP.NET Core 앱. 그냥 Sdk 면 라이브러리·콘솔 -->
  <PropertyGroup>
    <TargetFramework>net8.0</TargetFramework>      <!-- 대상 .NET 버전 -->
    <Nullable>enable</Nullable>                     <!-- nullable 참조 타입 경고 켬 -->
    <ImplicitUsings>enable</ImplicitUsings>         <!-- 자주 쓰는 using 자동 추가 -->
  </PropertyGroup>
  <ItemGroup>
    <PackageReference Include="Npgsql.EntityFrameworkCore.PostgreSQL" Version="8.0.4" />
    <ProjectReference Include="..\Cxp.Application\Cxp.Application.csproj" />
  </ItemGroup>
</Project>
```

`PackageReference` 가 npm 의 `dependencies` 다. 여기 목록만 봐도 어떤 DB(Npgsql 은 PostgreSQL, `Microsoft.EntityFrameworkCore.SqlServer` 는 MSSQL)와 어떤 라이브러리(MediatR, FluentValidation, Polly, Dapper)를 쓰는지 보인다.

저장소 루트에 있으면 같이 열어 볼 파일들:

| 파일 | 하는 일 | 프론트로 치면 |
| --- | --- | --- |
| `global.json` | 이 저장소에서 쓸 .NET SDK 버전을 고정 | `.nvmrc` |
| `Directory.Build.props` | 모든 `.csproj` 에 공통으로 들어갈 설정 | 공통 `tsconfig.base.json` |
| `Directory.Packages.props` | 패키지 버전을 한 곳에서 관리 (Central Package Management) | 모노레포 루트의 버전 고정 |
| `.editorconfig` | 코드 스타일·분석기 규칙 | `.eslintrc` + `.prettierrc` |

`Directory.Packages.props` 가 있으면 각 `.csproj` 의 `PackageReference` 에는 버전이 없다. 버전을 올릴 때는 이 파일을 고친다.

---

## 2. 읽는 순서 (첫날 2시간)

### ① `Program.cs`
서비스 전체의 요약본이다. 여기서 알아낼 것:
- 어떤 DB 를 쓰나 (`AddDbContext` 의 `UseNpgsql` / `UseSqlServer`)
- 인증 방식은 (`AddJwtBearer` / `AddAuthentication` 스킴)
- 외부 의존성은 (`AddHttpClient<...>`)
- 백그라운드 작업이 있나 (`AddHostedService`)
- 미들웨어 순서

큰 코드베이스의 `Program.cs` 는 `builder.Services.AddCxpCore()` 같은 줄 몇 개로 짧게 줄어 있는 경우가 많다. 등록 코드를 모듈별 확장 메서드로 옮겨 둔 것이다. F12(Go to Definition)로 들어가면 실제 등록 목록이 나온다. 각 줄의 의미는 `02-csharp-dotnet/02-aspnet-core.md` 1절에서 정리했다.

### ② `appsettings.json`
**연결하는 모든 외부 시스템 목록**이다. LLM 프로바이더, 스토리지, 고객사 API, 벡터 DB.

`ConnectionStrings` 섹션은 DB, 나머지 섹션 이름은 대개 외부 시스템 이름이다. 값이 비어 있거나 `"<set-in-keyvault>"` 같은 자리표시만 있다면 실제 값은 환경변수나 Key Vault 에서 들어온다는 뜻이다. `appsettings.Development.json` 과 나란히 놓고 보면 로컬과 운영에서 무엇이 달라지는지 보인다.

### ③ 엔드포인트 목록 뽑기

```bash
grep -rn "\[Http\(Get\|Post\|Put\|Delete\|Patch\)" --include="*.cs" src/ | head -50
# Minimal API 라면
grep -rn "app\.Map\(Get\|Post\|Put\|Delete\)" --include="*.cs" src/
```

또는 앱을 띄우고 `/openapi/v1.json` (또는 `/swagger`) 을 열면 전부 나온다. **이게 제일 빠르다.**

Minimal API 는 `app.Map~` 대신 `group.MapGet(...)` 처럼 그룹 변수나 `IEndpointRouteBuilder` 확장 메서드 안에 흩어져 있을 수 있어서 위 grep 이 다 잡지 못한다. 그럴 때는 `MapGet\|MapPost` 로 넓혀서 찾는다.

### ④ 세로로 한 줄기 관통하기
관심 있는 엔드포인트 하나를 골라 **Controller → Service → Repository → 엔티티** 까지 끝까지 따라간다.
Cmd+클릭(Go to Definition)으로 내려가면서 각 층이 뭘 하는지 한 문장씩 적는다.

한 줄기를 완주하면 나머지는 대부분 같은 모양이다.

인터페이스(`IPetService`)에서 Go to Definition 을 하면 구현이 아니라 인터페이스 선언으로 간다. 구현 클래스로 가려면 **Go to Implementation**(VS Code·Visual Studio 기본 단축키 `Ctrl+F12`)을 쓴다. 구현이 여러 개라면 `Program.cs` 의 DI 등록에서 어느 것이 쓰이는지 확인한다.

적는 내용은 이 정도면 된다.

```
POST /api/pets
 PetsController.Create     요청 DTO 받고 서비스 호출, 201 반환
 PetService.CreateAsync    보호자 존재·이름 중복 검사 (여기서 409 예외)
 PetRepository.AddAsync    DbContext 에 Add
 AppDbContext              SaveChangesAsync 에서 INSERT
```

### ⑤ `DbContext`
`DbSet<T>` 목록 = 이 제품의 도메인 모델 전체. 10분이면 도메인 지도가 생긴다.

`OnModelCreating`(또는 `IEntityTypeConfiguration<T>` 파일들)의 `HasQueryFilter` 는 꼭 찾아본다. 멀티테넌시나 소프트 삭제처럼 "모든 쿼리에 몰래 붙는 조건"이 여기 있다. 이걸 모르면 SQL 로그를 보고 "이 WHERE 는 어디서 왔지?" 하고 한참 헤맨다. (→ `02-csharp-dotnet/03-ef-core.md` 1절)

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
| `IHttpClientFactory` / `AddHttpClient<T>` | `HttpClient` 를 직접 `new` 하지 않고 팩토리에서 받는다 |
| `Result<T>` / `ErrorOr<T>` / `OneOf<...>` | 예외 대신 반환값으로 실패를 알리는 패턴 |
| `required` (프로퍼티 앞) | 객체를 만들 때 반드시 채워야 하는 프로퍼티 (C# 11) |
| `AddDbContextPool` / `EF.CompileAsyncQuery` | EF Core 성능 최적화 |
| `[Fact]` / `[Theory]` + `WebApplicationFactory<Program>` | xUnit 테스트. 후자는 앱 전체를 띄우는 통합 테스트 |

표의 줄 몇 개는 짧은 설명만으로는 감이 안 와서 풀어 둔다.

- **`BackgroundService`** 는 HTTP 요청과 상관없이 앱이 떠 있는 동안 계속 도는 작업이다. `ExecuteAsync` 안에 `while (!stoppingToken.IsCancellationRequested)` 루프를 두고 큐를 읽거나 주기적으로 일을 한다. 요청 스코프가 없으므로 DbContext 를 쓰려면 스코프를 직접 열어야 한다. (→ `01-backend-basics/02-layers-and-di.md` 4절, `01-backend-basics/05-long-running-jobs.md`)
- **`ValueTask<T>`** 는 결과가 캐시에 있어 기다릴 필요가 없는 경우가 대부분인 메서드에 쓴다. 매번 `Task` 객체를 만드는 비용을 아낀다. 읽을 때는 `Task` 와 똑같이 `await` 하면 된다. 단, 한 `ValueTask` 를 두 번 `await` 하면 안 된다.
- **`Span<T>`** 는 배열이나 문자열의 일부를 복사 없이 가리키는 "창"이다. 파서나 인코더 같은 성능 코드에서 쓴다. 업무 코드에서는 거의 안 만난다.
- **`ConfigureAwait(false)`** 는 "await 가 끝난 뒤 원래 스레드 문맥으로 돌아가지 않아도 된다"는 표시다. UI 앱에서 쓰일 수 있는 라이브러리가 데드락을 피하려고 붙인다. ASP.NET Core 에는 돌아갈 문맥이 없어서 앱 코드에서는 효과가 없다. 회사 코드의 공용 라이브러리 프로젝트에서 보이면 정상이다. (→ `02-csharp-dotnet/01-csharp-for-ts-devs.md` 6절)
- **CQRS**(Command Query Responsibility Segregation)는 "데이터를 바꾸는 요청(커맨드)과 읽는 요청(쿼리)을 다른 객체로 나눈다"는 설계다. MediatR 을 쓰는 코드에서는 컨트롤러가 `await sender.Send(new CreatePetCommand(...))` 만 하고 실제 로직은 `CreatePetCommandHandler` 라는 별도 클래스에 있다. 그래서 Go to Definition 으로 따라가면 `Send` 에서 길이 끊긴다. 핸들러는 커맨드 클래스 이름 + `Handler` 로 검색해서 찾는다.

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

`yield return` 은 값을 하나 내보내고 다음 요청이 올 때까지 멈춘다. 전체 응답을 다 모은 뒤 한꺼번에 돌려주는 대신 토큰이 생기는 대로 하나씩 흘려보낸다. `[EnumeratorCancellation]` 은 소비하는 쪽에서 넘긴 취소 토큰이 이 메서드의 `ct` 로 연결되게 하는 표시다. 이게 없으면 사용자가 스트림을 끊어도 LLM 호출은 계속된다.

소비 코드의 `data: ...\n\n` 은 **SSE**(Server-Sent Events) 형식이다. 브라우저의 `EventSource` 나 `fetch` 스트림 리더가 이 형식을 읽는다. 프론트 쪽 짝은 `05-realtime-ui/` 에서 다룬다.

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

Spring 을 안 해 봤다면 NestJS 가 가장 가까운 비교 대상이다. 데코레이터로 컨트롤러를 만들고 모듈에 프로바이더를 등록하고 생성자로 주입받는 구조가 ASP.NET Core 컨트롤러 방식과 거의 같다. NestJS 가 Spring 과 ASP.NET 의 구조를 TS 로 옮겨 온 프레임워크이기 때문이다.

---

## 5. 첫 주에 물어볼 목록 (`> ❓` 모음)

문서들에 흩어 놓은 질문들. 입사하면 여기에 답을 채운다.

- [ ] 에러 응답 포맷은 `ProblemDetails` 인가 자체 포맷인가
- [ ] 업무 규칙 실패는 예외로 던지나, `Result` 류 반환값으로 돌려주나
- [ ] 서비스에 인터페이스를 항상 두는 컨벤션인가
- [ ] 컨트롤러 vs Minimal API — 신규 엔드포인트 기준
- [ ] 서비스별 `TargetFramework`(.NET 버전)는 무엇이고 업그레이드는 언제 하나
- [ ] 마이그레이션은 누가 언제 적용하나. 고객사 온프레미스 설치본은?
- [ ] EF Core 외에 Dapper 나 생 SQL 을 쓰나. 그때 테넌트 조건은 어떻게 강제하나
- [ ] 백그라운드 작업(에이전트 실행)은 인프로세스인가 별도 워커인가. 큐는 뭘 쓰나
- [ ] Vector DB 는 pgvector 인가 별도 제품인가
- [ ] 멀티테넌시 격리는 행 단위인가 스키마/DB 분리인가
- [ ] 고객사 문서 권한을 어떻게 가져와 검색 필터로 쓰나. 동기화 주기는
- [ ] 토큰은 어디 보관하나. 고객사 SSO 연동 방식은
- [ ] 프롬프트는 어디서 버전 관리되나 (코드? DB? 별도 도구?)
- [ ] MAF 와 자체 Agentic 코어의 경계는 어디인가
- [ ] 통합 테스트는 어떤 DB 로 도나 (Testcontainers? 공유 테스트 DB?)
- [ ] 로컬에서 전체 스택을 어떻게 띄우나 (docker compose 가 있나)

---

## 6. 막혔을 때

- **`dotnet watch run`** 으로 띄우고 Swagger/OpenAPI 에서 직접 호출해 본다. 읽는 것보다 빠르다
- **SQL 로깅을 켜고** 화면 하나를 눌러본다. 어떤 쿼리가 나가는지가 곧 그 기능의 구조다
- **디버거로 중단점** — VS Code 에서 F5. 요청 하나가 실제로 어떤 경로로 가는지 눈으로 본다
- **테스트 코드를 읽는다** — `tests/` 의 테스트 이름(`같은_보호자에게_같은_이름이면_409`)이 그 기능의 명세다. 문서보다 정확한 경우가 많다
- **Claude 에게 파일을 통째로 주고 "이 코드가 하는 일을 한국어로 설명해줘"** — 문법 해석은 이게 제일 빠르다.
  다만 **왜 이렇게 설계했는지는 물어봐도 모른다.** 그건 사람에게 물어라

빌드부터 안 될 때 확인할 순서도 적어 둔다.

1. `dotnet --list-sdks` 로 설치된 SDK 와 `global.json` 이 요구하는 버전이 맞는지 본다
2. `dotnet restore` 가 사내 NuGet 피드 인증에서 막히는지 본다 (`nuget.config` 에 사내 피드가 있으면 거의 이것이다)
3. 로컬 DB·Redis 같은 의존성이 떠 있는지, `appsettings.Development.json` 이나 user-secrets 에 필요한 값이 있는지 본다

> ❓ 입사 후 확인: 사내 NuGet 피드가 있나? 로컬 개발용 user-secrets 목록은 어디에 정리돼 있나?
