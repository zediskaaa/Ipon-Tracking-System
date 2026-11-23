begin;

-- Use current session and account activity in the actual removal predicate.
create or replace function public.cleanup_inactive_verified_badges()
returns integer
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_row record;
  v_cleaned integer := 0;
  v_reason text;
begin
  if auth.uid() is null then
    return 0;
  end if;

  for v_row in
    select p.id,
           p.verified_badge_expires_at,
           p.verified_badge_granted_at,
           p.last_seen_at,
           p.created_at,
           coalesce(nullif(p.email, ''), u.email) as resolved_email,
           u.last_sign_in_at
    from public.profiles p
    left join auth.users u on u.id = p.id
    where p.verified_badge_tier <> 'NONE'
      and public.effective_verified_badge_for_user(
        p.verified_badge_tier,
        p.verified_badge_expires_at,
        p.verified_badge_granted_at,
        greatest(p.last_seen_at, public.latest_retention_activity_at(p.id)),
        p.created_at,
        coalesce(nullif(p.email, ''), u.email),
        u.last_sign_in_at,
        coalesce(p.verified_badge_acknowledged_at, now())
      ) = 'NONE'
  loop
    v_reason := case
      when v_row.verified_badge_expires_at is not null and v_row.verified_badge_expires_at <= now() then
        'Your temporary verified badge duration ended.'
      else
        'Automatically removed after 2 months of account inactivity.'
    end;

    update public.profiles
    set verified_badge_tier = 'NONE',
        verified_badge_expires_at = null,
        verified_badge_message = null,
        verified_badge_granted_at = null,
        verified_badge_acknowledged_at = now(),
        verified_badge_granted_by = null
    where id = v_row.id
      and verified_badge_tier <> 'NONE';

    if found then
      v_cleaned := v_cleaned + 1;
      insert into public.notifications (
        recipient_id,
        group_id,
        type,
        title,
        message,
        link,
        dedupe_key
      ) values (
        v_row.id,
        null,
        'BADGE_REMOVED',
        'Verified badge removed',
        left('Your verified badge was removed. Reason: ' || v_reason, 500),
        null,
        'BADGE_AUTO_REMOVED:' || v_row.id::text || ':' || floor(extract(epoch from clock_timestamp()) * 1000)::bigint::text
      );
    end if;
  end loop;

  return v_cleaned;
end;
$$;

insert into public.schema_migrations (version, name)
values ('20261123_188', 'protect active verified badges during cleanup')
on conflict (version) do nothing;

notify pgrst, 'reload schema';

commit;
