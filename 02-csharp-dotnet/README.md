# 02. C# / ASP.NET Core / EF Core

목표는 **C# 을 잘 쓰는 것이 아니라, 회사 코드를 읽고 고칠 수 있는 것**이다.
문법은 Claude 에게 물으면 3초다. 여기서는 **"왜 이렇게 생겼는가"** 와 **"TS 로 알던 것과 뭐가 다른가"** 만 다룬다.

| 문서 | 한 줄 |
| --- | --- |
| [01. TypeScript 개발자를 위한 C#](01-csharp-for-ts-devs.md) | 같은 것 / 다른 것 / 함정 |
| [02. ASP.NET Core](02-aspnet-core.md) | Program.cs 부터 컨트롤러까지 |
| [03. EF Core](03-ef-core.md) | LINQ → SQL, 추적, 마이그레이션 |
| [04. 처음 보는 .NET 코드베이스 읽는 법](04-reading-a-dotnet-codebase.md) | 입사 첫 주에 실제로 할 일 |

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

**"Core" 가 붙으면 크로스 플랫폼 신버전**이라고 외우면 대체로 맞는다.

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

`dotnet watch run` 은 **핫 리로드까지 된다.** 저장하면 실행 중인 서버에 변경이 반영된다.
