-- 0단계: 사용자 프로필과 열람 범위(audience)
-- audience 판단은 언제나 이 테이블에서 한다. 클라이언트가 보낸 값은 쓰지 않는다.

create table if not exists public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  audience     text not null check (audience in ('employee', 'customer')),
  created_at   timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- 본인 행만 읽을 수 있다
drop policy if exists "profiles: 본인 행 읽기" on public.profiles;
create policy "profiles: 본인 행 읽기"
  on public.profiles for select
  to authenticated
  using ((select auth.uid()) = id);

-- INSERT / UPDATE / DELETE 정책은 일부러 만들지 않는다.
-- RLS 가 켜져 있고 정책이 없으면 거부된다 → 사용자가 자기 audience 를 바꿀 수 없다.
-- 프로필은 대시보드 SQL 에디터(관리자 권한)에서만 넣는다. seed.sql 참고.
