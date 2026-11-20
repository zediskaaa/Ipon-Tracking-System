-- Expose savings workspace role (ADMIN / TREASURER / MEMBER) for group chat members and senders
begin;

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
            ),
            'forwarded_from_id', o.forwarded_from_id,
            'edited_at', o.edited_at,
            'deleted_for_everyone_at', o.deleted_for_everyone_at,
            'pinned_at', o.pinned_at,
            'created_at', o.created_at,
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

revoke all on function public.get_conversation_messages(uuid, timestamptz, integer, uuid) from public, anon;
grant execute on function public.get_conversation_messages(uuid, timestamptz, integer, uuid) to authenticated;

insert into public.schema_migrations (version, name)
values ('20261120_140', 'group_chat_member_roles')
on conflict (version) do nothing;

notify pgrst, 'reload schema';

commit;
