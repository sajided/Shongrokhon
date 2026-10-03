-- Phase 4: Bangla coach (TC-P4-L10N-06). Insights are cached per period and
-- language: the cache row's period is 'MONTH' for English, 'MONTH:bn' for Bangla.
drop function if exists public.coach_context(uuid, text);

create or replace function public.coach_context(p_user_id uuid, p_period text, p_lang text default 'en') returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_from timestamptz := private.period_start(p_period);
  v_key text := case when p_lang = 'bn' then p_period || ':bn' else p_period end;
  v_summary jsonb;
  cfg public.app_config;
begin
  if v_from is null then
    raise exception 'INVALID_PERIOD' using errcode = '22023';
  end if;
  if p_lang not in ('en', 'bn') then
    raise exception 'INVALID_LANGUAGE' using errcode = '22023';
  end if;
  select * into cfg from public.app_config where id;
  v_summary := private.coach_summary(p_user_id, v_from, now(), false);
  return jsonb_build_object(
    'summary', v_summary,
    'uncategorized', private.uncategorized_merchants(p_user_id),
    'cached', (select jsonb_build_object('payload', c.payload, 'source', c.source, 'created_at', c.created_at)
                 from public.coach_insight_cache c
                where c.user_id = p_user_id and c.period = v_key and c.data_hash = v_summary ->> 'data_hash'),
    'config', jsonb_build_object(
      'min_txns', cfg.coach_min_txns,
      'llm_mode', cfg.coach_llm_mode,
      'llm_timeout_ms', cfg.coach_llm_timeout_ms,
      'mock_delay_ms', cfg.coach_mock_delay_ms));
end $$;

revoke all on function public.coach_context(uuid, text, text) from public, anon, authenticated;
grant execute on function public.coach_context(uuid, text, text) to service_role;
