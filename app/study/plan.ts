/**
 * 금요일(2026-10-16) 테스트까지의 공부 계획.
 * 범위: Web API · C# 문법 · LINQ 가 중심이고 SignalR 은 개념만 가볍게.
 * kind: doc 은 문서를 읽었는지, quiz 는 그 주제 문항을 다 풀었는지 자동으로 체크하고,
 *       manual 은 직접 체크한다.
 */
export type PlanItem = {
  id: string;
  label: string;
  href: string;
  kind: "doc" | "quiz" | "manual";
  /** doc: "chapter/slug" */
  doc?: string;
  /** quiz: topic id */
  topic?: string;
  note?: string;
};

export type PlanDay = {
  date: string; // YYYY-MM-DD (KST)
  dow: string;
  title: string;
  focus: string;
  items: PlanItem[];
};

export const TEST_DATE = "2026-10-16";
const CH = "02-csharp-dotnet";

export const PLAN: PlanDay[] = [
  {
    date: "2026-10-12", dow: "월", title: "Web API",
    focus: "컨트롤러와 Minimal API 를 나란히 놓고 읽는다. 바인딩 · 상태코드 · [ApiController] 가 핵심.",
    items: [
      { id: "d1-read", label: "Web API 만들기 읽기", href: `/docs/${CH}/web-api`, kind: "doc", doc: `${CH}/web-api`, note: "표 위주. 40분" },
      { id: "d1-quiz", label: "Web API 문제 풀기", href: "/quiz/webapi", kind: "quiz", topic: "webapi" },
      { id: "d1-self", label: "'스스로 답해보기' 10개를 소리 내어 답해본다", href: `/docs/${CH}/web-api`, kind: "manual" },
    ],
  },
  {
    date: "2026-10-13", dow: "화", title: "C# 문법",
    focus: "값/참조 · null · record · 접근 제한자 · async. 최신 C# 12~14 는 한 줄씩만.",
    items: [
      { id: "d2-read", label: "C# 문법 정리 읽기", href: `/docs/${CH}/csharp-syntax`, kind: "doc", doc: `${CH}/csharp-syntax`, note: "50분" },
      { id: "d2-quiz", label: "C# 문법 문제 풀기", href: "/quiz/csyntax", kind: "quiz", topic: "csyntax" },
      { id: "d2-wrong", label: "틀린 문제 오답 복습", href: "/review", kind: "manual" },
    ],
  },
  {
    date: "2026-10-14", dow: "수", title: "LINQ",
    focus: "분량이 가장 많고 함정도 많다. 지연 실행 · First/Single · 집합 · IQueryable.",
    items: [
      { id: "d3-read", label: "LINQ 완전판 읽기", href: `/docs/${CH}/linq`, kind: "doc", doc: `${CH}/linq`, note: "60분. 2·7·9·13절 정독" },
      { id: "d3-quiz", label: "LINQ 문제 풀기", href: "/quiz/linq", kind: "quiz", topic: "linq" },
      { id: "d3-wrong", label: "틀린 문제 오답 복습", href: "/review", kind: "manual" },
    ],
  },
  {
    date: "2026-10-15", dow: "목", title: "SignalR · 총복습",
    focus: "SignalR 은 개념만 20분. 나머지 시간은 모의고사와 오답.",
    items: [
      { id: "d4-read", label: "SignalR 개념 읽기", href: `/docs/${CH}/signalr`, kind: "doc", doc: `${CH}/signalr`, note: "20분" },
      { id: "d4-quiz", label: "SignalR 문제 풀기", href: "/quiz/signalr", kind: "quiz", topic: "signalr" },
      { id: "d4-mock", label: "전 범위 모의고사 한 바퀴", href: "/study/mock", kind: "manual", note: "섞어서 풀기" },
      { id: "d4-wrong", label: "오답 전부 다시 풀기", href: "/review", kind: "manual" },
      { id: "d4-gloss", label: "용어 사전 훑기 (LINQ · Web API · SignalR)", href: "/glossary", kind: "manual" },
    ],
  },
  {
    date: "2026-10-16", dow: "금", title: "시험 당일",
    focus: "새로 읽지 않는다. 지하철에서 오답과 각 문서의 '자주 틀리는 것' 절만 본다.",
    items: [
      { id: "d5-wrong", label: "오답 복습", href: "/review", kind: "manual" },
      { id: "d5-linq", label: "LINQ 14절 '자주 틀리는 것'", href: `/docs/${CH}/linq`, kind: "manual" },
      { id: "d5-api", label: "Web API 12절 · C# 문법 12절 '자주 틀리는 것'", href: `/docs/${CH}/web-api`, kind: "manual" },
    ],
  },
];
