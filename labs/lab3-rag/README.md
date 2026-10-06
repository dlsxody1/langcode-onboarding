# 실습 3 — 온보딩 문서로 만드는 미니 사내 RAG 챗봇

이 사이트의 **"실습" 탭**(`/lab`)이다. 01–07 문서를 코퍼스로 검색하고, 근거와 함께 답한다.
전체 계획은 [`PLAN.md`](./PLAN.md), 측정 기록은 [`RESULTS.md`](./RESULTS.md).

**지금 상태: 4단계 완료** — 실습 탭에서 질문하면 BM25 근거 청크가 나온다(권한 2겹). 평가 기준선 R@3 0.893 · 누출 0건 → [`RESULTS.md`](./RESULTS.md). 답변 생성은 6단계.

## 파일 위치

| 무엇 | 어디 |
| --- | --- |
| 로그인 게이트 | `middleware.ts` (matcher: `/lab`, `/api/lab` 만) |
| Supabase 클라이언트 | `lib/supabase/` |
| 화면 | `app/lab/` (`login/`, `signout/`, `page.tsx`) |
| API | `app/api/lab/chat`, `app/api/lab/feedback` |
| DB 스키마 · 시드 | `labs/lab3-rag/supabase/` |
| 가상 사내 문서 | `labs/lab3-rag/corpus-internal/` (목록은 `manifest.json`, PDF·DOCX 원본은 `src/`) |
| 평가셋 | `labs/lab3-rag/data/eval.jsonl` (생성물) ← `data/questions.ts` + `data/eval-extra.jsonl` |
| 스크립트 | `labs/lab3-rag/scripts/` — Node 24 가 `.mts` 를 바로 실행한다 (tsx 불필요) |

## 명령

| 명령 | 하는 일 |
| --- | --- |
| `npm run lab:docs` | `src/` 원본으로 `travel-expense.pdf`, `benefits.docx` 다시 만들기 (Edge/Chrome 필요) |
| `npm run lab:parse` | 코퍼스 전체 → `generated/parsed.json`. `-- --print travel` 로 섹션 확인, `-- --markdown travel` 로 PDF 가 어떻게 읽혔는지 확인 |
| `npm run lab:index` | 파싱 → 청킹 → `generated/index.json`(커밋) + `chunks.json`(커밋 안 함) |
| `npm run lab:sync` | 청크·원본을 Supabase 로. 바뀐 청크만 보낸다. **secret 키 필요 (`.env.local` 의 `SUPABASE_SECRET_KEY`, 로컬 전용)** |
| `npm run lab:sync -- --check` | 쓰지 않고 색인 ↔ DB 어긋남만 확인 |
| `npm run lab:eval` | 평가: R@1·3·5, MRR, 종류·형식·함정별, 놓친 질문, 권한 누출. `-- --all` 전체, `-- --no-prefilter` 1차 필터 끈 실험 |
| `npm run lab:eval-set` | 퀴즈 + 보강 문항 → `data/eval.jsonl`. 정답 문서·절 오타를 검증한다 |

## 처음 한 번: Supabase · Vercel 설정 (직접 할 일)

- [ ] [supabase.com](https://supabase.com) 에서 무료 프로젝트 생성
- [ ] **Authentication → Sign In / Providers**: Email 켜기, **"Allow new users to sign up" 끄기** (초대 전용)
- [ ] **Authentication → Users → Add user**: `employee@demo.test`, `customer@demo.test` 생성 (비밀번호 지정, Auto Confirm 체크)
- [ ] **SQL Editor** 에서 차례로 실행
  1. `supabase/migrations/0001_profiles.sql`
  2. `supabase/seed.sql` (이메일을 바꿨다면 seed 도 같이 바꾼다)
  3. `supabase/migrations/0002_documents_chunks.sql`
- [ ] Secret keys 의 키를 `.env.local` 의 `SUPABASE_SECRET_KEY=` 에 넣고 `npm run lab:index && npm run lab:sync`
- [ ] **Project Settings → API Keys** 에서 Project URL 과 publishable 키(또는 anon 키) 복사
- [ ] 저장소 루트에서 `.env.local.example` → `.env.local` 로 복사하고 값 채우기
- [ ] Vercel(이 사이트 프로젝트) → Settings → Environment Variables 에 **두 개만** 추가
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (또는 `NEXT_PUBLIC_SUPABASE_ANON_KEY`)
  - ⚠ `SUPABASE_SERVICE_ROLE_KEY` 는 **등록하지 않는다**

## 로컬 실행

```bash
npm run dev
```

http://localhost:3000/lab → 로그인 화면으로 이동해야 한다.

## 0단계 확인

- 시크릿 창에서 `/lab` → `/lab/login` 리다이렉트
- 시크릿 창에서 `/docs`, `/quiz`, `/review`, `/glossary` 는 로그인 없이 열린다
- `curl -X POST http://localhost:3000/api/lab/chat` → `401`
- 데모 임직원 계정으로 로그인 → "임직원" 배지, 새로고침해도 유지, 로그아웃 → 다시 `/lab/login`
- 로그인 상태에서 `/api/lab/chat` 에 POST → `501` + `audience`

## 실험: 1차 권한 필터 끄기

개발 서버를 `LAB_UNSAFE_SKIP_PREFILTER=1` 로 띄우고 고객 계정으로 "USB 메모리 써도 되나요?" 를 물으면, BM25 는 임직원 청크를 고르지만 RLS 가 원문 조회를 막는다. 화면에는 경고가, 서버 로그에는 `[lab3] 요청 5개 중 n개만 조회됨` 이 남는다. 운영 빌드(`NODE_ENV=production`)에서는 이 스위치가 무시된다.

## 알아둘 것

- **Supabase 무료 프로젝트는 오래 안 쓰면 일시 중지될 수 있다.** 그러면 실습 탭만 막히고, 나머지 탭은 그대로 동작한다.
- `.env.local` 이 없어도 사이트 빌드는 성공한다. 그때 `/lab` 은 "Supabase 환경 변수가 필요합니다"(503)를 보여 준다.
- `corpus-internal/` 의 가상 사내 문서(출장 규정, 복리후생, 정보보안 정책)는 실습용으로 지어낸 것이고, 실제 회사 규정이 아니다.
- 정보보안 정책 v4.1 은 **일부러** 색인 대상에 남겨 둔 폐지 문서다. 구버전이 검색을 오염시키는 문제를 재현하고 5단계에서 고친다.
