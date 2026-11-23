import 'jsr:@supabase/functions-js/edge-runtime.d.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, HEAD, OPTIONS'
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
  'fb.watch',
  'x.com',
  'www.x.com',
  'mobile.x.com',
  'twitter.com',
  'www.twitter.com',
  'mobile.twitter.com',
  'm.twitter.com',
  'fxtwitter.com',
  'www.fxtwitter.com',
  'vxtwitter.com',
  'www.vxtwitter.com',
  'fixupx.com',
  'www.fixupx.com',
  'fixvx.com',
  'www.fixvx.com',
  'instagram.com',
  'www.instagram.com',
  'm.instagram.com',
  'instagr.am',
  'www.instagr.am'
]);

const ALLOWED_PROXY_MEDIA_HOSTS = [
  /^video\.twimg\.com$/i,
  /\.fbcdn\.net$/i,
  /\.cdninstagram\.com$/i
];

const YOUTUBE_ID_RE = /^[A-Za-z0-9_-]{11}$/;
const TIKTOK_ID_RE = /^\d{10,24}$/;
const X_STATUS_ID_RE = /^\d{5,22}$/;
const IG_SHORTCODE_RE = /^[A-Za-z0-9_-]{5,40}$/;
const FETCH_TIMEOUT_MS = 7000;
const MEDIA_STREAM_TTL_MS = 2 * 60 * 60 * 1000;
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const FB_CRAWLER_UA =
  'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)';

type Provider = 'youtube' | 'tiktok' | 'facebook' | 'x' | 'instagram';

function timingSafeEqual(a: string, b: string): boolean {
  if (!a || !b) return false;
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i += 1) diff |= ab[i] ^ bb[i];
  return diff === 0;
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function isAllowedProxyMediaUrl(raw: string): boolean {
  try {
    const u = new URL(String(raw || '').trim());
    if (u.protocol !== 'https:') return false;
    if (u.username || u.password) return false;
    return ALLOWED_PROXY_MEDIA_HOSTS.some((re) => re.test(u.hostname));
  } catch {
    return false;
  }
}

async function signMediaProxyUrl(mediaUrl: string, reqUrl: string): Promise<string> {
  const secret = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  if (!secret || !isAllowedProxyMediaUrl(mediaUrl)) return '';
  const exp = Date.now() + MEDIA_STREAM_TTL_MS;
  const sig = await hmacHex(secret, `${mediaUrl}:${exp}`);
  const supabaseOrigin = (Deno.env.get('SUPABASE_URL') || new URL(reqUrl).origin).replace(/\/+$/, '');
  return `${supabaseOrigin}/functions/v1/resolve-social-embed?media=${encodeURIComponent(mediaUrl)}&exp=${exp}&sig=${sig}`;
}

async function verifyCallerAuth(req: Request): Promise<boolean> {
  const authHeader = String(req.headers.get('authorization') || '').trim();
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) return false;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  const supabaseUrl = (Deno.env.get('SUPABASE_URL') || '').replace(/\/+$/, '');
  if ((anonKey && timingSafeEqual(token, anonKey)) || (serviceKey && timingSafeEqual(token, serviceKey))) {
    return true;
  }
  if (!supabaseUrl || !anonKey) return false;
  try {
    const r = await fetchWithTimeout(`${supabaseUrl}/auth/v1/user`, {
      method: 'GET',
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${token}`
      }
    });
    try { await r.body?.cancel(); } catch { }
    return r.ok;
  } catch {
    return false;
  }
}

async function handleSignedMediaProxy(req: Request): Promise<Response> {
  const secret = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  const u = new URL(req.url);
  const mediaUrl = String(u.searchParams.get('media') || '').trim();
  const expRaw = String(u.searchParams.get('exp') || '').trim();
  const sig = String(u.searchParams.get('sig') || '').trim().toLowerCase();
  const exp = Number(expRaw);

  if (!secret || !mediaUrl || !Number.isFinite(exp) || !sig) {
    return json({ error: 'Missing media stream signature.' }, 400);
  }
  if (Date.now() > exp || exp > Date.now() + MEDIA_STREAM_TTL_MS + 60_000) {
    return json({ error: 'Media stream link has expired.' }, 403);
  }
  if (!isAllowedProxyMediaUrl(mediaUrl)) {
    return json({ error: 'Disallowed media stream host.' }, 403);
  }
  const expected = await hmacHex(secret, `${mediaUrl}:${expRaw}`);
  if (!timingSafeEqual(sig, expected)) {
    return json({ error: 'Invalid media stream signature.' }, 403);
  }

  const upstreamHeaders: Record<string, string> = {
    'User-Agent': USER_AGENT,
    Accept: '*/*'
  };
  const range = req.headers.get('range');
  if (range) upstreamHeaders.Range = range;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const upstream = await fetch(mediaUrl, {
      method: req.method === 'HEAD' ? 'HEAD' : 'GET',
      redirect: 'manual',
      signal: controller.signal,
      headers: upstreamHeaders
    });
    clearTimeout(timer);

    if (upstream.status !== 200 && upstream.status !== 206) {
      try { await upstream.body?.cancel(); } catch { }
      return json({ error: `Upstream media returned HTTP ${upstream.status}.` }, upstream.status === 404 ? 404 : 502);
    }

    const contentType = String(upstream.headers.get('content-type') || 'video/mp4').toLowerCase();
    const isVideoType = contentType.startsWith('video/')
      || (contentType.startsWith('application/octet-stream') && /\.mp4(?:\?|$)/i.test(mediaUrl));
    if (!isVideoType) {
      try { await upstream.body?.cancel(); } catch { }
      return json({ error: 'Upstream media is not a supported video stream.' }, 415);
    }

    const resHeaders = new Headers({
      ...cors,
      'Content-Type': contentType.startsWith('video/') ? contentType : 'video/mp4',
      'Accept-Ranges': upstream.headers.get('accept-ranges') || 'bytes',
      'Cache-Control': 'private, max-age=1800',
      'Cross-Origin-Resource-Policy': 'cross-origin',
      'X-Content-Type-Options': 'nosniff'
    });
    const contentLength = upstream.headers.get('content-length');
    const contentRange = upstream.headers.get('content-range');
    if (contentLength) resHeaders.set('Content-Length', contentLength);
    if (contentRange) resHeaders.set('Content-Range', contentRange);

    return new Response(req.method === 'HEAD' ? null : upstream.body, {
      status: upstream.status,
      headers: resHeaders
    });
  } catch (err) {
    clearTimeout(timer);
    const msg = err instanceof Error ? err.message : 'Unable to stream social video.';
    return json({ error: msg }, 502);
  }
}

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

function detectProvider(hostname: string): Provider | null {
  const h = hostname.toLowerCase();
  if (h === 'youtu.be' || h.endsWith('youtube.com')) return 'youtube';
  if (h.endsWith('tiktok.com')) return 'tiktok';
  if (h === 'fb.watch' || h.endsWith('facebook.com')) return 'facebook';
  if (
    h === 'x.com' || h.endsWith('.x.com')
    || h === 'twitter.com' || h.endsWith('.twitter.com')
    || h === 'fxtwitter.com' || h.endsWith('.fxtwitter.com')
    || h === 'vxtwitter.com' || h.endsWith('.vxtwitter.com')
    || h === 'fixupx.com' || h.endsWith('.fixupx.com')
    || h === 'fixvx.com' || h.endsWith('.fixvx.com')
  ) return 'x';
  if (
    h === 'instagram.com' || h.endsWith('.instagram.com')
    || h === 'instagr.am' || h.endsWith('.instagr.am')
  ) return 'instagram';
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
    autoplay: '1',
    mute: '0'
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

function parseXStatus(u: URL): { statusId: string; userHint: string; canonicalUrl: string } | null {
  const m = u.pathname.match(/^\/(?:i\/web|i|[A-Za-z0-9_]{1,30})\/status(?:es)?\/(\d{5,22})(?:\/|$)/i);
  if (!m || !X_STATUS_ID_RE.test(m[1])) return null;
  const statusId = m[1];
  const parts = u.pathname.split('/').filter(Boolean);
  const first = parts[0] || '';
  const userHint = first && first.toLowerCase() !== 'i' ? first : '';
  const canonicalUrl = userHint
    ? `https://x.com/${userHint}/status/${statusId}`
    : `https://x.com/i/status/${statusId}`;
  return { statusId, userHint, canonicalUrl };
}

function parseInstagramPath(u: URL): {
  shortcode: string;
  kind: 'reel' | 'p' | 'tv';
  isShare: boolean;
  canonicalUrl: string;
} | null {
  const path = u.pathname;
  if (/^\/share\/(?:reel|p|tv)?\/?[A-Za-z0-9_-]{4,}/i.test(path)) {
    return {
      shortcode: '',
      kind: /^\/share\/reel\//i.test(path) ? 'reel' : 'p',
      isShare: true,
      canonicalUrl: u.toString()
    };
  }
  const m = path.match(/^\/(?:[A-Za-z0-9._]{1,40}\/)?(reel|reels|p|tv)\/([A-Za-z0-9_-]{5,40})(?:\/|$)/i);
  if (!m || !IG_SHORTCODE_RE.test(m[2])) return null;
  const rawKind = m[1].toLowerCase();
  const kind: 'reel' | 'p' | 'tv' = rawKind === 'reels' ? 'reel' : (rawKind as 'reel' | 'p' | 'tv');
  const shortcode = m[2];
  return {
    shortcode,
    kind,
    isShare: false,
    canonicalUrl: `https://www.instagram.com/${kind === 'reel' ? 'reel' : kind}/${shortcode}/`
  };
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
  const vParam = normalized.searchParams.get('v');
  normalized.search = vParam ? `?v=${encodeURIComponent(vParam)}` : '';
  normalized.hash = '';
  const canonicalUrl = normalized.toString();
  return {
    provider: 'facebook' as const,
    canonicalUrl,
    embedUrl: `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(canonicalUrl)}&show_text=false`,
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

function safeImageOnHosts(raw: string, patterns: RegExp[]): string {
  const clean = safeHttpsImage(raw);
  if (!clean) return '';
  try {
    const u = new URL(clean);
    return patterns.some((re) => re.test(u.hostname)) ? clean : '';
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
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const width = dv.getUint32(16, false);
    const height = dv.getUint32(20, false);
    if (width > 0 && height > 0) return { width, height };
  }
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

function cleanSocialCaption(raw: string, maxLen = 180): string {
  return String(raw || '')
    .replace(/https?:\/\/t\.co\/[A-Za-z0-9]+/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen);
}

function pickBestXVariant(variants: unknown): string {
  if (!Array.isArray(variants)) return '';
  const mp4s = variants
    .filter((v): v is { url?: string; content_type?: string; bitrate?: number } =>
      Boolean(v && typeof v === 'object' && String((v as { content_type?: string }).content_type || '').toLowerCase() === 'video/mp4')
    )
    .filter((v) => isAllowedProxyMediaUrl(String(v.url || '')))
    .sort((a, b) => Number(b.bitrate || 0) - Number(a.bitrate || 0));
  return mp4s[0]?.url ? String(mp4s[0].url) : '';
}

async function resolveXVideo(parsed: URL, reqUrl: string) {
  const xInfo = parseXStatus(parsed);
  if (!xInfo) return json({ error: 'Unable to recognize X post ID.' }, 422);

  let canonicalUrl = xInfo.canonicalUrl;
  let title = '';
  let author = '';
  let thumbnailUrl = '';
  let rawVideoUrl = '';
  let aspectRatio = 1.7778;
  let aspect: 'portrait' | 'landscape' = 'landscape';
  let isGif = false;
  let unavailableReason: 'private' | 'restricted' | 'not_video' | 'unavailable' | '' = '';
  let sawTweet = false;

  // 1. Primary: FxTwitter public status JSON API (returns direct video.twimg.com MP4 + dims + privacy status)
  try {
    const fxRes = await fetchWithTimeout(`https://api.fxtwitter.com/status/${xInfo.statusId}`, {
      headers: { Accept: 'application/json' }
    });
    const fxData = await fxRes.json().catch(() => null);
    const fxCode = Number(fxData?.code || fxRes.status || 0);
    const fxMsg = String(fxData?.message || '').toUpperCase();

    if (fxCode === 401 || fxMsg.includes('PRIVATE') || fxMsg.includes('PROTECTED')) {
      unavailableReason = 'private';
    } else if (fxRes.ok && fxData?.tweet) {
      sawTweet = true;
      const tweet = fxData.tweet;
      const screenName = String(tweet?.author?.screen_name || xInfo.userHint || '').trim();
      if (screenName) {
        author = `@${screenName}`.slice(0, 90);
        canonicalUrl = `https://x.com/${screenName}/status/${xInfo.statusId}`;
      }
      title = cleanSocialCaption(String(tweet?.text || ''));
      const ownVideos = Array.isArray(tweet?.media?.videos) ? tweet.media.videos : [];
      const ownPhotos = Array.isArray(tweet?.media?.photos) ? tweet.media.photos : [];
      const quoteVideos = !ownVideos.length && !ownPhotos.length && Array.isArray(tweet?.quote?.media?.videos)
        ? tweet.quote.media.videos
        : [];
      const primaryVideo = ownVideos[0] || quoteVideos[0] || null;

      if (primaryVideo) {
        const directCandidate = String(primaryVideo.url || '').trim();
        const variantCandidate = pickBestXVariant(primaryVideo.variants);
        rawVideoUrl = isAllowedProxyMediaUrl(directCandidate) ? directCandidate : variantCandidate;
        isGif = String(primaryVideo.type || '').toLowerCase() === 'gif';
        thumbnailUrl = safeImageOnHosts(String(primaryVideo.thumbnail_url || ''), [/^pbs\.twimg\.com$/i]);
        const ratio = clampAspectRatio(Number(primaryVideo.width), Number(primaryVideo.height));
        if (ratio) {
          aspectRatio = ratio;
          aspect = ratio < 0.85 ? 'portrait' : 'landscape';
        }
      } else {
        thumbnailUrl = safeImageOnHosts(String(ownPhotos[0]?.url || ''), [/^pbs\.twimg\.com$/i]);
        unavailableReason = 'not_video';
      }
    } else if (fxCode === 404 || fxMsg.includes('NOT_FOUND')) {
      unavailableReason = 'unavailable';
    }
  } catch { }

  // 2. Fallback: Official X syndication endpoint (when FxTwitter missed or couldn't return MP4)
  if (!rawVideoUrl && unavailableReason !== 'private') {
    try {
      const token = ((Number(xInfo.statusId) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, '');
      const synRes = await fetchWithTimeout(
        `https://cdn.syndication.twimg.com/tweet-result?id=${xInfo.statusId}&lang=en&token=${encodeURIComponent(token)}`,
        { headers: { Accept: 'application/json' } }
      );
      if (synRes.ok) {
        const sd = await synRes.json().catch(() => null);
        if (sd?.tombstone) {
          const tombText = String(sd.tombstone?.text?.text || '').toLowerCase();
          unavailableReason = /limits who can view|protected|private|age-restricted|sensitive/i.test(tombText)
            ? 'private'
            : 'unavailable';
        } else if (sd && (sd.id_str || sd.text || sd.user || Array.isArray(sd.mediaDetails))) {
          sawTweet = true;
          if (!author && sd.user?.screen_name) {
            const sn = String(sd.user.screen_name).trim();
            author = `@${sn}`.slice(0, 90);
            canonicalUrl = `https://x.com/${sn}/status/${xInfo.statusId}`;
          }
          if (!title && sd.text) title = cleanSocialCaption(String(sd.text));
          const mediaList = Array.isArray(sd.mediaDetails) ? sd.mediaDetails : [];
          const vidMedia = mediaList.find((m: Record<string, unknown>) =>
            m && (m.type === 'video' || m.type === 'animated_gif')
          );
          if (vidMedia) {
            rawVideoUrl = pickBestXVariant(vidMedia.video_info?.variants);
            isGif = vidMedia.type === 'animated_gif';
            if (!thumbnailUrl) {
              thumbnailUrl = safeImageOnHosts(String(vidMedia.media_url_https || ''), [/^pbs\.twimg\.com$/i]);
            }
            const ratio = clampAspectRatio(
              Number(vidMedia.original_info?.width),
              Number(vidMedia.original_info?.height)
            );
            if (ratio) {
              aspectRatio = ratio;
              aspect = ratio < 0.85 ? 'portrait' : 'landscape';
            }
            if (rawVideoUrl) unavailableReason = '';
          } else if (!unavailableReason) {
            unavailableReason = 'not_video';
          }
        }
      }
    } catch { }
  }

  if (rawVideoUrl && isAllowedProxyMediaUrl(rawVideoUrl)) {
    const proxiedUrl = await signMediaProxyUrl(rawVideoUrl, reqUrl);
    if (proxiedUrl) {
      return json({
        ok: true,
        provider: 'x',
        mediaMode: 'video',
        videoId: xInfo.statusId,
        canonicalUrl,
        videoUrl: proxiedUrl,
        embedUrl: '',
        aspect,
        aspectRatio,
        title,
        author,
        thumbnailUrl,
        isGif,
        playable: true
      });
    }
  }

  return json({
    ok: true,
    provider: 'x',
    mediaMode: 'video',
    videoId: xInfo.statusId,
    canonicalUrl,
    videoUrl: '',
    embedUrl: '',
    aspect,
    aspectRatio,
    title,
    author,
    thumbnailUrl,
    playable: false,
    unavailableReason: unavailableReason || (sawTweet ? 'not_video' : 'unavailable')
  });
}

async function resolveInstagramVideo(parsed: URL, reqUrl: string) {
  let targetUrl = parsed;
  let ig = parseInstagramPath(parsed);
  if (!ig) return json({ error: 'Unable to recognize Instagram reel or post link.' }, 422);

  // Follow mobile /share/ shortlinks or instagr.am redirects using Meta preview crawler UA
  if (ig.isShare || parsed.hostname.toLowerCase().endsWith('instagr.am')) {
    const followed = await followAllowedRedirects(parsed, 5, FB_CRAWLER_UA);
    targetUrl = followed.finalUrl;
    let nextIg = parseInstagramPath(targetUrl);
    if ((!nextIg || nextIg.isShare) && followed.htmlSnippet) {
      const canonicalRaw = readCanonicalLink(followed.htmlSnippet) || readMetaContent(followed.htmlSnippet, 'og:url');
      const canonicalObj = canonicalRaw ? parseAllowedUrl(canonicalRaw) : null;
      if (canonicalObj && detectProvider(canonicalObj.hostname) === 'instagram') {
        const parsedCanonical = parseInstagramPath(canonicalObj);
        if (parsedCanonical && !parsedCanonical.isShare) {
          targetUrl = canonicalObj;
          nextIg = parsedCanonical;
        }
      }
    }
    if (nextIg && !nextIg.isShare) ig = nextIg;
  }

  const defaultAspect: 'portrait' | 'landscape' = ig.kind === 'reel' ? 'portrait' : 'landscape';
  const defaultRatio = ig.kind === 'reel' ? 0.5625 : 1;

  if (!ig.shortcode) {
    return json({
      ok: true,
      provider: 'instagram',
      mediaMode: 'video',
      videoId: '',
      canonicalUrl: targetUrl.toString(),
      videoUrl: '',
      embedUrl: '',
      aspect: defaultAspect,
      aspectRatio: defaultRatio,
      title: '',
      author: '',
      thumbnailUrl: '',
      playable: false,
      unavailableReason: 'private'
    });
  }

  let title = '';
  let author = '';
  let thumbnailUrl = '';
  let rawVideoUrl = '';
  let aspectRatio = defaultRatio;
  let aspect: 'portrait' | 'landscape' = defaultAspect;
  let unavailableReason: 'private' | 'restricted' | 'not_video' | 'unavailable' | '' = '';
  let isReel = ig.kind === 'reel';

  // Fetch official Instagram embed/captioned endpoint which returns structured contextJSON (gql_data.shortcode_media)
  const embedPageUrl = `https://www.instagram.com/p/${encodeURIComponent(ig.shortcode)}/embed/captioned/`;
  let embedHtml = '';
  try {
    const res = await fetchWithTimeout(embedPageUrl, {
      method: 'GET',
      headers: {
        'User-Agent': FB_CRAWLER_UA,
        Accept: 'text/html,application/xhtml+xml,*/*;q=0.8'
      }
    });
    if (res.ok) {
      embedHtml = await res.text();
    } else {
      try { await res.body?.cancel(); } catch { }
    }
  } catch { }

  const ctxMatch = embedHtml.match(/"contextJSON"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (ctxMatch?.[1]) {
    try {
      const unescaped = JSON.parse(`"${ctxMatch[1]}"`);
      const payload = JSON.parse(unescaped);
      const ctx = payload?.context || {};
      const sm = payload?.gql_data?.shortcode_media;

      if (sm && typeof sm === 'object') {
        const ownerUsername = String(sm?.owner?.username || '').trim();
        if (ownerUsername) author = `@${ownerUsername}`.slice(0, 90);
        const cap = sm?.edge_media_to_caption?.edges?.[0]?.node?.text || '';
        title = cleanSocialCaption(String(cap));

        const igThumbHosts = [/\.fbcdn\.net$/i, /\.cdninstagram\.com$/i];
        thumbnailUrl = safeImageOnHosts(String(sm.display_url || sm.thumbnail_src || ''), igThumbHosts);

        let vidWidth = Number(sm?.dimensions?.width || 0);
        let vidHeight = Number(sm?.dimensions?.height || 0);

        if (sm.is_video && sm.video_url) {
          rawVideoUrl = String(sm.video_url).trim();
        } else if (Array.isArray(sm?.edge_sidecar_to_children?.edges)) {
          const vidChild = sm.edge_sidecar_to_children.edges
            .map((e: { node?: Record<string, unknown> }) => e?.node)
            .find((n: Record<string, unknown> | undefined) => Boolean(n?.is_video && n?.video_url));
          if (vidChild) {
            rawVideoUrl = String(vidChild.video_url || '').trim();
            if (vidChild.display_url) {
              const childThumb = safeImageOnHosts(String(vidChild.display_url), igThumbHosts);
              if (childThumb) thumbnailUrl = childThumb;
            }
            const childDims = vidChild.dimensions as { width?: number; height?: number } | undefined;
            if (childDims?.width && childDims?.height) {
              vidWidth = Number(childDims.width);
              vidHeight = Number(childDims.height);
            }
          }
        }

        const ratio = clampAspectRatio(vidWidth, vidHeight);
        if (ratio) {
          aspectRatio = ratio;
          aspect = ratio < 0.85 ? 'portrait' : 'landscape';
          if (ratio < 0.85) isReel = true;
        }

        if (!rawVideoUrl) {
          if (sm?.owner?.is_private === true) {
            unavailableReason = 'private';
          } else if (ctx?.copyright_blocked === true || sm.is_video === true) {
            unavailableReason = 'restricted';
          } else {
            unavailableReason = 'not_video';
          }
        }
      }
    } catch { }
  }

  if (!rawVideoUrl && !unavailableReason) {
    if (ig.shortcode.length > 28 || /\bprivate\b|private account|account is private/i.test(embedHtml)) {
      unavailableReason = 'private';
    } else if (/WatchOnInstagram|restricted|age-gated|copyright/i.test(embedHtml)) {
      unavailableReason = 'restricted';
    } else {
      unavailableReason = 'unavailable';
    }
  }

  const canonicalUrl = isReel
    ? `https://www.instagram.com/reel/${ig.shortcode}/`
    : `https://www.instagram.com/p/${ig.shortcode}/`;

  if (rawVideoUrl && isAllowedProxyMediaUrl(rawVideoUrl)) {
    const fallbackVideoUrl = await signMediaProxyUrl(rawVideoUrl, reqUrl);
    return json({
      ok: true,
      provider: 'instagram',
      mediaMode: 'video',
      videoId: ig.shortcode,
      canonicalUrl,
      videoUrl: rawVideoUrl,
      fallbackVideoUrl,
      embedUrl: '',
      aspect,
      aspectRatio,
      title,
      author,
      thumbnailUrl,
      playable: true
    });
  }

  return json({
    ok: true,
    provider: 'instagram',
    mediaMode: 'video',
    videoId: ig.shortcode,
    canonicalUrl,
    videoUrl: '',
    embedUrl: '',
    aspect,
    aspectRatio,
    title,
    author,
    thumbnailUrl,
    playable: false,
    unavailableReason: unavailableReason || 'unavailable'
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  if (req.method === 'GET' || req.method === 'HEAD') {
    return await handleSignedMediaProxy(req);
  }

  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

  const authorized = await verifyCallerAuth(req);
  if (!authorized) {
    return json({ error: 'Authentication required to resolve social links.' }, 401);
  }

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
    return json({ error: 'Only YouTube, TikTok, Facebook, X, and Instagram video links are supported.' }, 400);
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

      if (htmlSnippet && (!title || !thumbnailUrl || aspectRatio === 0.5625)) {
        try {
          const rehy = htmlSnippet.match(/<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/i);
          if (rehy?.[1]) {
            const parsedRehy = JSON.parse(rehy[1]);
            const item = parsedRehy?.__DEFAULT_SCOPE__?.['webapp.video-detail']?.itemInfo?.itemStruct;
            if (item) {
              if (!title && item.desc) title = String(item.desc).trim().slice(0, 180);
              if (!author && item.author?.uniqueId) author = `@${String(item.author.uniqueId).trim()}`.slice(0, 90);
              if (!thumbnailUrl) {
                const cover = safeHttpsImage(String(item.video?.cover || item.video?.originCover || ''));
                if (cover) thumbnailUrl = cover;
              }
              const realRatio = clampAspectRatio(Number(item.video?.width), Number(item.video?.height));
              if (realRatio) {
                aspectRatio = realRatio;
                aspect = realRatio < 0.85 ? 'portrait' : 'landscape';
              }
            }
          }
        } catch { }
      }

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
          playable: false,
          unavailableReason: 'private'
        });
      }

      return json({
        ok: true,
        provider: 'tiktok',
        videoId,
        canonicalUrl,
        embedUrl: `https://www.tiktok.com/player/v1/${videoId}?autoplay=1&muted=0&loop=1&rel=0&controls=1&music_info=1&description=1`,
        aspect,
        aspectRatio,
        title,
        author,
        thumbnailUrl,
        playable: true
      });
    }

    if (provider === 'x') {
      return await resolveXVideo(parsed, req.url);
    }

    if (provider === 'instagram') {
      return await resolveInstagramVideo(parsed, req.url);
    }

    // Facebook (public reels, videos, watch links, fb.watch & /share/r/ or /share/v/ shortlinks)
    let fbUrl = parsed;
    let htmlSnippet = '';
    const isShortPath = (u: URL) =>
      u.hostname.toLowerCase() === 'fb.watch' || /^\/share\/[rvp]\//i.test(u.pathname);

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
    const fbThumb = safeImageOnHosts(readMetaContent(htmlSnippet, 'og:image'), [/\.fbcdn\.net$/i]);

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
        playable: false,
        unavailableReason: 'private'
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
