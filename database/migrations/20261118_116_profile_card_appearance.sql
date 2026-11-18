begin;

alter table public.profiles
  add column if not exists card_theme text not null default 'emerald',
  add column if not exists cover_url text;

alter table public.profiles drop constraint if exists profiles_card_theme_check;
alter table public.profiles add constraint profiles_card_theme_check
  check (card_theme in ('emerald', 'midnight', 'rose', 'amber', 'ocean', 'mono'));

create or replace function public.get_profile_card_appearance(p_target_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_profile public.profiles%rowtype;
begin
  if auth.uid() is null then raise exception 'Sign in required.' using errcode = '28000'; end if;
  select * into v_profile from public.profiles
  where id = p_target_id and status = 'ACTIVE'
    and (id = auth.uid() or role in ('ADMIN', 'TREASURER', 'MEMBER'));
  if not found then raise exception 'Profile not found.' using errcode = 'P0002'; end if;
  return jsonb_build_object('card_theme', v_profile.card_theme, 'cover_url', v_profile.cover_url);
end $$;

create or replace function public.update_own_profile_card(p_theme text default null, p_cover_url text default null, p_clear_cover boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_profile public.profiles%rowtype;
begin
  if auth.uid() is null then raise exception 'Sign in required.' using errcode = '28000'; end if;
  if p_theme is not null and p_theme not in ('emerald', 'midnight', 'rose', 'amber', 'ocean', 'mono') then
    raise exception 'Invalid card color.' using errcode = '22023';
  end if;
  if p_cover_url is not null and (
    length(p_cover_url) > 500 or
    p_cover_url !~ ('^https://woslmwokhhyszkgevnli\.supabase\.co/storage/v1/object/public/ipon-media/covers/' || auth.uid()::text || '/[a-f0-9-]+\.(jpg|png|webp)$')
  ) then raise exception 'Invalid cover photo.' using errcode = '22023'; end if;
  if p_clear_cover and p_cover_url is not null then raise exception 'Invalid cover update.' using errcode = '22023'; end if;
  update public.profiles set
    card_theme = coalesce(p_theme, card_theme),
    cover_url = case when p_clear_cover then null else coalesce(p_cover_url, cover_url) end
  where id = auth.uid() and status = 'ACTIVE'
  returning * into v_profile;
  if not found then raise exception 'Profile not found.' using errcode = 'P0002'; end if;
  return jsonb_build_object('card_theme', v_profile.card_theme, 'cover_url', v_profile.cover_url);
end $$;

revoke execute on function public.get_profile_card_appearance(uuid) from public, anon;
revoke execute on function public.update_own_profile_card(text, text, boolean) from public, anon;
grant execute on function public.get_profile_card_appearance(uuid) to authenticated;
grant execute on function public.update_own_profile_card(text, text, boolean) to authenticated;

create or replace function public.queue_replaced_profile_cover()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.cover_url is not null and (tg_op = 'DELETE' or new.cover_url is distinct from old.cover_url) then
    perform public.queue_media_url_deletion(old.cover_url);
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

drop trigger if exists profiles_cover_cleanup on public.profiles;
create trigger profiles_cover_cleanup after update or delete on public.profiles
  for each row execute function public.queue_replaced_profile_cover();

insert into public.schema_migrations (version, name)
values ('20261118_116', 'profile card cover photo and color theme')
on conflict (version) do nothing;

notify pgrst, 'reload schema';

commit;
