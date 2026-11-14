-- Migration 058: In-Record Comments / Review Discussion Thread with role notifications & realtime updates

begin;

create table if not exists public.record_comments (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  record_type text not null check (record_type in ('contribution', 'withdrawal', 'expense')),
  record_id uuid not null,
  author_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 1000),
  created_at timestamptz not null default now()
);

create index if not exists record_comments_lookup_idx
  on public.record_comments (group_id, record_type, record_id, created_at asc);

alter table public.record_comments enable row level security;
alter table public.record_comments force row level security;

drop policy if exists mfa_verified_for_opted_in on public.record_comments;
create policy mfa_verified_for_opted_in on public.record_comments
as restrictive for all to authenticated
using (public.mfa_access_allowed());

drop policy if exists record_comments_select on public.record_comments;
create policy record_comments_select on public.record_comments for select to authenticated
using (
  group_id = public.current_group_id()
  and public.current_user_role() in ('ADMIN', 'TREASURER', 'MEMBER')
);

do $$
begin
  alter publication supabase_realtime add table public.record_comments;
exception when duplicate_object then null;
end $$;

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

create or replace function public.get_record_comment_counts(
  p_record_type text,
  p_record_ids uuid[]
)
returns table (
  record_id uuid,
  comment_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select rc.record_id, count(*)::bigint as comment_count
  from public.record_comments rc
  where rc.group_id = public.current_group_id()
    and public.current_user_role() in ('ADMIN', 'TREASURER', 'MEMBER')
    and rc.record_type = lower(btrim(coalesce(p_record_type, '')))
    and rc.record_id = any(coalesce(p_record_ids, '{}'::uuid[]))
  group by rc.record_id;
$$;

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

  for v_recipient in
    select distinct
      r.user_id,
      coalesce(gm.role, p.role) as target_role
    from (
      select a.user_id
      from public.group_admin_ids(v_group) a
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
    perform public.push_notification(
      v_recipient.user_id,
      'RECORD_COMMENT',
      'New reply on ' || v_type_label,
      v_author_name || ' (' || coalesce(v_subject_name, 'Member') || ' · PHP '
        || to_char(coalesce(v_amount, 0), 'FM999,999,990.00') || '): "' || v_snippet || '"',
      (case
        when v_type = 'contribution' and v_recipient.target_role = 'MEMBER' then 'user.html'
        else v_page
      end) || '?thread=' || v_type || ':' || p_record_id::text,
      v_group
    );
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

revoke execute on function public.get_record_comments(text, uuid) from public, anon;
revoke execute on function public.get_record_comment_counts(text, uuid[]) from public, anon;
revoke execute on function public.add_record_comment(text, uuid, text) from public, anon;

grant execute on function public.get_record_comments(text, uuid) to authenticated;
grant execute on function public.get_record_comment_counts(text, uuid[]) to authenticated;
grant execute on function public.add_record_comment(text, uuid, text) to authenticated;

insert into public.schema_migrations (version, name)
values ('20261114_058', 'add in-record discussion comments and review replies')
on conflict (version) do nothing;

commit;

