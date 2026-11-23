import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function read(relPath) {
  return fs.readFileSync(new URL(`../${relPath}`, import.meta.url), 'utf8');
}

function loadSocialEmbedsModule(extraGlobals = {}) {
  const src = read('js/social-video-embeds.js');
  const ctx = {
    URL,
    URLSearchParams,
    Map,
    Set,
    Math,
    Number,
    String,
    Boolean,
    Object,
    Array,
    Promise,
    window: {},
    ...extraGlobals
  };
  ctx.globalThis = ctx;
  ctx.window = ctx;
  vm.runInNewContext(src, ctx, { filename: 'js/social-video-embeds.js' });
  return ctx.IponSocialEmbeds;
}

test('social video embeds parser handles YouTube, TikTok, and Facebook links and rejects unsafe URLs', () => {
  const api = loadSocialEmbedsModule();

  // YouTube watch + timestamp
  const ytWatch = api.parseSocialVideoUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1m30s');
  assert.equal(ytWatch.provider, 'youtube');
  assert.equal(ytWatch.videoId, 'dQw4w9WgXcQ');
  assert.equal(ytWatch.aspect, 'landscape');
  assert.equal(ytWatch.needsResolve, false);
  assert.match(ytWatch.embedUrl, /^https:\/\/www\.youtube-nocookie\.com\/embed\/dQw4w9WgXcQ\?/);
  assert.match(ytWatch.embedUrl, /start=90/);
  assert.equal(ytWatch.thumbnailUrl, 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg');

  // YouTube Shorts
  const ytShort = api.parseSocialVideoUrl('https://youtube.com/shorts/abcDEF12345?feature=share');
  assert.equal(ytShort.provider, 'youtube');
  assert.equal(ytShort.aspect, 'portrait');
  assert.equal(ytShort.badge, 'YouTube Shorts');

  // youtu.be short link
  const ytBe = api.parseSocialVideoUrl('https://youtu.be/dQw4w9WgXcQ?t=42');
  assert.equal(ytBe.provider, 'youtube');
  assert.match(ytBe.embedUrl, /start=42/);

  // TikTok full video URL
  const ttFull = api.parseSocialVideoUrl('https://www.tiktok.com/@creator/video/7345678901234567890');
  assert.equal(ttFull.provider, 'tiktok');
  assert.equal(ttFull.videoId, '7345678901234567890');
  assert.equal(ttFull.aspect, 'portrait');
  assert.equal(ttFull.needsResolve, false);
  assert.equal(ttFull.embedUrl, 'https://www.tiktok.com/player/v1/7345678901234567890?autoplay=1&muted=0&loop=1&rel=0&controls=1&music_info=1&description=1');

  // TikTok mobile share shortlinks require server resolution
  const ttVt = api.parseSocialVideoUrl('https://vt.tiktok.com/ZS2abcdEF/');
  assert.equal(ttVt.provider, 'tiktok');
  assert.equal(ttVt.needsResolve, true);
  assert.equal(ttVt.embedUrl, '');

  const ttVm = api.parseSocialVideoUrl('https://vm.tiktok.com/ZM6xyz123/');
  assert.equal(ttVm.provider, 'tiktok');
  assert.equal(ttVm.needsResolve, true);

  // Facebook Reel + Watch + Shortlinks
  const fbReel = api.parseSocialVideoUrl('https://www.facebook.com/reel/123456789012345');
  assert.equal(fbReel.provider, 'facebook');
  assert.equal(fbReel.aspect, 'portrait');
  assert.equal(fbReel.needsResolve, false);
  assert.match(fbReel.embedUrl, /^https:\/\/www\.facebook\.com\/plugins\/video\.php\?href=/);
  assert.doesNotMatch(fbReel.embedUrl, /autoplay=true/);
  const fbCardHtml = api.renderSocialEmbedCardHtml(fbReel);
  assert.match(fbCardHtml, /class="msg-social-poster"/);
  assert.doesNotMatch(fbCardHtml, /<iframe\b/);

  const fbWatch = api.parseSocialVideoUrl('https://m.facebook.com/watch/?v=987654321098765');
  assert.equal(fbWatch.provider, 'facebook');
  assert.equal(fbWatch.aspect, 'landscape');
  assert.equal(fbWatch.needsResolve, false);

  const fbShare = api.parseSocialVideoUrl('https://www.facebook.com/share/r/1AbCdEfGhI/');
  assert.equal(fbShare.provider, 'facebook');
  assert.equal(fbShare.aspect, 'portrait');
  assert.equal(fbShare.needsResolve, true);

  const fbShort = api.parseSocialVideoUrl('https://fb.watch/abc123XYZ/');
  assert.equal(fbShort.provider, 'facebook');
  assert.equal(fbShort.needsResolve, true);

  // X / Twitter status links (x.com, twitter.com, fxtwitter.com, mobile.x.com)
  const xStatus = api.parseSocialVideoUrl('https://x.com/SpaceX/status/1845464615870914807?s=20');
  assert.equal(xStatus.provider, 'x');
  assert.equal(xStatus.videoId, '1845464615870914807');
  assert.equal(xStatus.canonicalUrl, 'https://x.com/SpaceX/status/1845464615870914807');
  assert.equal(xStatus.needsResolve, true);

  const twStatus = api.parseSocialVideoUrl('https://mobile.twitter.com/i/status/719944021058060289/video/1');
  assert.equal(twStatus.provider, 'x');
  assert.equal(twStatus.videoId, '719944021058060289');
  assert.equal(twStatus.canonicalUrl, 'https://x.com/i/status/719944021058060289');

  const fxStatus = api.parseSocialVideoUrl('https://fxtwitter.com/user/status/643211948184596480');
  assert.equal(fxStatus.provider, 'x');
  assert.equal(fxStatus.videoId, '643211948184596480');

  // Instagram Reels, posts, /<user>/reel/, and mobile /share/ shortlinks
  const igReel = api.parseSocialVideoUrl('https://www.instagram.com/reel/Cop84x6u7CP/?igsh=abc');
  assert.equal(igReel.provider, 'instagram');
  assert.equal(igReel.videoId, 'Cop84x6u7CP');
  assert.equal(igReel.aspect, 'portrait');
  assert.equal(igReel.badge, 'Instagram Reel');
  assert.equal(igReel.canonicalUrl, 'https://www.instagram.com/reel/Cop84x6u7CP/');
  assert.equal(igReel.needsResolve, true);

  const igUserReel = api.parseSocialVideoUrl('https://instagram.com/nasa/reels/Chunk8-jurw/');
  assert.equal(igUserReel.provider, 'instagram');
  assert.equal(igUserReel.videoId, 'Chunk8-jurw');
  assert.equal(igUserReel.aspect, 'portrait');

  const igPost = api.parseSocialVideoUrl('https://www.instagram.com/p/aye83DjauH/');
  assert.equal(igPost.provider, 'instagram');
  assert.equal(igPost.videoId, 'aye83DjauH');
  assert.equal(igPost.aspect, 'landscape');
  assert.equal(igPost.badge, 'Instagram');

  const igShare = api.parseSocialVideoUrl('https://www.instagram.com/share/reel/BA12345678/');
  assert.equal(igShare.provider, 'instagram');
  assert.equal(igShare.aspect, 'portrait');
  assert.equal(igShare.needsResolve, true);

  // Reject unsafe or unrelated URLs
  assert.equal(api.parseSocialVideoUrl('javascript:alert(1)'), null);
  assert.equal(api.parseSocialVideoUrl('https://evil.example/watch?v=dQw4w9WgXcQ'), null);
  assert.equal(api.parseSocialVideoUrl('https://user:pass@www.youtube.com/watch?v=dQw4w9WgXcQ'), null);
  assert.equal(api.parseSocialVideoUrl('https://www.facebook.com/settings/privacy'), null);
  assert.equal(api.parseSocialVideoUrl('https://x.com/home'), null);
  assert.equal(api.parseSocialVideoUrl('https://x.com/SpaceX/status/123456789/photo/1'), null);
  assert.equal(api.parseSocialVideoUrl('https://www.instagram.com/explore/'), null);
  assert.equal(api.parseSocialVideoUrl('https://www.instagram.com/stories/nasa/123456/'), null);

  // Strict embed, direct video & thumbnail allowlists
  assert.equal(api.isSafeEmbedUrl('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1'), true);
  assert.equal(api.isSafeEmbedUrl('https://www.tiktok.com/player/v1/7345678901234567890?autoplay=1'), true);
  assert.equal(api.isSafeEmbedUrl('https://www.facebook.com/plugins/video.php?href=https%3A%2F%2Fwww.facebook.com%2Freel%2F123'), true);
  assert.equal(api.isSafeEmbedUrl('https://www.instagram.com/reel/Cop84x6u7CP/embed/'), true);
  assert.equal(api.isSafeEmbedUrl('https://evil.example/embed/dQw4w9WgXcQ'), false);
  assert.equal(api.isSafeEmbedUrl('http://www.youtube-nocookie.com/embed/dQw4w9WgXcQ'), false);
  assert.equal(api.isSafeVideoUrl('https://video.twimg.com/ext_tw_video/123/pu/vid/720x1280/clip.mp4'), true);
  assert.equal(api.isSafeVideoUrl('https://instagram.fmnl9-7.fna.fbcdn.net/o1/v/t16/clip.mp4'), true);
  assert.equal(api.isSafeVideoUrl('https://scontent.cdninstagram.com/v/clip.mp4'), true);
  assert.equal(api.isSafeVideoUrl('https://woslmwokhhyszkgevnli.supabase.co/functions/v1/resolve-social-embed?media=https%3A%2F%2Fvideo.twimg.com%2Fclip.mp4&exp=9999999999999&sig=abc123'), true);
  assert.equal(api.isSafeVideoUrl('https://evil.example/clip.mp4'), false);
  assert.equal(api.isSafeVideoUrl('http://video.twimg.com/clip.mp4'), false);
  assert.equal(api.isSafeThumbUrl('https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg'), true);
  assert.equal(api.isSafeThumbUrl('https://p16-sign-sg.tiktokcdn.com/obj/thumb.jpg'), true);
  assert.equal(api.isSafeThumbUrl('https://pbs.twimg.com/ext_tw_video_thumb/123/img/thumb.jpg'), true);
  assert.equal(api.isSafeThumbUrl('https://scontent.cdninstagram.com/v/thumb.jpg'), true);
  assert.equal(api.isSafeThumbUrl('https://evil.example/thumb.jpg'), false);
});

test('social video embeds runtime activates inline player, resolves shortlinks, enforces single active player, and shows fallback on failure', async () => {
  const api = loadSocialEmbedsModule();

  function makeCard(rawUrl) {
    const parsed = api.parseSocialVideoUrl(rawUrl);
    const classSet = new Set(['msg-social-card', `is-${parsed.provider}`, parsed.aspect === 'portrait' ? 'is-portrait' : 'is-landscape']);
    const titleEl = { textContent: '' };
    const subEl = { textContent: '' };
    const stageEl = { innerHTML: '' };
    const card = {
      isConnected: true,
      dataset: { socialUrl: parsed.rawUrl, socialProvider: parsed.provider, socialEmbedUrl: parsed.embedUrl, socialAspect: parsed.aspect },
      classList: {
        add(c) { classSet.add(c); },
        remove(c) { classSet.delete(c); },
        toggle(c, on) { if (on) classSet.add(c); else classSet.delete(c); },
        contains(c) { return classSet.has(c); }
      },
      querySelector(sel) {
        if (sel === '.msg-social-stage') return stageEl;
        if (sel === '.msg-social-title') return titleEl;
        if (sel === '.msg-social-sub') return subEl;
        return null;
      },
      closest() { return null; },
      _stage: stageEl,
      _title: titleEl,
      _sub: subEl
    };
    return card;
  }

  // 1. Direct YouTube activation without waiting on network
  const ytCard = makeCard('https://youtu.be/dQw4w9WgXcQ');
  const ytOk = await api.activateSocialPlayer(ytCard, null, {});
  assert.equal(ytOk, true);
  assert.equal(ytCard.classList.contains('is-playing'), true);
  assert.match(ytCard._stage.innerHTML, /<iframe class="msg-social-iframe" src="https:\/\/www\.youtube-nocookie\.com\/embed\/dQw4w9WgXcQ/);
  assert.match(ytCard._stage.innerHTML, /data-social-close="1"/);

  // 2. Shortlink TikTok resolves via Edge Function callback
  const ttCard = makeCard('https://vt.tiktok.com/ZS2test99/');
  let resolveCalls = 0;
  const ttOk = await api.activateSocialPlayer(ttCard, async (url) => {
    resolveCalls += 1;
    assert.equal(url, 'https://vt.tiktok.com/ZS2test99/');
    return {
      provider: 'tiktok',
      videoId: '7399999999999999999',
      embedUrl: 'https://www.tiktok.com/player/v1/7399999999999999999?autoplay=1&music_info=1&description=1',
      aspect: 'portrait',
      title: 'Savings tip of the day',
      author: '@iponsaver',
      playable: true
    };
  }, {});
  assert.equal(ttOk, true);
  assert.equal(resolveCalls, 1);
  assert.equal(ttCard.classList.contains('is-playing'), true);
  assert.equal(ttCard._title.textContent, 'Savings tip of the day');
  assert.match(ttCard._stage.innerHTML, /https:\/\/www\.tiktok\.com\/player\/v1\/7399999999999999999/);

  // 3. Failed/restricted shortlink shows retryable fallback with external link
  const badFbCard = makeCard('https://fb.watch/privateReel99/');
  const fbOk = await api.activateSocialPlayer(badFbCard, async () => ({
    provider: 'facebook',
    playable: false,
    embedUrl: ''
  }), {});
  assert.equal(fbOk, false);
  assert.equal(badFbCard.classList.contains('is-playing'), false);
  assert.match(badFbCard._stage.innerHTML, /Inline playback unavailable/);
  assert.match(badFbCard._stage.innerHTML, /data-social-play="1"/);
  assert.match(badFbCard._stage.innerHTML, /Open on Facebook/);

  // 3a. X and Instagram play natively via <video class="msg-social-video"> with sound, and private posts render clear privacy fallback
  const xCard = makeCard('https://x.com/demo/status/719944021058060289');
  const xOk = await api.activateSocialPlayer(xCard, async () => ({
    provider: 'x',
    mediaMode: 'video',
    videoId: '719944021058060289',
    canonicalUrl: 'https://x.com/demo/status/719944021058060289',
    videoUrl: 'https://woslmwokhhyszkgevnli.supabase.co/functions/v1/resolve-social-embed?media=https%3A%2F%2Fvideo.twimg.com%2Fclip.mp4&exp=9999999999999&sig=deadbeef',
    thumbnailUrl: 'https://pbs.twimg.com/ext_tw_video_thumb/719944021058060289/img/thumb.jpg',
    aspect: 'landscape',
    aspectRatio: 1.7778,
    title: 'Launch highlight',
    author: '@demo',
    playable: true
  }), {});
  assert.equal(xOk, true);
  assert.equal(xCard.classList.contains('is-playing'), true);
  assert.match(xCard._stage.innerHTML, /<div class="msg-video-player is-social-video-player is-controls-visible"/);
  assert.match(xCard._stage.innerHTML, /<video class="msg-social-video" src="https:\/\/woslmwokhhyszkgevnli\.supabase\.co\/functions\/v1\/resolve-social-embed\?media=/);
  assert.doesNotMatch(xCard._stage.innerHTML, /<video[^>]*\scontrols(?:\s|>)/);
  assert.match(xCard._stage.innerHTML, /class="msg-video-controls"/);
  assert.match(xCard._stage.innerHTML, /class="msg-video-seek"/);
  assert.match(xCard._stage.innerHTML, /data-vact="play"/);
  assert.match(xCard._stage.innerHTML, /data-vact="mute"/);
  assert.match(xCard._stage.innerHTML, /data-vact="fs"/);
  assert.match(xCard._stage.innerHTML, /data-vact="menu"/);

  // Maximizing an X/Instagram video delegates to Ipon.openVideoViewer with synced time/mute & hideDownload
  let viewerCall = null;
  const maxApi = loadSocialEmbedsModule({
    Ipon: {
      openVideoViewer(src, title, sub, dlName, opts) {
        viewerCall = { src, title, sub, dlName, opts };
      }
    }
  });
  let inlinePausedForMax = false;
  const maxVideoEl = {
    isConnected: true,
    src: 'https://instagram.fmnl9-7.fna.fbcdn.net/o1/v/t16/reel.mp4',
    currentSrc: 'https://instagram.fmnl9-7.fna.fbcdn.net/o1/v/t16/reel.mp4',
    poster: 'https://instagram.fmnl4-6.fna.fbcdn.net/v/t51/thumb.jpg',
    currentTime: 7.5,
    duration: 30,
    muted: false,
    paused: false,
    ended: false,
    pause() { inlinePausedForMax = true; }
  };
  const maxCard = {
    dataset: { socialUrl: 'https://www.instagram.com/reel/Cop84x6u7CP/', socialProvider: 'instagram' },
    querySelector(sel) {
      if (sel === 'video.msg-social-video') return maxVideoEl;
      if (sel === '.msg-social-title') return { textContent: 'Quick savings reel' };
      return null;
    }
  };
  assert.equal(maxApi.maximizeSocialVideo(maxCard), true);
  assert.equal(inlinePausedForMax, true);
  assert.equal(viewerCall?.src, maxVideoEl.src);
  assert.equal(viewerCall?.opts?.startTime, 7.5);
  assert.equal(viewerCall?.opts?.muted, false);
  assert.equal(viewerCall?.opts?.hideDownload, true);
  viewerCall.opts.onClose({ currentTime: 12.25, muted: true });
  assert.equal(maxVideoEl.currentTime, 12.25);
  assert.equal(maxVideoEl.muted, true);

  const igCard = makeCard('https://www.instagram.com/reel/Cop84x6u7CP/');
  const igOk = await api.activateSocialPlayer(igCard, async () => ({
    provider: 'instagram',
    mediaMode: 'video',
    videoId: 'Cop84x6u7CP',
    canonicalUrl: 'https://www.instagram.com/reel/Cop84x6u7CP/',
    videoUrl: 'https://instagram.fmnl9-7.fna.fbcdn.net/o1/v/t16/reel.mp4',
    thumbnailUrl: 'https://instagram.fmnl4-6.fna.fbcdn.net/v/t51/thumb.jpg',
    aspect: 'portrait',
    aspectRatio: 0.5625,
    title: 'Quick savings reel',
    author: '@creator',
    playable: true
  }), {});
  assert.equal(igOk, true);
  assert.equal(igCard.classList.contains('is-playing'), true);
  assert.match(igCard._stage.innerHTML, /<video class="msg-social-video" src="https:\/\/instagram\.fmnl9-7\.fna\.fbcdn\.net\/o1\/v\/t16\/reel\.mp4"/);

  const privateIgCard = makeCard('https://www.instagram.com/reel/PrivateAccount99/');
  const privIgOk = await api.activateSocialPlayer(privateIgCard, async () => ({
    provider: 'instagram',
    playable: false,
    unavailableReason: 'private',
    canonicalUrl: 'https://www.instagram.com/reel/PrivateAccount99/'
  }), {});
  assert.equal(privIgOk, false);
  assert.match(privateIgCard._stage.innerHTML, /Private or protected video/);
  assert.match(privateIgCard._stage.innerHTML, /Open on Instagram/);

  const restrictedIgCard = makeCard('https://www.instagram.com/reel/CopyrightAudio99/');
  const restIgOk = await api.activateSocialPlayer(restrictedIgCard, async () => ({
    provider: 'instagram',
    playable: false,
    unavailableReason: 'restricted',
    canonicalUrl: 'https://www.instagram.com/reel/CopyrightAudio99/'
  }), {});
  assert.equal(restIgOk, false);
  assert.match(restrictedIgCard._stage.innerHTML, /Restricted by Instagram/);
  assert.match(restrictedIgCard._stage.innerHTML, /Open on Instagram/);

  // Stopping another active native <video> social card pauses and removes it cleanly
  let xVideoPaused = false;
  let xVideoRemoved = false;
  const mockXVideo = { pause() { xVideoPaused = true; }, removeAttribute() {}, load() {}, remove() { xVideoRemoved = true; } };
  const activeXCard = makeCard('https://x.com/demo/status/719944021058060289');
  activeXCard.classList.add('is-playing');
  const origXQ = activeXCard.querySelector.bind(activeXCard);
  activeXCard.querySelector = (sel) => (sel === 'video' || sel === 'iframe, video' ? mockXVideo : origXQ(sel));
  const nextYtCard = makeCard('https://youtu.be/dQw4w9WgXcQ');
  const mixedScope = { querySelectorAll(sel) { return sel === '.msg-social-card' ? [activeXCard, nextYtCard] : []; } };
  await api.activateSocialPlayer(nextYtCard, null, { scopeEl: mixedScope });
  assert.equal(xVideoPaused, true);
  assert.equal(xVideoRemoved, true);
  assert.equal(activeXCard.classList.contains('is-playing'), false);

  // 3b. Starting a second social video immediately stops the first and aborts stale async shortlink loads
  let firstIframeRemoved = false;
  const firstIframe = { src: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ', remove() { firstIframeRemoved = true; } };
  const firstCard = makeCard('https://youtu.be/dQw4w9WgXcQ');
  firstCard.classList.add('is-playing');
  const origQ = firstCard.querySelector.bind(firstCard);
  firstCard.querySelector = (sel) => (sel === 'iframe' ? firstIframe : origQ(sel));
  const secondCard = makeCard('https://www.tiktok.com/@creator/video/7345678901234567890');
  const scopeEl = { querySelectorAll(sel) { return sel === '.msg-social-card' ? [firstCard, secondCard] : []; } };
  const ok2 = await api.activateSocialPlayer(secondCard, null, { scopeEl });
  assert.equal(ok2, true);
  assert.equal(firstIframe.src, 'about:blank');
  assert.equal(firstIframeRemoved, true);
  assert.equal(firstCard.classList.contains('is-playing'), false);
  assert.equal(secondCard.classList.contains('is-playing'), true);

  // Stale async shortlink load is cancelled if another video starts before it finishes
  let finishSlowResolve;
  const slowCard = makeCard('https://vt.tiktok.com/ZS2slow11/');
  const fastCard = makeCard('https://youtu.be/dQw4w9WgXcQ');
  const slowPromise = api.activateSocialPlayer(slowCard, () => new Promise((r) => { finishSlowResolve = r; }), { scopeEl: { querySelectorAll: () => [slowCard, fastCard] } });
  const fastOk = await api.activateSocialPlayer(fastCard, null, { scopeEl: { querySelectorAll: () => [slowCard, fastCard] } });
  finishSlowResolve({ provider: 'tiktok', videoId: '7399999999999999991', embedUrl: 'https://www.tiktok.com/player/v1/7399999999999999991?autoplay=1&muted=0&loop=1&rel=0&controls=1&music_info=1&description=1', aspect: 'portrait', playable: true });
  const slowOk = await slowPromise;
  assert.equal(fastOk, true);
  assert.equal(slowOk, false);
  assert.equal(slowCard.classList.contains('is-playing'), false);

  // 4. Shared payload normalization deduplicates URL and recognizes social video
  const norm = api.normalizeSharedPayload({
    title: 'Cool video',
    text: 'Watch this https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
  });
  assert.equal(norm.url, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  assert.equal(norm.text, 'Watch this https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  assert.equal(norm.social?.provider, 'youtube');
});

test('Edge Function resolve-social-embed enforces strict HTTPS host allowlist and SSRF-safe manual redirect hops', () => {
  const fnSrc = read('supabase/functions/resolve-social-embed/index.ts');
  assert.match(fnSrc, /const ALLOWED_HOSTS = new Set\(\[/);
  assert.match(fnSrc, /vt\.tiktok\.com/);
  assert.match(fnSrc, /vm\.tiktok\.com/);
  assert.match(fnSrc, /fb\.watch/);
  assert.match(fnSrc, /'x\.com'/);
  assert.match(fnSrc, /'twitter\.com'/);
  assert.match(fnSrc, /'instagram\.com'/);
  assert.match(fnSrc, /'instagr\.am'/);
  assert.match(fnSrc, /handleSignedMediaProxy/);
  assert.match(fnSrc, /api\.fxtwitter\.com\/status\//);
  assert.match(fnSrc, /cdn\.syndication\.twimg\.com\/tweet-result/);
  assert.match(fnSrc, /\/embed\/captioned\//);
  assert.match(fnSrc, /unavailableReason/);
  assert.match(fnSrc, /redirect:\s*'manual'/);
  assert.match(fnSrc, /const nextUrl = parseAllowedUrl\(nextRaw\)/);
  assert.match(fnSrc, /maxHops\s*=\s*5/);
  assert.match(fnSrc, /https:\/\/www\.youtube-nocookie\.com\/embed\//);
  assert.match(fnSrc, /https:\/\/www\.tiktok\.com\/player\/v1\//);
  assert.match(fnSrc, /https:\/\/www\.facebook\.com\/plugins\/video\.php\?href=/);
  assert.match(fnSrc, /FB_CRAWLER_UA/);
  assert.match(fnSrc, /if \(!fb \|\| !fb\.playable\)/);
  assert.match(fnSrc, /probeImageDimensions/);
  assert.match(fnSrc, /aspectRatio/);
});

test('Android Share Sheet, PWA share_target, CSP allowlists, core.js, messages.js, and CSS are wired cleanly', () => {
  // Android native share intent & JS bridge
  const manifestXml = read('android/app/src/main/AndroidManifest.xml');
  assert.match(manifestXml, /android\.intent\.action\.SEND/);
  assert.match(manifestXml, /android:mimeType="text\/plain"/);
  assert.match(manifestXml, /Send to myIPON Messages/);

  const mainActivity = read('android/app/src/main/java/com/myipon/app/MainActivity.java');
  assert.match(mainActivity, /addJavascriptInterface\(new ShareBridge\(\), "IponNativeShare"\)/);
  assert.match(mainActivity, /handleShareIntent\(getIntent\(\)\)/);
  assert.match(mainActivity, /myipon:native-share/);
  assert.match(mainActivity, /public void onShowCustomView\(View view, CustomViewCallback callback\)/);
  assert.match(mainActivity, /public void onHideCustomView\(\)/);
  assert.match(mainActivity, /if \(exitFullscreenCustomView\(\)\)/);

  // PWA Web Share Target
  const webManifest = JSON.parse(read('manifest.webmanifest'));
  assert.equal(webManifest.share_target?.action, '/dashboard.html');
  assert.equal(webManifest.share_target?.method, 'GET');
  assert.equal(webManifest.share_target?.params?.url, 'share_url');
  assert.equal(webManifest.share_target?.params?.text, 'share_text');

  // CSP headers & meta tags allow official YouTube, TikTok, Facebook, X, and Instagram media & thumbnails
  for (const file of ['vercel.json', '_headers', 'dashboard.html', 'account.html', 'savings.html', 'user.html']) {
    const src = read(file);
    assert.match(src, /https:\/\/www\.youtube-nocookie\.com/, `${file} must allow youtube-nocookie frame-src`);
    assert.match(src, /https:\/\/www\.tiktok\.com/, `${file} must allow tiktok frame-src`);
    assert.match(src, /https:\/\/www\.facebook\.com/, `${file} must allow facebook frame-src`);
    assert.match(src, /https:\/\/www\.instagram\.com/, `${file} must allow instagram frame-src`);
    assert.match(src, /https:\/\/i\.ytimg\.com/, `${file} must allow YouTube thumbnails`);
    assert.match(src, /https:\/\/pbs\.twimg\.com/, `${file} must allow X thumbnails`);
    assert.match(src, /https:\/\/\*\.cdninstagram\.com/, `${file} must allow Instagram media/thumbnails`);
    assert.match(src, /https:\/\/video\.twimg\.com/, `${file} must allow X video streams`);
  }

  // Service worker precaches social-video-embeds.js
  const sw = read('sw.js');
  assert.match(sw, /'js\/social-video-embeds\.js'/);

  // Messaging HTML pages load social-video-embeds.js before messages.js
  for (const page of ['account.html', 'audit.html', 'budget.html', 'contributions.html', 'dashboard.html', 'expenses.html', 'members.html', 'reports.html', 'requests.html', 'savings.html', 'settings.html', 'user.html', 'withdrawals.html']) {
    const html = read(page);
    assert.match(html, /js\/social-video-embeds\.js\?v=20261123-18"><\/script>\s*<script src="js\/messages\.js\?v=20261123-15"/, `${page} must load social-video-embeds.js right before messages.js`);
  }

  // core.js exports share capture, Edge Function resolver, fullscreen Back exit, and browser popstate Back for video viewer
  const coreJs = read('js/core.js');
  assert.match(coreJs, /function capturePendingShareFromUrl\(\)/);
  assert.match(coreJs, /function consumePendingSharePayload\(\)/);
  assert.match(coreJs, /async function invokeSocialEmbedResolver\(rawUrl\)/);
  assert.match(coreJs, /resolve-social-embed/);
  assert.match(coreJs, /const fsEl = document\.fullscreenElement \|\| document\.webkitFullscreenElement;/);
  assert.match(coreJs, /iponVideoViewer:\s*true/);
  assert.match(coreJs, /dl\.hidden = Boolean\(opts\?\.hideDownload\);/);

  // messages.js integrates inline social embed rendering, player triggers, maximize viewer, swipe-to-reply over video, and #msg-share-dialog
  const msgJs = read('js/messages.js');
  assert.match(msgJs, /id="msg-share-dialog"/);
  assert.match(msgJs, /renderSocialEmbedsBlockHtml/);
  assert.match(msgJs, /activateSocialPlayer/);
  assert.match(msgJs, /maximizeSocialVideo/);
  assert.match(msgJs, /stopOtherActivePlayers/);
  assert.match(msgJs, /openShareLinkDialog/);
  assert.match(msgJs, /myipon:native-share/);
  assert.match(msgJs, /\.msg-social-poster,\s*\.msg-social-stage,\s*\.msg-social-video,\s*\.msg-social-fallback/);
  assert.match(msgJs, /function pauseOtherChatMedia\(activeMedia, \{ keepSocialCard = null \} = \{\}\)\s*\{[\s\S]*?stopOtherActivePlayers/);
  assert.match(msgJs, /pauseOtherChatMedia\(null, \{ keepSocialCard: card \}\);/);
  assert.match(msgJs, /media\?\.matches\?\.\('\.msg-social-video'\)/);

  // CSS rules for inline social player & share dialog: zero side margin on bubble, fixed non-growing portrait size, circular close button, X & Instagram themes
  const css = read('css/app.css');
  assert.match(css, /\.msg-row\.is-mine\s+\.msg-bubble-wrap\s*\{\s*justify-content:\s*flex-end;/);
  assert.match(css, /\.msg-bubble\.has-social-embed\s*\{\s*padding:\s*0;\s*width:\s*304px;/);
  assert.doesNotMatch(css, /\.msg-social-card\.is-playing\.is-portrait\s+\.msg-social-stage/);
  assert.match(css, /\.msg-social-card\.is-portrait\s+\.msg-social-stage\s*\{[\s\S]*?aspect-ratio:\s*var\(--social-ar,\s*9\s*\/\s*16\);/);
  assert.match(css, /\.msg-social-card\.is-x\s+\.msg-social-poster\s*\{/);
  assert.match(css, /\.msg-social-card\.is-instagram\s+\.msg-social-poster\s*\{/);
  assert.match(css, /\.msg-social-video\s*\{[\s\S]*?touch-action:\s*pan-y;/);
  assert.match(css, /\.msg-social-stage > \.msg-video-player\.is-social-video-player\s*\{/);
  assert.match(css, /\.msg-social-video::-webkit-media-controls/);
  assert.match(css, /\.msg-social-card\s*\{/);
  assert.match(css, /\.msg-social-close-btn\s*\{[\s\S]*?border-radius:\s*50%/);
  assert.match(css, /\.msg-share-dialog\s*\{/);
});
