# 02. C# / ASP.NET Core / EF Core

목표는 **C# 을 잘 쓰는 것이 아니라, 회사 코드를 읽고 고칠 수 있는 것**이다.
문법은 Claude 에게 물으면 3초다. 여기서는 "왜 이렇게 생겼는가"와 "TS 로 알던 것과 뭐가 다른가"만 다룬다.

| 문서 | 한 줄 |
| --- | --- |
| [01. TypeScript 개발자를 위한 C#](01-csharp-for-ts-devs.md) | 같은 것 / 다른 것 / 함정 |
| [02. ASP.NET Core](02-aspnet-core.md) | Program.cs 부터 컨트롤러까지 |
| [03. EF Core](03-ef-core.md) | LINQ → SQL, 추적, 마이그레이션 |
| [04. 처음 보는 .NET 코드베이스 읽는 법](04-reading-a-dotnet-codebase.md) | 입사 첫 주에 실제로 할 일 |
| [05. 팀 기술 목록 — 쓰기 전과 후](05-team-tech-list.md) | Carter · FluentValidation · Scrutor · Mediator · RabbitMQ · SignalR · Aspire. 라이브러리마다 없을 때와 있을 때의 코드 |
| [06. 생명주기 딥다이브](06-lifecycles.md) | 앱(Host) 시작·종료, 요청 스코프, DI 수명 규칙 7개, GC·Dispose, .NET 지원 기간 |
| [07. .NET 8 → 11](07-dotnet-versions.md) | C# 12~15 · ASP.NET Core · EF Core 버전별 변화, .NET 10 업그레이드 때 깨지는 곳, 공식 문서 읽는 법 |

읽는 순서는 01 → 02 → 03 → 04 다. 05 는 02 를 읽은 뒤 언제든. 06 은 02 를, 07 은 03 을 읽은 뒤가 좋다. 03 까지 읽었으면 `labs/lab1-dotnet-crud/README.md` 로 넘어가 직접 만들어 본다.
요청 수명주기, 계층과 DI, 인덱스·트랜잭션 같은 개념은 `01-backend-basics/` 에서 먼저 다뤘다. 이 장은 그 개념이 .NET 코드에서 어떤 모양으로 나타나는지를 본다.

## 먼저 알 것 — .NET 용어 정리

이름이 헷갈리게 지어져 있어서 처음에 반드시 한 번 막힌다.

| 이름 | 실제로 무엇 |
| --- | --- |
| **.NET** (구 .NET Core) | 런타임 + 표준 라이브러리 + 도구. 크로스 플랫폼. **지금 쓰는 것** |
| **.NET Framework** | 2002\~2019 의 구버전. **Windows 전용.** 고객사 레거시에서 만날 수 있다 |
| **C#** | 언어 |
| **ASP.NET Core** | .NET 위의 웹 프레임워크 |
| **EF Core** | ORM (Entity Framework Core) |
| **Blazor** | C# 으로 프론트를 만드는 프레임워크 (WASM 또는 서버 렌더) |
| **NuGet** | 패키지 매니저 (= npm) |
| **MSBuild / `.csproj`** | 빌드 시스템 / 프로젝트 파일 (= package.json + tsconfig 역할) |
| **Solution (`.sln`)** | 여러 프로젝트를 묶는 단위 (= 모노레포 워크스페이스) |
| **MAF** | Microsoft Agent Framework. 랭코드 스택 (→ `04-agent/02-maf.md`) |

"Core" 가 붙으면 크로스 플랫폼 신버전이라고 외우면 대체로 맞는다.

표의 단어 몇 개는 프론트 개발자에게 낯설어서 조금 더 풀어 둔다.

- **런타임**은 컴파일된 코드를 실제로 실행해 주는 프로그램이다. JS 에서 Node.js 가 하는 역할이다. C# 코드는 먼저 IL 이라는 중간 코드로 컴파일되고 .NET 런타임이 실행 시점에 그것을 기계어로 바꿔 돌린다. 그래서 같은 빌드 결과물이 Windows·Linux·macOS 에서 모두 돈다.
- **ORM**(Object-Relational Mapper)은 DB 테이블의 행을 코드의 객체로 바꿔 주는 라이브러리다. Prisma 나 TypeORM 을 써 봤다면 같은 종류다. EF Core 는 그중 .NET 의 표준 자리에 있다.
- **어셈블리**(assembly)는 프로젝트 하나를 빌드했을 때 나오는 `.dll` 파일이다. npm 패키지 하나를 빌드한 결과물과 비슷하게 생각하면 된다. C# 의 `internal` 접근 제어자는 "같은 어셈블리 안에서만 보인다"는 뜻이다.
- **SDK 와 런타임**은 다르다. SDK 는 `dotnet build`·`dotnet ef` 같은 개발 도구까지 포함한 묶음이고 런타임은 실행만 하는 부분이다. 개발 PC 에는 SDK 를, 운영 서버나 컨테이너에는 런타임만 둔다.

### 버전 읽는 법

.NET 은 해마다 11월에 새 버전이 나온다. 짝수 버전(.NET 8, .NET 10)이 **LTS**(Long Term Support, 3년 지원)이고 홀수 버전(.NET 9)은 지원 기간이 더 짧은 STS 다. 기업 코드베이스는 대개 LTS 에 머문다.
`.csproj` 의 `<TargetFramework>net8.0</TargetFramework>` 한 줄이 그 프로젝트가 어느 버전을 대상으로 빌드되는지를 알려 준다. 이 장의 예제는 .NET 8\~9 기준이고 버전에 따라 달라지는 API 는 그 자리에 표시했다.

> ❓ 입사 후 확인: 회사 서비스들의 `TargetFramework` 는 무엇인가? 업그레이드 주기는?

## npm 과의 명령어 대조

| 하려는 것 | npm | dotnet |
| --- | --- | --- |
| 프로젝트 생성 | `npm init` | `dotnet new webapi -n MyApi` |
| 패키지 설치 | `npm i pkg` | `dotnet add package Pkg` |
| 의존성 복원 | `npm ci` | `dotnet restore` |
| 개발 서버 | `npm run dev` | `dotnet watch run` |
| 빌드 | `npm run build` | `dotnet build` (또는 `publish`) |
| 테스트 | `npm test` | `dotnet test` |
| 실행 | `node dist/index.js` | `dotnet run` |
| 락 파일 | `package-lock.json` | `packages.lock.json` (선택) |

`dotnet watch run` 은 핫 리로드까지 된다. 저장하면 실행 중인 서버에 변경이 반영된다. 다만 메서드 시그니처를 바꾸는 것처럼 큰 변경은 반영하지 못해 재시작을 묻는다.

`dotnet build` 와 `dotnet publish` 의 차이도 알아 두면 좋다. `build` 는 개발용으로 컴파일만 하고 `publish` 는 배포에 필요한 파일만 모아 한 폴더에 내보낸다. Next.js 의 `next build` 결과물을 배포하는 것과 비슷한 단계다.
