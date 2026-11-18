begin;

-- Restrict the 2-month inactivity auto-removal rule strictly to permanent badges
-- (temporary badges with verified_badge_expires_at expire strictly at their expiration timestamp).
create or replace function public.effective_verified_badge_for_user(
  p_tier text,
  p_expires_at timestamptz,
  p_granted_at timestamptz,
  p_last_seen_at timestamptz,
  p_created_at timestamptz,
  p_email text default null,
  p_last_sign_in_at timestamptz default null,
  p_acknowledged_at timestamptz default null
)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tier text := upper(btrim(coalesce(p_tier, 'NONE')));
  v_last_active timestamptz;
begin
  if v_tier not in ('BLUE', 'CREATOR_GREEN') then
    return 'NONE';
  end if;

  if v_tier <> 'CREATOR_GREEN' and p_acknowledged_at is null then
    return 'NONE';
  end if;

  if p_expires_at is not null then
    if p_expires_at <= now() then
      return 'NONE';
    end if;
    return v_tier;
  end if;

  if v_tier <> 'CREATOR_GREEN' and not public.is_protected_retention_account(p_email) then
    v_last_active := greatest(
      coalesce(p_last_seen_at, '-infinity'::timestamptz),
      coalesce(p_granted_at, '-infinity'::timestamptz),
      coalesce(p_last_sign_in_at, '-infinity'::timestamptz),
      coalesce(p_created_at, now())
    );
    if v_last_active <= now() - interval '2 months' then
      return 'NONE';
    end if;
  end if;

  return v_tier;
end;
$$;

revoke all on function public.effective_verified_badge_for_user(text, timestamptz, timestamptz, timestamptz, timestamptz, text, timestamptz, timestamptz) from public, anon, authenticated;

insert into public.schema_migrations (version, name)
values ('20261118_114', 'apply 2-month verified badge inactivity rule strictly to permanent badges')
on conflict (version) do nothing;

notify pgrst, 'reload schema';

commit;
