export type DocMeta = { slug: string; file: string; title: string; kicker?: string };
export type Chapter = {
  id: string;
  no: string;
  title: string;
  blurb: string;
  dir: string;
  docs: DocMeta[];
};

/**
 * 문서 목록을 명시적으로 적는다. 파일 시스템에서 자동으로 긁으면 순서와 제목을
 * 파일명에 의존하게 되는데, 사이드바에 쓸 짧은 제목은 파일명과 달라야 한다.
 */
export const CHAPTERS: Chapter[] = [
  {
    id: "01-backend-basics",
    no: "01",
    title: "백엔드 근본 지식",
    blurb: "프레임워크 이전의 것들. 여기를 건너뛰면 문법만 외우게 된다.",
    dir: "01-backend-basics",
    docs: [
      { slug: "intro", file: "README.md", title: "들어가며", kicker: "프론트와 무엇이 다른가" },
      { slug: "request-lifecycle", file: "01-request-lifecycle.md", title: "요청 하나의 수명주기" },
      { slug: "layers-and-di", file: "02-layers-and-di.md", title: "계층 구조와 DI" },
      { slug: "database", file: "03-database.md", title: "데이터베이스" },
      { slug: "auth", file: "04-auth.md", title: "인증과 인가" },
      { slug: "long-running-jobs", file: "05-long-running-jobs.md", title: "오래 걸리는 작업" },
      { slug: "architecture", file: "06-architecture.md", title: "아키텍처 패턴", kicker: "DDD · Clean · CQRS · 모듈러 모놀리스" },
    ],
  },
  {
    id: "02-csharp-dotnet",
    no: "02",
    title: "C# · ASP.NET Core · EF Core",
    blurb: "문법을 외우는 게 아니라, 회사 코드를 읽을 수 있게 되는 것.",
    dir: "02-csharp-dotnet",
    docs: [
      { slug: "intro", file: "README.md", title: "들어가며", kicker: ".NET 용어 정리" },
      { slug: "csharp-for-ts-devs", file: "01-csharp-for-ts-devs.md", title: "TS 개발자를 위한 C#" },
      { slug: "aspnet-core", file: "02-aspnet-core.md", title: "ASP.NET Core" },
      { slug: "ef-core", file: "03-ef-core.md", title: "EF Core" },
      { slug: "reading-a-codebase", file: "04-reading-a-dotnet-codebase.md", title: "코드베이스 읽는 법" },
      { slug: "team-tech-list", file: "05-team-tech-list.md", title: "팀 기술 목록", kicker: "Carter · Scrutor · RabbitMQ · Aspire" },
      { slug: "lifecycles", file: "06-lifecycles.md", title: "생명주기 딥다이브", kicker: "앱 · 요청 · DI · GC · 지원 기간" },
      { slug: "dotnet-versions", file: "07-dotnet-versions.md", title: ".NET 8 → 11", kicker: "버전별 변화 · 업그레이드 함정" },
    ],
  },
  {
    id: "03-rag",
    no: "03",
    title: "RAG · Vector DB",
    blurb: "CXP Agent 의 본질. 화면만 만들어도 검색이 왜 틀렸는지 대화가 돼야 한다.",
    dir: "03-rag",
    docs: [
      { slug: "intro", file: "README.md", title: "들어가며", kicker: "왜 파인튜닝이 아닌가" },
      { slug: "foundations", file: "00-foundations.md", title: "기초: 벡터와 유사도", kicker: "임베딩 · 코사인 유사도" },
      { slug: "pipeline", file: "01-pipeline.md", title: "파이프라인" },
      { slug: "chunking-embedding", file: "02-chunking-embedding.md", title: "청킹과 임베딩" },
      { slug: "retrieval-quality", file: "03-retrieval-quality.md", title: "검색 품질" },
      { slug: "enterprise-rag", file: "04-enterprise-rag.md", title: "엔터프라이즈 RAG" },
    ],
  },
  {
    id: "04-agent",
    no: "04",
    title: "에이전트",
    blurb: '"AI Agent" 라는 말이 코드에서 정확히 무엇을 가리키는지.',
    dir: "04-agent",
    docs: [
      { slug: "intro", file: "README.md", title: "들어가며" },
      { slug: "what-is-an-agent", file: "01-what-is-an-agent.md", title: "에이전트란 무엇인가" },
      { slug: "maf", file: "02-maf.md", title: "MAF" },
      { slug: "mcp", file: "03-mcp.md", title: "MCP" },
      { slug: "agentic-rag", file: "04-agentic-rag.md", title: "Agentic RAG", kicker: "검색을 도구로 · 구조화 출력" },
      { slug: "orchestration", file: "05-orchestration.md", title: "오케스트레이션", kicker: "라우팅 · 멀티에이전트 · 메모리" },
    ],
  },
  {
    id: "05-realtime-ui",
    no: "05",
    title: "실시간 UI",
    blurb: "이미 잘하는 영역. 채팅 화면 특유의 함정만.",
    dir: "05-realtime-ui",
    docs: [
      { slug: "sse-vs-websocket", file: "01-sse-vs-websocket.md", title: "SSE vs WebSocket" },
      { slug: "streaming-ui", file: "02-streaming-ui.md", title: "스트리밍 UI 렌더링" },
    ],
  },
  {
    id: "06-fullstack-workflow",
    no: "06",
    title: "요즘 풀스택",
    blurb: "경계를 어떻게 다루느냐가 달라졌다.",
    dir: "06-fullstack-workflow",
    docs: [
      { slug: "how-it-works", file: "01-how-fullstack-works-now.md", title: "요즘 풀스택은 어떻게 일하는가" },
    ],
  },
  {
    id: "07-db-infra",
    no: "07",
    title: "DB · 인프라 · 백엔드 패턴",
    blurb: "서버가 여러 대이고 남의 시스템이 느릴 때. 데이터는 어디에, 어떤 모양으로.",
    dir: "07-db-infra",
    docs: [
      { slug: "intro", file: "README.md", title: "들어가며", kicker: "01 챕터와의 관계" },
      { slug: "relational-basics", file: "01-relational-basics.md", title: "관계형 DB 기초" },
      { slug: "caching", file: "02-caching.md", title: "캐싱" },
      { slug: "resilience", file: "03-resilience.md", title: "장애에 버티는 패턴" },
      { slug: "observability", file: "04-observability.md", title: "관측성" },
      { slug: "infra", file: "05-infra.md", title: "인프라 지도" },
      { slug: "cosmos-db", file: "06-cosmos-db.md", title: "Cosmos DB", kicker: "파티션 키 · RU · 일관성" },
      { slug: "our-stack", file: "07-our-stack.md", title: "우리 스택은 왜", kicker: "Postgres · Mongo · Redis · Blob · LLM" },
    ],
  },
];

export function getChapter(id: string) {
  return CHAPTERS.find((c) => c.id === id);
}

export function getDoc(chapterId: string, docSlug: string) {
  const chapter = getChapter(chapterId);
  const doc = chapter?.docs.find((d) => d.slug === docSlug);
  if (!chapter || !doc) return null;
  return { chapter, doc };
}

/** 이전/다음 문서 — 챕터 경계를 넘어 이어진다 */
export function getNeighbours(chapterId: string, docSlug: string) {
  const flat = CHAPTERS.flatMap((c) => c.docs.map((d) => ({ chapter: c, doc: d })));
  const i = flat.findIndex((x) => x.chapter.id === chapterId && x.doc.slug === docSlug);
  return { prev: i > 0 ? flat[i - 1] : null, next: i >= 0 && i < flat.length - 1 ? flat[i + 1] : null };
}

export const ALL_DOCS = CHAPTERS.flatMap((c) => c.docs.map((d) => ({ chapter: c, doc: d })));
