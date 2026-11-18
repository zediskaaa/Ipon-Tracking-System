-- Preserve custom drag-and-drop bio order of connected social apps inside profiles.social_links._order
begin;

create or replace function public.sanitize_social_app_links(
  p_links jsonb,
  p_strict boolean default false
)
returns jsonb
language plpgsql
immutable
set search_path = public
as $$
declare
  v_keys constant text[] := array['telegram', 'instagram', 'facebook', 'threads', 'discord'];
  v_key text;
  v_val jsonb;
  v_raw text;
  v_handle text;
  v_url text;
  v_host text;
  v_path text;
  v_allowed boolean;
  v_out jsonb := '{}'::jsonb;
  v_ord_elem text;
  v_clean_order text[] := '{}'::text[];
begin
  if p_links is null or jsonb_typeof(p_links) = 'null' then
    return '{}'::jsonb;
  end if;

  if jsonb_typeof(p_links) <> 'object' then
    if p_strict then
      raise exception 'Connected app links must be a JSON object.' using errcode = '22023';
    end if;
    return '{}'::jsonb;
  end if;

  foreach v_key in array v_keys loop
    if not (p_links ? v_key) then
      continue;
    end if;

    v_val := p_links -> v_key;
    if v_val is null or jsonb_typeof(v_val) = 'null' then
      continue;
    end if;

    if jsonb_typeof(v_val) <> 'string' then
      if p_strict then
        raise exception 'Connected app link for % must be text.', v_key using errcode = '22023';
      end if;
      continue;
    end if;

    v_raw := btrim(coalesce(p_links ->> v_key, ''));
    if v_raw = '' then
      continue;
    end if;

    if char_length(v_raw) > 240 or v_raw ~ '[[:cntrl:][:space:]<>"''`\\]' then
      if p_strict then
        raise exception 'Enter a valid % link without spaces or invalid characters.', initcap(v_key) using errcode = '22023';
      end if;
      continue;
    end if;

    if v_raw ~* '^(javascript|data|vbscript|file|blob):' then
      if p_strict then
        raise exception 'Enter a valid % link.', initcap(v_key) using errcode = '22023';
      end if;
      continue;
    end if;

    v_url := null;
    if v_raw ~* '^https?://' then
      v_url := regexp_replace(v_raw, '^https?://', 'https://', 'i');
    elsif v_raw like '//%' then
      v_url := 'https:' || v_raw;
    elsif left(v_raw, 1) = '@' then
      v_handle := substr(v_raw, 2);
      if v_key = 'telegram' and v_handle ~ '^[A-Za-z0-9_]{3,32}$' then
        v_url := 'https://t.me/' || v_handle;
      elsif v_key = 'instagram' and v_handle ~ '^[A-Za-z0-9._]{1,30}$' and position('..' in v_handle) = 0 and left(v_handle, 1) <> '.' and right(v_handle, 1) <> '.' then
        v_url := 'https://www.instagram.com/' || v_handle;
      elsif v_key = 'facebook' and v_handle ~ '^[A-Za-z0-9.]{3,50}$' and position('..' in v_handle) = 0 and left(v_handle, 1) <> '.' and right(v_handle, 1) <> '.' then
        v_url := 'https://www.facebook.com/' || v_handle;
      elsif v_key = 'threads' and v_handle ~ '^[A-Za-z0-9._]{1,30}$' and position('..' in v_handle) = 0 and left(v_handle, 1) <> '.' and right(v_handle, 1) <> '.' then
        v_url := 'https://www.threads.net/@' || v_handle;
      elsif v_key = 'discord' then
        if p_strict then
          raise exception 'For Discord, paste a discord.com/users/... link, discord.gg/... invite, or your numeric Discord User ID.' using errcode = '22023';
        end if;
        continue;
      else
        if p_strict then
          raise exception 'Enter a valid % @username or profile link.', initcap(v_key) using errcode = '22023';
        end if;
        continue;
      end if;
    elsif v_key = 'discord' and v_raw ~ '^[0-9]{15,22}$' then
      v_url := 'https://discord.com/users/' || v_raw;
    elsif v_raw ~* '^(www\.)?(t\.me|telegram\.me|telegram\.dog|instagram\.com|instagr\.am|m\.instagram\.com|facebook\.com|m\.facebook\.com|mbasic\.facebook\.com|web\.facebook\.com|fb\.com|fb\.me|m\.me|threads\.net|threads\.com|discord\.com|discord\.gg|discordapp\.com)(/|\?|$)' then
      v_url := 'https://' || v_raw;
    elsif position('.' in v_raw) = 0 and position('/' in v_raw) = 0 and position(':' in v_raw) = 0 and position('?' in v_raw) = 0 and position('#' in v_raw) = 0 then
      if v_key = 'telegram' and v_raw ~ '^[A-Za-z0-9_]{3,32}$' then
        v_url := 'https://t.me/' || v_raw;
      elsif v_key = 'instagram' and v_raw ~ '^[A-Za-z0-9_]{1,30}$' then
        v_url := 'https://www.instagram.com/' || v_raw;
      elsif v_key = 'facebook' and v_raw ~ '^[A-Za-z0-9]{3,50}$' then
        v_url := 'https://www.facebook.com/' || v_raw;
      elsif v_key = 'threads' and v_raw ~ '^[A-Za-z0-9_]{1,30}$' then
        v_url := 'https://www.threads.net/@' || v_raw;
      elsif v_key = 'discord' then
        if p_strict then
          raise exception 'For Discord, paste a discord.com/users/... link, discord.gg/... invite, or your numeric Discord User ID.' using errcode = '22023';
        end if;
        continue;
      else
        if p_strict then
          raise exception 'Enter a valid % link or @username.', initcap(v_key) using errcode = '22023';
        end if;
        continue;
      end if;
    else
      if p_strict then
        raise exception 'Enter a valid % URL or @username.', initcap(v_key) using errcode = '22023';
      end if;
      continue;
    end if;

    v_host := lower(coalesce(substring(v_url from '^https://([^/?#]+)'), ''));
    if v_host = '' or position('@' in v_host) > 0 or position(':' in v_host) > 0 then
      if p_strict then
        raise exception 'Enter a valid % link.', initcap(v_key) using errcode = '22023';
      end if;
      continue;
    end if;

    v_path := coalesce(substring(v_url from '^https://[^/?#]+(.*)$'), '');
    if char_length(btrim(regexp_replace(v_path, '[#?].*$', ''), '/')) = 0 then
      if p_strict then
        raise exception 'Include your % profile path after the domain.', initcap(v_key) using errcode = '22023';
      end if;
      continue;
    end if;

    v_allowed := case v_key
      when 'telegram' then v_host in ('t.me', 'www.t.me', 'telegram.me', 'www.telegram.me', 'telegram.dog')
      when 'instagram' then v_host in ('instagram.com', 'www.instagram.com', 'm.instagram.com', 'instagr.am', 'www.instagr.am')
      when 'facebook' then v_host in ('facebook.com', 'www.facebook.com', 'm.facebook.com', 'mbasic.facebook.com', 'web.facebook.com', 'fb.com', 'www.fb.com', 'fb.me', 'm.me')
      when 'threads' then v_host in ('threads.net', 'www.threads.net', 'threads.com', 'www.threads.com')
      when 'discord' then v_host in ('discord.com', 'www.discord.com', 'discord.gg', 'www.discord.gg', 'discordapp.com', 'www.discordapp.com')
      else false
    end;

    if not v_allowed then
      if p_strict then
        raise exception '% link must use an official % domain.', initcap(v_key), initcap(v_key) using errcode = '22023';
      end if;
      continue;
    end if;

    v_url := 'https://' || v_host || v_path;
    v_out := v_out || jsonb_build_object(v_key, v_url);
  end loop;

  if v_out <> '{}'::jsonb then
    if (p_links ? '_order') and jsonb_typeof(p_links -> '_order') = 'array' then
      for v_ord_elem in
        select jsonb_array_elements_text(p_links -> '_order')
      loop
        v_ord_elem := lower(btrim(coalesce(v_ord_elem, '')));
        if v_ord_elem = any(v_keys)
           and (v_out ? v_ord_elem)
           and not (v_ord_elem = any(v_clean_order)) then
          v_clean_order := array_append(v_clean_order, v_ord_elem);
        end if;
      end loop;
    end if;

    foreach v_key in array v_keys loop
      if (v_out ? v_key) and not (v_key = any(v_clean_order)) then
        v_clean_order := array_append(v_clean_order, v_key);
      end if;
    end loop;

    v_out := v_out || jsonb_build_object('_order', to_jsonb(v_clean_order));
  end if;

  return v_out;
end;
$$;

revoke all on function public.sanitize_social_app_links(jsonb, boolean) from public, anon;
grant execute on function public.sanitize_social_app_links(jsonb, boolean) to authenticated;

insert into public.schema_migrations (version, name)
values ('20261118_123', 'social_app_order')
on conflict (version) do nothing;

notify pgrst, 'reload schema';

commit;
