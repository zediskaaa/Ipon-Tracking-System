-- Surface each user's actual latest specific activity for Super Admin Users table
-- without exposing private financial amounts, group balances, or chat contents.
begin;

create or replace function public.super_admin_user_last_activities()
returns table (
  user_id uuid,
  activity_event text,
  activity_label text,
  occurred_at timestamptz,
  last_seen_at timestamptz
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
            when (l.old_data ->> 'chat_privacy') is distinct from (l.new_data ->> 'chat_privacy')
              or (l.old_data ->> 'username') is distinct from (l.new_data ->> 'username')
              or (l.old_data ->> 'bio') is distinct from (l.new_data ->> 'bio') then 'CHAT_PRIVACY_UPDATE'
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
            when (l.old_data ->> 'chat_privacy') is distinct from (l.new_data ->> 'chat_privacy')
              or (l.old_data ->> 'username') is distinct from (l.new_data ->> 'username')
              or (l.old_data ->> 'bio') is distinct from (l.new_data ->> 'bio') then 'Updated chat privacy'
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

    -- 5. Messaging, calls & friend requests
    select
      m.sender_id,
      case
        when m.deleted_for_everyone_at is not null then 'CHAT_MESSAGE_UNSEND'
        when m.edited_at is not null and m.edited_at > m.created_at + interval '2 seconds' then 'CHAT_MESSAGE_EDIT'
        else 'CHAT_MESSAGE'
      end,
      case
        when m.deleted_for_everyone_at is not null then 'Unsent chat message'
        when m.edited_at is not null and m.edited_at > m.created_at + interval '2 seconds' then 'Edited chat message'
        else 'Sent chat message'
      end,
      greatest(m.created_at, coalesce(m.edited_at, m.created_at), coalesce(m.deleted_for_everyone_at, m.created_at)),
      20
    from public.messages m

    union all

    select cs.caller_id, 'CALL_START', 'Started call', cs.started_at, 20
    from public.call_sessions cs

    union all

    select fq.sender_id, 'FRIEND_REQUEST_SEND', 'Sent friend request', fq.created_at, 22
    from public.friend_requests fq

    union all

    select
      fq.receiver_id,
      case when fq.status = 'ACCEPTED' then 'FRIEND_REQUEST_ACCEPT' else 'FRIEND_REQUEST_DECLINE' end,
      case when fq.status = 'ACCEPTED' then 'Accepted friend request' else 'Declined friend request' end,
      coalesce(fq.responded_at, fq.updated_at),
      22
    from public.friend_requests fq
    where fq.status in ('ACCEPTED', 'DECLINED')

    union all

    -- 6. Access requests, archives & cycle resets
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

    -- 7. Fallback coverage for financial & goal records older than 90-day audit_logs retention
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

    -- 8. Policy consent, auth sign-in fallback & passive presence fallback
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

revoke all on function public.super_admin_user_last_activities() from public, anon;
grant execute on function public.super_admin_user_last_activities() to authenticated;

notify pgrst, 'reload schema';

insert into public.schema_migrations (version, name)
values ('20261117_099', 'surface specific user last activity for super admin')
on conflict (version) do nothing;

commit;
