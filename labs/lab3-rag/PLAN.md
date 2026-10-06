# 실습 3 — 비용 0원으로 만드는 미니 사내 RAG 챗봇 (실행 계획 v4)

> 회사 RAG 파이프라인(Azure Document Intelligence → Azure AI Search → 시맨틱 리랭커 → LLM)을
> **유료 서비스 없이** 라이브러리나 직접 만든 코드로 재현한다.
> **이 학습 사이트의 "실습" 탭**으로 붙인다 (공부 / 문제 / 오답 / 용어 / 실습). 코퍼스는 이 저장소의 01–07 문서다.
> 실습 탭은 **로그인한 사용자만** 들어올 수 있고, 답변마다 근거 청크·메타데이터·원문 링크를 보여 준다.

### v3 → v4 에서 바뀐 것

| | v3 | v4 |
| --- | --- | --- |
| 앱 | 별도 앱 `labs/lab3-mini-rag-web` | 이 사이트에 탭 추가 (`app/lab`, `app/api/lab`, `lib/rag`) |
| 코퍼스 | 가상 회사 문서 7개 | **01–07 온보딩 문서 31개 (공개)** + 가상 사내 문서 2–3개 (**임직원 전용**, PDF·DOCX·함정) |
| 평가셋 | 새로 30문항 | `data/questions.ts` 90문항(chapter/doc/section 있음)을 변환 + 패러프레이즈·권한 문항 보강 |
| 용어 사전 | 새로 작성 | `data/glossary.json` 의 `term`/`aliases` 에서 시작 |
| 원문 보기 | `/docs/[slug]` 새로 작성 | 01–07 은 기존 `/docs/<chapter>/<doc>#<id>` 재사용. 가상 사내 문서만 `/lab/docs/[slug]` (권한 확인) |
| 로그인 게이트 | 사이트 전체 | **`/lab/**`, `/api/lab/**` 만**. 다른 탭은 Supabase 가 멈춰도 열린다 |

---

## 0. 원칙

1. **비용 0원.** 유료 API·유료 인프라를 쓰지 않는다. 무료 티어 LLM 은 "있으면 쓰는 옵션"이다.
2. **무거운 일은 빌드 타임에, 가벼운 일만 런타임에.** 파싱·청킹·색인은 배포 전에 돌린다. 서버리스 함수는 검색과 응답만 한다.
3. **권한은 두 겹으로.** 1차는 서버 코드가 검색 전에 거르고, 2차는 Supabase RLS 가 DB 에서 막는다.
4. **측정 먼저, 개선은 나중.** 평가 스크립트(4단계) 전에는 검색을 튜닝하지 않는다. 결과는 `RESULTS.md` 에 숫자로.
5. **비밀 키는 브라우저에 절대 안 간다.** `service_role` 키는 로컬·CI 의 색인 동기화에서만. Vercel 런타임은 publishable(anon) 키 + 사용자 세션으로만 DB 에 접근한다.
6. **외부 의존은 인터페이스 뒤에.** `Parser`, `SearchEngine`, `Reranker`, `Generator`, `ChunkStore`.
7. **실습 탭이 학습 사이트를 망가뜨리지 않는다.** env 가 없어도 사이트 빌드는 성공하고, 번들은 실습 탭에만 실린다. 디자인은 `.impeccable.md`(시험지 톤, 모달 금지).
8. **Claude 에게 코드를 시켜도 된다. 대신 각 단계의 "스스로 답해보기"는 내가 말로 답한다.**

## 1. 회사 스택 ↔ 이 프로젝트 대응표

| 회사 (유료) | 역할 | 이 프로젝트 (무료) |
| --- | --- | --- |
| Azure Document Intelligence | 문서 → 구조화 텍스트 | 수제 마크다운 파서, `unpdf`(PDF), `mammoth`(DOCX) |
| Azure AI Search 역색인 | 키워드 검색 | 수제 역색인 + BM25 (앱 내부) |
| Azure AI Search 벡터 필드 | 의미 검색 | 기본 미사용 → (선택) Supabase pgvector |
| 시맨틱 리랭커 | 후보 재정렬 | 수제 규칙 기반 + 피드백 가산 → (선택) 무료 LLM 리랭크 |
| 사내 용어 사전 | 표현 차이 흡수 | `synonyms.json` (glossary.json 에서 출발) |
| Azure OpenAI | 답변 생성 | ① 추출형(LLM 없음) ② 무료 티어 LLM (선택) |
| 사내 인증 (SSO 등) | 사용자 식별 | Supabase Auth (초대 전용, 회원가입 비활성) |
| 문서 ACL | 열람 범위 | 서버 사전 필터 + Supabase RLS |
| Blob Storage | 원본 파일 | Supabase Storage (비공개 버킷 + 서명 URL) |
| 운영 로그·피드백 DB | 실데이터, "도움이 됐다" | Supabase 테이블 |
| ASP.NET Core 백엔드 | API | Next.js Route Handler (선택 단계에서 .NET 이식) |
| Azure 호스팅 | 배포 | Vercel Hobby (이 사이트와 같은 프로젝트) |

> ❓ Vercel·Supabase·LLM 무료 티어 조건은 자주 바뀐다. 시작 시점에 공식 문서로 확인한다.

## 2. 기술 스택

- 이 사이트: **Next.js 15 (App Router) + TypeScript**, Vercel
- **Supabase:** Auth, Postgres(RLS), Storage. `@supabase/supabase-js` + `@supabase/ssr`
- **색인:** `labs/lab3-rag/scripts/` → `labs/lab3-rag/generated/index.json` + Supabase 동기화
- **검색:** 수제 BM25 (토크나이저: 어절 + 문자 bigram, `labs/lab2-mini-rag/minirag.py` 이식)
- **생성(선택):** Vercel AI SDK(`ai`) + 무료 티어 프로바이더 하나. 없으면 추출형
- **평가:** `npm run lab:eval`, GitHub Actions 무료 러너

## 3. 데이터 흐름

```
[빌드·동기화 — 로컬 또는 CI, service_role 키 사용]
01–07/*.md (공개) ─────────┐
corpus-internal/*.pdf|docx|md ─ parse ─ chunk ─┬─ generated/index.json   (토큰 통계 + chunkId + audience, 원문 없음)
  (임직원 전용)                                 ├─ Supabase chunks 테이블 (원문·메타데이터)
                                               └─ Supabase Storage       (가상 사내 문서 원본)

[요청 — Vercel, 사용자 세션 사용]
/lab 로그인 게이트 ─ audience 조회(profiles) ─ 질의 정규화 ─ BM25(audience 사전 필터)
  ─ top-N chunkId ─ chunks 에서 원문 조회(RLS 2차 차단) ─ 리랭크 ─ 컨텍스트 조립
  ─ 생성(스트리밍) ─ 근거 카드 ─ query_logs ─ 👍/👎 feedback
```

`index.json` 에 원문을 넣지 않는 이유: 원문은 **RLS 를 통과해야만** 읽히게 하려는 것이다.
(01–07 문서는 원래 공개라 이 효과가 없다. 권한 실험은 가상 사내 문서로 한다.)

## 4. 구조

```
middleware.ts                     /lab, /api/lab 에만 걸리는 로그인 게이트
lib/supabase/  env.ts server.ts client.ts
lib/rag/       tokenizer.ts bm25.ts rerank.ts context.ts generate.ts citations.ts   (4단계부터)
app/lab/
├─ login/                         로그인 (게이트 안에서 유일한 공개 경로)
├─ signout/route.ts
├─ page.tsx                       채팅 화면
└─ docs/[slug]/page.tsx           가상 사내 문서 뷰어 (권한 확인) — 7단계
app/api/lab/  chat/route.ts  feedback/route.ts
labs/lab3-rag/
├─ PLAN.md  RESULTS.md  README.md
├─ corpus-internal/               가상 사내 문서 원본 + manifest.json
├─ data/  synonyms.json  eval.jsonl
├─ supabase/  migrations/*.sql  seed.sql
├─ scripts/  parse.ts build-index.ts sync-supabase.ts eval.ts export-replay.ts
└─ generated/index.json
```

## 5. 데이터베이스 스키마 (요약)

| 테이블 | 주요 컬럼 | RLS 정책 |
| --- | --- | --- |
| `profiles` ✅ | `id`(= auth.users.id), `display_name`, `audience`(`employee`\|`customer`) | 본인 행만 SELECT. INSERT/UPDATE 정책 없음 |
| `documents` | `slug`, `title`, `version`, `effective_date`, `audience[]`, `source`(`onboarding`\|`internal`), `route`, `storage_path` | 내 audience 가 포함된 행만 SELECT |
| `chunks` | `chunk_id`, `slug`, `heading_path`, `page`, `anchor`, `text`, `audience[]`, `content_hash` | 내 audience 가 포함된 행만 SELECT |
| `query_logs` | `id`, `user_id`, `query`, `normalized_query`, `top_chunk_ids`, `mode`, `first_token_ms`, `total_ms`, `created_at` | 본인 행만 INSERT/SELECT |
| `feedback` | `id`, `log_id`, `user_id`, `rating`(+1/-1), `chunk_id`, `created_at` | 본인 행만 INSERT. 로그당 1회 |

- 01–07 문서: `audience = {employee, customer}`. 가상 사내 문서: `{employee}`
- 청크 `anchor` 는 `lib/content.ts` 의 `slugifyHeading` 과 **같은 규칙** (중복 시 `-1`, `-2`) → 기존 문서 페이지 헤딩 id 와 일치

---

## 6. 단계별 계획

각 단계: **목표 → 할 일 → 완료 기준 → 스스로 답해보기**. 완료 기준을 못 채우면 넘어가지 않는다.

### 0단계 — 실습 탭 + 로그인 게이트 ✅ (코드 완료, 대시보드 작업은 README)

- [x] Supabase 클라이언트(`lib/supabase/`), `middleware.ts`(matcher `/lab`, `/api/lab`)
- [x] `/lab/login`(서버 액션), `/lab/signout`, 헤더 배지, Masthead 에 "실습" 탭
- [x] API 에서 `getUser()` 재확인 → 401
- [x] `0001_profiles.sql`, `seed.sql`
- [x] Supabase 프로젝트·데모 계정 2개, `0001_profiles` 적용, 고객 역할 RLS 확인 (본인 행 1개만 보임)
- [x] 로컬에서 로그인 → 배지 → 새로고침 유지 → 로그아웃 차단, 임직원·고객 둘 다 확인
- [x] 공개 회원가입 끄기 ("Allow new users to sign up")
- [ ] Vercel env 등록 (README 체크리스트)

**완료 기준**
- 시크릿 창에서 `/lab` → `/lab/login`, `POST /api/lab/chat` → 401. `/docs`·`/quiz` 는 로그인 없이 열림
- 로그인 후 새로고침해도 세션 유지, 로그아웃하면 즉시 차단
- 브라우저 개발자 도구 어디에서도 `service_role` 키가 보이지 않는다

**스스로 답해보기**
- 미들웨어에서 막았는데 API 에서도 다시 확인하는 이유는?
- `getSession()` 대신 `getUser()` 를 쓰라는 이유는?
- 회원가입을 열어 두면 이 시스템에서 무슨 일이 생기나?
- 로그인 게이트를 사이트 전체가 아니라 실습 탭에만 건 대가는? (무엇이 보호되지 않나)

### 1단계 — 코퍼스와 평가셋 (1일)

**관련 문서:** `03-rag/02-chunking-embedding.md` 5절, `03-rag/03-retrieval-quality.md` 4절, `03-rag/04-enterprise-rag.md` 4절

01–07 은 이미 있다. **권한·파싱·함정 실험용 가상 사내 문서**만 만든다.

| 문서 | 형식 | 열람 | 넣을 함정 |
| --- | --- | --- | --- |
| 출장·경비 규정 | pdf | 임직원 | **표**(지역별 일비·숙박비) |
| 복리후생 안내 | docx | 임직원 | 목록, 중첩 제목, 구어체("반반차") |
| 정보보안 정책 v4.2 / v4.1 | md 2개 | 임직원 | 약어(MFA, DLP), 두 버전이 **모순**되는 조항 |

- [x] `corpus-internal/` 문서 4개 + `manifest.json` (`status: current | superseded` 추가 — 5단계 구버전 감점에 쓴다)
  - PDF·DOCX 는 `src/` 의 html·md 원본에서 `npm run lab:docs` 로 생성 (Edge headless 인쇄, `docx` 라이브러리)
  - 출장 규정 표 1은 머리글이 2단(직원/임원 × 일비/숙박비) — 글자만 뽑으면 숫자의 의미가 사라진다
- [x] `scripts/build-eval-set.mts`: 퀴즈 99문항 + `data/eval-extra.jsonl` 27문항 → `data/eval.jsonl` 126문항 (`npm run lab:eval-set`)
  - 정답은 **문서 단위**. 퀴즈 `section` 은 헤딩과 일치하는 67문항만 절까지 기록
  - 보강 문항의 정답 문서·절이 실제로 있는지 검증하고, 없으면 실패
- [x] 보강 27문항: 패러프레이즈 8, 사내 문서 11(표 3·약어 2·버전 모순 2·구어체 3), 고객 6, "찾지 못함" 5(고객 권한 3 + 아무 문서에도 없음 2)

**완료 기준:** 가상 문서 + manifest + eval.jsonl(99 + 보강) 커밋.

**스스로 답해보기**
- 퀴즈 문제를 그대로 평가셋으로 쓰면 점수가 왜 실제보다 높게 나오나?

### 2단계 — 파싱 (Document Intelligence 대체) (1일)

```ts
type ParsedDoc = {
  slug: string; title: string; source: "onboarding" | "internal"; route: string;
  sections: { id: string; headingPath: string[]; text: string; page?: number; kind: "text" | "table" }[];
};
```

- [x] 세 형식을 **마크다운으로 바꾼 뒤 한 분리기**(`scripts/parse/markdown.mts`)로 섹션을 나눈다 — 형식별 코드는 "마크다운 만들기"만 맡는다
- [x] md: `marked.lexer` 로 헤딩 단위 분리. 헤딩 id 는 사이트와 같은 `lib/slug.ts` → **사이트 헤딩 id 와 544/544 일치** (개발 서버 페이지와 대조)
- [x] 표: 섹션에서 떼어 `kind: "table"`, 행마다 "열: 값 | 열: 값". 앞의 "[표 n]" 캡션을 표에 붙인다
- [x] PDF(`unpdf`): 글자 조각 좌표로 줄 → 제목(글자 크기) → 표(칸 2개 이상 연속) 복원. **병합 머리글은 "글자 가운데가 덮는 열들의 한가운데"** 규칙으로 "직원 숙박비 상한" 같은 열 이름을 되살린다
- [x] DOCX(`mammoth`): Title 과 Heading 1 이 둘 다 `<h1>` 이 되는 문제 → 첫 `<h1>` 뒤 헤딩을 한 단계 내린다. 중첩 목록 유지
- [x] `npm run lab:parse` (요약) · `-- --print <docId>` (섹션) · `-- --markdown <docId>` (PDF·DOCX 중간 마크다운) → `generated/parsed.json`
- 남은 한계: PDF 줄바꿈 자리의 띄어쓰기를 모른다("안에서실비로"). 한글-한글은 붙이는 쪽을 택했다 — 줄이 단어 중간에서 끊길 확률이 더 높아서

**완료 기준:** 출장 규정 표의 "서울 숙박비 상한" 이 한 섹션 안에 온전히 들어 있다. 01–07 의 섹션 id 가 사이트 헤딩 id 와 같다. ✅ 둘 다 확인

**스스로 답해보기**
- 유료 Document Intelligence 가 수제 파서보다 확실히 나은 지점은?

### 3단계 — 청킹, 색인, Supabase 동기화 (1.5일)

**관련 문서:** `03-rag/01-pipeline.md` 1·3절, `03-rag/02-chunking-embedding.md` 2·7·8절

- [x] 섹션 기반 청킹 (`scripts/chunk.mts`): 600자 초과 시 문단 → 문장 경계, 코드·목록은 줄 경계, 표는 행 경계 + 조각마다 캡션 → **청크 1,215개** (표 242, 600자 초과 1개 = 혼자 긴 코드 블록)
- [x] chunkId = `문서#앵커~순번`. 다른 절을 고쳐도 이 절의 id 는 그대로 → 동기화가 바뀐 청크만 보낸다
- [x] 검색용 텍스트에 `[문서 제목 > 절 경로]` 맥락 주입, 표시용 원문(text)과 분리
- [x] `lib/rag/tokenizer.ts`(lab2 이식) · `lib/rag/bm25.ts` → `generated/index.json` 1.3MB, 원문 없음. 용어 2만여 개
  - 버그 하나: 색인을 `{}` 로 만들면 문서의 "constructor" 가 `Object.prototype.constructor` 와 부딪힌다 → Map 으로 만들고, 읽을 때는 `Object.hasOwn`
- [x] `0002_documents_chunks.sql`: documents · chunks + SELECT 정책만(쓰기는 secret 키만), 비공개 버킷 `originals` + "볼 수 있는 문서의 원본만" 정책 (documents RLS 를 이어 붙임). `0003_logs_feedback` 은 8단계로 미룸
- [x] `sync-supabase.mts` (secret 키, 로컬 전용): 해시 비교로 +추가 ~변경 -삭제 =그대로, 원본 4개 업로드, `--check` 는 쓰지 않고 어긋남만 보고(exit 1)
- [x] **index.json 은 커밋한다.** 사이트 빌드가 실습 도구(unpdf·mammoth)에 의존하지 않게 — 실습 탭 때문에 학습 사이트 배포가 깨지면 안 된다. 어긋남은 `lab:sync -- --check` 로 잡는다

**완료 기준** ✅
- 문서 하나를 고치고 동기화하면 그 문서 청크만 바뀐다는 로그 → v4.2 제5조 한 줄 수정 시 `internal/security-policy-v4.2 +0 ~1 -0 =15`, 나머지 36개 문서는 건너뜀
- 고객 역할로 `select * from chunks` 를 흉내 냈을 때 공개 문서(01–07)만 보인다 → 고객: 청크 1,160 · 임직원 전용 0 · 사내 문서 0 · 원본 0 / 임직원: 1,215 · 55 · 4 · 4

**스스로 답해보기**
- 색인 파일과 DB 에 데이터를 나눠 둔 이유는? 둘이 어긋나면 어떻게 감지하나?
- 동기화를 Vercel 빌드에서 하지 않는 이유는?

### 4단계 — 검색과 평가 (가장 중요) (1일)

**관련 문서:** `03-rag/03-retrieval-quality.md` 1·4절, `03-rag/04-enterprise-rag.md` 1절

- [ ] `SearchEngine.search(query, { audience, k })`: BM25, audience 는 후보 단계에서 제외 (1차)
- [ ] `ChunkStore.getByIds(ids)`: 사용자 세션으로 조회 → RLS 2차. 요청 수 ≠ 받은 수면 경고 로그
- [ ] `npm run lab:eval`: Recall@1·@3, MRR, 놓친 질문, **챕터별**·형식별·audience 별, 퀴즈 원문 vs 패러프레이즈 문항 비교
- [ ] 권한 누출 테스트: 고객 audience 로 전 문항 검색 시 임직원 청크 0개
- [ ] `RESULTS.md` 기준선, GitHub Actions 연결

**완료 기준:** 평가 한 번에 지표 + 실패 목록 + 누출 0건이 나오고, CI 에서도 돈다.

**스스로 답해보기**
- 1차 필터를 일부러 꺼 보면 어떤 로그가 찍히나?
- Recall@3 은 높은데 Recall@1 이 낮으면 다음에 손댈 곳은?

### 5단계 — 리랭킹과 용어 사전 (1일)

**관련 문서:** `03-rag/03-retrieval-quality.md` 2·3절

- [ ] `synonyms.json`: `glossary.json` 의 aliases 로 시작 + 구어 표현 추가 ("집에서 일" → "재택근무")
- [ ] 리랭커 v1: BM25 상위 20 → 절 제목 일치, 질의어 근접도, 최신 버전 가산·구버전 감점
- [ ] 적용 전/후 지표, 나빠진 질문까지 `RESULTS.md` 에
- [ ] (선택) 무료 LLM 리랭크

**완료 기준:** 패러프레이즈 질문과 버전 모순 질문이 1등으로 정답을 가져온다.

**스스로 답해보기**
- 크로스 인코더 리랭커는 수제 규칙과 무엇이 근본적으로 다른가?

### 6단계 — 답변 생성 (1일)

**관련 문서:** `03-rag/01-pipeline.md` 2절 ⑤⑥⑦

- [ ] `ContextBuilder`: 임계값 → 예산(2,000자) → 1·2위 양 끝 배치 → `[n] (문서 > 절)` 마커
- [ ] 모드 A 추출형(기본) / 모드 B 생성형(선택) / 자동 폴백 + "요약 모드로 답했어요"
- [ ] `citations.ts`: `[n]` 파싱 → 청크 메타데이터, 없는 번호 경고

**완료 기준:** 키 없이도 근거와 함께 답이 나오고, 근거 없는 질문엔 "문서에서 찾지 못했어요".

### 7단계 — 챗봇 UI: 근거, 메타데이터, 원문 링크 (2일)

**관련 문서:** `05-realtime-ui/01-sse-vs-websocket.md`, `05-realtime-ui/02-streaming-ui.md`, `03-rag/04-enterprise-rag.md` 7절

- [ ] 첫 화면: 질문 입력창 + 예시 질문 칩 (audience 별)
- [ ] `/api/lab/chat` 스트리밍, 마지막에 `citations` 이벤트. 잘린 `[1` 마커 처리
- [ ] 근거 카드: 문서·절 경로·페이지·버전·열람 범위·점수(BM25 → 리랭크)·청크 ID
- [ ] 원문 보기: 01–07 → `/docs/<chapter>/<doc>#<anchor>` (+ 하이라이트). 가상 사내 문서 → `/lab/docs/[slug]` (서버 권한 확인)
- [ ] 원본 다운로드(가상 사내 문서): 권한 확인 후 서명 URL
- [ ] 좁은 화면: 근거 패널을 본문 아래로 (모달 금지)

**완료 기준**
- 질문 → 스트리밍 → 칩 → 근거 카드 → 원문 위치가 한 흐름으로 동작
- 고객 계정으로 `/lab/docs/security-policy` 를 직접 입력하면 403, 서명 URL 도 발급되지 않음

**스스로 답해보기**
- 원본 파일을 공개 버킷에 두면 로그인 게이트가 있어도 왜 위험한가?

### 8단계 — 로그, 피드백, 무료 배포 운영 (1일)

- [ ] `query_logs` 기록 (로그 실패가 답변을 막지 않게)
- [ ] 👍/👎 → `/api/lab/feedback` (로그당 1회)
- [ ] 사용자당 분당 N회 제한, 질문 길이 제한, 빈 질문 차단
- [ ] Supabase 일시 중지 시 **실습 탭만** 막힌다는 점 README 에 명시
- [ ] README: "가상 사내 문서는 데모용"

**완료 기준:** 질문 10개 후 평균 첫 토큰 시간을 SQL 로 뽑아 `RESULTS.md` 에 기록.

**스스로 답해보기**
- 로그 저장을 응답과 같은 트랜잭션으로 묶으면 무슨 문제가 생기나?

### 9단계 — 운영 데이터로 개선하기 (1.5일)

- [ ] 피드백 가산 (스무딩 + 상한)
- [ ] `export-replay.ts` → `replay.jsonl`, `npm run lab:eval -- --replay --a <설정> --b <설정>`
- [ ] (선택) LLM-as-judge
- [ ] 피드백 가산 on/off A/B 리포트

**완료 기준:** "피드백 가산을 켰더니 무엇이 바뀌었나"를 표 한 장으로.

**스스로 답해보기**
- 피드백을 무제한으로 반영하면 어떤 악순환이 생기나?
- 👎 가 많은 질문은 검색 문제인가, 문서 문제인가?

### 10단계 (선택) — 확장

| 과제 | 내용 | 회사 대응 |
| --- | --- | --- |
| pgvector 벡터 검색 | 로컬에서 소형 다국어 임베딩 → `chunks.embedding`, RLS 적용 RPC | AI Search 벡터 필드 |
| 하이브리드 | BM25 + pgvector → RRF, 4단계 평가로 비교 | 하이브리드 검색 |
| 키워드 검색 DB 이전 | bigram 배열 컬럼 + GIN 인덱스 | AI Search 역색인 |
| 멀티턴 | 최근 3턴 + 후속 질문 → 독립 질의 재작성 | 멀티턴 |
| 의도 분류 | 잡담 / 지식 / 처리불가 | 의도 분류 |
| .NET 이식 | `/api/lab/chat` 을 ASP.NET Core 로, Supabase JWT 검증 (로컬) | 실제 백엔드 |
| 공부 탭 연동 | 문서 페이지에서 "이 절에 대해 묻기" → 실습 탭으로 질의 전달 | — |

임베딩 모델은 서버리스 함수에 넣지 않는다.

---

## 7. 일정 (권장)

| 묶음 | 단계 | 예상 |
| --- | --- | --- |
| 준비 | 0 · 1 | 1.5일 |
| 색인 파이프라인 | 2 · 3 | 2.5일 |
| 검색 품질 | 4 · 5 | 2일 |
| 제품 | 6 · 7 · 8 | 4일 |
| 운영 개선 | 9 | 1.5일 |

## 8. `RESULTS.md` 기록 양식

`RESULTS.md` 맨 위 양식을 따른다.

## 9. 입사 후 확인할 것 (❓)

- [ ] Document Intelligence 모델과 표 → 청크 변환 방식
- [ ] AI Search 인덱스 스키마: 검색용·필터용·표시용 필드
- [ ] 사내 인증 방식과 사용자 유형(고객/임직원)을 어디서 가져오나
- [ ] 문서 ACL 은 어디서 관리되고 인덱스에 어떻게 반영되나
- [ ] 원본 문서 링크는 어디로 가나 (SharePoint? Blob? 권한 처리?)
- [ ] 피드백이 검색 순위에 어떻게 반영되나, 운영 로그 보관 기간과 개인정보 처리
- [ ] 이 프로젝트의 각 단계가 실제 코드 어디에 대응하나 — **이 표를 채우는 것이 최종 산출물**

| 이 프로젝트 | 실제 코드 위치 |
| --- | --- |
| 0 로그인 게이트 | |
| 2 파싱 | |
| 3 청킹·색인·동기화 | |
| 4 검색·권한 | |
| 5 리랭킹·용어 사전 | |
| 6 생성·출처 | |
| 7 UI·근거 카드·원문 | |
| 8 로그·피드백 | |
| 9 피드백 반영·replay | |
