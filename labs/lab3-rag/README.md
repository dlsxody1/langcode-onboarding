# 실습 3 — 온보딩 문서로 만드는 미니 사내 RAG 챗봇

이 사이트의 **"실습" 탭**(`/lab`)이다. 01–07 문서를 코퍼스로 검색하고, 근거와 함께 답한다.
전체 계획은 [`PLAN.md`](./PLAN.md), 측정 기록은 [`RESULTS.md`](./RESULTS.md).

**지금 상태: 0단계** — 로그인 게이트와 빈 채팅 화면만 있다.

## 파일 위치

| 무엇 | 어디 |
| --- | --- |
| 로그인 게이트 | `middleware.ts` (matcher: `/lab`, `/api/lab` 만) |
| Supabase 클라이언트 | `lib/supabase/` |
| 화면 | `app/lab/` (`login/`, `signout/`, `page.tsx`) |
| API | `app/api/lab/chat`, `app/api/lab/feedback` |
| DB 스키마 · 시드 | `labs/lab3-rag/supabase/` |
| 가상 사내 문서 · 평가셋 · 스크립트 | `labs/lab3-rag/corpus-internal/`, `data/`, `scripts/` (1단계부터) |

## 처음 한 번: Supabase · Vercel 설정 (직접 할 일)

- [ ] [supabase.com](https://supabase.com) 에서 무료 프로젝트 생성
- [ ] **Authentication → Sign In / Providers**: Email 켜기, **"Allow new users to sign up" 끄기** (초대 전용)
- [ ] **Authentication → Users → Add user**: `employee@demo.test`, `customer@demo.test` 생성 (비밀번호 지정, Auto Confirm 체크)
- [ ] **SQL Editor** 에서 차례로 실행
  1. `supabase/migrations/0001_profiles.sql`
  2. `supabase/seed.sql` (이메일을 바꿨다면 seed 도 같이 바꾼다)
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

## 알아둘 것

- **Supabase 무료 프로젝트는 오래 안 쓰면 일시 중지될 수 있다.** 그러면 실습 탭만 막히고, 나머지 탭은 그대로 동작한다.
- `.env.local` 이 없어도 사이트 빌드는 성공한다. 그때 `/lab` 은 "Supabase 환경 변수가 필요합니다"(503)를 보여 준다.
- 1단계에서 추가할 가상 사내 문서는 데모용으로 지어낸 것이고, 실제 회사 규정이 아니다.
