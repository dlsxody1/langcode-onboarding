# 랭코드 온보딩 준비

> 입사일 **2026-10-01** · 포지션 **AI 풀스택** (Next.js + ASP.NET Core)
> 작성 시작 2026-09-22 (D-9)

## 이 레포는 뭔가

랭코드에 들어가서 **첫 2주 동안 남의 코드를 읽고 고칠 수 있는 상태**를 만드는 게 목표다.
면접 대비 자료가 아니다. 예상질문·답변 스크립트는 여기 없다.

내 실제 결손은 세 군데다.

| 결손 | 왜 문제인가 | 어디서 다루나 |
| --- | --- | --- |
| **백엔드 근본 지식** | 프레임워크를 몰라서가 아니라, 요청 하나가 서버에서 무슨 일을 겪는지를 몰라서 막힌다 | `01-backend-basics/` |
| **C# / ASP.NET Core / EF Core** | 회사 백엔드 전부가 이걸로 돼 있다 | `02-csharp-dotnet/` + `labs/lab1-dotnet-crud/` |
| **RAG / Vector DB** | CXP Agent의 본질이 RAG다. 화면만 만들어도 검색이 왜 틀렸는지 대화가 돼야 한다 | `03-rag/` + `labs/lab2-mini-rag/` |

여기에 회사 특성상 필요한 두 가지를 더 붙였다.

- `04-agent/` — MAF·MCP·tool calling. "에이전트"라는 말이 코드에서 정확히 뭘 가리키는지
- `05-realtime-ui/` — 스트리밍 응답 UI. 내가 이미 잘하는 영역이지만, 채팅 화면 특유의 함정이 따로 있다

## 읽는 순서

**순서대로 읽어야 한다.** 01이 02와 03의 전제다. 백엔드 기초 없이 EF Core 를 보면 문법만 외우게 된다.

| 일자 | 읽을 것 | 분량 |
| --- | --- | --- |
| D-9 | `01-backend-basics/` 01~03 (수명주기 · 계층/DI · DB) | 길다. 여기가 핵심 |
| D-8 | `01-backend-basics/` 04~05 (인증인가 · 오래 걸리는 작업) | |
| D-7 | `02-csharp-dotnet/` 01~02 (C# · ASP.NET Core) | |
| D-6 | `02-csharp-dotnet/` 03 (EF Core) — **3-2절 LINQ→SQL 대조표를 꼼꼼히** | |
| D-5 | `labs/lab1-dotnet-crud/` 의 **"📖 실행하지 않고 읽기만 할 경우"** + `reference/` 코드 4개 | 300줄 |
| D-4 | `03-rag/` 01~02 — **02의 3-2절·5-2절이 실측 데이터** | |
| D-3 | `03-rag/` 03~04 | |
| D-2 | `04-agent/` 전체 | 짧다 |
| D-1 | `05-realtime-ui/` + `06-fullstack-workflow/` + `02-csharp-dotnet/04` | |

### 실습을 안 할 거라면

**실습에서 나온 결과는 전부 본문 문서에 옮겨 놓았다.** 돌리지 않아도 결론은 얻는다.

| 실습에서 얻는 것 | 문서 어디에 있나 |
| --- | --- |
| 청킹 설정을 바꾸면 성능이 얼마나 달라지나 (실측표) | `03-rag/02-chunking-embedding.md` **3-2절** |
| 의미 검색이 실패하는 실물 (검색 결과와 점수까지) | `03-rag/02-chunking-embedding.md` **5-2절** |
| 평가셋을 잘못 만들면 어떻게 헛수고하게 되나 | `03-rag/03-retrieval-quality.md` **4절** |
| LINQ 가 실제로 어떤 SQL 이 되나 (9가지 대조) | `02-csharp-dotnet/03-ef-core.md` **3-2절** |
| N+1 이 콘솔에 어떻게 찍히나 | `02-csharp-dotnet/03-ef-core.md` **4절** |
| 요청 하나가 .NET 코드를 통과하는 전체 경로 | `labs/lab1-dotnet-crud/README.md` **맨 위** |

**대신 코드는 읽어라.** `labs/lab1-dotnet-crud/reference/` 4개 파일(300줄 미만)과
`labs/lab2-mini-rag/minirag.py`(350줄)는 실행하지 않아도 읽을 가치가 있다.
특히 후자는 **RAG 전체가 350줄이라는 걸 눈으로 확인하는 것** 자체가 목적이다.

각 문서 끝의 **"스스로 답해보기"** 는 반드시 소리 내어 답해라.
읽고 이해한 것과 말로 설명할 수 있는 것은 다르다. 막히는 항목이 그 문서를 다시 읽어야 할 지점이다.

## Day 0 세팅 — 새 맥북 / 집 윈도우

> 📖 **읽기만 할 거면 이 절은 건너뛰어라.** 문서는 아무것도 설치하지 않아도 전부 읽을 수 있다.
> 입사 직전(D-1)이나 첫 출근 후에 돌아와서 세팅하면 된다.

**두 대에서 다 돌아가게 써 뒀다.** 맥북은 초기화 직후, 윈도우는 그냥 지금.

### macOS

```bash
# 1. Homebrew (없으면)
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# 2. .NET 9 SDK — 회사 스택은 .NET 8 이상. 9 로 배워도 8 코드를 읽는 데 지장 없다
brew install --cask dotnet-sdk
dotnet --version        # 9.x 가 찍히면 성공

# 3. Python (RAG 실습용) — 3.11 이상
brew install python@3.13

# 4. C# 에디터 — VS Code + C# Dev Kit
code --install-extension ms-dotnettools.csdevkit

# 5. (선택) Postgres + pgvector — lab2 심화용
docker run -d --name pgvector -e POSTGRES_PASSWORD=dev -p 5432:5432 pgvector/pgvector:pg17
```

### Windows

**.NET 개발은 오히려 윈도우가 1급 시민이다.** WSL 없이 네이티브로 해도 되고,
Visual Studio 2022 Community 를 쓰면 디버거·EF 도구가 전부 통합돼 있다.

PowerShell 에서:

```powershell
# 1. .NET 9 SDK
winget install Microsoft.DotNet.SDK.9
# 새 터미널을 열고
dotnet --version

# 2. Python 3.13
winget install Python.Python.3.13
python --version

# 3. Git (없으면)
winget install Git.Git

# 4. 에디터 — 둘 중 하나
winget install Microsoft.VisualStudioCode
code --install-extension ms-dotnettools.csdevkit
#   또는 (C# 만 할 거면 이쪽이 더 편하다)
winget install Microsoft.VisualStudio.2022.Community

# 5. (선택) Docker Desktop — lab2 심화용. WSL2 백엔드가 필요하다
winget install Docker.DockerDesktop
```

**윈도우에서만 신경 쓸 것 3가지:**

| | |
| --- | --- |
| `python3` 가 아니라 **`python`** | 이 레포의 명령어에서 `python3` → `python` 으로 바꿔 읽어라 |
| **한글 출력이 깨지면** | `$env:PYTHONUTF8 = "1"` 을 먼저 실행. 영구 적용은 `setx PYTHONUTF8 1` |
| **줄바꿈(CRLF)** | 이 레포는 `.gitattributes` 로 고정해 뒀다. 별도 설정 불필요 |

`curl` 은 Windows 10 이후 기본 내장이지만 PowerShell 에서는 `Invoke-WebRequest` 의 별칭이라
옵션이 다르게 동작한다. **`curl.exe`** 로 명시해서 부르면 macOS 와 똑같이 쓸 수 있다.

### 둘 중 어디서 공부할까

| | 맥북 | 윈도우 |
| --- | --- | --- |
| 문서 읽기 | ○ | ○ |
| lab2 (미니 RAG) | ○ | ○ |
| lab1 (.NET CRUD) | ○ | **◎ 더 편하다** (Visual Studio) |

**lab1 은 집 윈도우에서 하는 걸 권한다.** 맥북 초기화를 기다릴 이유가 없고,
회사 코드도 결국 Windows/Visual Studio 로 짜여 있을 가능성이 높다.

`dotnet` 이 없어도 `01-backend-basics/` 와 `03-rag/` 는 전부 읽을 수 있다. 세팅이 막히면 읽기부터 시작해라.

## 원칙 세 가지

1. **문법을 외우지 않는다.** C# 문법은 Claude 에게 물으면 3초다. 외워야 하는 건 *왜 그 계층이 존재하는가* 다.
2. **모든 개념을 이미 아는 것에 붙인다.** Spring Boot, TanStack Query, FSD — 이미 아는 구조가 있다. 새 프레임워크는 대부분 이름만 다르다. 각 문서에 "이미 아는 것과의 대조표"를 넣어 뒀다.
3. **모르는 건 모른다고 적는다.** 문서 안 `> ❓` 표시는 내가 확인 못 한 부분이다. 입사 후 사수에게 물어볼 목록으로 쓴다.

## 레포 구조

```
01-backend-basics/     요청 수명주기 · 계층과 DI · DB · 인증인가 · 비동기 작업
02-csharp-dotnet/      TS 개발자용 C# · ASP.NET Core · EF Core · Spring 대조
03-rag/                파이프라인 · 청킹/임베딩 · 검색품질 · 엔터프라이즈 RAG
04-agent/              에이전트란 · MAF · MCP
05-realtime-ui/        SSE vs WebSocket · 스트리밍 UI 렌더링
06-fullstack-workflow/ 요즘 풀스택이 실제로 일하는 방식
labs/lab1-dotnet-crud/ 실습: ASP.NET Core + EF Core CRUD API
labs/lab2-mini-rag/    실습: 의존성 없는 미니 RAG 엔진 (Python)
```
