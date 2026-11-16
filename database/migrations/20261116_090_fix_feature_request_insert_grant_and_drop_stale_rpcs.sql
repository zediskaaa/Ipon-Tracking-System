-- Grant insert privilege on feature_requests.allow_credit (added in 038) so users can submit feature requests,
-- drop obsolete overloaded RPC signatures that cause overload ambiguity or expose anon/public execution,
-- and tighten stray anon/public privileges on tables and authenticated RPCs.

begin;

-- 1. Restore complete column-level INSERT grants on feature_requests (including allow_credit added in 038)
revoke all on public.feature_requests from public, anon, authenticated;
grant select on public.feature_requests to authenticated;
grant insert (requester_id, title, details, allow_credit) on public.feature_requests to authenticated;

drop policy if exists feature_requests_insert on public.feature_requests;
create policy feature_requests_insert on public.feature_requests for insert to authenticated
with check (
  requester_id = auth.uid()
  and public.current_user_role() in ('ADMIN', 'TREASURER', 'MEMBER', 'SUPER_ADMIN')
);

-- Keep bug_reports column-level INSERT explicit and idempotent
revoke all on public.bug_reports from public, anon, authenticated;
grant select on public.bug_reports to authenticated;
grant insert (reporter_id, title, description, attachments) on public.bug_reports to authenticated;

drop policy if exists bug_reports_insert on public.bug_reports;
create policy bug_reports_insert on public.bug_reports for insert to authenticated
with check (
  reporter_id = auth.uid()
  and public.current_user_role() in ('ADMIN', 'TREASURER', 'MEMBER', 'SUPER_ADMIN')
);

-- 2. Drop legacy short-argument RPC overloads superseded by default-backed signatures
drop function if exists public.create_member(text, text, text, text, date, numeric, text);
drop function if exists public.update_member(uuid, text, text, text, text, numeric, text);
drop function if exists public.update_own_profile(text, text, text, text);
drop function if exists public.update_contribution(uuid, numeric, date, text, text);
drop function if exists public.update_expense(uuid, date, numeric, text, text, text, text, text);
drop function if exists public.update_withdrawal(uuid, date, numeric, text, text, text, text, text);

-- 3. Tighten stray PUBLIC / anon execute grants on authenticated-only RPCs
revoke all on function public.set_contribution_setting(date, numeric, integer) from public, anon;
grant execute on function public.set_contribution_setting(date, numeric, integer) to authenticated;

revoke all on function public.update_group_payment_info(text, boolean, text, text, text, text) from public, anon;
grant execute on function public.update_group_payment_info(text, boolean, text, text, text, text) to authenticated;

revoke all on function public.get_group_payment_info() from public, anon;
grant execute on function public.get_group_payment_info() to authenticated;

-- 4. Revoke stray PUBLIC / anon table privileges while keeping authenticated grants intact
revoke all on
  public.group_memberships,
  public.record_comment_reads,
  public.record_comments,
  public.savings_calculator_plans,
  public.announcement_reactions,
  public.email_verifications
from public, anon;

grant select on public.group_memberships, public.record_comments, public.announcement_reactions to authenticated;
grant select, insert, update on public.record_comment_reads to authenticated;
grant select, insert, update, delete on public.savings_calculator_plans to authenticated;

notify pgrst, 'reload schema';

insert into public.schema_migrations (version, name)
values ('20261116_090', 'grant feature_requests allow_credit insert, drop stale overloaded RPCs, tighten anon grants')
on conflict (version) do nothing;

commit;
