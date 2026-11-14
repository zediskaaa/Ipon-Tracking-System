-- Migration 061: Allow lossless photo, video, and file attachments in record discussions

begin;

alter table public.record_comments
  add column if not exists attachments jsonb not null default '[]'::jsonb;

do $$
declare
  v_con record;
begin
  for v_con in
    select conname
    from pg_constraint
    where conrelid = 'public.record_comments'::regclass
      and contype = 'c'
      and (
        pg_get_constraintdef(oid) ~* '\ybody\y'
        or pg_get_constraintdef(oid) ~* '\yattachments\y'
      )
  loop
    execute format('alter table public.record_comments drop constraint if exists %I', v_con.conname);
  end loop;
end $$;

alter table public.record_comments
  add constraint record_comments_body_length_check
    check (char_length(btrim(coalesce(body, ''))) <= 1000),
  add constraint record_comments_attachments_array_check
    check (jsonb_typeof(attachments) = 'array' and jsonb_array_length(attachments) <= 5),
  add constraint record_comments_content_present_check
    check (char_length(btrim(coalesce(body, ''))) > 0 or jsonb_array_length(attachments) > 0);

create or replace function public.get_record_comments(
  p_record_type text,
  p_record_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_type text := lower(btrim(coalesce(p_record_type, '')));
  v_group uuid := public.current_group_id();
  v_role public.app_role := public.current_user_role();
  v_member_id uuid := public.current_member_id();
  v_record jsonb;
  v_submitted_by uuid;
  v_target_member_id uuid;
  v_person_responsible text;
  v_my_member_name text;
  v_can_reply boolean := false;
begin
  if auth.uid() is null or v_group is null or v_role not in ('ADMIN', 'TREASURER', 'MEMBER') then
    raise exception 'Join or select a savings group first.' using errcode = '42501';
  end if;

  if v_type not in ('contribution', 'withdrawal', 'expense') or p_record_id is null then
    raise exception 'Invalid record reference.' using errcode = '22023';
  end if;

  if v_type = 'contribution' then
    select
      jsonb_build_object(
        'id', c.id,
        'type', 'contribution',
        'authorName', m.full_name,
        'amount', c.amount,
        'date', c.payment_date,
        'periodMonth', cp.period_month,
        'status', c.approval_status::text,
        'paymentMethod', c.payment_method,
        'reference', c.transaction_reference,
        'notes', coalesce(nullif(c.void_reason, ''), nullif(c.review_note, ''), nullif(c.notes, '')),
        'reviewNote', coalesce(nullif(c.void_reason, ''), nullif(c.review_note, '')),
        'receiptUrl', c.receipt_url
      ),
      c.submitted_by,
      cp.member_id
    into v_record, v_submitted_by, v_target_member_id
    from public.contributions c
    join public.contribution_periods cp on cp.id = c.contribution_period_id
    join public.members m on m.id = cp.member_id
    where c.id = p_record_id
      and c.group_id = v_group;
  elsif v_type = 'withdrawal' then
    select
      jsonb_build_object(
        'id', w.id,
        'type', 'withdrawal',
        'authorName', w.person_responsible,
        'amount', w.amount,
        'date', w.transaction_date,
        'category', w.category,
        'status', w.approval_status::text,
        'paymentMethod', w.payment_method,
        'reference', w.reference_number,
        'description', w.description,
        'notes', coalesce(nullif(w.void_reason, ''), nullif(w.review_note, ''), nullif(w.notes, '')),
        'reviewNote', coalesce(nullif(w.void_reason, ''), nullif(w.review_note, '')),
        'receiptUrl', null
      ),
      w.submitted_by,
      w.person_responsible
    into v_record, v_submitted_by, v_person_responsible
    from public.withdrawals w
    where w.id = p_record_id
      and w.group_id = v_group;
  else
    select
      jsonb_build_object(
        'id', e.id,
        'type', 'expense',
        'authorName', e.person_responsible,
        'amount', e.amount,
        'date', e.transaction_date,
        'category', e.category,
        'status', e.approval_status::text,
        'paymentMethod', e.payment_method,
        'reference', e.reference_number,
        'description', e.description,
        'notes', coalesce(nullif(e.void_reason, ''), nullif(e.review_note, ''), nullif(e.notes, '')),
        'reviewNote', coalesce(nullif(e.void_reason, ''), nullif(e.review_note, '')),
        'receiptUrl', e.receipt_url
      ),
      e.submitted_by,
      e.person_responsible
    into v_record, v_submitted_by, v_person_responsible
    from public.expenses e
    where e.id = p_record_id
      and e.group_id = v_group;
  end if;

  if v_record is null then
    raise exception 'Record not found in the active savings group.' using errcode = 'P0002';
  end if;

  if v_role in ('ADMIN', 'TREASURER') then
    v_can_reply := true;
  else
    if v_member_id is not null then
      select m.full_name into v_my_member_name
      from public.members m
      where m.id = v_member_id and m.group_id = v_group;
    end if;
    if v_type = 'contribution' then
      v_can_reply := (v_submitted_by = auth.uid() or (v_member_id is not null and v_target_member_id = v_member_id));
    else
      v_can_reply := (
        v_submitted_by = auth.uid()
        or (v_my_member_name is not null and lower(btrim(coalesce(v_person_responsible, ''))) = lower(btrim(v_my_member_name)))
      );
    end if;
  end if;

  return jsonb_build_object(
    'record', v_record,
    'can_reply', v_can_reply,
    'comments', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', rc.id,
            'record_type', rc.record_type,
            'record_id', rc.record_id,
            'author_id', rc.author_id,
            'author_name', coalesce(nullif(btrim(p.full_name), ''), 'Group member'),
            'author_role', coalesce(gm.role::text, p.role::text, 'MEMBER'),
            'author_avatar_url', p.avatar_url,
            'body', rc.body,
            'attachments', coalesce(rc.attachments, '[]'::jsonb),
            'created_at', rc.created_at,
            'is_own', rc.author_id = auth.uid()
          )
          order by rc.created_at asc, rc.id asc
        )
        from public.record_comments rc
        join public.profiles p on p.id = rc.author_id
        left join public.group_memberships gm
          on gm.group_id = v_group
         and gm.user_id = rc.author_id
         and gm.status = 'ACTIVE'
        where rc.group_id = v_group
          and rc.record_type = v_type
          and rc.record_id = p_record_id
      ),
      '[]'::jsonb
    )
  );
end;
$$;

drop function if exists public.add_record_comment(text, uuid, text);
create or replace function public.add_record_comment(
  p_record_type text,
  p_record_id uuid,
  p_body text default '',
  p_attachments jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_type text := lower(btrim(coalesce(p_record_type, '')));
  v_body text := btrim(coalesce(p_body, ''));
  v_attachments jsonb := coalesce(p_attachments, '[]'::jsonb);
  v_sanitized_attachments jsonb := '[]'::jsonb;
  v_att jsonb;
  v_att_path text;
  v_att_name text;
  v_att_kind text;
  v_att_type text;
  v_att_size bigint;
  v_expected_prefix text;
  v_att_count integer := 0;
  v_first_att_name text := '';
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

  if jsonb_typeof(v_attachments) <> 'array' then
    raise exception 'Attachments must be an array.' using errcode = '22023';
  end if;

  v_att_count := jsonb_array_length(v_attachments);
  if v_att_count > 5 then
    raise exception 'You can attach at most 5 files per reply.' using errcode = '22023';
  end if;

  if char_length(v_body) > 1000 or (char_length(v_body) = 0 and v_att_count = 0) then
    raise exception 'Enter a reply or attach at least one file (max 1000 characters).' using errcode = '22023';
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

  v_expected_prefix := v_group::text || '/' || v_type || '/' || p_record_id::text || '/' || auth.uid()::text || '/';
  for v_att in select value from jsonb_array_elements(v_attachments) loop
    v_att_path := coalesce(v_att->>'path', '');
    if v_att_path = '' or position('..' in v_att_path) > 0 or left(v_att_path, char_length(v_expected_prefix)) <> v_expected_prefix then
      raise exception 'Invalid discussion attachment storage path.' using errcode = '42501';
    end if;
    v_att_name := left(coalesce(nullif(btrim(v_att->>'name'), ''), 'attachment'), 120);
    if v_first_att_name = '' then
      v_first_att_name := v_att_name;
    end if;
    v_att_kind := case lower(coalesce(v_att->>'kind', 'file'))
      when 'image' then 'image'
      when 'video' then 'video'
      else 'file'
    end;
    v_att_type := left(coalesce(v_att->>'type', ''), 120);
    v_att_size := greatest(0, least(52428800, coalesce(nullif(v_att->>'size', '')::bigint, 0)));
    v_sanitized_attachments := v_sanitized_attachments || jsonb_build_array(
      jsonb_build_object(
        'path', v_att_path,
        'name', v_att_name,
        'kind', v_att_kind,
        'type', v_att_type,
        'size', v_att_size
      )
    );
  end loop;

  insert into public.record_comments (group_id, record_type, record_id, author_id, body, attachments)
  values (v_group, v_type, p_record_id, auth.uid(), v_body, v_sanitized_attachments)
  returning * into v_comment;

  select coalesce(nullif(btrim(p.full_name), ''), 'Group member'), p.avatar_url
  into v_author_name, v_author_avatar
  from public.profiles p
  where p.id = auth.uid();

  if char_length(v_body) > 0 then
    v_snippet := case
      when char_length(v_body) > 120 then left(v_body, 117) || '...'
      else v_body
    end;
    if v_att_count > 0 then
      v_snippet := v_snippet || ' (+' || v_att_count::text || case when v_att_count = 1 then ' attachment)' else ' attachments)' end;
    end if;
  elsif v_att_count = 1 then
    v_snippet := 'Sent attachment: ' || left(v_first_att_name, 80);
  else
    v_snippet := 'Sent ' || v_att_count::text || ' attachments';
  end if;

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
    'attachments', coalesce(v_comment.attachments, '[]'::jsonb),
    'created_at', v_comment.created_at,
    'is_own', true
  );
end;
$$;

revoke execute on function public.add_record_comment(text, uuid, text, jsonb) from public, anon;
grant execute on function public.add_record_comment(text, uuid, text, jsonb) to authenticated;

insert into public.schema_migrations (version, name)
values ('20261114_061', 'allow lossless photo, video, and file attachments in record comments')
on conflict (version) do nothing;

commit;

