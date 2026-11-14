-- Migration 060: Replace prior record-comment notifications per thread, notify treasurers/participants, and return dedupe_key in background feed

begin;

-- Collapse any historical stacked RECORD_COMMENT rows down to the latest row per recipient/thread
delete from public.notifications
where id in (
  select id
  from (
    select
      n.id,
      row_number() over (
        partition by
          n.recipient_id,
          coalesce(
            n.dedupe_key,
            'RECORD_COMMENT:' || substring(coalesce(n.link, '') from 'thread=([a-z]+:[0-9a-f-]+)')
          )
        order by n.created_at desc, n.id desc
      ) as rn
    from public.notifications n
    where n.type = 'RECORD_COMMENT'
  ) ranked
  where ranked.rn > 1
);

update public.notifications n
set dedupe_key = 'RECORD_COMMENT:' || substring(n.link from 'thread=([a-z]+:[0-9a-f-]+)')
where n.type = 'RECORD_COMMENT'
  and n.dedupe_key is null
  and n.link ~ 'thread=[a-z]+:[0-9a-f-]+'
  and not exists (
    select 1
    from public.notifications existing
    where existing.recipient_id = n.recipient_id
      and existing.dedupe_key = 'RECORD_COMMENT:' || substring(n.link from 'thread=([a-z]+:[0-9a-f-]+)')
  );

create or replace function public.add_record_comment(
  p_record_type text,
  p_record_id uuid,
  p_body text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_type text := lower(btrim(coalesce(p_record_type, '')));
  v_body text := nullif(btrim(coalesce(p_body, '')), '');
  v_group uuid := public.current_group_id();
  v_role public.app_role := public.current_user_role();
  v_member_id uuid := public.current_member_id();
  v_submitted_by uuid;
  v_target_member_id uuid;
  v_person_responsible text;
  v_my_member_name text;
  v_amount numeric(14,2);
  v_subject_name text;
  v_allowed boolean := false;
  v_comment public.record_comments;
  v_author_name text;
  v_author_avatar text;
  v_type_label text;
  v_page text;
  v_snippet text;
  v_dedupe_key text;
  v_thread_marker text;
  v_title text;
  v_message text;
  v_link text;
  v_recipient record;
begin
  if auth.uid() is null or v_group is null or v_role not in ('ADMIN', 'TREASURER', 'MEMBER') then
    raise exception 'Join or select a savings group first.' using errcode = '42501';
  end if;

  if v_type not in ('contribution', 'withdrawal', 'expense') or p_record_id is null then
    raise exception 'Invalid record reference.' using errcode = '22023';
  end if;

  if v_body is null or char_length(v_body) > 1000 then
    raise exception 'Reply must be between 1 and 1000 characters.' using errcode = '22023';
  end if;

  if v_type = 'contribution' then
    select c.submitted_by, cp.member_id, m.full_name, c.amount
    into v_submitted_by, v_target_member_id, v_subject_name, v_amount
    from public.contributions c
    join public.contribution_periods cp on cp.id = c.contribution_period_id
    join public.members m on m.id = cp.member_id
    where c.id = p_record_id
      and c.group_id = v_group;
    v_type_label := 'contribution';
    v_page := 'contributions.html';
  elsif v_type = 'withdrawal' then
    select w.submitted_by, w.person_responsible, w.person_responsible, w.amount
    into v_submitted_by, v_person_responsible, v_subject_name, v_amount
    from public.withdrawals w
    where w.id = p_record_id
      and w.group_id = v_group;
    v_type_label := 'deduction';
    v_page := 'withdrawals.html';
  else
    select e.submitted_by, e.person_responsible, e.person_responsible, e.amount
    into v_submitted_by, v_person_responsible, v_subject_name, v_amount
    from public.expenses e
    where e.id = p_record_id
      and e.group_id = v_group;
    v_type_label := 'expense';
    v_page := 'expenses.html';
  end if;

  if not found then
    raise exception 'Record not found in the active savings group.' using errcode = 'P0002';
  end if;

  if v_role in ('ADMIN', 'TREASURER') then
    v_allowed := true;
  else
    if v_member_id is not null then
      select m.full_name into v_my_member_name
      from public.members m
      where m.id = v_member_id and m.group_id = v_group;
    end if;
    if v_type = 'contribution' then
      v_allowed := (v_submitted_by = auth.uid() or (v_member_id is not null and v_target_member_id = v_member_id));
    else
      v_allowed := (
        v_submitted_by = auth.uid()
        or (v_my_member_name is not null and lower(btrim(coalesce(v_person_responsible, ''))) = lower(btrim(v_my_member_name)))
      );
    end if;
  end if;

  if not v_allowed then
    raise exception 'You can only reply to records associated with your account.' using errcode = '42501';
  end if;

  insert into public.record_comments (group_id, record_type, record_id, author_id, body)
  values (v_group, v_type, p_record_id, auth.uid(), v_body)
  returning * into v_comment;

  select coalesce(nullif(btrim(p.full_name), ''), 'Group member'), p.avatar_url
  into v_author_name, v_author_avatar
  from public.profiles p
  where p.id = auth.uid();

  v_snippet := case
    when char_length(v_body) > 120 then left(v_body, 117) || '...'
    else v_body
  end;

  v_dedupe_key := 'RECORD_COMMENT:' || v_type || ':' || p_record_id::text;
  v_thread_marker := 'thread=' || v_type || ':' || p_record_id::text;
  v_title := 'New reply on ' || v_type_label;
  v_message := v_author_name || ' (' || coalesce(v_subject_name, 'Member') || ' · PHP '
    || to_char(coalesce(v_amount, 0), 'FM999,999,990.00') || '): "' || v_snippet || '"';

  for v_recipient in
    select distinct
      r.user_id,
      coalesce(gm.role, p.role) as target_role
    from (
      select a.user_id
      from public.group_admin_ids(v_group) a
      union
      select gm_t.user_id
      from public.group_memberships gm_t
      where gm_t.group_id = v_group
        and gm_t.role = 'TREASURER'
        and gm_t.status = 'ACTIVE'
      union
      select p_t.id
      from public.profiles p_t
      where p_t.group_id = v_group
        and p_t.role = 'TREASURER'
        and p_t.status = 'ACTIVE'
      union
      select v_submitted_by where v_submitted_by is not null
      union
      select gm_m.user_id
      from public.group_memberships gm_m
      where v_target_member_id is not null
        and gm_m.group_id = v_group
        and gm_m.member_id = v_target_member_id
        and gm_m.status = 'ACTIVE'
      union
      select p_m.id
      from public.profiles p_m
      where v_target_member_id is not null
        and p_m.member_id = v_target_member_id
        and p_m.status = 'ACTIVE'
      union
      select gm_pr.user_id
      from public.members m_pr
      join public.group_memberships gm_pr
        on gm_pr.group_id = v_group
       and gm_pr.member_id = m_pr.id
       and gm_pr.status = 'ACTIVE'
      where v_type in ('withdrawal', 'expense')
        and m_pr.group_id = v_group
        and lower(btrim(m_pr.full_name)) = lower(btrim(coalesce(v_person_responsible, '')))
      union
      select p_pr.id
      from public.members m_pr2
      join public.profiles p_pr
        on p_pr.member_id = m_pr2.id
       and p_pr.status = 'ACTIVE'
      where v_type in ('withdrawal', 'expense')
        and m_pr2.group_id = v_group
        and lower(btrim(m_pr2.full_name)) = lower(btrim(coalesce(v_person_responsible, '')))
      union
      select prev.author_id
      from public.record_comments prev
      where prev.group_id = v_group
        and prev.record_type = v_type
        and prev.record_id = p_record_id
    ) r
    join public.profiles p on p.id = r.user_id
    left join public.group_memberships gm
      on gm.group_id = v_group
     and gm.user_id = r.user_id
     and gm.status = 'ACTIVE'
    where r.user_id is not null
      and r.user_id <> auth.uid()
      and p.status = 'ACTIVE'
      and p.notifications_enabled
  loop
    v_link := (case
      when v_type = 'contribution' and v_recipient.target_role = 'MEMBER' then 'user.html'
      else v_page
    end) || '?' || v_thread_marker;

    -- Replace any earlier notification for this same thread (delete + insert assigns a fresh row ID so device pollers also re-alert while panel shows only 1 latest item)
    delete from public.notifications n
    where n.recipient_id = v_recipient.user_id
      and n.type = 'RECORD_COMMENT'
      and (
        n.dedupe_key = v_dedupe_key
        or (
          n.dedupe_key is null
          and position(v_thread_marker in coalesce(n.link, '')) > 0
        )
      );

    insert into public.notifications (recipient_id, group_id, type, title, message, link, dedupe_key)
    values (v_recipient.user_id, v_group, 'RECORD_COMMENT', btrim(v_title), btrim(v_message), v_link, v_dedupe_key);
  end loop;

  return jsonb_build_object(
    'id', v_comment.id,
    'record_type', v_comment.record_type,
    'record_id', v_comment.record_id,
    'author_id', v_comment.author_id,
    'author_name', v_author_name,
    'author_role', v_role::text,
    'author_avatar_url', v_author_avatar,
    'body', v_comment.body,
    'created_at', v_comment.created_at,
    'is_own', true
  );
end;
$$;

drop function if exists public.get_unread_notifications_by_token(uuid);
create or replace function public.get_unread_notifications_by_token(p_token uuid)
returns table (
  id bigint,
  type text,
  title text,
  message text,
  link text,
  dedupe_key text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select n.id, n.type, n.title, n.message, n.link, n.dedupe_key, n.created_at
  from public.notification_feed_tokens t
  join public.profiles p on p.id = t.user_id
  join public.notifications n on n.recipient_id = p.id
  where p_token is not null
    and t.token = p_token
    and p.status = 'ACTIVE'
    and p.notifications_enabled
    and n.read_at is null
    and n.created_at >= now() - interval '48 hours'
  order by n.created_at desc
  limit 8;
$$;

revoke execute on function public.get_unread_notifications_by_token(uuid) from public;
grant execute on function public.get_unread_notifications_by_token(uuid) to anon, authenticated;

revoke execute on function public.add_record_comment(text, uuid, text) from public, anon;
grant execute on function public.add_record_comment(text, uuid, text) to authenticated;

insert into public.schema_migrations (version, name)
values ('20261114_060', 'replace prior record comment notifications per thread and include dedupe key in feed')
on conflict (version) do nothing;

commit;
