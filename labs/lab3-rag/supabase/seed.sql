-- 데모 계정 프로필. 먼저 대시보드 Authentication > Users 에서 사용자 2명을 만든다.
-- 이메일로 id 를 찾아 넣으므로 uuid 를 복사할 필요는 없다. 이메일만 바꿔서 실행한다.

insert into public.profiles (id, display_name, audience)
select id, '데모 임직원', 'employee' from auth.users where email = 'employee@demo.test'
on conflict (id) do update set display_name = excluded.display_name, audience = excluded.audience;

insert into public.profiles (id, display_name, audience)
select id, '데모 고객', 'customer' from auth.users where email = 'customer@demo.test'
on conflict (id) do update set display_name = excluded.display_name, audience = excluded.audience;

-- 확인
select p.audience, u.email from public.profiles p join auth.users u on u.id = p.id;
