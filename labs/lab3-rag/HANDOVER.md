# 인수인계 — 실습 3 · 0단계 (2026-10-02)

> 다음 Claude Code 세션용. 이 파일을 먼저 읽고 "할 일"부터 이어서 한다. 다 끝나면 지워도 된다 (커밋 대상 아님).

## 사용자 선호
- **답변은 항상 한국어로.** 새 프로젝트 폴더에서는 메모리가 따로라서 이 설정도 메모리에 다시 저장해 둔다.
- **커밋은 사용자가 요청할 때만.** 직전 세션에서 커밋하려던 걸 사용자가 막았다.

## 작업 위치
- 작업 저장소는 **`C:\Users\dlsxo\projects\langcode-onboarding`** 한 곳이다 (`main`, `origin/main` 과 같음, 커밋 안 된 변경 있음).
- `\\wsl.localhost\Ubuntu\home\dlsxo\langcode-onboarding` 은 따로 복제된 옛 저장소다 (`07-db-infra` 없음). **건드리지 않는다.**

## 무엇을 하는 중인가
학습 사이트(Next.js 15.5)에 다섯 번째 탭 **"실습"**(`/lab`)을 붙여, 01–07 문서를 코퍼스로 한 RAG 챗봇을 만든다.
전체 계획은 [`PLAN.md`](./PLAN.md)(v4), 사용자가 직접 할 설정은 [`README.md`](./README.md) 체크리스트에 있다.

정한 것:
- **코퍼스 섞기:** 01–07 문서는 `employee`+`customer` 공개, 가상 사내 문서 2–3개(PDF·DOCX)는 `employee` 전용
- **로그인 게이트는 실습 탭에만:** `/lab/**`, `/api/lab/**` 만. 다른 탭은 Supabase 가 멈춰도 열린다

## 0단계 상태: 코드 완료 · 검증 완료 (실제 로그인 테스트만 남음)

커밋 안 된 변경 (`git status`):
- 수정: `.gitignore`(`.env*.local`), `README.md`(labs 목록 한 줄), `app/components/Masthead.tsx`(실습 링크), `app/globals.css`(`.lab*` 클래스), `package.json`/`package-lock.json`(`@supabase/supabase-js`, `@supabase/ssr`, `server-only`), `tsconfig.tsbuildinfo`(빌드 부산물)
- 새 파일: `middleware.ts`, `lib/supabase/{env,server,client}.ts`, `app/lab/{page.tsx,login/*,signout/route.ts}`, `app/api/lab/{chat,feedback}/route.ts`, `.env.local.example`, `.mcp.json`, `labs/lab3-rag/**`

핵심 설계:
- `lib/supabase/env.ts`: env 가 없으면 `null` 을 돌려준다. 그래서 env 없이도 빌드가 된다. 키는 `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` 와 `..._ANON_KEY` 둘 다 받는다
- `middleware.ts`: matcher `["/lab", "/lab/:path*", "/api/lab/:path*"]`. env 없으면 503, 미로그인이면 페이지는 `/lab/login?next=…`, API 는 401
- `currentUser()`(`lib/supabase/server.ts`): `getUser()` 로 확인한 뒤 `profiles` 에서 audience 를 읽는다. 프로필이 없으면 audience 는 `null`
- API 두 개는 `getUser()` 로 다시 확인하고, 로그인 상태면 501 + audience
- `seed.sql` 은 uuid 대신 **이메일로** `auth.users` 를 찾는다 (`employee@demo.test`, `customer@demo.test`)

직전 세션에서 확인한 것:
- `.env.local` 없이 `npm run build` 성공
- `/`, `/docs/...`, `/quiz`, `/review`, `/glossary` → 200 / env 없을 때 `/lab` → 503
- 가짜 키를 env 에 넣고 미로그인: `/lab` → 307 `/lab/login?next=%2Flab`, `POST /api/lab/chat`·`/feedback` → 401
- `.next/static` 에서 `service_role` 검색 → 0건

## 할 일 (순서대로)
1. **Supabase MCP 연결 확인.** `.mcp.json` 에 `supabase`(project_ref `syesunkyyemzxfkyrlrl`)가 있다. 도구가 안 보이면 사용자에게 `/mcp` 에서 OAuth 로그인을 부탁한다
2. **migration 적용:** `labs/lab3-rag/supabase/migrations/0001_profiles.sql` (profiles + RLS, 본인 SELECT 정책만)
3. **Auth 설정 확인:** Email 로그인 켜짐, 신규 회원가입 꺼짐. MCP 로 못 바꾸면 사용자에게 대시보드에서 바꿔 달라고 한다
4. **데모 사용자 2명:** `auth.users` 에 있는지 확인한다. 없으면 사용자가 대시보드 Authentication → Users → Add user(Auto Confirm)로 만든다. **비밀번호는 사용자가 정한다**
5. **`seed.sql` 실행** → 마지막 select 결과 2행 확인
6. **`.env.local` 작성:** MCP 로 project URL 과 publishable(또는 anon) 키를 받아 루트 `.env.local` 에 넣는다. `.env.local.example` 참고. **service_role 키는 넣지 않는다** (3단계 전까지 필요 없음)
7. **실제 로그인 테스트** (`npm run dev`, launch.json `onboarding`, 포트 3000):
   - 임직원 계정 로그인 → "임직원" 배지, 새로고침해도 유지
   - 고객 계정 → "고객" 배지
   - 틀린 비밀번호 → "이메일 또는 비밀번호가 맞지 않습니다."
   - 로그아웃 → `/lab` 접근 시 다시 `/lab/login`
   - 로그인 쿠키를 붙여 `POST /api/lab/chat` → 501 + `audience`
8. **Vercel env 등록:** 사용자가 할 일이다. `NEXT_PUBLIC_SUPABASE_URL` + publishable 키 두 개만. `SUPABASE_SERVICE_ROLE_KEY` 는 등록 금지
9. **커밋:** 사용자가 요청하면. `tsconfig.tsbuildinfo` 를 넣을지 물어보고, 이 HANDOVER.md 는 빼거나 지운다

## 그다음
PLAN.md 1단계: 가상 사내 문서 2–3개(`corpus-internal/`) 작성, `data/questions.ts` → 평가셋 변환과 패러프레이즈 보강. RAG 코드는 `lib/rag/` 에 둔다 (아직 없음).
