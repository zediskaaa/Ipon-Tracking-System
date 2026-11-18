begin;

-- 1. Permanently exempt protected owner social account from 6-month inactivity warnings & purges
create or replace function public.is_protected_retention_account(p_email text)
returns boolean
language sql
immutable
as $$
  select lower(btrim(coalesce(p_email, ''))) = 'breadspanish231@gmail.com';
$$;

revoke all on function public.is_protected_retention_account(text) from public, anon, authenticated;

update public.profiles p
set inactivity_warned_at = null
from auth.users u
where u.id = p.id
  and p.inactivity_warned_at is not null
  and public.is_protected_retention_account(coalesce(nullif(p.email, ''), u.email));

create or replace function public.collect_inactive_account_candidates(
  p_inactive_months integer default 6,
  p_warning_days integer default 7
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_inactive_span interval := make_interval(months => greatest(coalesce(p_inactive_months, 6), 1));
  v_warning_span interval := make_interval(days => greatest(coalesce(p_warning_days, 7), 1));
  v_warn_cutoff timestamptz := now() - (v_inactive_span - v_warning_span);
  v_warn_candidates jsonb := '[]'::jsonb;
  v_purge_candidates jsonb := '[]'::jsonb;
begin
  update public.profiles p
  set inactivity_warned_at = null
  from auth.users u
  where u.id = p.id
    and p.inactivity_warned_at is not null
    and (
      public.is_protected_retention_account(coalesce(nullif(p.email, ''), u.email))
      or greatest(
        coalesce(u.last_sign_in_at, u.created_at),
        coalesce(p.last_seen_at, p.created_at),
        coalesce((
          select max(c2.created_at)
          from public.contributions c2
          join public.contribution_periods cp2 on cp2.id = c2.contribution_period_id
          where cp2.member_id = p.member_id
            and c2.approval_status = 'CONFIRMED'
        ), 'epoch'::timestamptz)
      ) > p.inactivity_warned_at
    );

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'user_id', p.id,
        'email', coalesce(nullif(p.email, ''), u.email),
        'full_name', p.full_name,
        'inactivity_warned_at', p.inactivity_warned_at
      )
    ),
    '[]'::jsonb
  )
  into v_purge_candidates
  from public.profiles p
  join auth.users u on u.id = p.id
  where p.role <> 'SUPER_ADMIN'
    and not public.is_protected_retention_account(coalesce(nullif(p.email, ''), u.email))
    and p.inactivity_warned_at is not null
    and p.inactivity_warned_at <= now() - v_warning_span
    and greatest(
      coalesce(u.last_sign_in_at, u.created_at),
      coalesce(p.last_seen_at, p.created_at),
      coalesce((select max(c.created_at) from public.contributions c where c.submitted_by = p.id), 'epoch'::timestamptz),
      coalesce((
        select max(c2.created_at)
        from public.contributions c2
        join public.contribution_periods cp2 on cp2.id = c2.contribution_period_id
        where cp2.member_id = p.member_id
          and c2.approval_status = 'CONFIRMED'
      ), 'epoch'::timestamptz),
      coalesce((select max(m.created_at) from public.messages m where m.sender_id = p.id), 'epoch'::timestamptz)
    ) <= p.inactivity_warned_at
    and not (
      p.group_id is not null
      and exists (
        select 1
        from public.savings_goals sg
        where sg.group_id = p.group_id
          and sg.deleted_at is null
          and sg.status = 'ACTIVE'
      )
      and public.group_last_savings_activity_at(p.group_id) > now() - v_inactive_span
    );

  with due_warn as (
    select p.id, coalesce(nullif(p.email, ''), u.email) as email, p.full_name,
           greatest(
             coalesce(u.last_sign_in_at, u.created_at),
             coalesce(p.last_seen_at, p.created_at),
             coalesce((select max(c.created_at) from public.contributions c where c.submitted_by = p.id), 'epoch'::timestamptz),
             coalesce((
               select max(c2.created_at)
               from public.contributions c2
               join public.contribution_periods cp2 on cp2.id = c2.contribution_period_id
               where cp2.member_id = p.member_id
                 and c2.approval_status = 'CONFIRMED'
             ), 'epoch'::timestamptz),
             coalesce((select max(m.created_at) from public.messages m where m.sender_id = p.id), 'epoch'::timestamptz)
           ) as last_active_at
    from public.profiles p
    join auth.users u on u.id = p.id
    where p.role <> 'SUPER_ADMIN'
      and not public.is_protected_retention_account(coalesce(nullif(p.email, ''), u.email))
      and p.inactivity_warned_at is null
      and not (
        p.group_id is not null
        and exists (
          select 1
          from public.savings_goals sg
          where sg.group_id = p.group_id
            and sg.deleted_at is null
            and sg.status = 'ACTIVE'
        )
        and public.group_last_savings_activity_at(p.group_id) > now() - v_inactive_span
      )
      and greatest(
        coalesce(u.last_sign_in_at, u.created_at),
        coalesce(p.last_seen_at, p.created_at),
        coalesce((select max(c.created_at) from public.contributions c where c.submitted_by = p.id), 'epoch'::timestamptz),
        coalesce((
          select max(c2.created_at)
          from public.contributions c2
          join public.contribution_periods cp2 on cp2.id = c2.contribution_period_id
          where cp2.member_id = p.member_id
            and c2.approval_status = 'CONFIRMED'
        ), 'epoch'::timestamptz),
        coalesce((select max(m.created_at) from public.messages m where m.sender_id = p.id), 'epoch'::timestamptz)
      ) <= v_warn_cutoff
  ),
  stamped as (
    update public.profiles p
    set inactivity_warned_at = now()
    from due_warn dw
    where p.id = dw.id
    returning dw.id as user_id, dw.email, dw.full_name, dw.last_active_at, (now() + v_warning_span) as scheduled_purge_at
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'user_id', s.user_id,
        'email', s.email,
        'full_name', s.full_name,
        'last_active_at', s.last_active_at,
        'scheduled_purge_at', s.scheduled_purge_at
      )
    ),
    '[]'::jsonb
  )
  into v_warn_candidates
  from stamped s;

  return jsonb_build_object(
    'warn_candidates', v_warn_candidates,
    'purge_candidates', v_purge_candidates
  );
end;
$$;

revoke execute on function public.collect_inactive_account_candidates(integer, integer) from public, anon, authenticated;

create or replace function public.purge_inactive_user_data(p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_prof public.profiles%rowtype;
  v_account_email text;
  v_grp record;
  v_chat record;
  v_next_owner uuid;
  v_next_chat_owner uuid;
  v_att jsonb;
begin
  perform set_config('ipon.maintenance_retention_cleanup', 'on', true);

  select * into v_prof from public.profiles where id = p_user_id for update;
  if not found or v_prof.role = 'SUPER_ADMIN' then
    return false;
  end if;

  select coalesce(nullif(v_prof.email, ''), u.email) into v_account_email
  from auth.users u
  where u.id = p_user_id;

  if public.is_protected_retention_account(coalesce(nullif(v_prof.email, ''), v_account_email)) then
    return false;
  end if;

  -- Queue chat attachments belonging to user's DM conversations or uploaded by them
  insert into public.pending_storage_deletions (bucket_id, object_path)
  select coalesce(nullif(ma.bucket_id, ''), 'chat-attachments'), ma.storage_path
  from public.message_attachments ma
  join public.conversations c on c.id = ma.conversation_id
  where c.user_a = p_user_id or c.user_b = p_user_id or ma.uploader_id = p_user_id
  on conflict (bucket_id, object_path) do nothing;

  -- Transfer group chat ownership or clean empty orphaned group chats
  for v_chat in
    select distinct c.id, c.created_by
    from public.conversations c
    join public.conversation_participants cp on cp.conversation_id = c.id
    where c.kind = 'GROUP' and cp.user_id = p_user_id
  loop
    delete from public.conversation_participants where conversation_id = v_chat.id and user_id = p_user_id;

    select cp.user_id into v_next_chat_owner
    from public.conversation_participants cp
    join public.profiles mp on mp.id = cp.user_id
    where cp.conversation_id = v_chat.id
      and mp.status = 'ACTIVE'
    order by
      case cp.role when 'OWNER' then 0 when 'ADMIN' then 1 else 2 end,
      cp.joined_at asc
    limit 1;

    if v_next_chat_owner is not null then
      if v_chat.created_by = p_user_id or not exists (
        select 1 from public.conversation_participants cp2
        where cp2.conversation_id = v_chat.id and cp2.role = 'OWNER'
      ) then
        update public.conversation_participants set role = 'OWNER' where conversation_id = v_chat.id and user_id = v_next_chat_owner;
        update public.conversations set created_by = v_next_chat_owner where id = v_chat.id;
      end if;
    else
      insert into public.pending_storage_deletions (bucket_id, object_path)
      select coalesce(nullif(ma.bucket_id, ''), 'chat-attachments'), ma.storage_path
      from public.message_attachments ma
      where ma.conversation_id = v_chat.id
      on conflict (bucket_id, object_path) do nothing;
      delete from public.conversations where id = v_chat.id;
    end if;
  end loop;

  for v_att in
    select elem
    from public.bug_reports br
    cross join lateral jsonb_array_elements(coalesce(br.attachments, '[]'::jsonb)) elem
    where br.reporter_id = p_user_id
  loop
    perform public.queue_media_url_deletion(coalesce(v_att ->> 'url', v_att ->> 'dataUrl'));
  end loop;

  for v_att in
    select elem
    from public.record_comments rc
    cross join lateral jsonb_array_elements(coalesce(rc.attachments, '[]'::jsonb)) elem
    where rc.author_id = p_user_id
  loop
    perform public.queue_storage_object_deletion('record-comments', v_att ->> 'path');
  end loop;

  perform public.queue_media_url_deletion(v_prof.avatar_url);

  for v_grp in select id, avatar_url, payment_qr_url from public.groups where owner_id = p_user_id loop
    select gm.user_id into v_next_owner
    from public.group_memberships gm
    join public.profiles op on op.id = gm.user_id
    where gm.group_id = v_grp.id
      and gm.user_id <> p_user_id
      and gm.status = 'ACTIVE'
      and op.status = 'ACTIVE'
    order by
      case gm.role when 'ADMIN' then 1 when 'TREASURER' then 2 else 3 end,
      gm.created_at asc
    limit 1;

    if v_next_owner is not null then
      update public.groups set owner_id = v_next_owner where id = v_grp.id;
      update public.group_memberships set role = 'ADMIN' where group_id = v_grp.id and user_id = v_next_owner;
      update public.announcements set author_id = v_next_owner where group_id = v_grp.id and author_id = p_user_id;
    else
      perform public.queue_media_url_deletion(v_grp.avatar_url);
      perform public.queue_media_url_deletion(v_grp.payment_qr_url);
      update public.groups set owner_id = null, status = 'SUSPENDED', avatar_url = null, payment_qr_url = null where id = v_grp.id;
    end if;
  end loop;

  delete from public.group_memberships where user_id = p_user_id;
  delete from public.profiles where id = p_user_id;

  return true;
end;
$$;

revoke execute on function public.purge_inactive_user_data(uuid) from public, anon, authenticated;

-- 2. Expose linked social profile UUID (without exposing email) on SUPER_ADMIN announcements
create or replace function public.announcement_author_social_id(
  p_author_id uuid,
  p_author_role text
)
returns uuid
language sql
stable
security definer
set search_path = public, auth
as $$
  select case
    when p_author_role = 'SUPER_ADMIN' then (
      select p.id
      from public.profiles p
      left join auth.users u on u.id = p.id
      where p.status = 'ACTIVE'
        and p.role in ('ADMIN', 'TREASURER', 'MEMBER')
        and public.is_protected_retention_account(coalesce(nullif(p.email, ''), u.email))
      order by p.created_at desc
      limit 1
    )
    else null
  end;
$$;

revoke execute on function public.announcement_author_social_id(uuid, text) from public, anon;
grant execute on function public.announcement_author_social_id(uuid, text) to authenticated;

create or replace view public.v_announcements
with (security_invoker = true)
as
select a.id,
       a.group_id,
       a.author_id,
       public.announcement_author_name(a.author_id, a.author_name) as author_name,
       a.author_role,
       public.announcement_author_avatar(a.author_id) as author_avatar_url,
       a.title,
       a.description,
       a.attachments,
       a.created_at,
       a.announcement_type,
       a.release_version,
       public.announcement_author_social_id(a.author_id, a.author_role::text) as author_social_user_id
from public.announcements a
where a.deleted_at is null;

revoke all on public.v_announcements from public, anon;
grant select on public.v_announcements to authenticated;

insert into public.schema_migrations (version, name)
values ('20261118_109', 'owner social announcement profile link and inactivity retention exemption')
on conflict (version) do nothing;

notify pgrst, 'reload schema';

commit;
