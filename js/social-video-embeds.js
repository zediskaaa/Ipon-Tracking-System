(() => {
  'use strict';

  const YOUTUBE_ID_RE = /^[A-Za-z0-9_-]{11}$/;
  const TIKTOK_ID_RE = /^\d{10,24}$/;
  const URL_TOKEN_RE = /https?:\/\/[^\s<>"']+/gi;

  const ALLOWED_EMBED_HOSTS = new Set([
    'www.youtube-nocookie.com',
    'www.youtube.com',
    'www.tiktok.com',
    'www.facebook.com',
    'web.facebook.com'
  ]);

  const ALLOWED_THUMB_HOSTS = [
    /^i\.ytimg\.com$/i,
    /^i\d\.ytimg\.com$/i,
    /\.tiktokcdn(?:-us|-eu)?\.com$/i,
    /\.fbcdn\.net$/i
  ];

  const PROVIDER_META = Object.freeze({
    youtube: { label: 'YouTube', shortLabel: 'YouTube Shorts', accent: 'youtube' },
    tiktok: { label: 'TikTok', shortLabel: 'TikTok', accent: 'tiktok' },
    facebook: { label: 'Facebook', shortLabel: 'Facebook Reel', accent: 'facebook' }
  });

  const PROVIDER_ICONS = Object.freeze({
    youtube: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.6 12 3.6 12 3.6s-7.5 0-9.4.5A3 3 0 0 0 .5 6.2 31.4 31.4 0 0 0 0 12a31.4 31.4 0 0 0 .5 5.8 3 3 0 0 0 2.1 2.1c1.9.5 9.4.5 9.4.5s7.5 0 9.4-.5a3 3 0 0 0 2.1-2.1A31.4 31.4 0 0 0 24 12a31.4 31.4 0 0 0-.5-5.8ZM9.6 15.6V8.4l6.3 3.6-6.3 3.6Z"/></svg>',
    tiktok: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.89-2.89 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1V9.01a6.27 6.27 0 0 0-.79-.05 6.34 6.34 0 0 0-6.34 6.34 6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.33-6.34V8.7a8.18 8.18 0 0 0 4.78 1.52V6.77a4.85 4.85 0 0 1-1.01-.08Z"/></svg>',
    facebook: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M24 12.07C24 5.41 18.63 0 12 0S0 5.41 0 12.07c0 6.02 4.39 11.01 10.13 11.93v-8.44H7.08v-3.49h3.05V9.41c0-3.02 1.79-4.69 4.53-4.69 1.31 0 2.68.24 2.68.24v2.96h-1.51c-1.49 0-1.95.93-1.95 1.88v2.27h3.33l-.53 3.49h-2.8V24C19.61 23.08 24 18.09 24 12.07Z"/></svg>'
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
        thumbnailUrl: '',
        aspect: isReel ? 'portrait' : 'landscape',
        badge: isReel ? PROVIDER_META.facebook.shortLabel : PROVIDER_META.facebook.label,
        needsResolve: isShortFb
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

  function getCachedMeta(rawUrl) {
    return resolveCache.get(cleanUrlToken(rawUrl)) || null;
  }

  async function resolveSocialEmbed(rawUrl, invokeResolveFn) {
    const key = cleanUrlToken(rawUrl);
    if (!key) return null;
    if (resolveCache.has(key)) return resolveCache.get(key);
    if (inflightMap.has(key)) return inflightMap.get(key);

    const parsed = parseSocialVideoUrl(key);
    if (!parsed) return null;

    const task = (async () => {
      if (typeof invokeResolveFn !== 'function') {
        const localRes = {
          ...parsed,
          title: '',
          author: '',
          playable: Boolean(parsed.embedUrl && isSafeEmbedUrl(parsed.embedUrl))
        };
        if (localRes.playable) resolveCache.set(key, localRes);
        return localRes;
      }
      try {
        const data = await invokeResolveFn(key);
        const remoteEmbed = String(data?.embedUrl || '').trim();
        const safeEmbed = remoteEmbed && isSafeEmbedUrl(remoteEmbed) ? remoteEmbed : parsed.embedUrl;
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
          : parsed.badge;
        const merged = {
          ...parsed,
          videoId: String(data?.videoId || parsed.videoId || ''),
          canonicalUrl: String(data?.canonicalUrl || parsed.canonicalUrl || key),
          embedUrl: safeEmbed,
          thumbnailUrl: safeThumb,
          aspect,
          aspectRatio,
          badge,
          title: String(data?.title || '').trim().slice(0, 180),
          author: String(data?.author || '').trim().slice(0, 90),
          playable: Boolean(safeEmbed && isSafeEmbedUrl(safeEmbed) && data?.playable !== false),
          needsResolve: false
        };
        resolveCache.set(key, merged);
        return merged;
      } catch (err) {
        if (parsed.embedUrl && isSafeEmbedUrl(parsed.embedUrl)) {
          return { ...parsed, title: '', author: '', playable: true };
        }
        throw err;
      } finally {
        inflightMap.delete(key);
      }
    })();

    inflightMap.set(key, task);
    return task;
  }

  function renderSocialEmbedCardHtml(parsed, { compact = false } = {}) {
    if (!parsed || !PROVIDER_META[parsed.provider]) return '';
    const cached = getCachedMeta(parsed.rawUrl);
    const info = cached ? { ...parsed, ...cached } : parsed;
    const iconSvg = PROVIDER_ICONS[info.provider] || '';
    const safeThumb = isSafeThumbUrl(info.thumbnailUrl) ? info.thumbnailUrl : '';
    const aspectRatio = clampAspectRatio(info.aspectRatio) || (info.aspect === 'portrait' ? 0.5625 : 1.7778);
    const aspectCls = info.aspect === 'portrait' ? 'is-portrait' : 'is-landscape';
    const titleText = info.title || (info.provider === 'youtube'
      ? 'Play YouTube video'
      : info.provider === 'tiktok'
        ? 'Play TikTok video'
        : (info.aspect === 'portrait' ? 'Play Facebook Reel' : 'Play Facebook video'));
    const directFbEmbed = !compact && info.provider === 'facebook' && !info.needsResolve && info.playable !== false && isSafeEmbedUrl(info.embedUrl);
    const subText = info.author
      ? `${info.author} · Plays inside chat`
      : (directFbEmbed
          ? 'Tap video to play with sound'
          : (info.needsResolve ? 'Tap play to load inside chat' : 'Tap play to watch inside chat'));

    const stageInner = directFbEmbed
      ? `<iframe class="msg-social-iframe" src="${escapeHtml(info.embedUrl)}" title="${escapeHtml(titleText)}" allow="autoplay; clipboard-write; encrypted-media; picture-in-picture; web-share; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin" loading="lazy"></iframe>`
      : `<button type="button" class="msg-social-poster" data-social-play="1" aria-label="Play ${escapeHtml(info.badge)} video inside conversation">
          ${safeThumb ? `<img class="msg-social-thumb" src="${escapeHtml(safeThumb)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ''}
          <span class="msg-social-poster-scrim" aria-hidden="true"></span>
          <span class="msg-social-badge">${iconSvg}<span>${escapeHtml(info.badge)}</span></span>
          <span class="msg-social-play-circle" aria-hidden="true">${PLAY_SVG}</span>
          <span class="msg-social-watch-pill">Watch in chat</span>
        </button>`;

    return `<div class="msg-social-card is-${escapeHtml(info.provider)} ${aspectCls}${compact ? ' is-compact' : ''}${directFbEmbed ? ' is-fb-direct' : ''}" data-social-embed="1" data-social-provider="${escapeHtml(info.provider)}" data-social-url="${escapeHtml(info.rawUrl)}" data-social-embed-url="${escapeHtml(info.embedUrl || '')}" data-social-aspect="${escapeHtml(info.aspect)}" data-social-aspect-ratio="${escapeHtml(String(aspectRatio))}">
      <div class="msg-social-stage" style="--social-ar:${escapeHtml(String(aspectRatio))}">
        ${stageInner}
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

  function resetCardToPoster(cardEl) {
    if (!cardEl) return;
    const oldIframe = cardEl.querySelector?.('iframe');
    if (oldIframe) {
      try { oldIframe.src = 'about:blank'; } catch { }
    }
    const rawUrl = cardEl.dataset.socialUrl || '';
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
    const root = scopeEl || (typeof document !== 'undefined' ? document : null);
    if (!root || typeof root.querySelectorAll !== 'function') return;
    root.querySelectorAll('.msg-social-card.is-playing').forEach((other) => {
      if (other !== exceptCard) resetCardToPoster(other);
    });
    root.querySelectorAll('.msg-social-card.is-fb-direct').forEach((other) => {
      if (other === exceptCard) return;
      const frame = other.querySelector?.('iframe.msg-social-iframe');
      if (!frame) return;
      const embedUrl = other.dataset.socialEmbedUrl || '';
      try {
        frame.src = 'about:blank';
        if (exceptCard && embedUrl && isSafeEmbedUrl(embedUrl)) {
          frame.src = embedUrl;
        }
      } catch { }
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

  async function activateSocialPlayer(cardEl, invokeResolveFn, { scopeEl = null } = {}) {
    if (!cardEl) return false;
    ensureTikTokAudioBridge();
    const rawUrl = cardEl.dataset.socialUrl || '';
    const parsed = parseSocialVideoUrl(rawUrl);
    if (!parsed) return false;

    stopOtherActivePlayers(scopeEl || cardEl.closest?.('#msg-messages-list'), cardEl);

    const stage = cardEl.querySelector('.msg-social-stage');
    if (!stage) return false;

    let resolved = getCachedMeta(rawUrl);
    const directPlayable = Boolean(!parsed.needsResolve && parsed.embedUrl && isSafeEmbedUrl(parsed.embedUrl));

    if (!resolved || !resolved.embedUrl) {
      if (!directPlayable) {
        cardEl.classList.add('is-loading');
        stage.innerHTML = `<div class="msg-social-loading" role="status" aria-live="polite"><span class="msg-social-spinner" aria-hidden="true"></span><span>Loading ${escapeHtml(parsed.badge)} player…</span></div>`;
        try {
          resolved = await resolveSocialEmbed(rawUrl, invokeResolveFn);
        } catch {
          resolved = null;
        } finally {
          cardEl.classList.remove('is-loading');
        }
      } else {
        resolved = { ...parsed, playable: true };
        // Enrich title/author quietly in background without delaying playback
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

    const embedUrl = String(resolved?.embedUrl || '').trim();
    if (!embedUrl || !isSafeEmbedUrl(embedUrl) || resolved?.playable === false) {
      const openHref = resolved?.canonicalUrl || rawUrl;
      stage.innerHTML = `<div class="msg-social-fallback" role="alert">
        <strong>Inline playback unavailable</strong>
        <p>This ${escapeHtml(parsed.badge)} link may be private or restricted from embedded playback.</p>
        <div class="msg-social-fallback-actions">
          <button type="button" class="button button-secondary button-sm" data-social-play="1">Try again</button>
          <a class="button button-primary button-sm" href="${escapeHtml(openHref)}" target="_blank" rel="noopener noreferrer">Open link</a>
        </div>
      </div>`;
      return false;
    }

    const nextAspect = resolved?.aspect === 'portrait' ? 'portrait' : 'landscape';
    applyCardAspect(cardEl, resolved?.aspectRatio || cardEl.dataset.socialAspectRatio, nextAspect);
    cardEl.classList.add('is-playing');
    cardEl.dataset.socialEmbedUrl = embedUrl;

    const titleEl = cardEl.querySelector('.msg-social-title');
    const subEl = cardEl.querySelector('.msg-social-sub');
    if (resolved?.title && titleEl) titleEl.textContent = resolved.title;
    if (subEl) subEl.textContent = resolved?.author ? `${resolved.author} · Playing inside chat` : 'Playing inside chat';

    const iconSvg = PROVIDER_ICONS[parsed.provider] || '';
    const badgeLabel = resolved?.badge || parsed.badge;
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
        if (meta.title && titleEl) titleEl.textContent = meta.title;
        if (subEl) {
          subEl.textContent = meta.author
            ? `${meta.author} · Tap play to watch inside chat`
            : 'Tap play to watch inside chat';
        }
        if (meta.badge && badgeTextEl) badgeTextEl.textContent = meta.badge;
        if (meta.canonicalUrl && extEl) extEl.setAttribute('href', meta.canonicalUrl);
        if (meta.aspect || meta.aspectRatio) {
          applyCardAspect(card, meta.aspectRatio, meta.aspect);
        }
        // Upgrade resolved non-compact Facebook shortlinks to Facebook's native unmuted one-tap player
        if (
          meta.provider === 'facebook'
          && meta.playable !== false
          && !card.classList.contains('is-compact')
          && !card.classList.contains('is-fb-direct')
          && isSafeEmbedUrl(meta.embedUrl)
        ) {
          const stage = card.querySelector('.msg-social-stage');
          if (stage) {
            card.classList.add('is-fb-direct');
            card.dataset.socialEmbedUrl = meta.embedUrl;
            if (subEl) subEl.textContent = meta.author ? `${meta.author} · Tap video to play with sound` : 'Tap video to play with sound';
            stage.innerHTML = `<iframe class="msg-social-iframe" src="${escapeHtml(meta.embedUrl)}" title="${escapeHtml(meta.title || meta.badge || 'Facebook video')}" allow="autoplay; clipboard-write; encrypted-media; picture-in-picture; web-share; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin" loading="lazy"></iframe>`;
            return;
          }
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
    // Avoid duplicating the URL if both `text` and `url` carry it
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
