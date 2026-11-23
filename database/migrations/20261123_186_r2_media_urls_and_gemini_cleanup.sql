-- Migration 186: Extend ipon-media URL validation & cleanup extraction to support Cloudflare R2 media URLs,
-- and remove any stored Gemini API key row from internal_webhook_config.

begin;

create or replace function public.extract_ipon_media_path(p_url text)
returns text
language sql
immutable
as $$
  select case
    when p_url is null then null
    when p_url ~ '^https://[a-z0-9.-]+/storage/v1/object/public/ipon-media/'
      then nullif(btrim(split_part(regexp_replace(p_url, '^https://[a-z0-9.-]+/storage/v1/object/public/ipon-media/', ''), '?', 1)), '')
    when p_url ~ '^https://[a-z0-9.-]+/functions/v1/manage-account\?media=(avatars|covers|group-avatars|group-qr|receipts|bug-reports)/[0-9a-f-]{36}/r2/[a-zA-Z0-9._-]+$'
      then nullif(btrim(regexp_replace(p_url, '^https://[a-z0-9.-]+/functions/v1/manage-account\?media=', '')), '')
    else null
  end;
$$;

create or replace function public.is_valid_media_reference(p_url text)
returns boolean
language sql
immutable
as $$
  select
    p_url is null
    or (p_url ~ '^data:image/' and char_length(p_url) <= 600000)
    or (p_url ~ '^https://[a-z0-9.-]+/storage/v1/object/public/ipon-media/' and char_length(p_url) <= 500)
    or (
      p_url ~ '^https://[a-z0-9.-]+/functions/v1/manage-account\?media=(avatars|covers|group-avatars|group-qr|receipts|bug-reports)/[0-9a-f-]{36}/r2/[a-zA-Z0-9._-]+$'
      and char_length(p_url) <= 500
    );
$$;

create or replace function public.update_own_profile_card(
  p_theme text default null,
  p_cover_url text default null,
  p_clear_cover boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Sign in required.' using errcode = '28000';
  end if;
  if p_theme is not null and p_theme not in ('emerald', 'midnight', 'rose', 'amber', 'ocean', 'mono') then
    raise exception 'Invalid card color.' using errcode = '22023';
  end if;
  if p_cover_url is not null and (
    length(p_cover_url) > 500 or not (
      p_cover_url ~ ('^https://woslmwokhhyszkgevnli\.supabase\.co/storage/v1/object/public/ipon-media/covers/' || auth.uid()::text || '/[a-f0-9-]+\.(jpg|png|webp|gif)$')
      or p_cover_url ~ ('^https://woslmwokhhyszkgevnli\.supabase\.co/functions/v1/manage-account\?media=covers/' || auth.uid()::text || '/r2/[a-f0-9-]+\.(jpg|png|webp|gif)$')
    )
  ) then
    raise exception 'Invalid cover photo.' using errcode = '22023';
  end if;
  if p_clear_cover and p_cover_url is not null then
    raise exception 'Invalid cover update.' using errcode = '22023';
  end if;

  update public.profiles
  set card_theme = coalesce(p_theme, card_theme),
      cover_url = case when p_clear_cover then null else coalesce(p_cover_url, cover_url) end
  where id = auth.uid()
    and status = 'ACTIVE'
  returning * into v_profile;

  if not found then
    raise exception 'Profile not found.' using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'card_theme', v_profile.card_theme,
    'cover_url', v_profile.cover_url,
    'profile_effect', coalesce(v_profile.equipped_profile_effect, 'none')
  );
end;
$$;

revoke execute on function public.update_own_profile_card(text, text, boolean) from public, anon;
grant execute on function public.update_own_profile_card(text, text, boolean) to authenticated;

delete from public.internal_webhook_config
where key = 'gemini_api_key';

insert into public.schema_migrations (version, name)
values ('20261123_186', 'r2 media urls and gemini config cleanup')
on conflict (version) do nothing;

notify pgrst, 'reload schema';

commit;
