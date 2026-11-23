-- Remove chat & social messaging system cleanly while preserving all historical data.
-- Historical chat tables, rows, legacy chat notifications, and R2 chat-attachments objects
-- remain untouched on disk/storage pending a separate authorized archival/deletion plan.

begin;

-- 1. Unschedule the per-minute vanishing-message purge cron job
do $$
declare
  v_job_id bigint;
begin
  if exists (select 1 from pg_namespace where nspname = 'cron')
     and exists (
       select 1
       from information_schema.tables
       where table_schema = 'cron' and table_name = 'job'
     ) then
    for v_job_id in
      select jobid from cron.job where jobname = 'ipon-vanishing-message-purge'
    loop
      perform cron.unschedule(v_job_id);
    end loop;
  end if;
exception
  when undefined_table or insufficient_privilege then
    null;
end $$;

-- 2. Drop chat-only triggers (including the anonymous-chat trigger on shared public.notifications)
drop trigger if exists notifications_mask_anonymous_chat on public.notifications;
drop trigger if exists conversations_mask_anonymous_notifications on public.conversations;
drop trigger if exists conversations_queue_media_cleanup on public.conversations;
drop trigger if exists conversations_updated_at on public.conversations;
drop trigger if exists conversation_participants_start_vanish on public.conversation_participants;
drop trigger if exists conversation_participants_updated_at on public.conversation_participants;
drop trigger if exists messages_protected_forward on public.messages;
drop trigger if exists messages_snapshot_vanish_duration on public.messages;
drop trigger if exists messages_stamp_anonymous_session on public.messages;
drop trigger if exists message_attachments_queue_storage_delete on public.message_attachments;
drop trigger if exists friend_requests_updated_at on public.friend_requests;

-- 3. Remove all 10 legacy chat/social tables from Supabase Realtime publication
do $$
declare
  v_tbl text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach v_tbl in array array[
      'blocked_users',
      'call_sessions',
      'conversation_participants',
      'conversations',
      'friend_requests',
      'friendships',
      'message_attachments',
      'message_reactions',
      'message_receipts',
      'messages'
    ] loop
      if exists (
        select 1
        from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = v_tbl
      ) then
        execute format('alter publication supabase_realtime drop table public.%I', v_tbl);
      end if;
    end loop;
  end if;
end $$;

-- 4. Lock down legacy chat/social tables for browser roles without deleting historical rows
do $$
declare
  v_tbl text;
  v_pol record;
begin
  foreach v_tbl in array array[
    'blocked_users',
    'call_sessions',
    'conversation_participants',
    'conversations',
    'friend_requests',
    'friendships',
    'message_attachments',
    'message_reactions',
    'message_receipts',
    'messages'
  ] loop
    if to_regclass(format('public.%I', v_tbl)) is not null then
      for v_pol in
        select policyname
        from pg_policies
        where schemaname = 'public' and tablename = v_tbl
      loop
        execute format('drop policy if exists %I on public.%I', v_pol.policyname, v_tbl);
      end loop;
      execute format('alter table public.%I enable row level security', v_tbl);
      execute format('revoke all on table public.%I from public, anon, authenticated', v_tbl);
    end if;
  end loop;
end $$;

-- 5. Update shared views & functions so zero active features depend on chat/social tables or helpers

create or replace function public.announcement_author_avatar(p_author_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select p.avatar_url
  from public.profiles p
  where p.id = p_author_id
    and p.status = 'ACTIVE'
    and public.current_user_role() is not null
    and (
      p.id = auth.uid()
      or p.role = 'SUPER_ADMIN'
      or public.current_user_role() = 'SUPER_ADMIN'
      or (
        public.current_user_role() in ('ADMIN', 'TREASURER', 'MEMBER')
        and public.current_group_id() is not null
        and (
          exists (
            select 1
            from public.group_memberships gm
            where gm.user_id = p.id
              and gm.group_id = public.current_group_id()
              and gm.role = 'ADMIN'
              and gm.status = 'ACTIVE'
          )
          or (
            p.role = 'ADMIN'
            and p.group_id = public.current_group_id()
          )
        )
      )
    )
  limit 1;
$$;

-- Keep author_social_user_id as NULL::uuid so cached browser tabs querying v_announcements do not fail with HTTP 400
create or replace view public.v_announcements as
select
  a.id,
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
  null::uuid as author_social_user_id,
  a.pinned_at is not null as is_pinned,
  a.pinned_at
from public.announcements a
where a.deleted_at is null;

create or replace function public.get_announcement_reactions(p_announcement_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_result jsonb;
begin
  if v_uid is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  if public.is_super_admin_announcement(p_announcement_id)
     and not public.can_view_super_admin_announcement_reactors(v_uid) then
    raise exception 'Only the creator account can view who reacted to this announcement.' using errcode = '42501';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'user_id', ar.user_id,
        'profile_visible', true,
        'reaction', ar.reaction,
        'full_name', p.full_name,
        'role', p.role,
        'avatar_url', p.avatar_url,
        'created_at', ar.created_at
      ) order by ar.created_at desc
    ),
    '[]'::jsonb
  ) into v_result
  from public.announcement_reactions ar
  join public.announcements a on a.id = ar.announcement_id
  join public.profiles p on p.id = ar.user_id
  where ar.announcement_id = p_announcement_id
    and a.deleted_at is null
    and (
      public.is_super_admin()
      or a.group_id is null
      or a.group_id = public.current_group_id()
      or exists (
        select 1
        from public.group_memberships gm
        where gm.group_id = a.group_id
          and gm.user_id = v_uid
          and gm.status = 'ACTIVE'
      )
    );

  return coalesce(v_result, '[]'::jsonb);
end;
$$;

create or replace function public.get_profile_card_appearance(p_target_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_profile public.profiles%rowtype;
  v_email text;
  v_effect text := 'none';
begin
  if auth.uid() is null then
    raise exception 'Sign in required.' using errcode = '28000';
  end if;

  if p_target_id is distinct from auth.uid() and not public.is_super_admin() then
    return jsonb_build_object(
      'profile_visible', false,
      'card_theme', 'emerald',
      'cover_url', null,
      'profile_effect', 'none',
      'social_links', '{}'::jsonb
    );
  end if;

  select * into v_profile
  from public.profiles
  where id = p_target_id
    and status = 'ACTIVE';

  if not found then
    raise exception 'Profile not found.' using errcode = 'P0002';
  end if;

  select coalesce(nullif(v_profile.email, ''), u.email, '')
  into v_email
  from auth.users u
  where u.id = v_profile.id;

  v_effect := coalesce(v_profile.equipped_profile_effect, 'none');
  if left(lower(btrim(v_effect)), 8) = 'creator_' and not public.is_creator_owner_account(v_email) then
    v_effect := 'none';
  elsif v_effect <> 'none' and v_profile.role <> 'SUPER_ADMIN' and not public.is_creator_owner_account(v_email) then
    if not exists (
      select 1
      from public.profile_effect_grants g
      where g.user_id = v_profile.id
        and g.effect_id = v_effect
        and (g.is_permanent = true or g.expires_at is null or g.expires_at > now())
    ) then
      v_effect := 'none';
    end if;
  end if;

  return jsonb_build_object(
    'profile_visible', true,
    'card_theme', v_profile.card_theme,
    'cover_url', v_profile.cover_url,
    'profile_effect', v_effect,
    'social_links', public.sanitize_social_app_links(v_profile.social_links, false)
  );
end;
$$;

create or replace function public.get_unread_notifications_by_token(p_token uuid)
returns table(
  id bigint,
  type text,
  title text,
  message text,
  link text,
  dedupe_key text,
  actor_avatar_url text,
  created_at timestamp with time zone
)
language sql
stable
security definer
set search_path = public
as $$
  select
    n.id,
    n.type,
    n.title,
    n.message,
    n.link,
    n.dedupe_key,
    coalesce(n.actor_avatar_url, ap.avatar_url) as actor_avatar_url,
    n.created_at
  from public.notification_feed_tokens t
  join public.profiles p on p.id = t.user_id
  join public.notifications n on n.recipient_id = p.id
  left join public.profiles ap on ap.id = n.actor_id
  where p_token is not null
    and t.token = p_token
    and p.status = 'ACTIVE'
    and p.notifications_enabled
    and n.read_at is null
    and n.type not like 'SOCIAL_%'
    and coalesce(n.link, '') !~* '[?&](?:chat|messages)='
    and n.created_at >= now() - interval '48 hours'
  order by n.created_at desc
  limit 8;
$$;

create or replace function public.queue_replaced_media_refs()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if current_setting('ipon.maintenance_bin_snapshot', true) = 'on'
     and tg_op = 'DELETE'
     and tg_table_name in ('contributions', 'expenses') then
    return old;
  end if;

  if tg_table_name = 'profiles' then
    if old.avatar_url is not null and (tg_op = 'DELETE' or new.avatar_url is distinct from old.avatar_url) then
      perform public.queue_media_url_deletion(old.avatar_url);
    end if;
  elsif tg_table_name = 'groups' then
    if old.avatar_url is not null and (tg_op = 'DELETE' or new.avatar_url is distinct from old.avatar_url) then
      perform public.queue_media_url_deletion(old.avatar_url);
    end if;
    if old.payment_qr_url is not null and (tg_op = 'DELETE' or new.payment_qr_url is distinct from old.payment_qr_url) then
      perform public.queue_media_url_deletion(old.payment_qr_url);
    end if;
  elsif tg_table_name in ('contributions', 'expenses') then
    if old.receipt_url is not null and (tg_op = 'DELETE' or new.receipt_url is distinct from old.receipt_url) then
      perform public.queue_media_url_deletion(old.receipt_url);
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create or replace function public.super_admin_storage_overview()
returns jsonb
language sql
stable
security definer
set search_path = public, storage
as $$
  select case
    when not public.is_super_admin() then null
    else jsonb_build_object(
      'contribution_receipts_count', (select count(*) from public.contributions where receipt_url is not null),
      'contribution_receipts_bytes', (select coalesce(sum(pg_column_size(receipt_url)), 0) from public.contributions where receipt_url is not null),
      'expense_receipts_count', (select count(*) from public.expenses where receipt_url is not null),
      'expense_receipts_bytes', (select coalesce(sum(pg_column_size(receipt_url)), 0) from public.expenses where receipt_url is not null),
      'announcements_media_bytes', (select coalesce(sum(pg_column_size(attachments)), 0) from public.announcements where jsonb_array_length(attachments) > 0),
      'bug_reports_media_bytes', (select coalesce(sum(pg_column_size(attachments)), 0) from public.bug_reports where jsonb_array_length(attachments) > 0),
      'avatars_and_qr_bytes',
        (select coalesce(sum(pg_column_size(avatar_url)), 0) from public.profiles where avatar_url is not null)
        + (select coalesce(sum(pg_column_size(avatar_url)), 0) from public.groups where avatar_url is not null)
        + (select coalesce(sum(pg_column_size(payment_qr_url)), 0) from public.groups where payment_qr_url is not null),
      'reclaimable_rejected_count',
        (select count(*) from public.contributions where receipt_url is not null and approval_status in ('REJECTED', 'VOIDED') and coalesce(reviewed_at, voided_at, updated_at, created_at) < now() - interval '90 days')
        + (select count(*) from public.expenses where receipt_url is not null and approval_status in ('REJECTED', 'VOIDED') and coalesce(reviewed_at, voided_at, updated_at, created_at) < now() - interval '90 days'),
      'reclaimable_rejected_bytes',
        (select coalesce(sum(pg_column_size(receipt_url)), 0) from public.contributions where receipt_url is not null and approval_status in ('REJECTED', 'VOIDED') and coalesce(reviewed_at, voided_at, updated_at, created_at) < now() - interval '90 days')
        + (select coalesce(sum(pg_column_size(receipt_url)), 0) from public.expenses where receipt_url is not null and approval_status in ('REJECTED', 'VOIDED') and coalesce(reviewed_at, voided_at, updated_at, created_at) < now() - interval '90 days'),
      'audit_logs_bytes', pg_total_relation_size('public.audit_logs'),
      'audit_logs_count', (select count(*) from public.audit_logs),
      'messages_count', 0,
      'storage_bucket_bytes', (select coalesce(sum((metadata ->> 'size')::bigint), 0) from storage.objects),
      'storage_bucket_objects', (select count(*) from storage.objects),
      'pending_storage_deletions', (select count(*) from public.pending_storage_deletions),
      'annual_archives_count', (select count(*) from public.financial_annual_archives)
    )
  end;
$$;

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
        and exists (
          select 1
          from public.savings_goals sg
          where sg.group_id = p.group_id
            and sg.deleted_at is null
            and sg.status = 'ACTIVE'
        )
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
      ), 'epoch'::timestamptz)
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
    select
      p.id,
      coalesce(nullif(p.email, ''), u.email) as email,
      p.full_name,
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
        ), 'epoch'::timestamptz)
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
        ), 'epoch'::timestamptz)
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
  v_next_owner uuid;
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

  -- Recheck after locking the profile: a login or contribution between
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
    coalesce((
      select max(c2.created_at)
      from public.contributions c2
      join public.contribution_periods cp2 on cp2.id = c2.contribution_period_id
      where cp2.member_id = v_prof.member_id
        and c2.approval_status = 'CONFIRMED'
    ), 'epoch'::timestamptz)
  ) > v_prof.inactivity_warned_at then
    return false;
  end if;

  if v_prof.group_id is not null
     and exists (
       select 1
       from public.savings_goals sg
       where sg.group_id = v_prof.group_id
         and sg.deleted_at is null
         and sg.status = 'ACTIVE'
     )
     and public.group_last_savings_activity_at(v_prof.group_id) > now() - interval '6 months' then
    return false;
  end if;

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

create or replace function public.run_data_retention_cleanup(
  p_message_days integer default 90,
  p_audit_days integer default 90,
  p_read_notif_days integer default 30,
  p_unread_notif_days integer default 90,
  p_call_days integer default 30,
  p_bin_days integer default 30
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_receipt_cutoff timestamptz := now() - make_interval(days => greatest(coalesce(p_message_days, 90), 30));
  v_audit_cutoff timestamptz := now() - make_interval(days => greatest(coalesce(p_audit_days, 90), 30));
  v_read_notif_cutoff timestamptz := now() - make_interval(days => greatest(coalesce(p_read_notif_days, 30), 7));
  v_unread_notif_cutoff timestamptz := now() - make_interval(days => greatest(coalesce(p_unread_notif_days, 90), 30));
  v_bin_cutoff timestamptz := now() - make_interval(days => greatest(coalesce(p_bin_days, 30), 14));
  v_deleted_notifs integer := 0;
  v_deleted_audits integer := 0;
  v_deleted_activity integer := 0;
  v_deleted_throttles integer := 0;
  v_cleaned_receipts integer := 0;
  v_deleted_members integer := 0;
  v_deleted_goals integer := 0;
  v_deleted_announcements integer := 0;
  v_deleted_batches integer := 0;
  v_deleted_suspended_groups integer := 0;
  v_expired_ann record;
  v_expired_batch record;
begin
  perform set_config('ipon.maintenance_retention_cleanup', 'on', true);

  -- Preserve historical SOCIAL_* rows until explicitly authorized for deletion; prune non-chat notifications only
  delete from public.notifications
  where type not like 'SOCIAL_%'
    and (
      (read_at is not null and read_at < v_read_notif_cutoff)
      or (read_at is null and created_at < v_unread_notif_cutoff)
    );
  get diagnostics v_deleted_notifs = row_count;

  delete from public.audit_logs
  where changed_at < v_audit_cutoff;
  get diagnostics v_deleted_audits = row_count;

  delete from public.account_activity
  where created_at < v_audit_cutoff;
  get diagnostics v_deleted_activity = row_count;

  delete from public.auth_login_throttles
  where updated_at < now() - interval '7 days';
  get diagnostics v_deleted_throttles = row_count;

  with upd_c as (
    update public.contributions
    set receipt_url = null
    where receipt_url is not null
      and approval_status in ('REJECTED', 'VOIDED')
      and coalesce(reviewed_at, voided_at, updated_at, created_at) < v_receipt_cutoff
    returning 1
  ),
  upd_e as (
    update public.expenses
    set receipt_url = null
    where receipt_url is not null
      and approval_status in ('REJECTED', 'VOIDED')
      and coalesce(reviewed_at, voided_at, updated_at, created_at) < v_receipt_cutoff
    returning 1
  )
  select (select count(*) from upd_c) + (select count(*) from upd_e) into v_cleaned_receipts;

  delete from public.savings_goals
  where deleted_at is not null
    and deleted_at < v_bin_cutoff;
  get diagnostics v_deleted_goals = row_count;

  for v_expired_ann in
    select id, attachments
    from public.announcements
    where deleted_at is not null
      and deleted_at < v_bin_cutoff
  loop
    perform public.purge_bin_item_storage('announcement', v_expired_ann.attachments);
    delete from public.announcements where id = v_expired_ann.id;
    v_deleted_announcements := v_deleted_announcements + 1;
  end loop;

  for v_expired_batch in
    select id, snapshot
    from public.savings_cycle_batches
    where restored_at is null
      and (expires_at < now() or deleted_at < v_bin_cutoff)
  loop
    perform public.purge_bin_item_storage('savings_cycle', v_expired_batch.snapshot);
    delete from public.savings_cycle_batches where id = v_expired_batch.id;
    v_deleted_batches := v_deleted_batches + 1;
  end loop;

  delete from public.contribution_periods cp
  using public.members m
  where cp.member_id = m.id
    and m.deleted_at is not null
    and m.deleted_at < v_bin_cutoff
    and not exists (select 1 from public.contributions c where c.contribution_period_id = cp.id)
    and not exists (select 1 from public.contribution_periods cp2 join public.contributions c2 on c2.contribution_period_id = cp2.id where cp2.member_id = m.id);

  delete from public.members m
  where m.deleted_at is not null
    and m.deleted_at < v_bin_cutoff
    and not exists (select 1 from public.contribution_periods cp where cp.member_id = m.id);
  get diagnostics v_deleted_members = row_count;

  delete from public.contribution_settings cs
  where exists (
    select 1
    from public.groups g
    where g.id = cs.group_id
      and g.status = 'SUSPENDED'
      and g.owner_id is null
      and g.updated_at < v_bin_cutoff
      and not exists (select 1 from public.contributions c where c.group_id = g.id)
      and not exists (select 1 from public.withdrawals w where w.group_id = g.id)
      and not exists (select 1 from public.expenses e where e.group_id = g.id)
      and not exists (select 1 from public.contribution_periods cp where cp.group_id = g.id)
      and not exists (select 1 from public.savings_goals sg where sg.group_id = g.id)
      and not exists (select 1 from public.savings_cycle_batches sc where sc.group_id = g.id)
      and not exists (select 1 from public.members m where m.group_id = g.id)
  );

  delete from public.groups g
  where g.status = 'SUSPENDED'
    and g.owner_id is null
    and g.updated_at < v_bin_cutoff
    and not exists (select 1 from public.contributions c where c.group_id = g.id)
    and not exists (select 1 from public.withdrawals w where w.group_id = g.id)
    and not exists (select 1 from public.expenses e where e.group_id = g.id)
    and not exists (select 1 from public.contribution_periods cp where cp.group_id = g.id)
    and not exists (select 1 from public.savings_goals sg where sg.group_id = g.id)
    and not exists (select 1 from public.savings_cycle_batches sc where sc.group_id = g.id)
    and not exists (select 1 from public.members m where m.group_id = g.id);
  get diagnostics v_deleted_suspended_groups = row_count;

  return jsonb_build_object(
    'messages_deleted', 0,
    'calls_deleted', 0,
    'notifications_deleted', v_deleted_notifs,
    'audit_logs_deleted', v_deleted_audits,
    'account_activity_deleted', v_deleted_activity,
    'login_throttles_deleted', v_deleted_throttles,
    'receipts_cleaned', v_cleaned_receipts,
    'expired_bin_members_deleted', v_deleted_members,
    'expired_bin_goals_deleted', v_deleted_goals,
    'expired_bin_announcements_deleted', v_deleted_announcements,
    'expired_bin_savings_batches_deleted', v_deleted_batches,
    'abandoned_suspended_groups_deleted', v_deleted_suspended_groups,
    'pending_storage_queue', (select count(*) from public.pending_storage_deletions)
  );
end;
$$;

create or replace function public.super_admin_user_last_activities()
returns table(
  user_id uuid,
  activity_event text,
  activity_label text,
  occurred_at timestamp with time zone,
  last_seen_at timestamp with time zone
)
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  v_noise_keys constant text[] := array[
    'updated_at',
    'created_at',
    'last_seen_at',
    'inactivity_warned_at',
    'savings_inactivity_reminded_at',
    'savings_retention_warned_at',
    'previous_account_status',
    'name_setup_required',
    'policy_accepted_version',
    'policy_accepted_at'
  ];
begin
  if not public.is_super_admin() then
    raise exception 'Only a super administrator can view user activity summaries.' using errcode = '42501';
  end if;

  return query
  with raw_events as (
    -- 1. Explicit account security & profile activity log
    select
      aa.user_id,
      aa.event as activity_event,
      case aa.event
        when 'LOGIN' then 'Signed in'
        when 'PASSWORD_CHANGE' then 'Changed password'
        when 'PROFILE_UPDATE' then 'Updated profile'
        else initcap(replace(aa.event, '_', ' '))
      end as activity_label,
      aa.created_at as occurred_at,
      case aa.event
        when 'LOGIN' then 60
        when 'PASSWORD_CHANGE' then 20
        when 'PROFILE_UPDATE' then 25
        else 30
      end as priority
    from public.account_activity aa

    union all

    -- 2. Audited table actions attributed strictly to the acting user (changed_by)
    select
      l.changed_by as user_id,
      case
        when l.table_name = 'groups' and l.action = 'INSERT' then 'GROUP_CREATE'
        when l.table_name = 'groups' and l.action = 'DELETE' then 'GROUP_DELETE'
        when l.table_name = 'groups' and l.action = 'UPDATE' then
          case
            when (l.old_data ->> 'workspace_mode') is distinct from (l.new_data ->> 'workspace_mode') then 'WORKSPACE_MODE_UPDATE'
            when (l.old_data ->> 'payment_qr_url') is distinct from (l.new_data ->> 'payment_qr_url')
              or (l.old_data ->> 'payment_method_label') is distinct from (l.new_data ->> 'payment_method_label')
              or (l.old_data ->> 'payment_account_name') is distinct from (l.new_data ->> 'payment_account_name')
              or (l.old_data ->> 'payment_account_number') is distinct from (l.new_data ->> 'payment_account_number')
              or (l.old_data ->> 'payment_instructions') is distinct from (l.new_data ->> 'payment_instructions') then 'PAYMENT_INFO_UPDATE'
            when (l.old_data ->> 'cycle_start_date') is distinct from (l.new_data ->> 'cycle_start_date') then 'CYCLE_START_UPDATE'
            else 'GROUP_UPDATE'
          end
        when l.table_name = 'contributions' then 'CONTRIBUTION_' || l.action
        when l.table_name = 'withdrawals' then 'WITHDRAWAL_' || l.action
        when l.table_name = 'expenses' then 'EXPENSE_' || l.action
        when l.table_name = 'savings_goals' then
          case
            when l.action = 'INSERT' then 'GOAL_CREATE'
            when l.action = 'DELETE' then 'GOAL_DELETE'
            when (l.old_data ->> 'deleted_at') is null and (l.new_data ->> 'deleted_at') is not null then 'GOAL_BIN'
            when (l.old_data ->> 'deleted_at') is not null and (l.new_data ->> 'deleted_at') is null then 'GOAL_RESTORE'
            when (l.new_data ->> 'status') = 'COMPLETED' and (l.old_data ->> 'status') is distinct from 'COMPLETED' then 'GOAL_COMPLETE'
            when (l.new_data ->> 'status') = 'CANCELLED' and (l.old_data ->> 'status') is distinct from 'CANCELLED' then 'GOAL_CANCEL'
            else 'GOAL_UPDATE'
          end
        when l.table_name = 'members' then
          case
            when l.action = 'INSERT' then 'MEMBER_ADD'
            when l.action = 'DELETE' then 'MEMBER_DELETE'
            when (l.old_data ->> 'deleted_at') is null and (l.new_data ->> 'deleted_at') is not null then 'MEMBER_BIN'
            when (l.old_data ->> 'deleted_at') is not null and (l.new_data ->> 'deleted_at') is null then 'MEMBER_RESTORE'
            when (l.old_data ->> 'activation_status') is distinct from (l.new_data ->> 'activation_status')
             and (coalesce(l.old_data, '{}'::jsonb) - array['activation_status','activated_at','updated_at','updated_by'])
               = (coalesce(l.new_data, '{}'::jsonb) - array['activation_status','activated_at','updated_at','updated_by']) then 'MEMBER_ACTIVATE'
            when (l.old_data ->> 'status') is distinct from (l.new_data ->> 'status') then 'MEMBER_STATUS'
            else 'MEMBER_UPDATE'
          end
        when l.table_name = 'contribution_settings' then 'SCHEDULE_' || l.action
        when l.table_name = 'contribution_periods' then
          case
            when l.action = 'UPDATE' and (l.old_data ->> 'is_exempt') is distinct from (l.new_data ->> 'is_exempt') then 'PERIOD_EXEMPT'
            else 'PERIOD_' || l.action
          end
        when l.table_name = 'profiles' and l.action = 'UPDATE' then
          case
            when (l.old_data ->> 'group_id') is distinct from (l.new_data ->> 'group_id') then
              case
                when nullif(l.old_data ->> 'group_id', '') is null and nullif(l.new_data ->> 'group_id', '') is not null then 'WORKSPACE_JOIN'
                when nullif(l.old_data ->> 'group_id', '') is not null and nullif(l.new_data ->> 'group_id', '') is null then 'WORKSPACE_LEAVE'
                else 'WORKSPACE_SWITCH'
              end
            when (l.old_data ->> 'avatar_url') is distinct from (l.new_data ->> 'avatar_url') then
              case when nullif(l.new_data ->> 'avatar_url', '') is null then 'PROFILE_PHOTO_REMOVE' else 'PROFILE_PHOTO_UPDATE' end
            when (l.old_data ->> 'notifications_enabled') is distinct from (l.new_data ->> 'notifications_enabled') then 'ALERT_PREF_UPDATE'
            when (l.old_data ->> 'username') is distinct from (l.new_data ->> 'username')
              or (l.old_data ->> 'bio') is distinct from (l.new_data ->> 'bio') then 'PROFILE_IDENTITY_UPDATE'
            when (l.old_data ->> 'status') = 'PENDING' and (l.new_data ->> 'status') = 'ACTIVE' then 'ACCOUNT_ACTIVATE'
            when ((l.old_data ->> 'payout_channel') is distinct from (l.new_data ->> 'payout_channel')
              or (l.old_data ->> 'payout_account_number') is distinct from (l.new_data ->> 'payout_account_number')
              or (l.old_data ->> 'payout_account_name') is distinct from (l.new_data ->> 'payout_account_name'))
             and (coalesce(l.old_data, '{}'::jsonb) - array['payout_channel','payout_account_number','payout_account_name','updated_at'])
               = (coalesce(l.new_data, '{}'::jsonb) - array['payout_channel','payout_account_number','payout_account_name','updated_at']) then 'PAYOUT_UPDATE'
            else 'PROFILE_UPDATE'
          end
        else upper(l.table_name || '_' || l.action)
      end as activity_event,
      case
        when l.table_name = 'groups' and l.action = 'INSERT' then 'Created workspace'
        when l.table_name = 'groups' and l.action = 'DELETE' then 'Deleted workspace'
        when l.table_name = 'groups' and l.action = 'UPDATE' then
          case
            when (l.old_data ->> 'workspace_mode') is distinct from (l.new_data ->> 'workspace_mode') then 'Switched workspace mode'
            when (l.old_data ->> 'payment_qr_url') is distinct from (l.new_data ->> 'payment_qr_url')
              or (l.old_data ->> 'payment_method_label') is distinct from (l.new_data ->> 'payment_method_label')
              or (l.old_data ->> 'payment_account_name') is distinct from (l.new_data ->> 'payment_account_name')
              or (l.old_data ->> 'payment_account_number') is distinct from (l.new_data ->> 'payment_account_number')
              or (l.old_data ->> 'payment_instructions') is distinct from (l.new_data ->> 'payment_instructions') then 'Updated payment settings'
            when (l.old_data ->> 'cycle_start_date') is distinct from (l.new_data ->> 'cycle_start_date') then 'Updated cycle start date'
            else 'Updated workspace settings'
          end
        when l.table_name = 'contributions' then
          case l.action
            when 'INSERT' then 'Recorded contribution'
            when 'CONFIRM' then 'Confirmed contribution'
            when 'REJECT' then 'Rejected contribution'
            when 'VOID' then 'Voided contribution'
            when 'DELETE' then 'Deleted contribution'
            else 'Updated contribution'
          end
        when l.table_name = 'withdrawals' then
          case l.action
            when 'INSERT' then 'Recorded deduction'
            when 'CONFIRM' then 'Confirmed deduction'
            when 'REJECT' then 'Rejected deduction'
            when 'VOID' then 'Voided deduction'
            when 'DELETE' then 'Deleted deduction'
            else 'Updated deduction'
          end
        when l.table_name = 'expenses' then
          case l.action
            when 'INSERT' then 'Recorded expense'
            when 'CONFIRM' then 'Confirmed expense'
            when 'REJECT' then 'Rejected expense'
            when 'VOID' then 'Voided expense'
            when 'DELETE' then 'Deleted expense'
            else 'Updated expense'
          end
        when l.table_name = 'savings_goals' then
          case
            when l.action = 'INSERT' then 'Created savings goal'
            when l.action = 'DELETE' then 'Deleted savings goal'
            when (l.old_data ->> 'deleted_at') is null and (l.new_data ->> 'deleted_at') is not null then 'Moved goal to bin'
            when (l.old_data ->> 'deleted_at') is not null and (l.new_data ->> 'deleted_at') is null then 'Restored goal from bin'
            when (l.new_data ->> 'status') = 'COMPLETED' and (l.old_data ->> 'status') is distinct from 'COMPLETED' then 'Completed savings goal'
            when (l.new_data ->> 'status') = 'CANCELLED' and (l.old_data ->> 'status') is distinct from 'CANCELLED' then 'Cancelled savings goal'
            else 'Updated savings goal'
          end
        when l.table_name = 'members' then
          case
            when l.action = 'INSERT' then 'Added member'
            when l.action = 'DELETE' then 'Deleted member'
            when (l.old_data ->> 'deleted_at') is null and (l.new_data ->> 'deleted_at') is not null then 'Moved member to bin'
            when (l.old_data ->> 'deleted_at') is not null and (l.new_data ->> 'deleted_at') is null then 'Restored member from bin'
            when (l.old_data ->> 'activation_status') is distinct from (l.new_data ->> 'activation_status')
             and (coalesce(l.old_data, '{}'::jsonb) - array['activation_status','activated_at','updated_at','updated_by'])
               = (coalesce(l.new_data, '{}'::jsonb) - array['activation_status','activated_at','updated_at','updated_by']) then 'Activated member account'
            when (l.old_data ->> 'status') is distinct from (l.new_data ->> 'status') then 'Updated member status'
            else 'Updated member'
          end
        when l.table_name = 'contribution_settings' then
          case l.action
            when 'DELETE' then 'Removed contribution schedule'
            else 'Updated contribution schedule'
          end
        when l.table_name = 'contribution_periods' then
          case
            when l.action = 'DELETE' then 'Removed billing period'
            when l.action = 'INSERT' then 'Generated billing periods'
            when (l.old_data ->> 'is_exempt') is distinct from (l.new_data ->> 'is_exempt') then 'Updated member exemption'
            else 'Updated billing period'
          end
        when l.table_name = 'profiles' and l.action = 'UPDATE' then
          case
            when (l.old_data ->> 'group_id') is distinct from (l.new_data ->> 'group_id') then
              case
                when nullif(l.old_data ->> 'group_id', '') is null and nullif(l.new_data ->> 'group_id', '') is not null then 'Joined workspace'
                when nullif(l.old_data ->> 'group_id', '') is not null and nullif(l.new_data ->> 'group_id', '') is null then 'Left workspace'
                else 'Switched workspace'
              end
            when (l.old_data ->> 'avatar_url') is distinct from (l.new_data ->> 'avatar_url') then
              case when nullif(l.new_data ->> 'avatar_url', '') is null then 'Removed profile photo' else 'Updated profile photo' end
            when (l.old_data ->> 'notifications_enabled') is distinct from (l.new_data ->> 'notifications_enabled') then 'Updated alert preferences'
            when (l.old_data ->> 'username') is distinct from (l.new_data ->> 'username')
              or (l.old_data ->> 'bio') is distinct from (l.new_data ->> 'bio') then 'Updated profile identity'
            when (l.old_data ->> 'status') = 'PENDING' and (l.new_data ->> 'status') = 'ACTIVE' then 'Activated account'
            when ((l.old_data ->> 'payout_channel') is distinct from (l.new_data ->> 'payout_channel')
              or (l.old_data ->> 'payout_account_number') is distinct from (l.new_data ->> 'payout_account_number')
              or (l.old_data ->> 'payout_account_name') is distinct from (l.new_data ->> 'payout_account_name'))
             and (coalesce(l.old_data, '{}'::jsonb) - array['payout_channel','payout_account_number','payout_account_name','updated_at'])
               = (coalesce(l.new_data, '{}'::jsonb) - array['payout_channel','payout_account_number','payout_account_name','updated_at']) then 'Updated payout account'
            else 'Updated profile'
          end
        else initcap(replace(l.table_name, '_', ' '))
      end as activity_label,
      l.changed_at as occurred_at,
      case
        when l.table_name = 'groups' and l.action in ('INSERT', 'DELETE') then 10
        when l.table_name = 'groups' then 15
        when l.table_name in ('contributions', 'withdrawals', 'expenses', 'savings_goals') and l.action <> 'DELETE' then 20
        when l.table_name = 'members' and l.action <> 'DELETE' then
          case
            when (l.old_data ->> 'activation_status') is distinct from (l.new_data ->> 'activation_status')
             and (coalesce(l.old_data, '{}'::jsonb) - array['activation_status','activated_at','updated_at','updated_by'])
               = (coalesce(l.new_data, '{}'::jsonb) - array['activation_status','activated_at','updated_at','updated_by']) then 55
            else 25
          end
        when l.table_name = 'contribution_periods' and l.action = 'UPDATE' and (l.old_data ->> 'is_exempt') is distinct from (l.new_data ->> 'is_exempt') then 25
        when l.table_name = 'profiles' then
          case
            when (l.old_data ->> 'group_id') is distinct from (l.new_data ->> 'group_id') then 35
            when (l.old_data ->> 'status') = 'PENDING' and (l.new_data ->> 'status') = 'ACTIVE' then 55
            else 25
          end
        when l.table_name = 'contribution_settings' and l.action <> 'DELETE' then 40
        when l.action = 'DELETE' then 45
        else 50
      end as priority
    from public.audit_logs l
    where l.changed_by is not null
      and (
        l.table_name <> 'profiles'
        or (
          l.action = 'UPDATE'
          and (coalesce(l.old_data, '{}'::jsonb) - v_noise_keys) is distinct from (coalesce(l.new_data, '{}'::jsonb) - v_noise_keys)
        )
      )

    union all

    -- 3. Budget allocation & planning tools
    select bc.user_id, 'BUDGET_SPLIT_UPDATE', 'Updated budget split', bc.updated_at, 18
    from public.budget_configs bc

    union all

    select
      bi.user_id,
      case when bi.updated_at > bi.created_at + interval '2 seconds' then 'BUDGET_ITEM_UPDATE' else 'BUDGET_ITEM_ADD' end,
      case when bi.updated_at > bi.created_at + interval '2 seconds' then 'Updated budget item' else 'Added budget item' end,
      bi.updated_at,
      18
    from public.budget_items bi

    union all

    select
      be.user_id,
      case when be.updated_at > be.created_at + interval '2 seconds' then 'BUDGET_EXPENSE_UPDATE' else 'BUDGET_EXPENSE_ADD' end,
      case when be.updated_at > be.created_at + interval '2 seconds' then 'Updated budget expense' else 'Logged budget expense' end,
      be.updated_at,
      18
    from public.budget_expenses be

    union all

    select sp.user_id, 'CALC_PLAN_SAVE', 'Saved calculator plan', sp.updated_at, 22
    from public.savings_calculator_plans sp

    union all

    -- 4. Feedback, announcements & record discussions
    select fr.requester_id, 'FEATURE_REQUEST', 'Submitted feature request', fr.created_at, 15
    from public.feature_requests fr

    union all

    select br.reporter_id, 'BUG_REPORT', 'Submitted bug report', br.created_at, 15
    from public.bug_reports br

    union all

    select a.author_id, 'ANNOUNCEMENT_POST', 'Posted announcement', a.created_at, 15
    from public.announcements a
    where a.author_id is not null

    union all

    select a.deleted_by, 'ANNOUNCEMENT_BIN', 'Removed announcement', a.deleted_at, 20
    from public.announcements a
    where a.deleted_by is not null and a.deleted_at is not null

    union all

    select ar.user_id, 'ANNOUNCEMENT_REACT', 'Reacted to announcement', coalesce(ar.updated_at, ar.created_at), 25
    from public.announcement_reactions ar

    union all

    select rc.author_id, 'RECORD_COMMENT', 'Commented on record', rc.created_at, 22
    from public.record_comments rc

    union all

    -- 5. Access requests, archives & cycle resets
    select adr.requester_id, 'ADMIN_REQUEST', 'Requested admin access', adr.created_at, 25
    from public.admin_requests adr

    union all

    select fa.archived_by, 'ANNUAL_ARCHIVE', 'Archived annual ledger', fa.archived_at, 15
    from public.financial_annual_archives fa
    where fa.archived_by is not null

    union all

    select scb.deleted_by, 'CYCLE_BIN', 'Moved savings cycle to bin', coalesce(scb.deleted_at, scb.created_at), 15
    from public.savings_cycle_batches scb
    where scb.deleted_by is not null

    union all

    -- 6. Fallback coverage for financial & goal records older than 90-day audit_logs retention
    select c.submitted_by, 'CONTRIBUTION_ADD', 'Recorded contribution', c.created_at, 65
    from public.contributions c
    where c.submitted_by is not null

    union all

    select
      c.reviewed_by,
      case when c.approval_status = 'CONFIRMED' then 'CONTRIBUTION_CONFIRM' else 'CONTRIBUTION_REJECT' end,
      case when c.approval_status = 'CONFIRMED' then 'Confirmed contribution' else 'Rejected contribution' end,
      c.reviewed_at,
      65
    from public.contributions c
    where c.reviewed_by is not null
      and c.reviewed_at is not null
      and c.reviewed_at > c.created_at + interval '2 seconds'

    union all

    select c.voided_by, 'CONTRIBUTION_VOID', 'Voided contribution', c.voided_at, 65
    from public.contributions c
    where c.voided_by is not null and c.voided_at is not null

    union all

    select w.submitted_by, 'WITHDRAWAL_ADD', 'Recorded deduction', w.created_at, 65
    from public.withdrawals w
    where w.submitted_by is not null

    union all

    select
      w.reviewed_by,
      case when w.approval_status = 'CONFIRMED' then 'WITHDRAWAL_CONFIRM' else 'WITHDRAWAL_REJECT' end,
      case when w.approval_status = 'CONFIRMED' then 'Confirmed deduction' else 'Rejected deduction' end,
      w.reviewed_at,
      65
    from public.withdrawals w
    where w.reviewed_by is not null
      and w.reviewed_at is not null
      and w.reviewed_at > w.created_at + interval '2 seconds'

    union all

    select w.voided_by, 'WITHDRAWAL_VOID', 'Voided deduction', w.voided_at, 65
    from public.withdrawals w
    where w.voided_by is not null and w.voided_at is not null

    union all

    select ex.submitted_by, 'EXPENSE_ADD', 'Recorded expense', ex.created_at, 65
    from public.expenses ex
    where ex.submitted_by is not null

    union all

    select
      ex.reviewed_by,
      case when ex.approval_status = 'CONFIRMED' then 'EXPENSE_CONFIRM' else 'EXPENSE_REJECT' end,
      case when ex.approval_status = 'CONFIRMED' then 'Confirmed expense' else 'Rejected expense' end,
      ex.reviewed_at,
      65
    from public.expenses ex
    where ex.reviewed_by is not null
      and ex.reviewed_at is not null
      and ex.reviewed_at > ex.created_at + interval '2 seconds'

    union all

    select ex.voided_by, 'EXPENSE_VOID', 'Voided expense', ex.voided_at, 65
    from public.expenses ex
    where ex.voided_by is not null and ex.voided_at is not null

    union all

    select sg.created_by, 'GOAL_CREATE', 'Created savings goal', sg.created_at, 65
    from public.savings_goals sg
    where sg.created_by is not null

    union all

    select sg.updated_by, 'GOAL_UPDATE', 'Updated savings goal', sg.updated_at, 65
    from public.savings_goals sg
    where sg.updated_by is not null
      and sg.updated_at > sg.created_at + interval '2 seconds'

    union all

    -- 7. Policy consent, auth sign-in fallback & passive presence fallback
    select p2.id, 'POLICY_ACCEPT', 'Accepted terms & privacy', p2.policy_accepted_at, 30
    from public.profiles p2
    where p2.policy_accepted_at is not null

    union all

    select u.id, 'LOGIN', 'Signed in', u.last_sign_in_at, 70
    from auth.users u
    where u.last_sign_in_at is not null

    union all

    select p3.id, 'APP_ACTIVE', 'Active in app', p3.last_seen_at, 90
    from public.profiles p3
    where p3.last_seen_at is not null

    union all

    select p4.id, 'ACCOUNT_CREATED', 'Account created', p4.created_at, 95
    from public.profiles p4
  )
  select distinct on (p.id)
    p.id as user_id,
    e.activity_event,
    e.activity_label,
    e.occurred_at,
    p.last_seen_at
  from public.profiles p
  join raw_events e
    on e.user_id = p.id
   and e.occurred_at is not null
  where p.role <> 'SUPER_ADMIN'
  order by
    p.id,
    (e.priority >= 90) asc,
    e.occurred_at desc,
    e.priority asc;
end;
$$;

-- 6. Replace automatic boot/background chat RPCs with zero-table-scan no-op tombstones
-- so already-open stale web tabs and un-updated Android APKs settle cleanly with zero error/retry loops.

create or replace function public.get_conversations()
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select '[]'::jsonb;
$$;

create or replace function public.get_social_overview()
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'me', null,
    'friends', '[]'::jsonb,
    'incoming_requests', '[]'::jsonb,
    'sent_requests', '[]'::jsonb,
    'blocked_users', '[]'::jsonb,
    'chat_disabled', true
  );
$$;

create or replace function public.get_conversation_messages(
  p_conversation_id uuid,
  p_before timestamptz default null,
  p_limit integer default 60,
  p_around_message_id uuid default null
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'conversation', null,
    'messages', '[]'::jsonb,
    'has_more', false,
    'chat_disabled', true
  );
$$;

create or replace function public.mark_conversation_read(p_conversation_id uuid)
returns jsonb
language sql
volatile
security invoker
set search_path = public
as $$
  select jsonb_build_object('ok', true, 'disabled', true);
$$;

create or replace function public.mark_messages_delivered(p_conversation_id uuid default null)
returns integer
language sql
volatile
security invoker
set search_path = public
as $$
  select 0;
$$;

create or replace function public.report_client_platform(p_platform text)
returns text
language sql
volatile
security invoker
set search_path = public
as $$
  select null::text;
$$;

create or replace function public.ack_message_notifications_by_token(
  p_token uuid,
  p_notification_ids bigint[]
)
returns integer
language sql
volatile
security invoker
set search_path = public
as $$
  select 0;
$$;

revoke all on function public.get_conversations() from public;
grant execute on function public.get_conversations() to authenticated, service_role;

revoke all on function public.get_social_overview() from public;
grant execute on function public.get_social_overview() to authenticated, service_role;

revoke all on function public.get_conversation_messages(uuid, timestamptz, integer, uuid) from public;
grant execute on function public.get_conversation_messages(uuid, timestamptz, integer, uuid) to authenticated, service_role;

revoke all on function public.mark_conversation_read(uuid) from public;
grant execute on function public.mark_conversation_read(uuid) to authenticated, service_role;

revoke all on function public.mark_messages_delivered(uuid) from public;
grant execute on function public.mark_messages_delivered(uuid) to authenticated, service_role;

revoke all on function public.report_client_platform(text) from public;
grant execute on function public.report_client_platform(text) to authenticated, service_role;

revoke all on function public.ack_message_notifications_by_token(uuid, bigint[]) from public;
grant execute on function public.ack_message_notifications_by_token(uuid, bigint[]) to anon, authenticated, service_role;

-- 7. Drop all remaining chat/social-only RPCs and trigger functions (no CASCADE)
drop function if exists public.announcement_author_social_id(uuid, text);
drop function if exists public.add_group_chat_members(uuid, uuid[]);
drop function if exists public.are_friends(uuid, uuid);
drop function if exists public.block_social_user(uuid);
drop function if exists public.can_send_to_conversation(uuid);
drop function if exists public.can_view_social_profile(uuid, uuid, text);
drop function if exists public.cancel_friend_request(uuid);
drop function if exists public.canonical_pair_key(uuid, uuid);
drop function if exists public.conversation_supports_screenshot_block(uuid);
drop function if exists public.create_group_chat(text, uuid[], text, text);
drop function if exists public.delete_chat_message(uuid, text);
drop function if exists public.edit_chat_message(uuid, text);
drop function if exists public.get_anonymous_chat_state(uuid);
drop function if exists public.get_conversation_attachment_paths(uuid, text[]);
drop function if exists public.get_conversation_messages_unmasked(uuid, timestamptz, integer, uuid);
drop function if exists public.get_conversation_protection(uuid);
drop function if exists public.get_conversation_protection_unmasked(uuid);
drop function if exists public.get_conversations_unmasked();
drop function if exists public.get_friend_suggestions(integer);
drop function if exists public.get_mutual_friends_summary(uuid, uuid, integer);
drop function if exists public.get_social_user_profile(uuid);
drop function if exists public.get_user_friends_count(uuid, uuid);
drop function if exists public.has_direct_chat_connection(uuid, uuid);
drop function if exists public.is_conversation_member(uuid, uuid);
drop function if exists public.is_creator_messaging_account(uuid);
drop function if exists public.is_messaging_eligible(uuid);
drop function if exists public.is_user_blocked_between(uuid, uuid);
drop function if exists public.mask_anonymous_chat_notification();
drop function if exists public.mask_existing_anonymous_chat_notifications();
drop function if exists public.pin_chat_message(uuid);
drop function if exists public.purge_expired_vanishing_messages();
drop function if exists public.push_social_notification(uuid, uuid, text, text, text, text, text);
drop function if exists public.queue_deleted_chat_attachment_storage();
drop function if exists public.record_conversation_screenshot(uuid);
drop function if exists public.reject_protected_message_forward();
drop function if exists public.remove_friend(uuid);
drop function if exists public.remove_group_chat_member(uuid, uuid);
drop function if exists public.require_messaging_actor();
drop function if exists public.respond_friend_request(uuid, text);
drop function if exists public.respond_message_request(uuid, text);
drop function if exists public.search_conversation_messages(uuid, text, uuid, integer);
drop function if exists public.search_conversation_messages_unmasked(uuid, text, uuid, integer);
drop function if exists public.search_social_users(text, integer);
drop function if exists public.send_chat_message(uuid, text, text, uuid, uuid, jsonb, jsonb);
drop function if exists public.send_friend_request(uuid);
drop function if exists public.set_anonymous_chat(uuid, boolean);
drop function if exists public.set_conversation_protection(uuid, text, boolean);
drop function if exists public.set_conversation_vanish(uuid, integer);
drop function if exists public.snapshot_message_vanish_duration();
drop function if exists public.stamp_anonymous_chat_message();
drop function if exists public.start_call_session(uuid, text);
drop function if exists public.start_or_open_direct_chat(uuid);
drop function if exists public.start_seen_message_vanish();
drop function if exists public.toggle_message_reaction(uuid, text);
drop function if exists public.unblock_social_user(uuid);
drop function if exists public.update_call_session(uuid, text, text);
drop function if exists public.update_conversation_member_state(uuid, text, text);
drop function if exists public.update_group_chat_info(uuid, text, text, text, boolean);
drop function if exists public.update_group_chat_member_role(uuid, uuid, text);
drop function if exists public.update_social_profile_and_privacy(text, text, jsonb);

insert into public.schema_migrations (version, name)
values ('20261123_193', 'remove_chat_system')
on conflict (version) do nothing;

commit;
