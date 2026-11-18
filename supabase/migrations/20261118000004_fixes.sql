-- =====================================================================
-- Your Space — migration 4: audit fixes
-- Run in: Supabase Dashboard → SQL Editor → New query → paste → Run
-- Safe to run more than once.
-- =====================================================================

-- B1: with Quota = ₱0 the view divided by zero and the Home + Quota pages
-- crashed. nullif() turns those percentages into 0 instead of an error.
-- Same columns, same order, so "create or replace" keeps grants and RLS behaviour.
create or replace view public.v_quota_progress with (security_invoker = true) as
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
  coalesce(round(coalesce(d.sales_php,0) / nullif(s.quota_php, 0) * 100, 2), 0)                     as pct_of_quota,
  coalesce(round(coalesce(d.sales_php,0) / nullif(s.quota_php * s.goal_pct / 100, 0) * 100, 2), 0)  as pct_of_goal,
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

revoke all on public.v_quota_progress from anon;

-- Progress report: commission rate used to compute "Total earnings" (contract price × rate).
alter table public.settings
  add column if not exists commission_pct numeric(5,2) check (commission_pct between 0 and 100);
