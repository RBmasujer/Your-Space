-- =====================================================================
-- Your Space — Supabase schema v1
-- Run in: Supabase Dashboard → SQL Editor → New query → paste → Run
-- Safe to run once on a fresh project. Run 02_seed.sql AFTER you have
-- created the single login user (see setup step 3).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. Private schema (NOT exposed through the REST API) + owner lock
-- ---------------------------------------------------------------------
-- Two locks protect the data: (a) every row has owner_id = auth.uid(),
-- (b) the user must ALSO be listed in private.app_owner. So even if
-- public sign-ups are switched on by mistake, a stranger who signs up
-- sees and writes nothing.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table private.app_owner (
  user_id   uuid primary key references auth.users(id) on delete cascade,
  singleton boolean not null default true unique check (singleton) -- max 1 row
);

create or replace function public.is_app_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from private.app_owner where user_id = auth.uid());
$$;
revoke all on function public.is_app_owner() from public, anon;
grant execute on function public.is_app_owner() to authenticated;

-- updated_at helper
create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------------
-- 1. Enums (match the statuses already used in her Excel + current app)
-- ---------------------------------------------------------------------
create type public.lead_status  as enum
  ('New','Contacted','Follow-Up','Site Visit','Reserved','Closed','Cancelled','Not Interested');
create type public.income_class as enum ('High','Mid','Low');
create type public.post_platform as enum ('Facebook','Instagram','TikTok','Other');
create type public.post_status  as enum ('Draft','Scheduled','Posted','Cancelled');
create type public.event_kind   as enum ('Manning','Training','Sync','Tripping','Other');
create type public.event_status as enum ('Planned','Done','Cancelled');
create type public.file_kind    as enum ('docx','xlsx','csv','image','video','other');
create type public.proc_status  as enum ('pending','processing','done','error','skipped');
create type public.email_status as enum ('queued','sent','failed');
create type public.lead_quality as enum ('Qualified','Not qualified');
create type public.lead_temp    as enum ('Hot','Cold');

-- ---------------------------------------------------------------------
-- 2. Settings (one row) — quota inputs that drive the auto-computation
-- ---------------------------------------------------------------------
create table public.settings (
  owner_id        uuid primary key default auth.uid()
                  references auth.users(id) on delete cascade,
  quota_php       numeric(14,2) not null default 25000000 check (quota_php >= 0),
  goal_pct        numeric(6,2)  not null default 150      check (goal_pct > 0),  -- goal = quota × 150%
  period_start    date not null default date '2026-11-01',
  period_end      date not null default date '2027-02-28',
  avg_unit_price  numeric(14,2) check (avg_unit_price > 0),                   -- optional, for "deals needed"
  email_from      text not null default 'cjmasujer.rpmmc@gmail.com',
  email_signature text,
  updated_at      timestamptz not null default now(),
  check (period_end >= period_start)
);

-- ---------------------------------------------------------------------
-- 3. Leads — the quota tracker is computed from this table
-- ---------------------------------------------------------------------
create table public.leads (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid not null default auth.uid() references auth.users(id) on delete cascade,
  full_name       text not null check (length(btrim(full_name)) between 1 and 200),
  phone           text check (length(phone) <= 50),
  -- no strict format check here: the imported list has cells like
  -- "a@x.com / b@y.com" and "@gmail.com". The app extracts the first valid
  -- address when emailing; email_log.to_email IS strictly checked.
  email           text check (length(email) <= 320),
  address         text,
  income_class    public.income_class,
  nationality     text,
  status          public.lead_status not null default 'New',
  quality         public.lead_quality,  -- null = not reviewed
  temperature     public.lead_temp,     -- null = not rated
  source          text,                 -- FB, IG, TikTok, walk-in, referral…
  project         text,                 -- RLC project of interest
  unit            text,
  contract_price  numeric(14,2) check (contract_price >= 0),
  closed_at       date,                 -- auto-set by trigger below
  next_follow_up  date,
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  -- a Closed deal must carry a price, otherwise the quota math is wrong
  constraint closed_needs_price check (status <> 'Closed' or contract_price is not null)
);

-- Stamp/clear closed_at automatically (Manila date, not UTC)
create or replace function public.leads_closed_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.status = 'Closed' and new.closed_at is null then
    new.closed_at := (now() at time zone 'Asia/Manila')::date;
  elsif new.status not in ('Closed','Cancelled') then
    new.closed_at := null;           -- re-opened lead no longer counts
  end if;
  return new;
end $$;

create trigger trg_leads_closed_at before insert or update of status, closed_at on public.leads
  for each row execute function public.leads_closed_at();

-- ---------------------------------------------------------------------
-- 4. Marketing / content calendar
-- ---------------------------------------------------------------------
create table public.files_metadata (            -- defined before content_posts (FK)
  id                uuid primary key default gen_random_uuid(),
  owner_id          uuid not null default auth.uid() references auth.users(id) on delete cascade,
  file_name         text not null check (length(file_name) between 1 and 255),
  file_type         public.file_kind not null,
  mime_type         text,
  storage_path      text not null unique,       -- "<owner_id>/<folder>/<uuid>-<name>"
  size_bytes        bigint check (size_bytes between 0 and 52428800),
  tags              text[] not null default '{}',
  summary           text,                       -- extracted text summary (docx) / human note
  metrics           jsonb not null default '{}'::jsonb,  -- latest metrics from Edge Function
  processing_status public.proc_status not null default 'pending',
  processing_error  text,
  last_modified     timestamptz not null default now(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  -- a row can only point at a file inside the owner's own storage folder
  constraint path_in_owner_folder check (split_part(storage_path, '/', 1) = owner_id::text)
);

-- metrics history, written only by the Edge Function (service role)
create table public.file_metrics_log (
  id           bigint generated always as identity primary key,
  owner_id     uuid not null references auth.users(id) on delete cascade,
  file_id      uuid not null references public.files_metadata(id) on delete cascade,
  captured_at  timestamptz not null default now(),
  metrics      jsonb not null
);

create table public.content_posts (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title         text not null check (length(btrim(title)) between 1 and 200),
  caption       text,
  platforms     public.post_platform[] not null default '{Facebook}',
  scheduled_at  timestamptz,
  status        public.post_status not null default 'Draft',
  asset_file_id uuid references public.files_metadata(id) on delete set null,
  asset_url     text,                            -- e.g. a Google Drive link
  posted_url    text,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint scheduled_needs_date check (status <> 'Scheduled' or scheduled_at is not null)
);

-- ---------------------------------------------------------------------
-- 5. Manning + tripping calendar
-- ---------------------------------------------------------------------
create table public.schedule_events (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind        public.event_kind not null default 'Manning',
  title       text not null check (length(btrim(title)) between 1 and 200),
  starts_at   timestamptz not null,
  ends_at     timestamptz,
  all_day     boolean not null default false,
  location    text,                              -- booth / showroom / project site
  lead_id     uuid references public.leads(id) on delete set null,  -- client for a tripping
  status      public.event_status not null default 'Planned',
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  check (ends_at is null or ends_at >= starts_at)
);

-- ---------------------------------------------------------------------
-- 6. Shortcuts, property showcase, email log
-- ---------------------------------------------------------------------
create table public.shortcuts (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  label       text not null,
  url         text not null check (url ~* '^https://'),   -- blocks javascript: URLs
  category    text not null default 'Other',
  sort_order  int  not null default 0,
  created_at  timestamptz not null default now()
);

create table public.properties (
  id             uuid primary key default gen_random_uuid(),
  owner_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name           text not null,
  location       text,
  price_from     numeric(14,2) check (price_from >= 0),
  description    text,
  link           text check (link is null or link ~* '^https://'),
  image_file_id  uuid references public.files_metadata(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table public.email_log (
  id                  uuid primary key default gen_random_uuid(),
  owner_id            uuid not null default auth.uid() references auth.users(id) on delete cascade,
  lead_id             uuid references public.leads(id) on delete set null,
  to_email            text not null check (to_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  subject             text not null,
  body                text,
  status              public.email_status not null default 'queued',
  error               text,
  provider_message_id text,
  sent_at             timestamptz,
  created_at          timestamptz not null default now()
);

create table public.email_templates (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name        text not null,
  subject     text not null,
  body        text not null,
  sort_order  int  not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (owner_id, name)
);

-- ---------------------------------------------------------------------
-- 7. Indexes
-- ---------------------------------------------------------------------
create index on public.leads (owner_id, status);
create index on public.leads (owner_id, closed_at) where status = 'Closed';
create index on public.leads (owner_id, next_follow_up) where next_follow_up is not null;
create index on public.leads (lower(email));
create index on public.content_posts (owner_id, scheduled_at);
create index on public.schedule_events (owner_id, starts_at);
create index on public.schedule_events (lead_id);
create index on public.files_metadata (owner_id, last_modified desc);
create index on public.files_metadata using gin (tags);
create index on public.file_metrics_log (file_id, captured_at desc);
create index on public.email_log (owner_id, created_at desc);

-- updated_at triggers
do $$
declare t text;
begin
  foreach t in array array['settings','leads','files_metadata','content_posts','schedule_events','properties','email_templates']
  loop
    execute format('create trigger trg_%1$s_updated before update on public.%1$I
                    for each row execute function public.set_updated_at()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 8. Row-Level Security
-- ---------------------------------------------------------------------
-- Full CRUD for the owner on every user table. Nothing for anon.
do $$
declare t text;
begin
  foreach t in array array['settings','leads','files_metadata','content_posts',
                           'schedule_events','shortcuts','properties','email_log',
                           'email_templates']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from anon', t);

    execute format($p$create policy "%1$s_select_own" on public.%1$I for select to authenticated
      using (owner_id = (select auth.uid()) and (select public.is_app_owner()))$p$, t);
    execute format($p$create policy "%1$s_insert_own" on public.%1$I for insert to authenticated
      with check (owner_id = (select auth.uid()) and (select public.is_app_owner()))$p$, t);
    execute format($p$create policy "%1$s_update_own" on public.%1$I for update to authenticated
      using (owner_id = (select auth.uid()) and (select public.is_app_owner()))
      with check (owner_id = (select auth.uid()))$p$, t);
    execute format($p$create policy "%1$s_delete_own" on public.%1$I for delete to authenticated
      using (owner_id = (select auth.uid()) and (select public.is_app_owner()))$p$, t);
  end loop;
end $$;

-- metrics log: owner can READ only; the Edge Function writes with the service role
alter table public.file_metrics_log enable row level security;
alter table public.file_metrics_log force row level security;
revoke all on public.file_metrics_log from anon;
revoke insert, update, delete on public.file_metrics_log from authenticated;
create policy "file_metrics_log_select_own" on public.file_metrics_log for select to authenticated
  using (owner_id = (select auth.uid()) and (select public.is_app_owner()));

-- ---------------------------------------------------------------------
-- 9. Views for the dashboard (security_invoker = RLS of the caller applies;
--    without it a Supabase view runs as postgres and BYPASSES RLS)
-- ---------------------------------------------------------------------
create view public.v_quota_progress with (security_invoker = true) as
select
  s.owner_id,
  s.quota_php,
  s.goal_pct,
  round(s.quota_php * s.goal_pct / 100, 2)                         as goal_php,
  s.period_start,
  s.period_end,
  coalesce(d.deals_closed, 0)                                      as deals_closed,
  coalesce(d.sales_php, 0)                                         as sales_php,
  coalesce(p.reserved_count, 0)                                    as reserved_count,
  coalesce(p.reserved_php, 0)                                      as reserved_php,
  case when s.quota_php = 0 then 0
       else round(coalesce(d.sales_php,0) / s.quota_php * 100, 2) end            as pct_of_quota,
  round(coalesce(d.sales_php,0) / (s.quota_php * s.goal_pct / 100) * 100, 2)   as pct_of_goal,
  greatest(0, s.quota_php - coalesce(d.sales_php,0))                            as remaining_quota_php,
  greatest(0, s.quota_php * s.goal_pct / 100 - coalesce(d.sales_php,0))         as remaining_goal_php,
  greatest(0, s.period_end - (now() at time zone 'Asia/Manila')::date)           as days_left,
  case when s.avg_unit_price > 0
       then ceil(greatest(0, s.quota_php - coalesce(d.sales_php,0)) / s.avg_unit_price) end
                                                                                 as deals_needed_quota,
  case when s.avg_unit_price > 0
       then ceil(greatest(0, s.quota_php * s.goal_pct / 100 - coalesce(d.sales_php,0)) / s.avg_unit_price) end
                                                                                 as deals_needed_goal,
  case when coalesce(d.sales_php,0) >= s.quota_php * s.goal_pct / 100 then 'Goal reached'
       when coalesce(d.sales_php,0) >= s.quota_php                    then 'Quota met'
       else 'In progress' end                                                    as status_label
from public.settings s
left join lateral (
  select count(*) as deals_closed, sum(l.contract_price) as sales_php
  from public.leads l
  where l.owner_id = s.owner_id
    and l.status = 'Closed'
    and l.closed_at between s.period_start and s.period_end
) d on true
left join lateral (
  select count(*) as reserved_count, sum(l.contract_price) as reserved_php
  from public.leads l
  where l.owner_id = s.owner_id and l.status = 'Reserved'
) p on true;

-- month-by-month closed sales + running total (for the progress graph)
create view public.v_monthly_sales with (security_invoker = true) as
select
  owner_id,
  date_trunc('month', closed_at)::date                      as month,
  count(*)                                                  as deals,
  sum(contract_price)                                       as sales_php,
  sum(sum(contract_price)) over (partition by owner_id
        order by date_trunc('month', closed_at))            as cumulative_php
from public.leads
where status = 'Closed'
group by owner_id, date_trunc('month', closed_at);

-- funnel counts per status (for the pipeline chart)
create view public.v_lead_funnel with (security_invoker = true) as
select owner_id, status, count(*) as leads
from public.leads
group by owner_id, status;

revoke all on public.v_quota_progress, public.v_monthly_sales, public.v_lead_funnel from anon;

-- ---------------------------------------------------------------------
-- 10. Storage: private bucket "workspace" (50 MB per file)
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'workspace', 'workspace', false, 52428800,
  array[
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document', -- .docx
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',       -- .xlsx
    'text/csv', 'application/vnd.ms-excel',                                    -- .csv (Windows reports ms-excel)
    'image/jpeg', 'image/png', 'image/webp', 'image/gif',
    'video/mp4', 'video/quicktime', 'video/webm'                              -- content-calendar clips (≤50 MB)
  ]
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Files must live under "<your user id>/…". Upsert needs select+insert+update.
create policy "workspace_select_own" on storage.objects for select to authenticated
  using (bucket_id = 'workspace'
         and (storage.foldername(name))[1] = (select auth.uid())::text
         and (select public.is_app_owner()));

create policy "workspace_insert_own" on storage.objects for insert to authenticated
  with check (bucket_id = 'workspace'
              and (storage.foldername(name))[1] = (select auth.uid())::text
              and (select public.is_app_owner()));

create policy "workspace_update_own" on storage.objects for update to authenticated
  using (bucket_id = 'workspace'
         and (storage.foldername(name))[1] = (select auth.uid())::text
         and (select public.is_app_owner()))
  with check (bucket_id = 'workspace'
              and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "workspace_delete_own" on storage.objects for delete to authenticated
  using (bucket_id = 'workspace'
         and (storage.foldername(name))[1] = (select auth.uid())::text
         and (select public.is_app_owner()));
