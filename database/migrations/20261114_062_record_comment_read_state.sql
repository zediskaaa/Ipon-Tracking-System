-- Migration 062: Track per-user read state on record discussions so unread pills clear after opening

begin;

create table if not exists public.record_comment_reads (
  user_id uuid not null references auth.users(id) on delete cascade,
  record_type text not null check (record_type in ('contribution', 'withdrawal', 'expense')),
  record_id uuid not null,
  last_read_at timestamptz not null default now(),
  primary key (user_id, record_type, record_id)
);

alter table public.record_comment_reads enable row level security;

drop policy if exists "users manage own record comment reads" on public.record_comment_reads;
create policy "users manage own record comment reads"
  on public.record_comment_reads
  for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop function if exists public.get_record_comment_counts(text, uuid[]);
create or replace function public.get_record_comment_counts(
  p_record_type text,
  p_record_ids uuid[]
)
returns table (
  record_id uuid,
  comment_count bigint,
  unread_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    rc.record_id,
    count(*)::bigint as comment_count,
    count(*) filter (
      where rc.author_id <> auth.uid()
        and rc.created_at > coalesce(rcr.last_read_at, '-infinity'::timestamptz)
    )::bigint as unread_count
  from public.record_comments rc
  left join public.record_comment_reads rcr
    on rcr.user_id = auth.uid()
   and rcr.record_type = rc.record_type
   and rcr.record_id = rc.record_id
  where rc.group_id = public.current_group_id()
    and public.current_user_role() in ('ADMIN', 'TREASURER', 'MEMBER')
    and rc.record_type = lower(btrim(coalesce(p_record_type, '')))
    and rc.record_id = any(coalesce(p_record_ids, '{}'::uuid[]))
  group by rc.record_id;
$$;

revoke execute on function public.get_record_comment_counts(text, uuid[]) from public, anon;
grant execute on function public.get_record_comment_counts(text, uuid[]) to authenticated;

create or replace function public.get_record_comments(
  p_record_type text,
  p_record_id uuid
)
returns jsonb
language plpgsql
volatile
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

  insert into public.record_comment_reads (user_id, record_type, record_id, last_read_at)
  values (auth.uid(), v_type, p_record_id, clock_timestamp())
  on conflict (user_id, record_type, record_id)
  do update set last_read_at = greatest(public.record_comment_reads.last_read_at, excluded.last_read_at);

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

insert into public.schema_migrations (version, name)
values ('20261114_062', 'track per-user record comment read state so unread count clears on open')
on conflict (version) do nothing;

commit;

