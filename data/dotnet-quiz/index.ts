import type { Question, Topic } from "../questions";
import { CSYNTAX_QUESTIONS } from "./csyntax";
import { LINQ_QUESTIONS } from "./linq";
import { WEBAPI_QUESTIONS } from "./webapi";
import { SIGNALR_QUESTIONS } from "./signalr";

/** 금요일 테스트 범위 — Web API · C# 문법 · LINQ (+ SignalR 개념) */
export const DOTNET_TOPICS: Topic[] = [
  { id: "csyntax", chapter: "02-csharp-dotnet", title: "C# 문법", blurb: "값/참조 · null · record · 접근 제한자 · async · 최신 C#." },
  { id: "linq", chapter: "02-csharp-dotnet", title: "LINQ", blurb: "지연 실행 · First/Single · 집합 · IQueryable · .NET 6~10 신규." },
  { id: "webapi", chapter: "02-csharp-dotnet", title: "Web API", blurb: "컨트롤러 · Minimal API · 바인딩 · 상태코드 · 검증 · ProblemDetails." },
  { id: "signalr", chapter: "02-csharp-dotnet", title: "SignalR", blurb: "전송 폴백 · Hub · 프로토콜 · 확장." },
];

export const DOTNET_QUESTIONS: Question[] = [
  ...CSYNTAX_QUESTIONS,
  ...LINQ_QUESTIONS,
  ...WEBAPI_QUESTIONS,
  ...SIGNALR_QUESTIONS,
];
