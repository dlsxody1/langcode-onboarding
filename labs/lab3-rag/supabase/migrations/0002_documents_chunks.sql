-- 3단계: 문서 · 청크 · 원본 파일
-- 쓰기는 service_role(secret 키)만 한다 — INSERT/UPDATE/DELETE 정책을 만들지 않는다.
-- 읽기는 "내 audience 가 들어 있는 행"만. audience 는 언제나 profiles 에서 가져온다.

create table if not exists public.documents (
  doc_id         text primary key,                 -- "03-rag/foundations" | "internal/travel-expense"
  title          text not null,
  source         text not null check (source in ('onboarding', 'internal')),
  format         text not null check (format in ('md', 'pdf', 'docx')),
  route          text not null,                    -- 원문 보기 경로
  version        text,
  effective_date date,
  status         text not null default 'current' check (status in ('current', 'superseded')),
  audience       text[] not null,
  storage_path   text,                             -- 원본 파일 (originals 버킷). 01–07 은 없음
  updated_at     timestamptz not null default now()
);

create table if not exists public.chunks (
  chunk_id      text primary key,                  -- "03-rag/foundations#3-코사인-유사도~0"
  doc_id        text not null references public.documents (doc_id) on delete cascade,
  kind          text not null check (kind in ('text', 'table')),
  heading_path  text[] not null,
  anchor        text,
  page          int,
  text          text not null,                     -- 표시용 원문 (검색용 텍스트는 색인에만)
  audience      text[] not null,
  content_hash  text not null,
  updated_at    timestamptz not null default now()
);

create index if not exists chunks_doc_id_idx on public.chunks (doc_id);

alter table public.documents enable row level security;
alter table public.chunks enable row level security;

-- 정책 안의 profiles 조회도 profiles 자신의 RLS(본인 행만)를 거친다 → 남의 audience 를 빌려 쓸 수 없다
drop policy if exists "documents: 열람 범위 안의 문서만" on public.documents;
create policy "documents: 열람 범위 안의 문서만"
  on public.documents for select
  to authenticated
  using ((select p.audience from public.profiles p where p.id = (select auth.uid())) = any (audience));

drop policy if exists "chunks: 열람 범위 안의 청크만" on public.chunks;
create policy "chunks: 열람 범위 안의 청크만"
  on public.chunks for select
  to authenticated
  using ((select p.audience from public.profiles p where p.id = (select auth.uid())) = any (audience));

-- 원본 파일: 비공개 버킷. 링크는 서버가 권한 확인 후 짧은 만료의 서명 URL 로만 준다 (7단계)
insert into storage.buckets (id, name, public)
values ('originals', 'originals', false)
on conflict (id) do update set public = false;

-- 읽기 정책은 documents 를 거친다. documents 의 RLS 가 이미 audience 로 걸러 주므로,
-- "내가 볼 수 있는 문서의 storage_path 와 같은 파일"이면 된다 — 정책을 겹쳐 쓰는 대신 이어 붙인다
drop policy if exists "originals: 볼 수 있는 문서의 원본만" on storage.objects;
create policy "originals: 볼 수 있는 문서의 원본만"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'originals'
    and exists (select 1 from public.documents d where d.storage_path = objects.name)
  );
