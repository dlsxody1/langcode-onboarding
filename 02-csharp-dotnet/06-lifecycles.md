# 생명주기 딥다이브 — 앱 · 요청 · DI 서비스 · 객체 · .NET 버전

`01-backend-basics/02-layers-and-di.md` 4절에서 Transient · Scoped · Singleton 과 함정 두 개를 봤다. 그건 입구다.
실무에서 터지는 생명주기 문제는 더 넓다. "배포할 때마다 진행 중이던 에이전트 실행이 끊긴다", "트래픽이 몰리면 소켓이 고갈된다",
"개발 환경에서는 멀쩡한데 운영에서만 데이터가 섞인다" 같은 것들이다.

.NET 에서 "생명주기"는 **다섯 겹**이다. 바깥에서 안쪽 순서로 본다.

| 겹 | 무엇이 언제 태어나고 죽나 | 틀리면 생기는 일 |
| --- | --- | --- |
| **1. 앱 (Host)** | 프로세스 시작 → 서비스 시작 → 요청 처리 → 종료 신호 → 정리 → 프로세스 끝 | 배포 때 진행 중 작업이 끊긴다, 종료가 안 되거나 강제 종료된다 |
| **2. 요청** | 요청 하나마다 스코프가 열리고 닫힌다 | 요청이 끝났는데 계속 도는 작업, 취소되지 않는 LLM 호출 |
| **3. DI 서비스** | Transient · Scoped · Singleton 이 언제 만들어지고 버려지나 | 데이터 섞임, 메모리 누수, "second operation" 예외 |
| **4. 객체 (GC · Dispose)** | 메모리와 OS 자원(연결, 파일, 소켓)이 언제 반납되나 | 커넥션 풀 고갈, 소켓 고갈, 메모리 증가 |
| **5. .NET 버전** | 버전마다 지원 기간이 정해져 있다 | 보안 패치가 끊긴 런타임으로 운영 |

> 공식 문서: [.NET 의 종속성 주입](https://learn.microsoft.com/ko-kr/dotnet/core/extensions/dependency-injection) ·
> [.NET 제네릭 호스트](https://learn.microsoft.com/ko-kr/dotnet/core/extensions/generic-host) ·
> [DI 지침](https://learn.microsoft.com/ko-kr/dotnet/core/extensions/dependency-injection-guidelines) ·
> [.NET 지원 정책](https://dotnet.microsoft.com/ko-kr/platform/support/policy/dotnet-core)

---

## 1. 앱 생명주기 — Host 가 시작하고 끝내는 법

### 전체 순서

ASP.NET Core 앱은 **호스트(Host)** 위에서 돈다. 호스트는 "DI 컨테이너 + 설정 + 로깅 + 시작/종료 관리"를 한 묶음으로 가진 객체다.
`Program.cs` 의 코드가 실제로 어떤 순서로 무엇을 하는지 펼치면 이렇다.

```
① var builder = WebApplication.CreateBuilder(args);
     설정 읽기 (appsettings.json → appsettings.{환경}.json → 사용자 비밀 → 환경 변수 → 명령줄. 뒤가 앞을 덮어쓴다)
     로깅 준비

② builder.Services.Add...(...)
     DI 컨테이너에 "만드는 법"만 등록한다. 아직 아무것도 만들지 않는다

③ var app = builder.Build();
     컨테이너가 확정된다. 이후로는 등록을 바꿀 수 없다
     개발 환경이면 여기서 등록 검증(ValidateOnBuild · ValidateScopes)이 돈다 → 3절

④ app.Use...(...) / app.Map...(...)
     미들웨어 파이프라인과 엔드포인트를 조립한다 (01-backend-basics/01-request-lifecycle.md)

⑤ app.Run();
     ├─ IHostedService.StartAsync 를 등록 순서대로 호출 (BackgroundService 포함)
     ├─ Kestrel 이 포트를 열고 요청을 받기 시작
     ├─ IHostApplicationLifetime.ApplicationStarted 발생
     │
     │   … 요청 처리 …
     │
     ├─ 종료 신호 (Ctrl+C, SIGTERM — 컨테이너 재배포 때 오는 신호)
     ├─ ApplicationStopping 발생
     ├─ Kestrel 이 새 요청을 거절하고, 처리 중인 요청이 끝나길 기다림
     ├─ IHostedService.StopAsync 를 등록 역순으로 호출 (stoppingToken 이 취소됨)
     ├─ 전체를 ShutdownTimeout(기본 30초) 안에 끝내야 한다. 넘기면 남은 작업을 버리고 진행
     ├─ ApplicationStopped 발생
     └─ 루트 DI 컨테이너 Dispose → Singleton 들의 Dispose 호출 → 프로세스 종료
```

### 우아한 종료 (graceful shutdown) — 배포 때마다 터지는 곳

컨테이너 환경(Azure Container Apps, Kubernetes)에서 새 버전을 배포하면, 옛 컨테이너에 **SIGTERM** 이 오고 일정 시간 뒤 강제 종료(SIGKILL)된다.
이 사이에 정리를 끝내야 한다.

```csharp
public class AgentRunWorker(IServiceScopeFactory scopes, ILogger<AgentRunWorker> log) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)          // ← 종료 신호가 오면 루프를 빠져나온다
        {
            var job = await DequeueAsync(stoppingToken);          // ← 대기 중에도 토큰을 넘겨 즉시 깨어나게
            if (job is null) continue;

            await using var scope = scopes.CreateAsyncScope();    // ← 작업 하나 = 스코프 하나 (3절)
            var runner = scope.ServiceProvider.GetRequiredService<IAgentRunner>();
            try
            {
                await runner.RunAsync(job, stoppingToken);       // ← LLM 호출까지 토큰이 내려가야 끊을 수 있다
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                await MarkForRetryAsync(job);                    // ← 끊긴 작업은 "재시도 대기"로 돌려놓는다 (멱등성 필요)
                log.LogInformation("종료 중이라 작업 {Id} 를 되돌림", job.Id);
            }
        }
    }
}
```

지켜야 할 것 세 가지.

1. **`CancellationToken` 을 끝까지 내려보낸다.** 중간에서 끊기면(`CancellationToken.None`) 종료 신호가 와도 그 작업은 멈추지 않고, 30초 뒤 강제로 버려진다
2. **30초 안에 못 끝나는 작업은 "끝내기"가 아니라 "되돌리기"를 설계한다.** 몇 분짜리 에이전트 실행을 종료 시간 안에 끝낼 수는 없다. 큐로 돌려놓고 새 인스턴스가 다시 잡게 한다 → 그래서 작업이 **멱등**해야 한다 (`01-backend-basics/05-long-running-jobs.md`)
3. **필요하면 종료 시간을 늘리되, 플랫폼의 유예 시간보다 짧게.** `builder.Services.Configure<HostOptions>(o => o.ShutdownTimeout = TimeSpan.FromSeconds(60));` 를 늘려도 컨테이너 플랫폼이 그보다 먼저 SIGKILL 을 보내면 소용없다

### 시작·종료 시점에 끼어드는 법

| 필요 | 쓰는 것 |
| --- | --- |
| 계속 도는 백그라운드 작업 | `BackgroundService` (의 `ExecuteAsync`) |
| 시작할 때 한 번 (캐시 예열, 연결 확인) | `IHostedService.StartAsync`. **오래 걸리면 앱 시작 전체가 늦어진다** — 무거운 일은 `BackgroundService` 로 |
| 시작 전후·종료 전후를 세밀하게 | `IHostedLifecycleService` (.NET 8+): `StartingAsync` · `StartedAsync` · `StoppingAsync` · `StoppedAsync` |
| 아무 곳에서나 "종료가 시작됐나" 알기 | `IHostApplicationLifetime.ApplicationStopping` 토큰 |

> `BackgroundService.ExecuteAsync` 안에서 처리하지 않은 예외가 나면, .NET 6 부터는 **호스트 전체가 멈춘다**(기본 동작). 루프 안의 한 작업이 실패해도 서버가 죽지 않게 작업 단위로 `try/catch` 한다.

---

## 2. 요청 생명주기 — 스코프와 취소

요청이 들어오는 경로(미들웨어 → 라우팅 → 컨트롤러)는 `01-backend-basics/01-request-lifecycle.md` 에서 봤다. 생명주기 관점에서 덧붙일 것은 두 가지다.

**요청 하나 = DI 스코프 하나.** 요청이 시작될 때 스코프가 열리고(`HttpContext.RequestServices`), 응답이 끝나면 닫히면서 그 안의 Scoped · Transient 중 `IDisposable` 인 것들이 Dispose 된다.
`DbContext` 가 요청마다 새로 생기고 요청 끝에 연결을 반납하는 이유가 이것이다.

**요청에도 취소 토큰이 있다.** 사용자가 브라우저를 닫거나 채팅 화면에서 "중지"를 누르면 `HttpContext.RequestAborted` 가 취소된다.
컨트롤러 액션에 `CancellationToken ct` 매개변수를 두면 이 토큰이 들어온다.

```csharp
[HttpPost("chat")]
public async Task Chat(ChatRequest req, CancellationToken ct)    // ← RequestAborted 가 바인딩된다
{
    await foreach (var token in _llm.StreamAsync(req, ct))         // ← 사용자가 떠나면 LLM 스트리밍도 멈춘다
        await Response.WriteAsync(token, ct);
}
```

토큰을 넘기지 않으면 사용자는 떠났는데 서버는 LLM 응답을 끝까지 받아 비용을 쓴다. **AI 제품에서는 취소 누락이 그대로 돈이다.**

---

## 3. DI 서비스 수명 — 깊이 보기

### 표 하나로 다시

| | Transient | Scoped | Singleton |
| --- | --- | --- | --- |
| 언제 만들어지나 | 요청(주입)할 때마다 새로 | 스코프(보통 HTTP 요청)마다 1개 | 처음 필요할 때 1개 (앱 전체) |
| 언제 Dispose 되나 | **자기를 만든 스코프**가 닫힐 때 | 스코프가 닫힐 때 | 앱 종료 때 (루트 컨테이너) |
| 동시 접근 | 거의 없음 | 한 요청 안에서만 | **모든 요청·스레드가 동시에** → 스레드 안전 필수 |
| 대표 | 가볍고 상태 없는 도구 | `DbContext`, 현재 사용자·테넌트 정보 | 설정, 캐시, `IHttpClientFactory`, 로거 |

### 규칙 1 — 오래 사는 것이 짧게 살 것을 붙잡으면 안 된다 (captive dependency)

`01-backend-basics/02-layers-and-di.md` 4절의 함정 1이다. Singleton 이 Scoped(`DbContext`)를 생성자로 받으면, 첫 요청의 `DbContext` 가 앱이 죽을 때까지 살아남는다.
여러 요청이 하나의 `DbContext` 를 동시에 쓰게 되고, 앞 요청의 테넌트 정보가 뒤 요청에 남을 수도 있다.

**함정의 함정: 이 실수는 개발 환경에서만 잡힌다.**
ASP.NET Core 는 **개발 환경에서만** `ValidateScopes` 와 `ValidateOnBuild` 를 켠다. 그래서 개발할 때는
`Cannot consume scoped service 'AppDbContext' from singleton 'ICacheWarmer'` 예외가 뜨지만, 운영 환경에서는 **조용히 동작하다가 데이터가 섞인다.**

```csharp
// 운영에서도 검증하고 싶다면 (시작 시간이 조금 늘어난다)
builder.Host.UseDefaultServiceProvider(o =>
{
    o.ValidateScopes = true;    // Singleton 이 Scoped 를 잡는지 검사
    o.ValidateOnBuild = true;   // Build() 때 모든 등록을 만들어 볼 수 있는지 검사 (빠진 등록 조기 발견)
});
```

Singleton 안에서 Scoped 가 필요하면 **그때그때 스코프를 연다.**

```csharp
public class CacheWarmer(IServiceScopeFactory scopes) : ICacheWarmer
{
    public async Task WarmAsync(CancellationToken ct)
    {
        await using var scope = scopes.CreateAsyncScope();   // ← 이 블록이 끝나면 DbContext 도 Dispose
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        // ...
    }
}
```

1절의 `BackgroundService` 도 같은 이유로 작업마다 스코프를 연다. **백그라운드에는 HTTP 요청이 없으니 자동으로 열리는 스코프도 없다.**

### 규칙 2 — Transient 인 `IDisposable` 을 루트에서 꺼내지 않는다

컨테이너는 자기가 만든 `IDisposable` 객체를 기억했다가 **스코프가 닫힐 때** Dispose 한다. Transient 도 마찬가지다.
그런데 루트 컨테이너(스코프 밖, 예: Singleton 의 생성 과정이나 `app.Services.GetService(...)`)에서 Transient `IDisposable` 을 계속 꺼내면,
루트는 앱이 끝날 때까지 닫히지 않으므로 **꺼낸 객체가 전부 메모리에 쌓인다.** 공식 DI 지침이 경고하는 메모리 누수 패턴이다.

### 규칙 3 — `DbContext` 는 한 번에 한 작업만

`DbContext` 는 스레드 안전하지 않다. 한 요청 안에서도 **동시에** 두 쿼리를 돌리면 터진다.

```csharp
// ❌ 같은 DbContext 로 병렬 쿼리
var ordersTask = _db.Orders.Where(...).ToListAsync(ct);
var itemsTask  = _db.Items.Where(...).ToListAsync(ct);
await Task.WhenAll(ordersTask, itemsTask);
// → InvalidOperationException: A second operation was started on this context instance before a previous operation completed.
```

| 상황 | 해결 |
| --- | --- |
| 한 요청 안에서 순서대로 쿼리 | 그냥 `await` 를 차례로. 대부분 이걸로 충분하다 |
| 정말 병렬이 필요하다 (대시보드 집계 여러 개) | `IDbContextFactory<AppDbContext>` 로 작업마다 `DbContext` 를 따로 만든다 (`AddDbContextFactory`) |
| 백그라운드 작업 | 작업마다 스코프(규칙 1) 또는 팩토리 |
| `DbContext` 생성 비용이 신경 쓰인다 | `AddDbContextPool` — 인스턴스를 재사용한다. 단, **생성자에서 요청별 상태(테넌트 ID 등)를 받아 필드에 두면 다음 요청에 남는다.** 풀링을 쓸 거면 상태를 필드에 두지 않는다 |

### 규칙 4 — `HttpClient` 는 직접 만들지도, 영원히 들고 있지도 않는다

외부 LLM API · 고객사 시스템을 부르는 코드가 많은 회사라 거의 반드시 만난다.

| 방식 | 문제 |
| --- | --- |
| `new HttpClient()` 를 요청마다 | 소켓이 바로 반납되지 않아 트래픽이 몰리면 **소켓 고갈** |
| `static HttpClient` 하나를 앱 내내 | 연결을 계속 재사용해서 상대 서버의 **DNS 변경을 못 따라간다** |
| **`IHttpClientFactory`** (`AddHttpClient`) | 내부 핸들러를 풀에 두고 주기적으로(기본 2분) 교체한다. 둘 다 해결 |

```csharp
builder.Services.AddHttpClient<OpenAiClient>(c => c.BaseAddress = new Uri("https://..."))
    .AddStandardResilienceHandler();    // 재시도·타임아웃·서킷 브레이커 (07-db-infra/03-resilience.md)
```

**함정:** 이렇게 등록한 타입 클라이언트(`OpenAiClient`)는 **Transient** 다. Singleton 이 생성자로 받으면 규칙 1과 같은 이유로 핸들러 교체가 멈춘다.
Singleton 에서 써야 하면 `IHttpClientFactory` 를 받아 그때그때 `CreateClient()` 한다.

### 규칙 5 — 설정(Options)도 수명이 셋이다

`02-aspnet-core.md` 4절의 타입 있는 설정을 주입받는 방법이 세 가지이고, 수명이 다르다.

| 인터페이스 | 수명 | 값이 언제 바뀌나 | 쓸 곳 |
| --- | --- | --- | --- |
| `IOptions<T>` | Singleton | 앱 시작 때 한 번 읽고 끝 | 바뀔 일 없는 설정 |
| `IOptionsSnapshot<T>` | **Scoped** | 요청마다 다시 읽음 | 요청 처리 코드. **Singleton 에 주입하면 captive dependency** |
| `IOptionsMonitor<T>` | Singleton | 파일이 바뀌면 즉시 + 변경 알림(`OnChange`) | Singleton · 백그라운드 서비스 |

### 규칙 6 — 같은 인터페이스의 구현이 여럿이면: keyed services (.NET 8+)

고객사마다 연동 어댑터가 다른 상황(`01-backend-basics/02-layers-and-di.md` 6절)에서 쓰는 기능이다.

```csharp
builder.Services.AddKeyedScoped<IDocumentSource, SharePointSource>("sharepoint");
builder.Services.AddKeyedScoped<IDocumentSource, ConfluenceSource>("confluence");

public class IngestHandler([FromKeyedServices("sharepoint")] IDocumentSource source) { ... }

// 실행 중에 고르기 (고객사 설정에 따라)
var source = sp.GetRequiredKeyedService<IDocumentSource>(tenant.SourceKind);
```

같은 인터페이스를 키 없이 여러 번 등록하면 **마지막 등록**이 주입되고, `IEnumerable<IDocumentSource>` 로 받으면 **전부** 받는다. 덮어쓰기를 피하려면 `TryAdd...` 를 쓴다.

### 규칙 7 — Dispose 는 컨테이너가 한다

- 컨테이너가 **만든** 객체는 컨테이너가 Dispose 한다. 내가 `Dispose()` 를 부르면 이중 해제가 된다
- `AddSingleton(new Foo())` 처럼 **내가 만들어 넣은** 인스턴스는 컨테이너가 Dispose 하지 않는다
- `IAsyncDisposable` 만 구현한 객체가 있으면 스코프도 `await using` (`CreateAsyncScope`) 으로 닫아야 한다. 동기 `using` 으로 닫으면 예외가 난다

---

## 4. 객체 생명주기 — GC 와 Dispose

### 메모리는 GC 가, 자원은 내가

C# 은 TS 처럼 메모리를 직접 해제하지 않는다. **가비지 컬렉터(GC)** 가 더 이상 참조되지 않는 객체를 치운다. 그런데 GC 가 치우는 건 **메모리**뿐이다.
DB 연결, 파일 핸들, 소켓 같은 **OS 자원**은 GC 가 언제 돌지 모르니 직접 반납해야 한다. 그게 `IDisposable` 과 `using` 이다.

```csharp
await using var conn = new NpgsqlConnection(cs);   // 블록(또는 메서드)이 끝나면 conn.DisposeAsync() → 커넥션 풀에 반납
await conn.OpenAsync(ct);
```

`using` 을 빠뜨리면 메모리는 결국 치워지지만 **연결은 GC 가 돌 때까지 붙잡혀** 커넥션 풀이 고갈된다(`01-backend-basics/03-database.md` 커넥션 풀).
DI 로 받은 객체는 3절 규칙 7대로 컨테이너가 처리하니 `using` 하지 않는다. **내가 `new` 한 `IDisposable` 만 내가 닫는다.**

### GC 를 이해하는 최소한

| 개념 | 뜻 | 실무에서 |
| --- | --- | --- |
| **세대 (0 · 1 · 2)** | 새 객체는 0세대. 살아남을수록 1, 2세대로 올라가고, 2세대는 드물게 치운다 | 짧게 쓰고 버리는 객체는 싸다. **오래 붙잡는 객체**가 비싸다 |
| **LOH (대형 객체 힙)** | 85,000바이트 이상 객체는 따로 관리되고 잘 치워지지 않는다 | 큰 배열·문자열을 반복해서 만들면 메모리가 계단식으로 오른다 (예: 임베딩 배열, 큰 JSON 을 통째로 문자열로) → 스트리밍·`ArrayPool` |
| **Server GC** | ASP.NET Core 기본. 코어마다 힙을 두어 처리량을 높인다 | 메모리를 넉넉히 잡는 편이라 컨테이너 메모리 제한과 같이 본다 |

### .NET 에서도 메모리는 샌다

GC 가 있어도 **참조가 남아 있으면** 못 치운다. 흔한 누수 패턴.

- Singleton 이나 `static` 컬렉션에 계속 추가만 하는 캐시 (상한·만료 없음) → `IMemoryCache` 에 크기 제한, 또는 `HybridCache`
- Singleton 이 이벤트를 구독하고 해제하지 않음 → 구독한 객체가 영원히 살아남는다
- 3절 규칙 2 (루트에서 꺼낸 Transient `IDisposable`)
- 람다가 큰 객체를 캡처한 채 Singleton 에 저장됨

---

## 5. .NET 버전 생명주기 — 지원 기간

**.NET 은 매년 11월에 새 메이저 버전이 나오고, 버전마다 지원 기간이 정해져 있다.** 지원이 끝나면 보안 패치가 없다.

| 종류 | 버전 | 무료 지원 기간 |
| --- | --- | --- |
| **LTS** (Long Term Support) | 짝수: 8, 10, 12 | **3년** |
| **STS** (Standard Term Support) | 홀수: 9, 11, 13 | **2년** (.NET 9 부터 18개월 → 24개월로 늘었다) |

| 버전 | 종류 | 출시 | 지원 종료 | 지금 (2026-10) |
| --- | --- | --- | --- | --- |
| .NET 8 | LTS | 2023-11 | **2026-11-10** | 곧 종료 — 유지보수(보안 패치만) 단계 |
| .NET 9 | STS | 2024-11 | **2026-11-10** | 곧 종료 |
| **.NET 10** | **LTS** | 2025-11-11 | 2028-11 | **현재 주력** |
| .NET 11 | STS | 2026-11 예정 (현재 RC) | 2028-11 예정 | 출시 직전 |

**눈여겨볼 점: .NET 8 과 9 가 같은 날(2026-11-10) 지원이 끝난다.** 회사 코드가 8이나 9라면 .NET 10 으로 올리는 일이 지금 진행 중이거나 곧 시작될 가능성이 높다.
업그레이드 때 확인할 변경점은 `07-dotnet-versions.md` 에 정리했다.

- 패치는 매달 둘째 화요일(Patch Tuesday)에 나온다. **지원 대상이 되려면 최신 패치를 유지해야 한다**
- 버전 확인: 프로젝트 파일의 `<TargetFramework>net10.0</TargetFramework>`, 저장소 루트의 `global.json`(SDK 고정), `dotnet --info`

> ❓ 입사 후 확인
> - 사내 서비스들의 `TargetFramework` 는 무엇인가? .NET 10 업그레이드 계획이 있나?
> - 운영 환경에서 `ValidateScopes` / `ValidateOnBuild` 를 켜나?
> - 배포 플랫폼의 종료 유예 시간과 `HostOptions.ShutdownTimeout` 은 각각 몇 초인가? 긴 에이전트 실행은 종료 때 어떻게 처리하나?
> - 병렬 DB 작업에 `IDbContextFactory` 를 쓰나? `AddDbContextPool` 을 쓰나?

## 6. 실무 체크리스트

코드 리뷰나 장애 조사 때 이 순서로 의심한다.

```
[ ] Singleton 생성자에 Scoped(DbContext, IOptionsSnapshot, 타입 HttpClient)가 들어가 있지 않나
[ ] BackgroundService · Singleton 에서 DbContext 를 쓰는 곳이 스코프(CreateAsyncScope)나 팩토리를 쓰나
[ ] CancellationToken 이 컨트롤러 → 서비스 → HttpClient/LLM 호출까지 끊기지 않고 내려가나
[ ] 같은 DbContext 로 Task.WhenAll 을 돌리지 않나
[ ] new HttpClient() 가 있지 않나
[ ] 내가 new 한 IDisposable (연결, 스트림)에 using 이 붙어 있나
[ ] 상한 없는 static/Singleton 캐시가 있지 않나
[ ] 종료 신호(SIGTERM) 때 진행 중 작업을 되돌리는 경로가 있나 (작업이 멱등한가)
```

## 스스로 답해보기

1. `builder.Build()` 전과 후에 각각 할 수 있는 일과 없는 일은? 등록 검증은 언제 도나?
2. 배포 때 SIGTERM 이 오면 Kestrel, `IHostedService`, 루트 컨테이너에 차례로 무슨 일이 일어나나? 기본 종료 제한 시간은?
3. 5분 걸리는 에이전트 실행 중에 배포가 시작됐다. 종료 시간을 10분으로 늘리는 것 말고 어떻게 설계해야 하나?
4. 사용자가 채팅 화면에서 "중지"를 눌렀는데 LLM 비용이 계속 나간다. 무엇을 의심하나?
5. Singleton 이 `DbContext` 를 생성자로 받는 실수가 개발 환경에서는 잡히는데 운영에서는 안 잡히는 이유는? 운영에서도 잡으려면?
6. 같은 `DbContext` 로 `Task.WhenAll` 을 돌리면 어떤 예외가 나나? 정말 병렬이 필요하면 무엇을 쓰나?
7. `new HttpClient()` 를 요청마다 만들 때와 `static` 하나를 계속 쓸 때 각각 생기는 문제는? `IHttpClientFactory` 는 둘을 어떻게 해결하나?
8. `IOptions`, `IOptionsSnapshot`, `IOptionsMonitor` 중 Singleton 에서 설정 변경을 따라가려면 무엇을 쓰나?
9. GC 가 있는데 왜 `using` 이 필요한가? DI 로 받은 객체에도 `using` 을 붙여야 하나?
10. .NET 8 과 .NET 9 의 지원 종료일이 같은 이유를 LTS / STS 기간으로 설명해 보라. 그 날짜가 회사 코드에 의미하는 것은?
