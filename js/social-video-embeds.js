(() => {
  'use strict';

  const YOUTUBE_ID_RE = /^[A-Za-z0-9_-]{11}$/;
  const TIKTOK_ID_RE = /^\d{10,24}$/;
  const X_STATUS_ID_RE = /^\d{5,22}$/;
  const IG_SHORTCODE_RE = /^[A-Za-z0-9_-]{5,40}$/;
  const URL_TOKEN_RE = /https?:\/\/[^\s<>"']+/gi;
  const DIRECT_MEDIA_TTL_MS = 18 * 60 * 1000;

  const ALLOWED_EMBED_HOSTS = new Set([
    'www.youtube-nocookie.com',
    'www.youtube.com',
    'www.tiktok.com',
    'www.facebook.com',
    'web.facebook.com',
    'www.instagram.com'
  ]);

  const ALLOWED_THUMB_HOSTS = [
    /^i\.ytimg\.com$/i,
    /^i\d\.ytimg\.com$/i,
    /\.tiktokcdn(?:-us|-eu)?\.com$/i,
    /\.fbcdn\.net$/i,
    /^pbs\.twimg\.com$/i,
    /\.cdninstagram\.com$/i
  ];

  const ALLOWED_VIDEO_HOSTS = [
    /^video\.twimg\.com$/i,
    /\.fbcdn\.net$/i,
    /\.cdninstagram\.com$/i
  ];

  const X_HOSTS = new Set([
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
    'www.fixvx.com'
  ]);

  const IG_HOSTS = new Set([
    'instagram.com',
    'www.instagram.com',
    'm.instagram.com',
    'instagr.am',
    'www.instagr.am'
  ]);

  const PROVIDER_META = Object.freeze({
    youtube: { label: 'YouTube', shortLabel: 'YouTube Shorts', accent: 'youtube' },
    tiktok: { label: 'TikTok', shortLabel: 'TikTok', accent: 'tiktok' },
    facebook: { label: 'Facebook', shortLabel: 'Facebook Reel', accent: 'facebook' },
    x: { label: 'X', shortLabel: 'X Video', accent: 'x' },
    instagram: { label: 'Instagram', shortLabel: 'Instagram Reel', accent: 'instagram' }
  });

  const PROVIDER_ICONS = Object.freeze({
    youtube: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.6 12 3.6 12 3.6s-7.5 0-9.4.5A3 3 0 0 0 .5 6.2 31.4 31.4 0 0 0 0 12a31.4 31.4 0 0 0 .5 5.8 3 3 0 0 0 2.1 2.1c1.9.5 9.4.5 9.4.5s7.5 0 9.4-.5a3 3 0 0 0 2.1-2.1A31.4 31.4 0 0 0 24 12a31.4 31.4 0 0 0-.5-5.8ZM9.6 15.6V8.4l6.3 3.6-6.3 3.6Z"/></svg>',
    tiktok: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.89-2.89 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1V9.01a6.27 6.27 0 0 0-.79-.05 6.34 6.34 0 0 0-6.34 6.34 6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.33-6.34V8.7a8.18 8.18 0 0 0 4.78 1.52V6.77a4.85 4.85 0 0 1-1.01-.08Z"/></svg>',
    facebook: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M24 12.07C24 5.41 18.63 0 12 0S0 5.41 0 12.07c0 6.02 4.39 11.01 10.13 11.93v-8.44H7.08v-3.49h3.05V9.41c0-3.02 1.79-4.69 4.53-4.69 1.31 0 2.68.24 2.68.24v2.96h-1.51c-1.49 0-1.95.93-1.95 1.88v2.27h3.33l-.53 3.49h-2.8V24C19.61 23.08 24 18.09 24 12.07Z"/></svg>',
    x: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>',
    instagram: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2.16c3.2 0 3.58.01 4.85.07 1.17.05 1.8.25 2.23.41.56.22.96.48 1.38.9.42.42.68.82.9 1.38.16.43.36 1.06.41 2.23.06 1.27.07 1.65.07 4.85s-.01 3.58-.07 4.85c-.05 1.17-.25 1.8-.41 2.23a3.7 3.7 0 0 1-.9 1.38 3.7 3.7 0 0 1-1.38.9c-.43.16-1.06.36-2.23.41-1.27.06-1.65.07-4.85.07s-3.58-.01-4.85-.07c-1.17-.05-1.8-.25-2.23-.41a3.7 3.7 0 0 1-1.38-.9 3.7 3.7 0 0 1-.9-1.38c-.16-.43-.36-1.06-.41-2.23-.06-1.27-.07-1.65-.07-4.85s.01-3.58.07-4.85c.05-1.17.25-1.8.41-2.23.22-.56.48-.96.9-1.38.42-.42.82-.68 1.38-.9.43-.16 1.06-.36 2.23-.41 1.27-.06 1.65-.07 4.85-.07ZM12 0C8.74 0 8.33.01 7.05.07 5.78.13 4.9.33 4.14.63a5.87 5.87 0 0 0-2.12 1.38A5.87 5.87 0 0 0 .63 4.14C.33 4.9.13 5.78.07 7.05.01 8.33 0 8.74 0 12s.01 3.67.07 4.95c.06 1.27.26 2.15.56 2.91.3.79.72 1.46 1.38 2.12a5.87 5.87 0 0 0 2.12 1.38c.76.3 1.64.5 2.91.56C8.33 23.99 8.74 24 12 24s3.67-.01 4.95-.07c1.27-.06 2.15-.26 2.91-.56a5.87 5.87 0 0 0 2.12-1.38 5.87 5.87 0 0 0 1.38-2.12c.3-.76.5-1.64.56-2.91.06-1.28.07-1.69.07-4.95s-.01-3.67-.07-4.95c-.06-1.27-.26-2.15-.56-2.91a5.87 5.87 0 0 0-1.38-2.12A5.87 5.87 0 0 0 19.86.63C19.1.33 18.22.13 16.95.07 15.67.01 15.26 0 12 0Zm0 5.84A6.16 6.16 0 1 0 18.16 12 6.16 6.16 0 0 0 12 5.84ZM12 16a4 4 0 1 1 4-4 4 4 0 0 1-4 4Zm7.85-10.4a1.44 1.44 0 1 1-1.44-1.44 1.44 1.44 0 0 1 1.44 1.44Z"/></svg>'
  });

  const PLAY_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M8 5.14v13.72a1 1 0 0 0 1.52.85l11.04-6.86a1 1 0 0 0 0-1.7L9.52 4.29A1 1 0 0 0 8 5.14Z"/></svg>';
  const EXTERNAL_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6M10 14 20 4M18 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5"/></svg>';
  const CLOSE_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>';

  const resolveCache = new Map();
  const inflightMap = new Map();

  function clampAspectRatio(raw) {
    const num = Number(raw);
    if (!Number.isFinite(num) || num <= 0) return null;
    return Math.round(Math.min(2, Math.max(0.5625, num)) * 10000) / 10000;
  }

  function applyCardAspect(cardEl, aspectRatio, fallbackAspect) {
    if (!cardEl) return;
    const clamped = clampAspectRatio(aspectRatio);
    const nextAspect = clamped
      ? (clamped < 0.85 ? 'portrait' : 'landscape')
      : (fallbackAspect === 'portrait' ? 'portrait' : 'landscape');
    const ratioToUse = clamped || (nextAspect === 'portrait' ? 0.5625 : 1.7778);
    cardEl.classList.toggle('is-portrait', nextAspect === 'portrait');
    cardEl.classList.toggle('is-landscape', nextAspect !== 'portrait');
    cardEl.dataset.socialAspect = nextAspect;
    cardEl.dataset.socialAspectRatio = String(ratioToUse);
    const stage = cardEl.querySelector?.('.msg-social-stage');
    if (stage?.style?.setProperty) {
      stage.style.setProperty('--social-ar', String(ratioToUse));
    }
    cardEl.closest?.('.msg-bubble')?.classList?.toggle?.('has-social-portrait', nextAspect === 'portrait');
  }

  function escapeHtml(val) {
    return String(val ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function parseStartSeconds(raw) {
    const v = String(raw || '').trim();
    if (!v) return 0;
    if (/^\d+$/.test(v)) return Math.min(86400, Number(v));
    const m = v.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/i);
    if (!m) return 0;
    return Math.min(86400, Math.max(0, Number(m[1] || 0) * 3600 + Number(m[2] || 0) * 60 + Number(m[3] || 0)));
  }

  function isSafeEmbedUrl(rawUrl) {
    try {
      const u = new URL(String(rawUrl || '').trim());
      if (u.protocol !== 'https:') return false;
      const host = u.hostname.toLowerCase();
      if (!ALLOWED_EMBED_HOSTS.has(host)) return false;
      if (host === 'www.youtube-nocookie.com' || host === 'www.youtube.com') {
        return /^\/embed\/[A-Za-z0-9_-]{11}$/.test(u.pathname);
      }
      if (host === 'www.tiktok.com') {
        return /^\/(?:player\/v1|embed\/v2)\/\d{10,24}$/.test(u.pathname);
      }
      if (host === 'www.facebook.com' || host === 'web.facebook.com') {
        return u.pathname === '/plugins/video.php' && Boolean(u.searchParams.get('href'));
      }
      if (host === 'www.instagram.com') {
        return /^\/(?:reel|p|tv)\/[A-Za-z0-9_-]{5,40}\/embed(?:\/captioned)?\/?$/.test(u.pathname);
      }
      return false;
    } catch {
      return false;
    }
  }

  function isSafeVideoUrl(rawUrl) {
    try {
      const u = new URL(String(rawUrl || '').trim());
      if (u.protocol !== 'https:') return false;
      if (u.username || u.password) return false;
      const host = u.hostname.toLowerCase();
      if (ALLOWED_VIDEO_HOSTS.some((re) => re.test(host))) return true;
      if (/^[a-z0-9-]+\.supabase\.co$/i.test(host)
        && u.pathname === '/functions/v1/resolve-social-embed'
        && Boolean(u.searchParams.get('media'))
        && Boolean(u.searchParams.get('exp'))
        && Boolean(u.searchParams.get('sig'))) {
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  function isSafeThumbUrl(rawUrl) {
    try {
      const u = new URL(String(rawUrl || '').trim());
      if (u.protocol !== 'https:') return false;
      return ALLOWED_THUMB_HOSTS.some((re) => re.test(u.hostname));
    } catch {
      return false;
    }
  }

  function cleanUrlToken(token) {
    return String(token || '').trim().replace(/[),.?!;:'"]+$/, '');
  }

  function extractUrls(rawText) {
    const raw = String(rawText || '');
    if (!raw) return [];
    const seen = new Set();
    const out = [];
    for (const m of raw.matchAll(URL_TOKEN_RE)) {
      const href = cleanUrlToken(m[0]);
      if (!href || seen.has(href)) continue;
      seen.add(href);
      out.push(href);
    }
    return out;
  }

  function parseSocialVideoUrl(rawUrl) {
    let u;
    try {
      u = new URL(cleanUrlToken(rawUrl));
    } catch {
      return null;
    }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    if (u.username || u.password) return null;
    const host = u.hostname.toLowerCase();
    const parts = u.pathname.split('/').filter(Boolean);

    // 1. YouTube (watch, youtu.be, shorts, live, embed)
    if (host === 'youtu.be' || host === 'youtube.com' || host === 'www.youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com') {
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
      const qs = new URLSearchParams({ rel: '0', modestbranding: '1', playsinline: '1', autoplay: '1', mute: '0' });
      if (start > 0) qs.set('start', String(start));
      return {
        provider: 'youtube',
        videoId: id,
        rawUrl: u.toString(),
        canonicalUrl: isShort ? `https://www.youtube.com/shorts/${id}` : `https://www.youtube.com/watch?v=${id}`,
        embedUrl: `https://www.youtube-nocookie.com/embed/${id}?${qs.toString()}`,
        videoUrl: '',
        thumbnailUrl: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
        aspect: isShort ? 'portrait' : 'landscape',
        badge: isShort ? PROVIDER_META.youtube.shortLabel : PROVIDER_META.youtube.label,
        needsResolve: false
      };
    }

    // 2. TikTok (full video URLs + mobile share shortlinks vt.tiktok.com / vm.tiktok.com / /t/...)
    if (host === 'tiktok.com' || host === 'www.tiktok.com' || host === 'm.tiktok.com' || host === 'vt.tiktok.com' || host === 'vm.tiktok.com') {
      const idMatch = u.pathname.match(/\/(?:video|photo|embed\/v2|player\/v1)\/(\d{10,24})(?:\/|$)/i);
      const videoId = idMatch && TIKTOK_ID_RE.test(idMatch[1]) ? idMatch[1] : '';
      const isShortlink = !videoId && (host === 'vt.tiktok.com' || host === 'vm.tiktok.com' || parts[0] === 't' || Boolean(parts[0]));
      if (!videoId && !isShortlink) return null;
      return {
        provider: 'tiktok',
        videoId,
        rawUrl: u.toString(),
        canonicalUrl: videoId ? `https://www.tiktok.com${u.pathname}` : u.toString(),
        embedUrl: videoId ? `https://www.tiktok.com/player/v1/${videoId}?autoplay=1&muted=0&loop=1&rel=0&controls=1&music_info=1&description=1` : '',
        videoUrl: '',
        thumbnailUrl: '',
        aspect: 'portrait',
        badge: PROVIDER_META.tiktok.label,
        needsResolve: !videoId
      };
    }

    // 3. Facebook (reels, videos, watch, fb.watch, /share/r/ & /share/v/ shortlinks)
    if (host === 'fb.watch' || host === 'facebook.com' || host === 'www.facebook.com' || host === 'm.facebook.com' || host === 'web.facebook.com') {
      const path = u.pathname;
      const isShortFb = host === 'fb.watch' || /^\/share\/[rvp]\//i.test(path);
      const isReel = /^\/(?:reels?|share\/r)\//i.test(path);
      const isWatch = /^\/watch\/?$/i.test(path) && Boolean(u.searchParams.get('v'));
      const isVideoPath = /\/(?:videos|video\.php|watch\/live)/i.test(path) || Boolean(u.searchParams.get('v'));
      if (!isShortFb && !isReel && !isWatch && !isVideoPath) return null;
      let canonicalUrl = u.toString();
      if (!isShortFb) {
        const norm = new URL(u.toString());
        norm.protocol = 'https:';
        norm.hostname = 'www.facebook.com';
        const vParam = norm.searchParams.get('v');
        norm.search = vParam ? `?v=${encodeURIComponent(vParam)}` : '';
        norm.hash = '';
        canonicalUrl = norm.toString();
      }
      return {
        provider: 'facebook',
        videoId: '',
        rawUrl: u.toString(),
        canonicalUrl,
        embedUrl: isShortFb
          ? ''
          : `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(canonicalUrl)}&show_text=false`,
        videoUrl: '',
        thumbnailUrl: '',
        aspect: isReel ? 'portrait' : 'landscape',
        badge: isReel ? PROVIDER_META.facebook.shortLabel : PROVIDER_META.facebook.label,
        needsResolve: isShortFb
      };
    }

    // 4. X / Twitter (status links on x.com, twitter.com, fxtwitter.com, vxtwitter.com, fixupx.com, fixvx.com)
    if (X_HOSTS.has(host)) {
      if (/\/photo\/\d+(?:\/|$)/i.test(u.pathname)) return null;
      const match = u.pathname.match(/^\/(?:i\/web|i|([A-Za-z0-9_]{1,30}))\/status(?:es)?\/(\d{5,22})(?:\/|$)/i);
      if (!match || !X_STATUS_ID_RE.test(match[2])) return null;
      const userHint = match[1] || '';
      const statusId = match[2];
      const canonicalUrl = userHint
        ? `https://x.com/${userHint}/status/${statusId}`
        : `https://x.com/i/status/${statusId}`;
      return {
        provider: 'x',
        videoId: statusId,
        rawUrl: u.toString(),
        canonicalUrl,
        embedUrl: '',
        videoUrl: '',
        thumbnailUrl: '',
        aspect: 'landscape',
        badge: PROVIDER_META.x.label,
        needsResolve: true
      };
    }

    // 5. Instagram (reels, p, tv, /<user>/reel/, /share/reel/, /share/p/, instagr.am)
    if (IG_HOSTS.has(host)) {
      const path = u.pathname;
      const isShare = /^\/share\/(?:reel|p|tv)?\/?[A-Za-z0-9_-]{4,}/i.test(path);
      const match = path.match(/^\/(?:[A-Za-z0-9._]{1,40}\/)?(reel|reels|p|tv)\/([A-Za-z0-9_-]{5,40})(?:\/|$)/i);
      if (!isShare && (!match || !IG_SHORTCODE_RE.test(match[2]))) return null;
      const rawKind = (match?.[1] || '').toLowerCase();
      const isReel = isShare ? /^\/share\/reel\//i.test(path) : (rawKind === 'reel' || rawKind === 'reels');
      const shortcode = match?.[2] || '';
      const canonicalUrl = shortcode
        ? `https://www.instagram.com/${isReel ? 'reel' : (rawKind || 'p')}/${shortcode}/`
        : u.toString();
      return {
        provider: 'instagram',
        videoId: shortcode,
        rawUrl: u.toString(),
        canonicalUrl,
        embedUrl: '',
        videoUrl: '',
        thumbnailUrl: '',
        aspect: isReel ? 'portrait' : 'landscape',
        aspectRatio: isReel ? 0.5625 : 1,
        badge: isReel ? PROVIDER_META.instagram.shortLabel : PROVIDER_META.instagram.label,
        needsResolve: true
      };
    }

    return null;
  }

  function extractSocialVideoEmbeds(rawText, maxCount = 2) {
    const urls = extractUrls(rawText);
    const out = [];
    for (const href of urls) {
      const parsed = parseSocialVideoUrl(href);
      if (!parsed) continue;
      out.push(parsed);
      if (out.length >= maxCount) break;
    }
    return out;
  }

  function isCachedEntryExpired(entry) {
    if (!entry) return true;
    if ((entry.provider === 'x' || entry.provider === 'instagram') && entry.videoUrl) {
      const age = Date.now() - Number(entry.resolvedAt || 0);
      if (!Number.isFinite(age) || age > DIRECT_MEDIA_TTL_MS) return true;
    }
    return false;
  }

  function getCachedMeta(rawUrl) {
    const key = cleanUrlToken(rawUrl);
    const entry = resolveCache.get(key) || null;
    if (!entry) return null;
    if (isCachedEntryExpired(entry)) {
      resolveCache.delete(key);
      return null;
    }
    return entry;
  }

  function describeUnavailableState(provider, badge, reason) {
    const label = PROVIDER_META[provider]?.label || badge || 'this platform';
    if (reason === 'private') {
      return {
        title: 'Private or protected video',
        body: `This ${label} post is from a private or protected account. Open it directly on ${label} if you have access.`,
        pill: 'Private post',
        sub: `Private or protected · Open on ${label}`,
        openLabel: `Open on ${label}`,
        canRetry: true
      };
    }
    if (reason === 'restricted') {
      return {
        title: `Restricted by ${label}`,
        body: `${label} restricts inline playback for this video due to privacy, age, or audio license settings.`,
        pill: 'Restricted',
        sub: `Playback restricted · Open on ${label}`,
        openLabel: `Open on ${label}`,
        canRetry: true
      };
    }
    if (reason === 'not_video') {
      return {
        title: 'No playable video found',
        body: `This ${label} link does not contain a playable inline video. Open it on ${label} to view the full post.`,
        pill: `View on ${label}`,
        sub: `Post link · Open on ${label}`,
        openLabel: `Open on ${label}`,
        canRetry: false
      };
    }
    return {
      title: 'Inline playback unavailable',
      body: `This ${badge || label} link may be private, removed, or restricted from embedded playback.`,
      pill: 'Unavailable',
      sub: `Open on ${label} to view`,
      openLabel: `Open on ${label}`,
      canRetry: true
    };
  }

  async function resolveSocialEmbed(rawUrl, invokeResolveFn, { force = false } = {}) {
    const key = cleanUrlToken(rawUrl);
    if (!key) return null;
    if (force) resolveCache.delete(key);
    const cached = getCachedMeta(key);
    if (cached) return cached;
    if (inflightMap.has(key)) return inflightMap.get(key);

    const parsed = parseSocialVideoUrl(key);
    if (!parsed) return null;

    const task = (async () => {
      if (typeof invokeResolveFn !== 'function') {
        const localRes = {
          ...parsed,
          title: '',
          author: '',
          videoUrl: '',
          fallbackVideoUrl: '',
          unavailableReason: '',
          resolvedAt: Date.now(),
          playable: Boolean(parsed.embedUrl && isSafeEmbedUrl(parsed.embedUrl))
        };
        if (localRes.playable) resolveCache.set(key, localRes);
        return localRes;
      }
      try {
        const data = await invokeResolveFn(key);
        const remoteEmbed = String(data?.embedUrl || '').trim();
        const safeEmbed = remoteEmbed && isSafeEmbedUrl(remoteEmbed) ? remoteEmbed : parsed.embedUrl;
        const remoteVideo = String(data?.videoUrl || '').trim();
        const safeVideo = remoteVideo && isSafeVideoUrl(remoteVideo) ? remoteVideo : '';
        const remoteFallbackVideo = String(data?.fallbackVideoUrl || '').trim();
        const safeFallbackVideo = remoteFallbackVideo && isSafeVideoUrl(remoteFallbackVideo) ? remoteFallbackVideo : '';
        const safeThumb = isSafeThumbUrl(data?.thumbnailUrl) ? String(data.thumbnailUrl).trim() : parsed.thumbnailUrl;
        const aspectRatio = clampAspectRatio(data?.aspectRatio)
          || clampAspectRatio(Number(data?.width) / Number(data?.height))
          || clampAspectRatio(parsed.aspectRatio)
          || (parsed.aspect === 'portrait' ? 0.5625 : 1.7778);
        const aspect = clampAspectRatio(data?.aspectRatio)
          ? (aspectRatio < 0.85 ? 'portrait' : 'landscape')
          : (data?.aspect === 'portrait' || data?.aspect === 'landscape' ? data.aspect : parsed.aspect);
        const badge = parsed.provider === 'facebook'
          ? (aspect === 'portrait' ? PROVIDER_META.facebook.shortLabel : PROVIDER_META.facebook.label)
          : parsed.provider === 'instagram'
            ? (aspect === 'portrait' ? PROVIDER_META.instagram.shortLabel : PROVIDER_META.instagram.label)
            : parsed.badge;
        const hasPlayableMedia = Boolean(
          (safeVideo && isSafeVideoUrl(safeVideo))
          || (safeEmbed && isSafeEmbedUrl(safeEmbed))
        );
        const merged = {
          ...parsed,
          videoId: String(data?.videoId || parsed.videoId || ''),
          canonicalUrl: String(data?.canonicalUrl || parsed.canonicalUrl || key),
          embedUrl: safeEmbed,
          videoUrl: safeVideo,
          fallbackVideoUrl: safeFallbackVideo,
          thumbnailUrl: safeThumb,
          aspect,
          aspectRatio,
          badge,
          isGif: Boolean(data?.isGif),
          title: String(data?.title || '').trim().slice(0, 180),
          author: String(data?.author || '').trim().slice(0, 90),
          unavailableReason: String(data?.unavailableReason || '').trim(),
          playable: Boolean(hasPlayableMedia && data?.playable !== false),
          resolvedAt: Date.now(),
          needsResolve: false
        };
        resolveCache.set(key, merged);
        return merged;
      } catch (err) {
        if (parsed.embedUrl && isSafeEmbedUrl(parsed.embedUrl)) {
          return { ...parsed, title: '', author: '', videoUrl: '', fallbackVideoUrl: '', unavailableReason: '', playable: true };
        }
        throw err;
      } finally {
        inflightMap.delete(key);
      }
    })();

    inflightMap.set(key, task);
    return task;
  }

  function defaultTitleFor(info) {
    if (info.provider === 'youtube') return 'Play YouTube video';
    if (info.provider === 'tiktok') return 'Play TikTok video';
    if (info.provider === 'x') return 'Play X video';
    if (info.provider === 'instagram') return info.aspect === 'portrait' ? 'Play Instagram Reel' : 'Play Instagram video';
    return info.aspect === 'portrait' ? 'Play Facebook Reel' : 'Play Facebook video';
  }

  function renderSocialEmbedCardHtml(parsed, { compact = false } = {}) {
    if (!parsed || !PROVIDER_META[parsed.provider]) return '';
    const cached = getCachedMeta(parsed.rawUrl);
    const info = cached ? { ...parsed, ...cached } : parsed;
    const iconSvg = PROVIDER_ICONS[info.provider] || '';
    const safeThumb = isSafeThumbUrl(info.thumbnailUrl) ? info.thumbnailUrl : '';
    const aspectRatio = clampAspectRatio(info.aspectRatio) || (info.aspect === 'portrait' ? 0.5625 : 1.7778);
    const aspectCls = info.aspect === 'portrait' ? 'is-portrait' : 'is-landscape';
    const isRestricted = cached && info.playable === false;
    const unavailableInfo = isRestricted ? describeUnavailableState(info.provider, info.badge, info.unavailableReason) : null;
    const titleText = info.title || defaultTitleFor(info);
    const subText = isRestricted
      ? unavailableInfo.sub
      : (info.author
        ? `${info.author} · Plays inside chat`
        : (info.needsResolve ? 'Tap play to load inside chat' : 'Tap play to watch inside chat'));
    const pillText = isRestricted ? unavailableInfo.pill : 'Watch in chat';

    return `<div class="msg-social-card is-${escapeHtml(info.provider)} ${aspectCls}${compact ? ' is-compact' : ''}${isRestricted ? ' is-restricted' : ''}" data-social-embed="1" data-social-provider="${escapeHtml(info.provider)}" data-social-url="${escapeHtml(info.rawUrl)}" data-social-embed-url="${escapeHtml(info.embedUrl || '')}" data-social-aspect="${escapeHtml(info.aspect)}" data-social-aspect-ratio="${escapeHtml(String(aspectRatio))}">
      <div class="msg-social-stage" style="--social-ar:${escapeHtml(String(aspectRatio))}">
        <button type="button" class="msg-social-poster" data-social-play="1" aria-label="Play ${escapeHtml(info.badge)} video inside conversation">
          ${safeThumb ? `<img class="msg-social-thumb" src="${escapeHtml(safeThumb)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ''}
          <span class="msg-social-poster-scrim" aria-hidden="true"></span>
          <span class="msg-social-badge">${iconSvg}<span>${escapeHtml(info.badge)}</span></span>
          <span class="msg-social-play-circle" aria-hidden="true">${PLAY_SVG}</span>
          <span class="msg-social-watch-pill${isRestricted ? ' is-restricted' : ''}">${escapeHtml(pillText)}</span>
        </button>
      </div>
      <div class="msg-social-foot">
        <div class="msg-social-copy">
          <strong class="msg-social-title">${escapeHtml(titleText)}</strong>
          <small class="msg-social-sub">${escapeHtml(subText)}</small>
        </div>
        <a class="msg-social-ext" href="${escapeHtml(info.canonicalUrl || info.rawUrl)}" target="_blank" rel="noopener noreferrer" aria-label="Open on ${escapeHtml(info.badge)}" title="Open on ${escapeHtml(info.badge)}">${EXTERNAL_SVG}</a>
      </div>
    </div>`;
  }

  function renderSocialEmbedsBlockHtml(rawText, opts = {}) {
    const embeds = extractSocialVideoEmbeds(rawText, 2);
    if (!embeds.length) return '';
    return `<div class="msg-social-embeds">${embeds.map((e) => renderSocialEmbedCardHtml(e, opts)).join('')}</div>`;
  }

  let activeSessionToken = 0;

  function teardownStageMedia(cardEl) {
    if (!cardEl) return;
    const oldIframe = cardEl.querySelector?.('iframe');
    if (oldIframe) {
      if (cardEl.dataset?.socialProvider === 'tiktok') {
        try {
          oldIframe.contentWindow?.postMessage?.({ 'x-tiktok-player': true, type: 'pause', value: '' }, 'https://www.tiktok.com');
          oldIframe.contentWindow?.postMessage?.({ 'x-tiktok-player': true, type: 'mute', value: '' }, 'https://www.tiktok.com');
        } catch { }
      }
      try { oldIframe.src = 'about:blank'; } catch { }
      try { oldIframe.remove?.(); } catch { }
    }
    const oldVideo = cardEl.querySelector?.('video');
    if (oldVideo) {
      try { oldVideo.pause?.(); } catch { }
      try { oldVideo.removeAttribute?.('src'); } catch { }
      try { oldVideo.load?.(); } catch { }
      try { oldVideo.remove?.(); } catch { }
    }
  }

  function resetCardToPoster(cardEl) {
    if (!cardEl) return;
    teardownStageMedia(cardEl);
    cardEl.classList?.remove?.('is-playing', 'is-loading');
    const rawUrl = cardEl.dataset?.socialUrl || '';
    const parsed = parseSocialVideoUrl(rawUrl);
    if (!parsed) return;
    const tmp = typeof document !== 'undefined' ? document.createElement('div') : null;
    if (!tmp) return;
    tmp.innerHTML = renderSocialEmbedCardHtml(parsed);
    const fresh = tmp.firstElementChild;
    if (fresh && cardEl.parentNode) {
      cardEl.replaceWith(fresh);
    }
  }

  function stopOtherActivePlayers(scopeEl, exceptCard) {
    if (!exceptCard) activeSessionToken += 1;
    const doc = typeof document !== 'undefined' ? document : null;
    const roots = [];
    if (doc && typeof doc.querySelectorAll === 'function') roots.push(doc);
    if (scopeEl && scopeEl !== doc && typeof scopeEl.querySelectorAll === 'function') roots.push(scopeEl);
    const visited = new Set();
    roots.forEach((root) => {
      root.querySelectorAll('.msg-social-card').forEach((other) => {
        if (other === exceptCard || visited.has(other)) return;
        const isActive = other.classList?.contains?.('is-playing')
          || other.classList?.contains?.('is-loading')
          || Boolean(other.querySelector?.('iframe, video'));
        if (!isActive) return;
        visited.add(other);
        resetCardToPoster(other);
      });
    });
  }

  let tiktokBridgeBound = false;
  function ensureTikTokAudioBridge() {
    if (tiktokBridgeBound || typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
    tiktokBridgeBound = true;
    window.addEventListener('message', (ev) => {
      if (ev.origin !== 'https://www.tiktok.com') return;
      const msg = ev.data;
      if (!msg || typeof msg !== 'object' || msg['x-tiktok-player'] !== true) return;
      if (msg.type !== 'onPlayerReady') return;
      if (typeof document === 'undefined' || !ev.source) return;
      const frames = document.querySelectorAll('.msg-social-card.is-tiktok.is-playing iframe.msg-social-iframe');
      frames.forEach((frame) => {
        if (frame.contentWindow !== ev.source || frame.dataset.tiktokUnmuted === '1') return;
        frame.dataset.tiktokUnmuted = '1';
        try {
          frame.contentWindow.postMessage({ 'x-tiktok-player': true, type: 'unMute', value: '' }, 'https://www.tiktok.com');
          frame.contentWindow.postMessage({ 'x-tiktok-player': true, type: 'play', value: '' }, 'https://www.tiktok.com');
        } catch { }
      });
    });
  }

  function renderUnavailableFallback(stage, parsed, resolved, rawUrl) {
    const openHref = resolved?.canonicalUrl || rawUrl;
    const info = describeUnavailableState(parsed.provider, resolved?.badge || parsed.badge, resolved?.unavailableReason);
    stage.innerHTML = `<div class="msg-social-fallback" role="alert">
      <strong>${escapeHtml(info.title)}</strong>
      <p>${escapeHtml(info.body)}</p>
      <div class="msg-social-fallback-actions">
        ${info.canRetry ? '<button type="button" class="button button-secondary button-sm" data-social-play="1" data-social-force-resolve="1">Try again</button>' : ''}
        <a class="button button-primary button-sm" href="${escapeHtml(openHref)}" target="_blank" rel="noopener noreferrer">${escapeHtml(info.openLabel)}</a>
      </div>
    </div>`;
  }

  async function activateSocialPlayer(cardEl, invokeResolveFn, { scopeEl = null, forceResolve = false } = {}) {
    if (!cardEl) return false;
    ensureTikTokAudioBridge();
    const rawUrl = cardEl.dataset.socialUrl || '';
    const parsed = parseSocialVideoUrl(rawUrl);
    if (!parsed) return false;

    const myToken = ++activeSessionToken;
    const targetScope = scopeEl || cardEl.closest?.('#msg-messages-list');
    stopOtherActivePlayers(targetScope, cardEl);

    const stage = cardEl.querySelector('.msg-social-stage');
    if (!stage) return false;

    let resolved = forceResolve ? null : getCachedMeta(rawUrl);
    let wasFromCache = Boolean(resolved);
    const directPlayable = Boolean(!parsed.needsResolve && parsed.embedUrl && isSafeEmbedUrl(parsed.embedUrl));

    if (!resolved || (!resolved.embedUrl && !resolved.videoUrl && resolved.playable !== false)) {
      if (!directPlayable || forceResolve) {
        cardEl.classList.add('is-loading');
        stage.innerHTML = `<div class="msg-social-loading" role="status" aria-live="polite"><span class="msg-social-spinner" aria-hidden="true"></span><span>Loading ${escapeHtml(parsed.badge)} player…</span></div>`;
        try {
          resolved = await resolveSocialEmbed(rawUrl, invokeResolveFn, { force: forceResolve });
          wasFromCache = false;
        } catch {
          resolved = null;
        } finally {
          cardEl.classList.remove('is-loading');
        }
        if (myToken !== activeSessionToken || cardEl.isConnected === false) {
          if (cardEl.isConnected !== false) resetCardToPoster(cardEl);
          return false;
        }
      } else {
        resolved = { ...parsed, playable: true };
        if (typeof invokeResolveFn === 'function') {
          resolveSocialEmbed(rawUrl, invokeResolveFn).then((meta) => {
            if (!meta || !cardEl.isConnected) return;
            const titleEl = cardEl.querySelector('.msg-social-title');
            const subEl = cardEl.querySelector('.msg-social-sub');
            if (meta.title && titleEl) titleEl.textContent = meta.title;
            if (meta.author && subEl) subEl.textContent = `${meta.author} · Playing inside chat`;
          }).catch(() => { });
        }
      }
    }

    if (myToken !== activeSessionToken) {
      resetCardToPoster(cardEl);
      return false;
    }

    const videoUrl = String(resolved?.videoUrl || '').trim();
    const fallbackVideoUrl = String(resolved?.fallbackVideoUrl || '').trim();
    const embedUrl = String(resolved?.embedUrl || '').trim();
    const canPlayNativeVideo = Boolean(videoUrl && isSafeVideoUrl(videoUrl) && resolved?.playable !== false);
    const canPlayIframe = Boolean(!canPlayNativeVideo && embedUrl && isSafeEmbedUrl(embedUrl) && resolved?.playable !== false);

    if (!canPlayNativeVideo && !canPlayIframe) {
      cardEl.classList.remove('is-playing');
      renderUnavailableFallback(stage, parsed, resolved, rawUrl);
      return false;
    }

    // Re-enforce single active player right before mounting media in case another card started while resolving
    stopOtherActivePlayers(targetScope, cardEl);

    const nextAspect = resolved?.aspect === 'portrait' ? 'portrait' : 'landscape';
    applyCardAspect(cardEl, resolved?.aspectRatio || cardEl.dataset.socialAspectRatio, nextAspect);
    cardEl.classList.add('is-playing');
    cardEl.dataset.socialEmbedUrl = canPlayNativeVideo ? videoUrl : embedUrl;

    const titleEl = cardEl.querySelector('.msg-social-title');
    const subEl = cardEl.querySelector('.msg-social-sub');
    if (resolved?.title && titleEl) titleEl.textContent = resolved.title;
    if (subEl) {
      subEl.textContent = parsed.provider === 'facebook'
        ? (resolved?.author ? `${resolved.author} · Ready with sound` : 'Tap video to play with sound')
        : (resolved?.author ? `${resolved.author} · Playing inside chat` : 'Playing inside chat');
    }

    const iconSvg = PROVIDER_ICONS[parsed.provider] || '';
    const badgeLabel = resolved?.badge || parsed.badge;

    if (canPlayNativeVideo) {
      const safePoster = isSafeThumbUrl(resolved?.thumbnailUrl) ? resolved.thumbnailUrl : '';
      const loopAttr = resolved?.isGif ? ' loop' : '';
      stage.innerHTML = `
        <div class="msg-social-player-bar">
          <span class="msg-social-player-tag">${iconSvg}<span>${escapeHtml(badgeLabel)}</span></span>
          <button type="button" class="dialog-close msg-social-close-btn" data-social-close="1" aria-label="Close inline video player" title="Close player">${CLOSE_SVG}</button>
        </div>
        <video class="msg-social-video" src="${escapeHtml(videoUrl)}"${safePoster ? ` poster="${escapeHtml(safePoster)}"` : ''} controls playsinline preload="auto"${loopAttr} aria-label="${escapeHtml(resolved?.title || badgeLabel)}"></video>`;

      const videoEl = stage.querySelector?.('video.msg-social-video');
      if (videoEl) {
        videoEl.muted = false;
        videoEl.defaultMuted = false;
        let triedFallback = false;
        let triedRefresh = false;

        videoEl.addEventListener?.('loadedmetadata', () => {
          if (!cardEl.isConnected || !cardEl.classList.contains('is-playing')) return;
          const vw = Number(videoEl.videoWidth || 0);
          const vh = Number(videoEl.videoHeight || 0);
          if (vw > 0 && vh > 0) {
            applyCardAspect(cardEl, vw / vh, nextAspect);
          }
        });

        videoEl.addEventListener?.('play', () => {
          stopOtherActivePlayers(targetScope, cardEl);
        });

        videoEl.addEventListener?.('error', async () => {
          if (!cardEl.isConnected || myToken !== activeSessionToken) return;
          if (!triedFallback && fallbackVideoUrl && isSafeVideoUrl(fallbackVideoUrl) && videoEl.src !== fallbackVideoUrl) {
            triedFallback = true;
            videoEl.src = fallbackVideoUrl;
            videoEl.load?.();
            videoEl.muted = false;
            videoEl.play?.().catch?.(() => { });
            return;
          }
          if (!triedRefresh && wasFromCache && typeof invokeResolveFn === 'function') {
            triedRefresh = true;
            try {
              const fresh = await resolveSocialEmbed(rawUrl, invokeResolveFn, { force: true });
              if (cardEl.isConnected && myToken === activeSessionToken && fresh?.videoUrl && isSafeVideoUrl(fresh.videoUrl)) {
                videoEl.src = fresh.videoUrl;
                videoEl.load?.();
                videoEl.muted = false;
                videoEl.play?.().catch?.(() => { });
                return;
              }
            } catch { }
          }
          cardEl.classList.remove('is-playing');
          renderUnavailableFallback(stage, parsed, { ...resolved, unavailableReason: resolved?.unavailableReason || 'unavailable' }, rawUrl);
        });

        try {
          const playPromise = videoEl.play?.();
          if (playPromise && typeof playPromise.catch === 'function') {
            playPromise.catch(() => {
              // Keep sound unmuted so a single tap on the native play control starts with sound
              videoEl.muted = false;
            });
          }
        } catch { }
      }
      return true;
    }

    stage.innerHTML = `
      <div class="msg-social-player-bar">
        <span class="msg-social-player-tag">${iconSvg}<span>${escapeHtml(badgeLabel)}</span></span>
        <button type="button" class="dialog-close msg-social-close-btn" data-social-close="1" aria-label="Close inline video player" title="Close player">${CLOSE_SVG}</button>
      </div>
      <iframe class="msg-social-iframe" src="${escapeHtml(embedUrl)}" title="${escapeHtml(resolved?.title || badgeLabel)}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin" loading="eager"></iframe>`;
    return true;
  }

  function hydrateVisibleSocialMeta(containerEl, invokeResolveFn) {
    if (!containerEl || typeof invokeResolveFn !== 'function') return;
    const cards = containerEl.querySelectorAll?.('[data-social-embed="1"]');
    if (!cards || !cards.length) return;
    const seen = new Set();
    cards.forEach((card) => {
      const rawUrl = card.dataset.socialUrl || '';
      if (!rawUrl || seen.has(rawUrl) || getCachedMeta(rawUrl)) return;
      seen.add(rawUrl);
      resolveSocialEmbed(rawUrl, invokeResolveFn).then((meta) => {
        if (!meta || !card.isConnected || card.classList.contains('is-playing')) return;
        const titleEl = card.querySelector('.msg-social-title');
        const subEl = card.querySelector('.msg-social-sub');
        const extEl = card.querySelector('.msg-social-ext');
        const badgeTextEl = card.querySelector('.msg-social-badge span');
        const pillEl = card.querySelector('.msg-social-watch-pill');
        if (meta.title && titleEl) titleEl.textContent = meta.title;
        if (meta.playable === false) {
          const unavail = describeUnavailableState(meta.provider, meta.badge, meta.unavailableReason);
          card.classList.add('is-restricted');
          if (subEl) subEl.textContent = unavail.sub;
          if (pillEl) {
            pillEl.textContent = unavail.pill;
            pillEl.classList.add('is-restricted');
          }
        } else {
          card.classList.remove('is-restricted');
          if (subEl) {
            subEl.textContent = meta.author
              ? `${meta.author} · Tap play to watch inside chat`
              : 'Tap play to watch inside chat';
          }
          if (pillEl) {
            pillEl.textContent = 'Watch in chat';
            pillEl.classList.remove('is-restricted');
          }
        }
        if (meta.badge && badgeTextEl) badgeTextEl.textContent = meta.badge;
        if (meta.canonicalUrl && extEl) extEl.setAttribute('href', meta.canonicalUrl);
        if (meta.aspect || meta.aspectRatio) {
          applyCardAspect(card, meta.aspectRatio, meta.aspect);
        }
        if (meta.thumbnailUrl && isSafeThumbUrl(meta.thumbnailUrl) && !card.querySelector('.msg-social-thumb')) {
          const poster = card.querySelector('.msg-social-poster');
          if (poster && typeof document !== 'undefined') {
            const img = document.createElement('img');
            img.className = 'msg-social-thumb';
            img.src = meta.thumbnailUrl;
            img.alt = '';
            img.loading = 'lazy';
            img.referrerPolicy = 'no-referrer';
            if (meta.provider !== 'youtube') {
              img.addEventListener?.('load', () => {
                if (!card.isConnected || card.classList.contains('is-playing')) return;
                const nw = Number(img.naturalWidth || 0);
                const nh = Number(img.naturalHeight || 0);
                if (nw > 0 && nh > 0 && !meta.aspectRatio) {
                  applyCardAspect(card, nw / nh, meta.aspect);
                }
              }, { once: true });
            }
            poster.prepend(img);
          }
        }
      }).catch(() => { });
    });
  }

  function normalizeSharedPayload(input) {
    const rawTitle = String(input?.title || '').trim();
    const rawText = String(input?.text || '').trim();
    const rawUrl = String(input?.url || '').trim();
    const combined = [rawText, rawUrl].filter(Boolean).join('\n').trim();
    const urls = extractUrls(combined);
    const primaryUrl = urls[0] || '';
    const social = primaryUrl ? parseSocialVideoUrl(primaryUrl) : null;
    let bodyText = rawText;
    if (rawUrl && !bodyText.includes(rawUrl)) {
      bodyText = bodyText ? `${bodyText}\n${rawUrl}` : rawUrl;
    }
    if (!bodyText && rawTitle) bodyText = rawTitle;
    return {
      title: rawTitle.slice(0, 180),
      text: bodyText.slice(0, 2000),
      url: primaryUrl,
      social
    };
  }

  const api = Object.freeze({
    extractUrls,
    parseSocialVideoUrl,
    extractSocialVideoEmbeds,
    isSafeEmbedUrl,
    isSafeVideoUrl,
    isSafeThumbUrl,
    getCachedMeta,
    resolveSocialEmbed,
    renderSocialEmbedCardHtml,
    renderSocialEmbedsBlockHtml,
    activateSocialPlayer,
    resetCardToPoster,
    stopOtherActivePlayers,
    hydrateVisibleSocialMeta,
    normalizeSharedPayload
  });

  if (typeof window !== 'undefined') window.IponSocialEmbeds = api;
  if (typeof globalThis !== 'undefined') globalThis.IponSocialEmbeds = api;
})();
