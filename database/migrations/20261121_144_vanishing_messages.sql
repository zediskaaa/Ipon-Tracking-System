begin;

alter table public.conversations
  add column if not exists vanish_after_seconds integer
  check (vanish_after_seconds between 1 and 3600);

alter table public.messages
  add column if not exists vanish_after_seconds integer
    check (vanish_after_seconds between 1 and 3600),
  add column if not exists vanish_started_at timestamptz,
  add column if not exists vanish_at timestamptz;

create index if not exists messages_vanish_due_idx
  on public.messages (vanish_at) where vanish_at is not null;
create index if not exists messages_vanish_pending_idx
  on public.messages (conversation_id, created_at)
  where vanish_after_seconds is not null and vanish_at is null;

drop policy if exists messages_select on public.messages;
create policy messages_select on public.messages for select to authenticated
using (
  not (auth.uid() = any(deleted_for_user_ids))
  and public.is_conversation_member(conversation_id, auth.uid())
  and (vanish_at is null or vanish_at > now())
);

drop policy if exists message_attachments_select on public.message_attachments;
create policy message_attachments_select on public.message_attachments for select to authenticated
using (
  public.is_conversation_member(conversation_id, auth.uid())
  and exists (
    select 1 from public.messages m
    where m.id = message_id and (m.vanish_at is null or m.vanish_at > now())
  )
);

drop policy if exists message_reactions_select on public.message_reactions;
create policy message_reactions_select on public.message_reactions for select to authenticated
using (
  exists (
    select 1 from public.messages m
    where m.id = message_id
      and not (auth.uid() = any(m.deleted_for_user_ids))
      and public.is_conversation_member(m.conversation_id, auth.uid())
      and (m.vanish_at is null or m.vanish_at > now())
  )
);

drop policy if exists message_receipts_select on public.message_receipts;
create policy message_receipts_select on public.message_receipts for select to authenticated
using (
  exists (
    select 1 from public.messages m
    where m.id = message_id
      and public.is_conversation_member(m.conversation_id, auth.uid())
      and (m.vanish_at is null or m.vanish_at > now())
  )
);

create or replace function public.get_conversation_protection(p_conversation_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_conv public.conversations%rowtype;
begin
  select * into v_conv from public.conversations where id = p_conversation_id;
  if v_conv.id is null or not public.is_conversation_member(v_conv.id, public.require_messaging_actor()) then
    raise exception 'Conversation not found.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'block_screenshots', v_conv.block_screenshots,
    'block_forwarding', v_conv.block_forwarding,
    'vanish_after_seconds', v_conv.vanish_after_seconds
  );
end;
$$;

create or replace function public.set_conversation_vanish(p_conversation_id uuid, p_seconds integer)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.require_messaging_actor();
  v_conv public.conversations%rowtype;
begin
  if p_seconds is not null and (p_seconds < 1 or p_seconds > 3600) then
    raise exception 'Choose a duration from 1 second to 60 minutes.' using errcode = '22023';
  end if;
  select * into v_conv from public.conversations where id = p_conversation_id for update;
  if v_conv.id is null or not public.is_conversation_member(v_conv.id, v_uid) then
    raise exception 'Conversation not found.' using errcode = '42501';
  end if;
  if v_conv.status <> 'ACCEPTED' or (v_conv.kind = 'DIRECT' and v_conv.user_a = v_conv.user_b) then
    raise exception 'Vanishing messages are unavailable in this conversation.' using errcode = '42501';
  end if;
  if v_conv.kind = 'GROUP' and not exists (
    select 1 from public.conversation_participants
    where conversation_id = v_conv.id and user_id = v_uid and role in ('OWNER', 'ADMIN')
  ) then
    raise exception 'Only group owners or admins can change this setting.' using errcode = '42501';
  end if;
  update public.conversations set vanish_after_seconds = p_seconds where id = v_conv.id;
  return public.get_conversation_protection(v_conv.id);
end;
$$;

create or replace function public.snapshot_message_vanish_duration()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.message_type not in ('SYSTEM', 'CALL_EVENT') then
    select c.vanish_after_seconds into new.vanish_after_seconds
    from public.conversations c where c.id = new.conversation_id;
  end if;
  return new;
end;
$$;
drop trigger if exists messages_snapshot_vanish_duration on public.messages;
create trigger messages_snapshot_vanish_duration before insert on public.messages
  for each row execute function public.snapshot_message_vanish_duration();

create or replace function public.start_seen_message_vanish()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_started_at timestamptz;
begin
  if new.last_read_at is null or new.last_read_at is not distinct from old.last_read_at then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(new.conversation_id::text, 144));
  v_started_at := clock_timestamp();
  update public.messages m
  set vanish_started_at = v_started_at,
      vanish_at = v_started_at + make_interval(secs => m.vanish_after_seconds)
  where m.conversation_id = new.conversation_id
    and m.sender_id <> new.user_id
    and m.vanish_after_seconds is not null
    and m.vanish_at is null
    and m.created_at <= new.last_read_at
    and exists (
      select 1 from public.message_receipts mr
      where mr.message_id = m.id and mr.user_id = new.user_id
    )
    and not exists (
      select 1
      from public.message_receipts mr
      join public.conversation_participants cp
        on cp.conversation_id = m.conversation_id and cp.user_id = mr.user_id
      where mr.message_id = m.id
        and cp.user_id <> m.sender_id
        and (cp.last_read_at is null or cp.last_read_at < m.created_at)
    );
  return new;
end;
$$;
drop trigger if exists conversation_participants_start_vanish on public.conversation_participants;
create trigger conversation_participants_start_vanish after update of last_read_at on public.conversation_participants
  for each row execute function public.start_seen_message_vanish();

create or replace function public.purge_expired_vanishing_messages()
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_count integer;
  v_conv_id uuid;
  v_latest record;
begin
  perform set_config('ipon.maintenance_retention_cleanup', 'on', true);
  with deleted as (
    delete from public.messages
    where vanish_at <= clock_timestamp()
    returning conversation_id
  )
  select count(*) into v_count from deleted;
  if v_count > 0 then
    for v_conv_id in
      select c.id from public.conversations c
      where c.last_message_id is not null
        and not exists (select 1 from public.messages m where m.id = c.last_message_id)
    loop
      select m.id, m.created_at, m.sender_id,
        case
          when m.deleted_for_everyone_at is not null then 'Message removed'
          when char_length(btrim(m.body)) > 0 then left(btrim(m.body), 140)
          when m.message_type = 'VOICE' then 'Sent a voice message'
          else 'Sent an attachment'
        end as preview
      into v_latest
      from public.messages m
      where m.conversation_id = v_conv_id
        and (m.vanish_at is null or m.vanish_at > clock_timestamp())
      order by m.created_at desc limit 1;
      update public.conversations
      set last_message_id = v_latest.id,
          last_message_at = v_latest.created_at,
          last_message_sender_id = v_latest.sender_id,
          last_message_preview = v_latest.preview
      where id = v_conv_id;
    end loop;
  end if;
  return v_count;
end;
$$;

revoke all on function public.set_conversation_vanish(uuid,integer),
  public.purge_expired_vanishing_messages() from public, anon, authenticated;
grant execute on function public.set_conversation_vanish(uuid,integer) to authenticated;

do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise exception 'pg_cron is required for vanishing message cleanup.';
  end if;
  if not exists (select 1 from cron.job where jobname = 'ipon-vanishing-message-purge') then
    perform cron.schedule(
      'ipon-vanishing-message-purge',
      '* * * * *',
      'select public.purge_expired_vanishing_messages();'
    );
  end if;
end $$;

create or replace function public.get_conversation_attachment_paths(
  p_conversation_id uuid,
  p_paths text[]
)
returns text[]
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.require_messaging_actor();
  v_part public.conversation_participants%rowtype;
begin
  if not public.is_conversation_member(p_conversation_id, v_uid) then
    return '{}';
  end if;
  select * into v_part
  from public.conversation_participants
  where conversation_id = p_conversation_id and user_id = v_uid;

  return coalesce((
    select array_agg(distinct ma.storage_path)
    from public.message_attachments ma
    join public.messages m on m.id = ma.message_id
    where ma.conversation_id = p_conversation_id
      and ma.storage_path = any(coalesce(p_paths, '{}'))
      and m.deleted_for_everyone_at is null
      and (m.vanish_at is null or m.vanish_at > now())
      and not (v_uid = any(m.deleted_for_user_ids))
      and (v_part.deleted_before_at is null or m.created_at > v_part.deleted_before_at)
  ), '{}');
end;
$$;

create or replace function public.get_conversations()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.require_messaging_actor();
begin
  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'id', c.id,
        'kind', c.kind,
        'title', c.title,
        'description', c.description,
        'avatar_url', c.avatar_url,
        'status', c.status,
        'initiator_id', c.initiator_id,
        'is_incoming_request', (c.kind = 'DIRECT' and c.status = 'PENDING_REQUEST' and c.initiator_id is distinct from v_uid),
        'is_outgoing_request', (c.kind = 'DIRECT' and c.status = 'PENDING_REQUEST' and c.initiator_id = v_uid),
        'peer', case
          when c.kind = 'DIRECT' and peer.id is not null then jsonb_build_object(
            'id', peer.id,
            'is_self', (peer.id = v_uid),
            'profile_visible', peer_vis.can_view,
            'full_name', peer.full_name,
            'username', case when peer_vis.can_view then peer.username else null end,
            'avatar_url', case when peer_vis.can_view then peer.avatar_url else null end,
            'social_links', case
              when peer_vis.can_view then public.sanitize_social_app_links(peer.social_links, false)
              else '{}'::jsonb
            end,
            'is_friend', (peer.id <> v_uid and public.are_friends(v_uid, peer.id)),
            'is_blocked', (peer.id <> v_uid and public.is_user_blocked_between(v_uid, peer.id)),
            'blocked_by_me', (peer.id <> v_uid and exists (select 1 from public.blocked_users b where b.blocker_id = v_uid and b.blocked_id = peer.id)),
            'allow_online_status', (peer.id = v_uid or (peer_vis.can_view and coalesce((peer.chat_privacy ->> 'show_online')::boolean, true))),
            'last_seen_at', case
              when peer.id <> v_uid
                   and peer_vis.can_view
                   and coalesce((peer.chat_privacy ->> 'show_online')::boolean, true)
                   and coalesce((peer.chat_privacy ->> 'show_last_seen')::boolean, true)
              then peer.last_seen_at
              else null
            end
          )
          else null
        end,
        'my_role', case when c.kind = 'GROUP' then cp.role else null end,
        'member_count', case
          when c.kind = 'GROUP' then (
            select count(*)::integer
            from public.conversation_participants gcp
            where gcp.conversation_id = c.id
          )
          when c.user_a = c.user_b then 1
          else 2
        end,
        'members_preview', case
          when c.kind = 'GROUP' then coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'id', gm.id,
                'profile_visible', gm.profile_visible,
                'full_name', gm.full_name,
                'avatar_url', gm.avatar_url,
                'allow_online_status', gm.allow_online_status
              )
            )
            from (
              select
                mp.id,
                mvis.can_view as profile_visible,
                mp.full_name,
                case when mvis.can_view then mp.avatar_url else null end as avatar_url,
                (mvis.can_view and coalesce((mp.chat_privacy ->> 'show_online')::boolean, true)) as allow_online_status
              from public.conversation_participants gcp
              join public.profiles mp on mp.id = gcp.user_id
              cross join lateral (
                select public.can_view_social_profile(v_uid, mp.id, mp.chat_privacy ->> 'profile_visibility') as can_view
              ) mvis
              where gcp.conversation_id = c.id
                and gcp.user_id <> v_uid
                and mp.status = 'ACTIVE'
              order by gcp.joined_at asc
              limit 4
            ) gm
          ), '[]'::jsonb)
          else '[]'::jsonb
        end,
        'is_pinned', coalesce(cp.is_pinned, false),
        'pinned_at', cp.pinned_at,
        'is_muted', coalesce(cp.is_muted, false),
        'is_archived', coalesce(cp.is_archived, false),
        'marked_unread', coalesce(cp.marked_unread, false),
        'chat_theme', coalesce(cp.chat_theme, 'paper'),
        'last_message_at', coalesce(latest.created_at, c.created_at),
        'last_message_type', latest.message_type,
        'last_message_preview', coalesce(
          case
            when latest.id is null then null
            when latest.deleted_for_everyone_at is not null then 'Message removed'
            when char_length(btrim(latest.body)) > 0 then left(latest.body, 140)
            when latest.message_type = 'VOICE' then 'Sent a voice message'
            when latest.message_type = 'CALL_EVENT' then coalesce(latest.metadata ->> 'summary', 'Call activity')
            else 'Sent an attachment'
          end,
          case
            when c.kind = 'GROUP' then 'No recent messages'
            when c.user_a = c.user_b then 'Personal notes & saved messages'
            else 'Start a conversation'
          end
        ),
        'last_message_sender_id', latest.sender_id,
        'last_message_sender_name', sender_p.full_name,
        'unread_count', (
          select count(*)::integer
          from public.messages um
          where um.conversation_id = c.id
            and (um.vanish_at is null or um.vanish_at > now())
            and um.sender_id <> v_uid
            and um.message_type <> 'SYSTEM'
            and um.deleted_for_everyone_at is null
            and not (v_uid = any(um.deleted_for_user_ids))
            and (cp.deleted_before_at is null or um.created_at > cp.deleted_before_at)
            and (cp.last_read_at is null or um.created_at > cp.last_read_at)
        )
      )
      order by
        coalesce(cp.is_pinned, false) desc,
        cp.pinned_at desc nulls last,
        coalesce(latest.created_at, c.created_at) desc
    )
    from public.conversations c
    left join public.conversation_participants cp on cp.conversation_id = c.id and cp.user_id = v_uid
    left join public.profiles peer on c.kind = 'DIRECT' and peer.id = case when c.user_a = v_uid then c.user_b else c.user_a end
    left join lateral (
      select (
        peer.id = v_uid
        or public.can_view_social_profile(v_uid, peer.id, peer.chat_privacy ->> 'profile_visibility')
      ) as can_view
    ) peer_vis on c.kind = 'DIRECT' and peer.id is not null
    left join lateral (
      select m.*
      from public.messages m
      where m.conversation_id = c.id
        and (m.vanish_at is null or m.vanish_at > now())
        and not (v_uid = any(m.deleted_for_user_ids))
        and (cp.deleted_before_at is null or m.created_at > cp.deleted_before_at)
      order by m.created_at desc
      limit 1
    ) latest on true
    left join public.profiles sender_p on sender_p.id = latest.sender_id
    where (
      (c.kind = 'GROUP' and cp.user_id = v_uid and cp.hidden_at is null and c.status = 'ACCEPTED')
      or (
        c.kind = 'DIRECT'
        and (c.user_a = v_uid or c.user_b = v_uid)
        and peer.id is not null
        and peer.role in ('ADMIN', 'TREASURER', 'MEMBER')
        and peer.status = 'ACTIVE'
        and cp.hidden_at is null
        and c.status <> 'DECLINED'
        and (latest.id is not null or c.status = 'ACCEPTED')
      )
    )
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.get_conversations() from public, anon;
grant execute on function public.get_conversations() to authenticated;

create or replace function public.get_conversation_messages(
  p_conversation_id uuid,
  p_before timestamptz default null,
  p_limit integer default 60,
  p_around_message_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.require_messaging_actor();
  v_conv public.conversations%rowtype;
  v_peer_id uuid;
  v_me_privacy jsonb;
  v_viewer_group_id uuid;
  v_peer_privacy jsonb;
  v_part public.conversation_participants%rowtype;
  v_lim integer := greatest(10, least(coalesce(p_limit, 60), 120));
  v_share_receipts boolean := false;
  v_anchor timestamptz;
  v_unread_first_id uuid;
  v_conv_payload jsonb;
  v_group_members jsonb := '[]'::jsonb;
begin
  select * into v_conv from public.conversations where id = p_conversation_id;
  if v_conv.id is null or not public.is_conversation_member(v_conv.id, v_uid) then
    raise exception 'Conversation not found.' using errcode = 'P0002';
  end if;

  select chat_privacy, group_id into v_me_privacy, v_viewer_group_id from public.profiles where id = v_uid;
  select * into v_part from public.conversation_participants where conversation_id = v_conv.id and user_id = v_uid;

  if v_conv.kind = 'DIRECT' then
    v_peer_id := case when v_conv.user_a = v_uid then v_conv.user_b else v_conv.user_a end;
    if not public.is_messaging_eligible(v_peer_id) then
      raise exception 'This user is unavailable.' using errcode = '42501';
    end if;
    select chat_privacy into v_peer_privacy from public.profiles where id = v_peer_id;
    v_share_receipts := v_conv.status = 'ACCEPTED'
      and coalesce((v_me_privacy ->> 'read_receipts')::boolean, true)
      and coalesce((v_peer_privacy ->> 'read_receipts')::boolean, true);

    v_conv_payload := public.get_social_user_profile(v_peer_id) || jsonb_build_object(
      'conversation_id', v_conv.id,
      'kind', 'DIRECT',
      'status', v_conv.status,
      'initiator_id', v_conv.initiator_id,
      'is_muted', coalesce(v_part.is_muted, false),
      'is_pinned', coalesce(v_part.is_pinned, false),
      'is_archived', coalesce(v_part.is_archived, false),
      'chat_theme', coalesce(v_part.chat_theme, 'paper'),
      'receipts_enabled', v_share_receipts
    );
  else
    v_share_receipts := coalesce((v_me_privacy ->> 'read_receipts')::boolean, true);

    select coalesce(jsonb_agg(
      jsonb_build_object(
        'id', mp.id,
        'profile_visible', gmvis.can_view,
        'full_name', mp.full_name,
        'username', case when gmvis.can_view then mp.username else null end,
        'avatar_url', case when gmvis.can_view then mp.avatar_url else null end,
        'role', gcp.role,
        'app_role', coalesce(
          (
            select gm.role
            from public.group_memberships gm
            where gm.user_id = mp.id
              and gm.status = 'ACTIVE'
              and v_viewer_group_id is not null
              and gm.group_id = v_viewer_group_id
            limit 1
          ),
          (
            select gm.role
            from public.group_memberships gm
            join public.group_memberships my_gm
              on my_gm.group_id = gm.group_id
             and my_gm.user_id = v_uid
             and my_gm.status = 'ACTIVE'
            where gm.user_id = mp.id
              and gm.status = 'ACTIVE'
            order by case gm.role when 'ADMIN' then 1 when 'TREASURER' then 2 else 3 end
            limit 1
          ),
          case when mp.role in ('ADMIN', 'TREASURER') then mp.role else 'MEMBER' end
        ),
        'joined_at', gcp.joined_at,
        'is_friend', (mp.id <> v_uid and public.are_friends(v_uid, mp.id)),
        'is_blocked', (mp.id <> v_uid and public.is_user_blocked_between(v_uid, mp.id)),
        'allow_online_status', (
          mp.id = v_uid
          or (gmvis.can_view and coalesce((mp.chat_privacy ->> 'show_online')::boolean, true))
        ),
        'last_seen_at', case
          when mp.id <> v_uid
               and gmvis.can_view
               and coalesce((mp.chat_privacy ->> 'show_online')::boolean, true)
               and coalesce((mp.chat_privacy ->> 'show_last_seen')::boolean, true)
          then mp.last_seen_at
          else null
        end
      )
      order by
        case gcp.role when 'OWNER' then 1 when 'ADMIN' then 2 else 3 end,
        mp.full_name asc
    ), '[]'::jsonb)
    into v_group_members
    from public.conversation_participants gcp
    join public.profiles mp on mp.id = gcp.user_id
    cross join lateral (
      select (
        mp.id = v_uid
        or public.can_view_social_profile(v_uid, mp.id, mp.chat_privacy ->> 'profile_visibility')
      ) as can_view
    ) gmvis
    where gcp.conversation_id = v_conv.id
      and mp.status = 'ACTIVE'
      and mp.role in ('ADMIN', 'TREASURER', 'MEMBER');

    v_conv_payload := jsonb_build_object(
      'id', v_conv.id,
      'conversation_id', v_conv.id,
      'kind', 'GROUP',
      'title', v_conv.title,
      'full_name', v_conv.title,
      'description', v_conv.description,
      'avatar_url', v_conv.avatar_url,
      'created_by', v_conv.created_by,
      'status', v_conv.status,
      'my_role', v_part.role,
      'member_count', jsonb_array_length(v_group_members),
      'members', v_group_members,
      'is_muted', coalesce(v_part.is_muted, false),
      'is_pinned', coalesce(v_part.is_pinned, false),
      'is_archived', coalesce(v_part.is_archived, false),
      'chat_theme', coalesce(v_part.chat_theme, 'paper'),
      'receipts_enabled', v_share_receipts
    );
  end if;

  if p_around_message_id is not null then
    select created_at into v_anchor
    from public.messages
    where id = p_around_message_id and conversation_id = v_conv.id;
  end if;

  select id into v_unread_first_id
  from public.messages um
  where um.conversation_id = v_conv.id
    and (um.vanish_at is null or um.vanish_at > now())
    and um.sender_id <> v_uid
    and um.message_type <> 'SYSTEM'
    and um.deleted_for_everyone_at is null
    and not (v_uid = any(um.deleted_for_user_ids))
    and (v_part.deleted_before_at is null or um.created_at > v_part.deleted_before_at)
    and v_part.last_read_at is not null
    and um.created_at > v_part.last_read_at
  order by um.created_at asc
  limit 1;

  return (
    with visible as (
      select m.*
      from public.messages m
      where m.conversation_id = v_conv.id
        and (m.vanish_at is null or m.vanish_at > now())
        and not (v_uid = any(m.deleted_for_user_ids))
        and (v_part.deleted_before_at is null or m.created_at > v_part.deleted_before_at)
        and (
          (v_anchor is null and (p_before is null or m.created_at < p_before))
          or (v_anchor is not null and m.created_at <= (v_anchor + interval '30 days'))
        )
      order by m.created_at desc
      limit v_lim + 1
    ),
    sliced as (
      select * from visible order by created_at desc limit v_lim
    ),
    ordered as (
      select * from sliced order by created_at asc
    )
    select jsonb_build_object(
      'conversation', v_conv_payload,
      'has_older', ((select count(*) from visible) > v_lim),
      'unread_first_id', v_unread_first_id,
      'pinned_messages', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id', pm.id,
            'sender_id', pm.sender_id,
            'sender_name', sp.full_name,
            'body', case when pm.deleted_for_everyone_at is not null then '' else left(pm.body, 140) end,
            'pinned_at', pm.pinned_at,
            'created_at', pm.created_at
          ) order by pm.pinned_at desc
        )
        from public.messages pm
        join public.profiles sp on sp.id = pm.sender_id
        where pm.conversation_id = v_conv.id
          and (pm.vanish_at is null or pm.vanish_at > now())
          and pm.pinned_at is not null
          and pm.deleted_for_everyone_at is null
          and not (v_uid = any(pm.deleted_for_user_ids))
          and (v_part.deleted_before_at is null or pm.created_at > v_part.deleted_before_at)
      ), '[]'::jsonb),
      'messages', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id', o.id,
            'conversation_id', o.conversation_id,
            'sender_id', o.sender_id,
            'sender_name', sp.full_name,
            'sender_app_role', case
              when v_conv.kind <> 'GROUP' then null
              else coalesce(
                (
                  select gm.role
                  from public.group_memberships gm
                  where gm.user_id = sp.id
                    and gm.status = 'ACTIVE'
                    and v_viewer_group_id is not null
                    and gm.group_id = v_viewer_group_id
                  limit 1
                ),
                (
                  select gm.role
                  from public.group_memberships gm
                  join public.group_memberships my_gm
                    on my_gm.group_id = gm.group_id
                   and my_gm.user_id = v_uid
                   and my_gm.status = 'ACTIVE'
                  where gm.user_id = sp.id
                    and gm.status = 'ACTIVE'
                  order by case gm.role when 'ADMIN' then 1 when 'TREASURER' then 2 else 3 end
                  limit 1
                ),
                case when sp.role in ('ADMIN', 'TREASURER') then sp.role else 'MEMBER' end
              )
            end,
            'sender_avatar_url', case
              when sp.id = v_uid then sp.avatar_url
              when v_conv.kind = 'DIRECT' then (v_conv_payload ->> 'avatar_url')
              when public.can_view_social_profile(v_uid, sp.id, sp.chat_privacy ->> 'profile_visibility') then sp.avatar_url
              else null
            end,
            'body', case when o.deleted_for_everyone_at is not null then '' else o.body end,
            'message_type', o.message_type,
            'metadata', coalesce(o.metadata, '{}'::jsonb),
            'reply_to_id', o.reply_to_id,
            'reply_preview', (
              select case
                when rm.id is null then null
                else jsonb_build_object(
                  'id', rm.id,
                  'sender_id', rm.sender_id,
                  'sender_name', rp.full_name,
                  'body', case when rm.deleted_for_everyone_at is not null then 'Message removed' else left(nullif(btrim(rm.body), ''), 120) end
                )
              end
              from public.messages rm
              join public.profiles rp on rp.id = rm.sender_id
              where rm.id = o.reply_to_id
                and (rm.vanish_at is null or rm.vanish_at > now())
            ),
            'forwarded_from_id', o.forwarded_from_id,
            'edited_at', o.edited_at,
            'deleted_for_everyone_at', o.deleted_for_everyone_at,
            'pinned_at', o.pinned_at,
            'created_at', o.created_at,
            'vanish_after_seconds', o.vanish_after_seconds,
            'vanish_started_at', o.vanish_started_at,
            'vanish_at', o.vanish_at,
            'delivered_at', case
              when v_conv.kind = 'DIRECT' then (
                select mr.delivered_at from public.message_receipts mr
                where mr.message_id = o.id and mr.user_id = v_peer_id
                limit 1
              )
              when o.sender_id = v_uid then (
                select min(mr.delivered_at) from public.message_receipts mr
                where mr.message_id = o.id and mr.delivered_at is not null
              )
              else null
            end,
            'read_at', case
              when o.sender_id = v_uid and v_share_receipts then
                case
                  when v_conv.kind = 'DIRECT' then (
                    select mr.read_at from public.message_receipts mr
                    where mr.message_id = o.id and mr.user_id = v_peer_id
                    limit 1
                  )
                  else (
                    select min(mr.read_at) from public.message_receipts mr
                    where mr.message_id = o.id and mr.read_at is not null
                  )
                end
              else null
            end,
            'seen_by', case
              when v_conv.kind = 'GROUP' and o.sender_id = v_uid and v_share_receipts then coalesce((
                select jsonb_agg(
                  jsonb_build_object(
                    'id', rp3.id,
                    'full_name', rp3.full_name,
                    'read_at', mr3.read_at
                  ) order by mr3.read_at asc
                )
                from public.message_receipts mr3
                join public.profiles rp3 on rp3.id = mr3.user_id
                where mr3.message_id = o.id
                  and mr3.read_at is not null
              ), '[]'::jsonb)
              else '[]'::jsonb
            end,
            'attachments', case
              when o.deleted_for_everyone_at is not null then '[]'::jsonb
              else coalesce((
                select jsonb_agg(
                  jsonb_build_object(
                    'id', ma.id,
                    'path', ma.storage_path,
                    'name', ma.file_name,
                    'type', ma.mime_type,
                    'size', ma.file_size,
                    'kind', ma.attachment_kind,
                    'width', ma.width,
                    'height', ma.height,
                    'duration_seconds', ma.duration_seconds
                  ) order by ma.created_at asc
                )
                from public.message_attachments ma
                where ma.message_id = o.id
              ), '[]'::jsonb)
            end,
            'reactions', case
              when o.deleted_for_everyone_at is not null then '[]'::jsonb
              else coalesce((
                select jsonb_agg(
                  jsonb_build_object(
                    'user_id', mr2.user_id,
                    'emoji', mr2.emoji,
                    'user_name', rp2.full_name
                  ) order by mr2.created_at asc
                )
                from public.message_reactions mr2
                join public.profiles rp2 on rp2.id = mr2.user_id
                where mr2.message_id = o.id
              ), '[]'::jsonb)
            end
          )
          order by o.created_at asc
        )
        from ordered o
        join public.profiles sp on sp.id = o.sender_id
      ), '[]'::jsonb)
    )
  );
end;
$$;

create or replace function public.search_conversation_messages(
  p_conversation_id uuid default null,
  p_query text default '',
  p_sender_id uuid default null,
  p_limit integer default 40
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.require_messaging_actor();
  v_q text := lower(btrim(coalesce(p_query, '')));
  v_lim integer := greatest(1, least(coalesce(p_limit, 40), 80));
begin
  if v_q = '' and p_sender_id is null then
    return '[]'::jsonb;
  end if;

  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'message_id', m.id,
        'conversation_id', m.conversation_id,
        'kind', c.kind,
        'sender_id', m.sender_id,
        'sender_name', sp.full_name,
        'peer_id', case when c.kind = 'GROUP' then c.id else peer.id end,
        'peer_name', case when c.kind = 'GROUP' then c.title else peer.full_name end,
        'peer_avatar', case when c.kind = 'GROUP' then c.avatar_url else peer.avatar_url end,
        'body', left(m.body, 220),
        'created_at', m.created_at
      )
      order by m.created_at desc
    )
    from (
      select m.*
      from public.messages m
      join public.conversations c on c.id = m.conversation_id
      left join public.conversation_participants cp on cp.conversation_id = c.id and cp.user_id = v_uid
      where public.is_conversation_member(c.id, v_uid)
        and (p_conversation_id is null or m.conversation_id = p_conversation_id)
        and m.deleted_for_everyone_at is null
        and (m.vanish_at is null or m.vanish_at > now())
        and m.message_type not in ('CALL_EVENT', 'SYSTEM')
        and not (v_uid = any(m.deleted_for_user_ids))
        and (cp.deleted_before_at is null or m.created_at > cp.deleted_before_at)
        and c.status <> 'DECLINED'
        and (p_sender_id is null or m.sender_id = p_sender_id)
        and (
          v_q = ''
          or lower(m.body) like '%' || v_q || '%'
          or exists (
            select 1 from public.message_attachments ma
            where ma.message_id = m.id and lower(ma.file_name) like '%' || v_q || '%'
          )
        )
      order by m.created_at desc
      limit v_lim
    ) m
    join public.conversations c on c.id = m.conversation_id
    join public.profiles sp on sp.id = m.sender_id
    left join public.profiles peer on c.kind = 'DIRECT' and peer.id = case when c.user_a = v_uid then c.user_b else c.user_a end
    where (
      c.kind = 'GROUP'
      or (peer.id is not null and peer.role in ('ADMIN', 'TREASURER', 'MEMBER') and not public.is_user_blocked_between(v_uid, peer.id))
    )
  ), '[]'::jsonb);
end;
$$;

insert into public.schema_migrations (version, name)
values ('20261121_144', 'vanishing_messages')
on conflict (version) do nothing;

notify pgrst, 'reload schema';
commit;
