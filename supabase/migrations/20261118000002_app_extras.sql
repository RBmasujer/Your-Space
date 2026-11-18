-- Keep-alive endpoint for the GitHub Action (free projects pause after 7 idle days).
-- Returns a constant; reads no data, so it is safe to expose to anon.
create or replace function public.ping()
returns text language sql stable set search_path = '' as $$ select 'ok'::text $$;
revoke all on function public.ping() from public;
grant execute on function public.ping() to anon, authenticated;
