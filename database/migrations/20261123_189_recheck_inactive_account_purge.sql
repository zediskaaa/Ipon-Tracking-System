begin;

-- Clear stale warnings after every activity source that also blocks a purge.
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
        public.latest_retention_activity_at(p.id),
        coalesce((select max(c.created_at) from public.contributions c where c.submitted_by = p.id), 'epoch'::timestamptz),
        coalesce((select max(m.created_at) from public.messages m where m.sender_id = p.id), 'epoch'::timestamptz),
        coalesce((
          select max(c2.created_at)
          from public.contributions c2
          join public.contribution_periods cp2 on cp2.id = c2.contribution_period_id
          where cp2.member_id = p.member_id
            and c2.approval_status = 'CONFIRMED'
        ), 'epoch'::timestamptz)
      ) > p.inactivity_warned_at
      or (
        p.group_id is not null
        and exists (select 1 from public.savings_goals sg
          where sg.group_id = p.group_id and sg.deleted_at is null and sg.status = 'ACTIVE')
        and public.group_last_savings_activity_at(p.group_id) > p.inactivity_warned_at
      )
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
        public.latest_retention_activity_at(p.id),
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
        public.latest_retention_activity_at(p.id),
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
        public.latest_retention_activity_at(p.id),
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

-- Recheck eligibility at the destructive boundary.
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

  -- Recheck after locking the profile: a login, message, or contribution between
  -- candidate collection and purge must never delete an active account.
  if v_prof.inactivity_warned_at is null
     or v_prof.inactivity_warned_at > now() - interval '7 days' then
    return false;
  end if;

  if greatest(
    coalesce((select coalesce(u.last_sign_in_at, u.created_at) from auth.users u where u.id = p_user_id), v_prof.created_at),
    coalesce(v_prof.last_seen_at, v_prof.created_at),
    public.latest_retention_activity_at(p_user_id),
    coalesce((select max(c.created_at) from public.contributions c where c.submitted_by = p_user_id), 'epoch'::timestamptz),
    coalesce((select max(c2.created_at) from public.contributions c2
      join public.contribution_periods cp2 on cp2.id = c2.contribution_period_id
      where cp2.member_id = v_prof.member_id and c2.approval_status = 'CONFIRMED'), 'epoch'::timestamptz),
    coalesce((select max(m.created_at) from public.messages m where m.sender_id = p_user_id), 'epoch'::timestamptz)
  ) > v_prof.inactivity_warned_at then
    return false;
  end if;

  if v_prof.group_id is not null
     and exists (select 1 from public.savings_goals sg
       where sg.group_id = v_prof.group_id and sg.deleted_at is null and sg.status = 'ACTIVE')
     and public.group_last_savings_activity_at(v_prof.group_id) > now() - interval '6 months' then
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

insert into public.schema_migrations (version, name)
values ('20261123_189', 'reset stale inactivity warnings and recheck account purge')
on conflict (version) do nothing;

notify pgrst, 'reload schema';

commit;
