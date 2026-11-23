import 'jsr:@supabase/functions-js/edge-runtime.d.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' }
  });

const ALLOWED_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
  'tiktok.com',
  'www.tiktok.com',
  'm.tiktok.com',
  'vt.tiktok.com',
  'vm.tiktok.com',
  'facebook.com',
  'www.facebook.com',
  'm.facebook.com',
  'web.facebook.com',
  'fb.watch'
]);

const YOUTUBE_ID_RE = /^[A-Za-z0-9_-]{11}$/;
const TIKTOK_ID_RE = /^\d{10,24}$/;
const FETCH_TIMEOUT_MS = 6500;
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const FB_CRAWLER_UA =
  'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)';

function parseAllowedUrl(raw: string): URL | null {
  try {
    const u = new URL(String(raw || '').trim());
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    if (u.username || u.password) return null;
    const host = u.hostname.toLowerCase();
    if (!ALLOWED_HOSTS.has(host)) return null;
    u.protocol = 'https:';
    return u;
  } catch {
    return null;
  }
}

function detectProvider(hostname: string): 'youtube' | 'tiktok' | 'facebook' | null {
  const h = hostname.toLowerCase();
  if (h === 'youtu.be' || h.endsWith('youtube.com')) return 'youtube';
  if (h.endsWith('tiktok.com')) return 'tiktok';
  if (h === 'fb.watch' || h.endsWith('facebook.com')) return 'facebook';
  return null;
}

function parseStartSeconds(raw: string | null): number {
  const v = String(raw || '').trim();
  if (!v) return 0;
  if (/^\d+$/.test(v)) return Math.min(86400, Number(v));
  const m = v.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/i);
  if (!m) return 0;
  const total = Number(m[1] || 0) * 3600 + Number(m[2] || 0) * 60 + Number(m[3] || 0);
  return Math.min(86400, Math.max(0, total));
}

function parseYouTube(u: URL) {
  const host = u.hostname.toLowerCase();
  const parts = u.pathname.split('/').filter(Boolean);
  let id = '';
  let isShort = false;
  if (host === 'youtu.be') {
    id = parts[0] || '';
  } else if (parts[0] === 'watch') {
    id = u.searchParams.get('v') || '';
  } else if (parts[0] === 'shorts' || parts[0] === 'embed' || parts[0] === 'live' || parts[0] === 'v') {
    id = parts[1] || '';
    isShort = parts[0] === 'shorts';
  }
  if (!YOUTUBE_ID_RE.test(id)) return null;
  const start = parseStartSeconds(u.searchParams.get('t') || u.searchParams.get('start'));
  const canonicalUrl = isShort
    ? `https://www.youtube.com/shorts/${id}`
    : `https://www.youtube.com/watch?v=${id}`;
  const embedParams = new URLSearchParams({
    rel: '0',
    modestbranding: '1',
    playsinline: '1',
    autoplay: '1'
  });
  if (start > 0) embedParams.set('start', String(start));
  return {
    provider: 'youtube' as const,
    videoId: id,
    canonicalUrl,
    embedUrl: `https://www.youtube-nocookie.com/embed/${id}?${embedParams.toString()}`,
    thumbnailUrl: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    aspect: isShort ? ('portrait' as const) : ('landscape' as const),
    playable: true
  };
}

function extractTikTokVideoId(u: URL): string {
  const m = u.pathname.match(/\/(?:video|photo|embed\/v2|player\/v1)\/(\d{10,24})(?:\/|$)/i);
  if (m && TIKTOK_ID_RE.test(m[1])) return m[1];
  const qItem = u.searchParams.get('item_id') || u.searchParams.get('video_id') || '';
  if (TIKTOK_ID_RE.test(qItem)) return qItem;
  return '';
}

function parseFacebookCanonical(u: URL) {
  const normalized = new URL(u.toString());
  if (normalized.hostname.toLowerCase() !== 'fb.watch') {
    normalized.hostname = 'www.facebook.com';
  }
  const path = normalized.pathname;
  const isReel = /^\/(?:reels?|share\/r)\//i.test(path);
  const isWatch = /^\/watch\/?$/i.test(path) && Boolean(normalized.searchParams.get('v'));
  const isVideoPath = /\/(?:videos|video\.php|watch\/live)/i.test(path)
    || Boolean(normalized.searchParams.get('v'))
    || /^\/share\/v\//i.test(path);
  const isShort = normalized.hostname.toLowerCase() === 'fb.watch' || /^\/share\/[rvp]\//i.test(path);
  if (!isReel && !isWatch && !isVideoPath && !isShort) return null;
  // Strip noisy tracking params while keeping video ID query param `v`
  const vParam = normalized.searchParams.get('v');
  normalized.search = vParam ? `?v=${encodeURIComponent(vParam)}` : '';
  normalized.hash = '';
  const canonicalUrl = normalized.toString();
  return {
    provider: 'facebook' as const,
    canonicalUrl,
    embedUrl: `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(canonicalUrl)}&show_text=false&autoplay=true&mute=0`,
    aspect: isReel ? ('portrait' as const) : ('landscape' as const),
    playable: !isShort
  };
}

async function fetchWithTimeout(url: string, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        'User-Agent': USER_AGENT,
        'Accept-Language': 'en-US,en;q=0.9',
        ...(init.headers || {})
      }
    });
  } finally {
    clearTimeout(timer);
  }
}

async function followAllowedRedirects(
  startUrl: URL,
  maxHops = 5,
  userAgent = USER_AGENT
): Promise<{ finalUrl: URL; htmlSnippet: string }> {
  let current = startUrl;
  let htmlSnippet = '';
  for (let hop = 0; hop < maxHops; hop += 1) {
    const res = await fetchWithTimeout(current.toString(), {
      method: 'GET',
      redirect: 'manual',
      headers: {
        'User-Agent': userAgent,
        Accept: 'text/html,application/xhtml+xml,*/*;q=0.8'
      }
    });
    const loc = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && loc) {
      try { await res.body?.cancel(); } catch { }
      let nextRaw = '';
      try {
        nextRaw = new URL(loc, current).toString();
      } catch {
        break;
      }
      const nextUrl = parseAllowedUrl(nextRaw);
      if (!nextUrl) break;
      current = nextUrl;
      continue;
    }
    const contentType = String(res.headers.get('content-type') || '').toLowerCase();
    if (contentType.includes('text/html') && res.body) {
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let chunks = '';
      try {
        while (chunks.length < 96000) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks += dec.decode(value, { stream: true });
        }
      } catch { } finally {
        try { await reader.cancel(); } catch { }
      }
      htmlSnippet = chunks;
    } else {
      try { await res.body?.cancel(); } catch { }
    }
    break;
  }
  return { finalUrl: current, htmlSnippet };
}

function decodeHtmlEntities(text: string): string {
  return String(text || '')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
      const code = parseInt(hex, 16);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    })
    .replace(/&#(\d+);/g, (_, dec) => {
      const code = parseInt(dec, 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    })
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
}

function readMetaContent(html: string, prop: string): string {
  const esc = prop.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m1 = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${esc}["'][^>]+content=["']([^"']+)["']`, 'i'));
  if (m1?.[1]) return decodeHtmlEntities(m1[1]);
  const m2 = html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${esc}["']`, 'i'));
  if (m2?.[1]) return decodeHtmlEntities(m2[1]);
  return '';
}

function readCanonicalLink(html: string): string {
  const m1 = html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i);
  if (m1?.[1]) return decodeHtmlEntities(m1[1]);
  const m2 = html.match(/<link[^>]+href=["']([^"']+)["'][^>]+rel=["']canonical["']/i);
  if (m2?.[1]) return decodeHtmlEntities(m2[1]);
  return '';
}

function safeHttpsImage(raw: string): string {
  try {
    const u = new URL(String(raw || '').trim());
    if (u.protocol !== 'https:') return '';
    return u.toString();
  } catch {
    return '';
  }
}

function clampAspectRatio(width: number, height: number): number | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  const raw = width / height;
  if (!Number.isFinite(raw) || raw <= 0) return null;
  return Math.round(Math.min(2, Math.max(0.5625, raw)) * 10000) / 10000;
}

function parseImageDimensionsFromBytes(buf: Uint8Array): { width: number; height: number } | null {
  if (!buf || buf.length < 24) return null;
  // PNG: 89 50 4E 47 0D 0A 1A 0A, IHDR width/height at offset 16..23
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const width = dv.getUint32(16, false);
    const height = dv.getUint32(20, false);
    if (width > 0 && height > 0) return { width, height };
  }
  // JPEG: FF D8 ... SOF0/SOF1/SOF2 markers (FF C0 / C1 / C2)
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) {
        i += 1;
        continue;
      }
      while (i + 1 < buf.length && buf[i + 1] === 0xff) i += 1;
      const marker = buf[i + 1];
      if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
        const height = (buf[i + 5] << 8) | buf[i + 6];
        const width = (buf[i + 7] << 8) | buf[i + 8];
        if (width > 0 && height > 0) return { width, height };
        return null;
      }
      if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
        i += 2;
        continue;
      }
      if (i + 3 >= buf.length) break;
      const segLen = (buf[i + 2] << 8) | buf[i + 3];
      if (segLen < 2) break;
      i += 2 + segLen;
    }
  }
  // WebP: RIFF....WEBP
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 && buf.length >= 30) {
    const tag = String.fromCharCode(buf[12], buf[13], buf[14], buf[15]);
    if (tag === 'VP8X') {
      const width = 1 + (buf[24] | (buf[25] << 8) | (buf[26] << 16));
      const height = 1 + (buf[27] | (buf[28] << 8) | (buf[29] << 16));
      if (width > 0 && height > 0) return { width, height };
    } else if (tag === 'VP8 ' && buf.length >= 30) {
      const width = (buf[26] | (buf[27] << 8)) & 0x3fff;
      const height = (buf[28] | (buf[29] << 8)) & 0x3fff;
      if (width > 0 && height > 0) return { width, height };
    }
  }
  return null;
}

async function probeImageDimensions(imageUrl: string): Promise<{ width: number; height: number } | null> {
  if (!imageUrl) return null;
  try {
    const res = await fetchWithTimeout(imageUrl, {
      method: 'GET',
      headers: { Range: 'bytes=0-32767' }
    });
    if (!res.ok || !res.body) {
      try { await res.body?.cancel(); } catch { }
      return null;
    }
    const reader = res.body.getReader();
    const parts: Uint8Array[] = [];
    let total = 0;
    try {
      while (total < 32768) {
        const { done, value } = await reader.read();
        if (done || !value) break;
        parts.push(value);
        total += value.byteLength;
      }
    } catch { } finally {
      try { await reader.cancel(); } catch { }
    }
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const part of parts) {
      merged.set(part, offset);
      offset += part.byteLength;
    }
    return parseImageDimensionsFromBytes(merged);
  } catch {
    return null;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON request body.' }, 400);
  }

  const rawUrl = String(body.url || '').trim();
  if (!rawUrl || rawUrl.length > 2048) {
    return json({ error: 'A valid social video URL is required.' }, 400);
  }

  const parsed = parseAllowedUrl(rawUrl);
  if (!parsed) {
    return json({ error: 'Unsupported or disallowed URL host.' }, 400);
  }

  const provider = detectProvider(parsed.hostname);
  if (!provider) {
    return json({ error: 'Only YouTube, TikTok, and Facebook video links are supported.' }, 400);
  }

  try {
    if (provider === 'youtube') {
      const yt = parseYouTube(parsed);
      if (!yt) return json({ error: 'Unable to recognize YouTube video ID.' }, 422);
      let title = '';
      let author = '';
      let thumbnailUrl = yt.thumbnailUrl;
      let aspectRatio = yt.aspect === 'portrait' ? 0.5625 : 1.7778;
      let aspect: 'portrait' | 'landscape' = yt.aspect;
      try {
        const oe = await fetchWithTimeout(
          `https://www.youtube.com/oembed?url=${encodeURIComponent(yt.canonicalUrl)}&format=json`
        );
        if (oe.ok) {
          const data = await oe.json();
          title = String(data?.title || '').trim().slice(0, 180);
          author = String(data?.author_name || '').trim().slice(0, 90);
          const safeThumb = safeHttpsImage(String(data?.thumbnail_url || ''));
          if (safeThumb) thumbnailUrl = safeThumb;
          if (yt.aspect !== 'portrait') {
            const ratio = clampAspectRatio(Number(data?.width), Number(data?.height));
            if (ratio) {
              aspectRatio = ratio;
              aspect = ratio < 0.85 ? 'portrait' : 'landscape';
            }
          }
        }
      } catch { }
      return json({
        ok: true,
        provider: 'youtube',
        videoId: yt.videoId,
        canonicalUrl: yt.canonicalUrl,
        embedUrl: yt.embedUrl,
        aspect,
        aspectRatio,
        title,
        author,
        thumbnailUrl,
        playable: true
      });
    }

    if (provider === 'tiktok') {
      let targetUrl = parsed;
      let videoId = extractTikTokVideoId(parsed);
      let htmlSnippet = '';
      if (!videoId) {
        const followed = await followAllowedRedirects(parsed, 5);
        targetUrl = followed.finalUrl;
        htmlSnippet = followed.htmlSnippet;
        videoId = extractTikTokVideoId(targetUrl);
        if (!videoId && htmlSnippet) {
          const canonicalRaw = readCanonicalLink(htmlSnippet) || readMetaContent(htmlSnippet, 'og:url');
          const canonicalUrlObj = canonicalRaw ? parseAllowedUrl(canonicalRaw) : null;
          if (canonicalUrlObj) {
            targetUrl = canonicalUrlObj;
            videoId = extractTikTokVideoId(canonicalUrlObj);
          }
          if (!videoId) {
            const idMatch = htmlSnippet.match(/"(?:itemId|videoId|aweme_id)"\s*:\s*"(\d{10,24})"/i)
              || htmlSnippet.match(/\/video\/(\d{10,24})/i);
            if (idMatch?.[1]) videoId = idMatch[1];
          }
        }
      }

      const canonicalUrl = videoId
        ? (extractTikTokVideoId(targetUrl) ? targetUrl.origin + targetUrl.pathname : `https://www.tiktok.com/video/${videoId}`)
        : targetUrl.toString();

      let title = '';
      let author = '';
      let thumbnailUrl = '';
      let aspectRatio = 0.5625;
      let aspect: 'portrait' | 'landscape' = 'portrait';
      try {
        const oe = await fetchWithTimeout(
          `https://www.tiktok.com/oembed?url=${encodeURIComponent(canonicalUrl)}`
        );
        if (oe.ok) {
          const data = await oe.json();
          title = String(data?.title || '').trim().slice(0, 180);
          author = String(data?.author_name || '').trim().slice(0, 90);
          thumbnailUrl = safeHttpsImage(String(data?.thumbnail_url || ''));
          const ratio = clampAspectRatio(Number(data?.thumbnail_width), Number(data?.thumbnail_height));
          if (ratio) {
            aspectRatio = ratio;
            aspect = ratio < 0.85 ? 'portrait' : 'landscape';
          }
          if (!videoId) {
            const oeId = String(data?.embed_product_id || '').trim();
            if (TIKTOK_ID_RE.test(oeId)) videoId = oeId;
          }
        }
      } catch { }

      if (!videoId) {
        return json({
          ok: true,
          provider: 'tiktok',
          videoId: '',
          canonicalUrl,
          embedUrl: '',
          aspect,
          aspectRatio,
          title: title || readMetaContent(htmlSnippet, 'og:title').slice(0, 180),
          author,
          thumbnailUrl,
          playable: false
        });
      }

      return json({
        ok: true,
        provider: 'tiktok',
        videoId,
        canonicalUrl,
        embedUrl: `https://www.tiktok.com/player/v1/${videoId}?autoplay=1&music_info=1&description=1`,
        aspect,
        aspectRatio,
        title,
        author,
        thumbnailUrl,
        playable: true
      });
    }

    // Facebook (public reels, videos, watch links, fb.watch & /share/r/ or /share/v/ shortlinks)
    let fbUrl = parsed;
    let htmlSnippet = '';
    const isShortPath = (u: URL) =>
      u.hostname.toLowerCase() === 'fb.watch' || /^\/share\/[rvp]\//i.test(u.pathname);

    // Facebook returns HTTP 400 to plain script Chrome UAs on /share/ links; its official preview crawler UA receives the 302 + OpenGraph metadata.
    const followed = await followAllowedRedirects(parsed, 5, FB_CRAWLER_UA);
    fbUrl = followed.finalUrl;
    htmlSnippet = followed.htmlSnippet;

    if (isShortPath(fbUrl)) {
      const canonicalRaw = readCanonicalLink(htmlSnippet) || readMetaContent(htmlSnippet, 'og:url');
      const canonicalObj = canonicalRaw ? parseAllowedUrl(canonicalRaw) : null;
      if (canonicalObj && detectProvider(canonicalObj.hostname) === 'facebook' && !isShortPath(canonicalObj)) {
        fbUrl = canonicalObj;
      }
    }
    if (isShortPath(fbUrl) && htmlSnippet) {
      const reelMatch = htmlSnippet.match(/https?:\\?\/\\?\/(?:www\.|m\.)?facebook\.com\\?\/reel\\?\/(\d{8,24})/i);
      const vidMatch = htmlSnippet.match(/https?:\\?\/\\?\/(?:www\.|m\.)?facebook\.com\\?\/[^"'\s\\]+\\?\/videos\\?\/(\d{8,24})/i);
      const extracted = reelMatch?.[1]
        ? `https://www.facebook.com/reel/${reelMatch[1]}/`
        : (vidMatch?.[1] ? `https://www.facebook.com/watch/?v=${vidMatch[1]}` : '');
      const extractedObj = extracted ? parseAllowedUrl(extracted) : null;
      if (extractedObj) fbUrl = extractedObj;
    }

    const fb = parseFacebookCanonical(fbUrl);
    const ogTitle = readMetaContent(htmlSnippet, 'og:title')
      .replace(/\s*\|\s*Facebook\s*$/i, '')
      .trim()
      .slice(0, 180);
    const rawOgImage = safeHttpsImage(readMetaContent(htmlSnippet, 'og:image'));
    const fbThumb = (() => {
      if (!rawOgImage) return '';
      try {
        const u = new URL(rawOgImage);
        return /\.fbcdn\.net$/i.test(u.hostname) ? rawOgImage : '';
      } catch {
        return '';
      }
    })();

    const dims = fbThumb ? await probeImageDimensions(fbThumb) : null;
    const probedRatio = dims ? clampAspectRatio(dims.width, dims.height) : null;
    const fbAspectRatio = probedRatio ?? (fb?.aspect === 'portrait' ? 0.5625 : 1.7778);
    const fbAspect: 'portrait' | 'landscape' = probedRatio
      ? (probedRatio < 0.85 ? 'portrait' : 'landscape')
      : (fb?.aspect || 'landscape');

    if (!fb || !fb.playable) {
      return json({
        ok: true,
        provider: 'facebook',
        canonicalUrl: fb?.canonicalUrl || fbUrl.toString(),
        embedUrl: '',
        aspect: fbAspect,
        aspectRatio: fbAspectRatio,
        title: ogTitle,
        author: '',
        thumbnailUrl: fbThumb,
        playable: false
      });
    }

    return json({
      ok: true,
      provider: 'facebook',
      canonicalUrl: fb.canonicalUrl,
      embedUrl: fb.embedUrl,
      aspect: fbAspect,
      aspectRatio: fbAspectRatio,
      title: ogTitle,
      author: '',
      thumbnailUrl: fbThumb,
      playable: true
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unable to resolve social link.';
    return json({ error: message }, 502);
  }
});
