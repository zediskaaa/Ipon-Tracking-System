-- Limit user profile short bio to 58 characters across table constraint and RPCs
begin;

update public.profiles
set bio = nullif(btrim(left(btrim(bio), 58)), ''),
    updated_at = now()
where bio is not null
  and (char_length(btrim(bio)) > 58 or bio <> btrim(bio));

alter table public.profiles
  drop constraint if exists profiles_bio_length_check;

alter table public.profiles
  add constraint profiles_bio_length_check
  check (bio is null or char_length(btrim(bio)) <= 58);

create or replace function public.update_own_social_identity(
  p_username text default null,
  p_bio text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_username text := nullif(lower(btrim(coalesce(p_username, ''))), '');
  v_bio text := nullif(btrim(coalesce(p_bio, '')), '');
begin
  if v_uid is null or not public.mfa_access_allowed() then
    raise exception 'Sign in and complete security verification first.' using errcode = '42501';
  end if;

  if v_username is not null and v_username !~ '^[a-z0-9_]{3,24}$' then
    raise exception 'Username must be 3-24 characters using lowercase letters, numbers, or underscores.' using errcode = '22023';
  end if;

  if v_bio is not null and char_length(v_bio) > 58 then
    raise exception 'Bio must be 58 characters or fewer.' using errcode = '22023';
  end if;

  update public.profiles
  set username = v_username,
      bio = v_bio,
      updated_at = now()
  where id = v_uid
    and status = 'ACTIVE';

  if not found then
    raise exception 'Active profile not found.' using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'username', v_username,
    'bio', v_bio
  );
exception
  when unique_violation then
    raise exception 'That username is already taken.' using errcode = '23505';
end;
$$;

revoke all on function public.update_own_social_identity(text, text) from public, anon;
grant execute on function public.update_own_social_identity(text, text) to authenticated;

create or replace function public.update_social_profile_and_privacy(
  p_username text default '__KEEP__',
  p_bio text default '__KEEP__',
  p_chat_privacy jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.require_messaging_actor();
  v_keep_username boolean := (p_username = '__KEEP__');
  v_keep_bio boolean := (p_bio = '__KEEP__');
  v_username text := case when p_username = '__KEEP__' then null else nullif(lower(btrim(coalesce(p_username, ''))), '') end;
  v_bio text := case when p_bio = '__KEEP__' then null else nullif(btrim(coalesce(p_bio, '')), '') end;
  v_existing_username text;
  v_existing_bio text;
  v_existing jsonb;
  v_next jsonb;
  v_friend_req text;
  v_msg_req text;
begin
  if not v_keep_username and v_username is not null and v_username !~ '^[a-z0-9_]{3,24}$' then
    raise exception 'Username must be 3-24 characters using lowercase letters, numbers, or underscores.' using errcode = '22023';
  end if;

  if not v_keep_bio and v_bio is not null and char_length(v_bio) > 58 then
    raise exception 'Bio must be 58 characters or fewer.' using errcode = '22023';
  end if;

  select username, bio, coalesce(chat_privacy, '{}'::jsonb)
  into v_existing_username, v_existing_bio, v_existing
  from public.profiles
  where id = v_uid;

  v_next := v_existing;
  if p_chat_privacy is not null and jsonb_typeof(p_chat_privacy) = 'object' then
    v_friend_req := upper(coalesce(p_chat_privacy ->> 'allow_friend_requests', v_existing ->> 'allow_friend_requests', 'EVERYONE'));
    if v_friend_req not in ('EVERYONE', 'MUTUAL_GROUPS', 'NOBODY') then
      v_friend_req := 'EVERYONE';
    end if;
    v_msg_req := upper(coalesce(p_chat_privacy ->> 'allow_message_requests', v_existing ->> 'allow_message_requests', 'EVERYONE'));
    if v_msg_req not in ('EVERYONE', 'FRIENDS_ONLY') then
      v_msg_req := 'EVERYONE';
    end if;
    v_next := jsonb_build_object(
      'show_online', coalesce((p_chat_privacy ->> 'show_online')::boolean, coalesce((v_existing ->> 'show_online')::boolean, true)),
      'show_last_seen', coalesce((p_chat_privacy ->> 'show_last_seen')::boolean, coalesce((v_existing ->> 'show_last_seen')::boolean, true)),
      'read_receipts', coalesce((p_chat_privacy ->> 'read_receipts')::boolean, coalesce((v_existing ->> 'read_receipts')::boolean, true)),
      'allow_friend_requests', v_friend_req,
      'allow_message_requests', v_msg_req
    );
  end if;

  update public.profiles
  set username = case when v_keep_username then v_existing_username else v_username end,
      bio = case when v_keep_bio then v_existing_bio else v_bio end,
      chat_privacy = v_next,
      updated_at = now()
  where id = v_uid;

  return jsonb_build_object(
    'username', case when v_keep_username then v_existing_username else v_username end,
    'bio', case when v_keep_bio then v_existing_bio else v_bio end,
    'chat_privacy', v_next
  );
exception
  when unique_violation then
    raise exception 'That username is already taken.' using errcode = '23505';
end;
$$;

revoke all on function public.update_social_profile_and_privacy(text, text, jsonb) from public, anon;
grant execute on function public.update_social_profile_and_privacy(text, text, jsonb) to authenticated;

insert into public.schema_migrations (version, name)
values ('20261118_127', 'bio_max_58_chars')
on conflict (version) do nothing;

notify pgrst, 'reload schema';

commit;
