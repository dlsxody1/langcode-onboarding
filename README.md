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

**순서대로 읽어야 한다.** 01이 02와 03의 전제다. 백엔드 기초 없이 EF Core를 보면 문법만 외우게 된다.

| 일자 | 할 것 | 산출물 |
| --- | --- | --- |
| D-9 ~ D-8 | `01-backend-basics/` 전체 | 각 문서 끝 "스스로 답해보기"를 소리 내어 답함 |
| D-7 | `02-csharp-dotnet/01` ~ `02` | — |
| D-6 ~ D-5 | `labs/lab1-dotnet-crud/` 실습 + `02-csharp-dotnet/03` (EF Core) | 돌아가는 CRUD API 1개 |
| D-4 | `03-rag/` 전체 | — |
| D-3 | `labs/lab2-mini-rag/` 실습 | 돌아가는 미니 RAG 1개 |
| D-2 | `04-agent/` | — |
| D-1 | `05-realtime-ui/` + `06-fullstack-workflow/` | — |

실습(labs)은 읽기보다 **우선순위가 높다**. 시간이 모자라면 문서를 건너뛰고 실습을 해라.
"공부했다"와 "만들어봤다"는 입사 후 첫 티켓을 잡을 때 완전히 다른 상태다.

## 새 맥북에서 처음 할 것 (Day 0 세팅)

맥북을 밀고 나서 이 레포를 클론한 직후 실행한다.

```bash
# 1. Homebrew (없으면)
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# 2. .NET 9 SDK — 회사 스택은 .NET 8 이상. 9 로 배워도 8 코드를 읽는 데 지장 없다
brew install --cask dotnet-sdk
dotnet --version        # 9.x 가 찍히면 성공

# 3. Python (RAG 실습용) — 3.11 이상
brew install python@3.13 uv

# 4. Postgres + pgvector (선택, lab2 심화용). Docker 로 띄우는 게 제일 빠르다
docker run -d --name pgvector -e POSTGRES_PASSWORD=dev -p 5432:5432 pgvector/pgvector:pg17

# 5. C# 에디터 — VS Code + C# Dev Kit 확장, 또는 JetBrains Rider
code --install-extension ms-dotnettools.csdevkit
```

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
