(() => {
  'use strict';

  const MAX_ATTACHMENT_BYTES = 52428800; // 50 MB
  const MAX_ATTACHMENTS_PER_MSG = 10;
  const MAX_QUEUE_ATTACHMENTS = 30;
  const SINGLE_CHECK_SVG = '<svg class="msg-tick-svg" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.2 8.6 6.4 11.8 13.2 4.6"/></svg>';
  const DOUBLE_CHECK_SVG = '<svg class="msg-tick-svg is-double" viewBox="0 0 20 16" aria-hidden="true"><path d="M1.8 8.6 5 11.8 11.8 4.6"/><path d="M7.2 8.6 10.4 11.8 17.4 4.6"/></svg>';
  const VIDEO_PLAY_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><polygon points="7,5 19,12 7,19" fill="currentColor" stroke="none"/></svg>';
  const VIDEO_PAUSE_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6.5" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none"/><rect x="13.5" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none"/></svg>';
  const VIDEO_VOL_ON_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><polygon points="4,9 9,9 14,5 14,19 9,15 4,15" fill="currentColor" stroke="none"/><path d="M17.2 8.8a4.8 4.8 0 0 1 0 6.4"/><path d="M19.8 6.2a8.4 8.4 0 0 1 0 11.6"/></svg>';
  const VIDEO_VOL_OFF_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><polygon points="4,9 9,9 14,5 14,19 9,15 4,15" fill="currentColor" stroke="none"/><line x1="17" y1="9" x2="21.5" y2="15"/><line x1="21.5" y1="9" x2="17" y2="15"/></svg>';
  const VIDEO_FS_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 4H4v4M16 4h4v4M8 20H4v-4M16 20h4v-4"/></svg>';
  const VIDEO_MORE_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="5.5" r="1.7" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.7" fill="currentColor" stroke="none"/><circle cx="12" cy="18.5" r="1.7" fill="currentColor" stroke="none"/></svg>';
  const MSG_REACT_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9.25"/><path d="M8.5 14.3s1.4 2.1 3.5 2.1 3.5-2.1 3.5-2.1"/><circle cx="9.2" cy="10" r="1.15" fill="currentColor" stroke="none"/><circle cx="14.8" cy="10" r="1.15" fill="currentColor" stroke="none"/></svg>';
  const MSG_REPLY_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="9 14 4 9 9 4"/><path d="M20 20v-7a4 4 0 0 0-4-4H4"/></svg>';
  const MSG_MORE_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5.5" cy="12" r="1.75" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.75" fill="currentColor" stroke="none"/><circle cx="18.5" cy="12" r="1.75" fill="currentColor" stroke="none"/></svg>';
  const MSG_PLUS_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><line x1="12" y1="5.5" x2="12" y2="18.5"/><line x1="5.5" y1="12" x2="18.5" y2="12"/></svg>';
  const MSG_PIN_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/></svg>';
  const MSG_CHEVRON_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
  const MSG_CLOSE_X_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>';
  const HOLD_EXCLUDE_SEL = 'a, input, textarea, select, label, [data-aact], [data-vact], [data-react-msg], [data-jump-msg], [data-retry-pending], [data-cancel-pending], .msg-video-controls, .msg-voice-wave';
  const MSG_HOLD_DELAY_MS = 380;
  const MENU_EXIT_MS = 200;
  const VOICE_WAVE_HEIGHTS = [28, 48, 36, 62, 42, 78, 96, 54, 44, 68, 86, 50, 74, 40, 84, 92, 60, 46, 72, 98, 56, 48, 66, 38, 76, 52, 82, 44, 70, 90, 58, 42, 74, 60, 46, 32];
  const BLOCKED_EXT_RE = /\.(exe|msi|bat|cmd|com|pif|scr|vbs|vbe|js|mjs|cjs|jse|wsf|wsh|ps1|psm1|sh|bash|html|htm|xhtml|svg|php|asp|aspx|jsp|jar|dll|sys|drv|reg|hta|cpl)$/i;
  const ALLOWED_EXT_RE = /\.(jpg|jpeg|png|webp|gif|pdf|doc|docx|xls|xlsx|ppt|pptx|txt|csv|rtf|odt|ods|odp|md|mp3|wav|ogg|m4a|webm|aac|mp4|mov|zip)$/i;
  const IMAGE_EXT_RE = /\.(jpg|jpeg|png|webp|gif)$/i;
  const DOC_EXT_RE = /\.(pdf|doc|docx|xls|xlsx|ppt|pptx|txt|csv|rtf|odt|ods|odp|md|zip)$/i;
  const QUICK_REACTIONS = ['❤️', '👍', '😂', '😮', '😢', '🙏'];
  const EMOJI_PALETTE = [
    '😀', '😂', '😍', '🥰', '😊', '🙌', '👏', '👍', '❤️', '🔥',
    '🎉', '💯', '🙏', '✨', '🤝', '💸', '💰', '🏦', '📈', '✅',
    '😮', '😢', '🤔', '👌', '💪', '😎', '🥳', '🫶', '💬', '📞'
  ];

  let initializedProfile = null;
  let meSocial = null;
  let rootMounted = false;
  let realtimeChannel = null;
  let typingChannel = null;
  let typingIdleTimer = null;
  let lastSeenTimer = null;
  let searchDebounce = null;
  let threadSearchDebounce = null;
  let openingChatTargetId = null;
  let pendingMsgSeq = 0;
  let activeVideoMenuPlayer = null;
  let activeFloatingMenuAnchor = null;
  let suppressBubbleClickId = null;
  let recentHoldMsgId = null;
  let recentHoldAt = 0;
  let isWindowFocused = typeof document !== 'undefined' && typeof document.hasFocus === 'function'
    ? Boolean(document.hasFocus())
    : true;

  const NEW_CHAT_ICON_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';
  const BACK_ARROW_ICON_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 12H5"/><path d="m12 19-7-7 7-7"/></svg>';

  const state = {
    tab: 'chats', // chats | requests | friends | discover | notifications
    chatFilter: 'inbox', // inbox | unread | archived
    friendsSubTab: 'all', // all | incoming | sent
    conversations: [],
    overview: { me: null, friends: [], incoming_requests: [], sent_requests: [], blocked_users: [] },
    socialNotifications: [],
    discoverUsers: [],
    discoverMessages: [],
    discoverQuery: '',
    chatListQuery: '',
    searchActive: false,
    searchLoading: false,
    conversationsLoaded: false,
    overviewLoaded: false,
    loadingConvs: false,
    discoverySeq: 0,
    activeConvId: null,
    activeThread: null,
    loadingThread: false,
    threadError: '',
    mobileShowThread: false,
    showThreadInfo: false,
    threadInfoView: 'root', // root | media | files
    showThreadSearch: false,
    threadSearchQuery: '',
    threadSearchSenderId: '',
    threadSearchMatches: [],
    threadSearchCursor: 0,
    replyToMsg: null,
    editingMsg: null,
    uploadQueue: [],
    pendingByConv: new Map(), // convId -> Array<PendingMsg>
    draftsByConv: new Map(),
    signedUrlCache: new Map(), // path -> signedUrl
    typingPeers: new Map(), // convId -> { timer, at }
    lastTypingSentAt: 0,
    lastTypingState: false,
    typingChannelConvId: null,
    openConvSeq: 0,
    recentMarkReadAt: new Map(), // convId -> timestamp
    lastThreadFingerprint: '',
    voiceRecorder: null,
    voiceChunks: [],
    voiceStartedAt: 0,
    voiceTimer: null,
    openDropdownMsgId: null,
    showPinnedList: false,
    activePinnedId: null
  };

  function ipon() { return window.Ipon; }
  function escapeHtml(v) { return ipon().escapeHtml(v); }
  function escAttr(v) { return escapeHtml(String(v ?? '')).replace(/`/g, '&#96;'); }
  function isEligible() {
    const p = initializedProfile || ipon()?.profile;
    return Boolean(p && p.role && p.role !== 'SUPER_ADMIN' && p.status === 'ACTIVE');
  }

  function formatBytes(bytes) {
    const n = Number(bytes) || 0;
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(n >= 10 * 1024 * 1024 ? 1 : 2)} MB`;
  }

  function formatClock(ts) {
    if (!ts) return '';
    try {
      return new Intl.DateTimeFormat('en-PH', { hour: 'numeric', minute: '2-digit' }).format(new Date(ts));
    } catch { return ''; }
  }

  function formatMediaDuration(rawSeconds) {
    const sec = Number(rawSeconds);
    if (!Number.isFinite(sec) || sec <= 0) return '0:00';
    const whole = Math.floor(sec);
    return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
  }

  function formatShortDate(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    if (sameDay) return formatClock(ts);
    const yest = new Date(now);
    yest.setDate(now.getDate() - 1);
    if (d.toDateString() === yest.toDateString()) return 'Yesterday';
    return new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric' }).format(d);
  }

  function formatDateDivider(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) return 'Today';
    const yest = new Date(now);
    yest.setDate(now.getDate() - 1);
    if (d.toDateString() === yest.toDateString()) return 'Yesterday';
    return new Intl.DateTimeFormat('en-PH', { weekday: 'short', month: 'short', day: 'numeric', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' }).format(d);
  }

  function formatStatusLine(user, isTyping = false) {
    if (isTyping) return 'Typing…';
    if (!user) return '';
    if (user.is_blocked || user.friendship_status === 'BLOCKED_BY_ME' || user.friendship_status === 'BLOCKED_ME') {
      return 'Messaging restricted';
    }
    if (!user.allow_online_status) return 'Privacy mode';
    if (ipon().isUserOnline(user.id)) return 'Active now';
    if (user.last_seen_at) {
      const diffSec = Math.max(0, Math.floor((Date.now() - Date.parse(user.last_seen_at)) / 1000));
      if (diffSec < 90) return 'Last seen moments ago';
      if (diffSec < 3600) return `Last seen ${Math.floor(diffSec / 60)}m ago`;
      if (diffSec < 86400) return `Last seen ${Math.floor(diffSec / 3600)}h ago`;
      return `Last seen ${formatShortDate(user.last_seen_at)}`;
    }
    return 'Offline';
  }

  function findKnownPeer(conversationId, userId = null) {
    if (conversationId) {
      const conv = state.conversations.find((c) => c.id === conversationId);
      if (conv?.peer) return { ...conv.peer, chat_theme: conv.chat_theme || 'paper' };
    }
    if (userId) {
      const target = String(userId);
      const pools = [
        ...(state.discoverUsers || []),
        ...(state.overview?.friends || []),
        ...(state.overview?.incoming_requests || []).map((r) => ({ id: r.user_id, full_name: r.full_name, username: r.username, avatar_url: r.avatar_url })),
        ...(state.overview?.sent_requests || []).map((r) => ({ id: r.user_id, full_name: r.full_name, username: r.username, avatar_url: r.avatar_url }))
      ];
      const hit = pools.find((u) => String(u?.id || '') === target);
      if (hit) return hit;
    }
    return null;
  }

  function skeletonHtml(kind, count = 4) {
    if (kind === 'thread') {
      return `<div class="msg-thread-skeleton" role="status" aria-label="Loading conversation">
        <div class="msg-thread-status-pill">
          <span class="msg-wave-dots" aria-hidden="true"><i></i><i></i><i></i></span>
          <span>Loading conversation</span>
        </div>
        <div class="msg-bubble-skel is-peer" style="--skel-delay:0ms">
          <span class="msg-skel msg-skel-circle msg-skel-av-sm"></span>
          <div class="msg-bubble-skel-stack">
            <div class="msg-bubble-skel-card" style="width:min(230px,68vw)"><span class="msg-skel msg-skel-line" style="width:74%"></span><span class="msg-skel msg-skel-line" style="width:48%"></span></div>
            <div class="msg-bubble-skel-card" style="width:min(156px,48vw)"><span class="msg-skel msg-skel-line" style="width:82%"></span></div>
          </div>
        </div>
        <div class="msg-bubble-skel is-mine" style="--skel-delay:90ms">
          <div class="msg-bubble-skel-stack">
            <div class="msg-bubble-skel-card" style="width:min(198px,60vw)"><span class="msg-skel msg-skel-line" style="width:86%"></span><span class="msg-skel msg-skel-line" style="width:52%"></span></div>
          </div>
        </div>
        <div class="msg-bubble-skel is-peer" style="--skel-delay:160ms">
          <span class="msg-skel msg-skel-circle msg-skel-av-sm"></span>
          <div class="msg-bubble-skel-stack">
            <div class="msg-bubble-skel-card is-tall" style="width:min(248px,72vw)"><span class="msg-skel msg-skel-line" style="width:66%"></span><span class="msg-skel msg-skel-line" style="width:92%"></span><span class="msg-skel msg-skel-line" style="width:42%"></span></div>
          </div>
        </div>
        <div class="msg-bubble-skel is-mine" style="--skel-delay:230ms">
          <div class="msg-bubble-skel-stack">
            <div class="msg-bubble-skel-card" style="width:min(138px,44vw)"><span class="msg-skel msg-skel-line" style="width:78%"></span></div>
          </div>
        </div>
      </div>`;
    }
    if (kind === 'header') {
      return `<div class="msg-thread-header-left msg-header-skel" aria-hidden="true">
        <span class="msg-skel msg-skel-circle msg-skel-av-md"></span>
        <div class="msg-skel-col">
          <span class="msg-skel msg-skel-line" style="width:138px;height:13px"></span>
          <span class="msg-skel msg-skel-line" style="width:88px;height:10px"></span>
        </div>
      </div>
      <div class="msg-thread-header-actions" aria-hidden="true">
        <span class="msg-skel msg-skel-circle msg-skel-icon"></span>
        <span class="msg-skel msg-skel-circle msg-skel-icon"></span>
      </div>`;
    }
    if (kind === 'popover') {
      return `<div class="msg-pop-skeleton" role="status" aria-label="Loading profile">
        <div class="msg-pop-head">
          <span class="msg-skel msg-skel-circle" style="width:64px;height:64px;flex-shrink:0"></span>
          <div class="msg-skel-col" style="flex:1">
            <span class="msg-skel msg-skel-line" style="width:74%;height:18px"></span>
            <span class="msg-skel msg-skel-line" style="width:58%;height:12px"></span>
          </div>
        </div>
        <span class="msg-skel msg-skel-rect" style="width:100%;height:44px;border-radius:14px"></span>
        <div class="msg-pop-actions">
          <span class="msg-skel msg-skel-rect" style="width:100%;height:44px;border-radius:13px"></span>
          <div class="msg-pop-secondary-row">
            <span class="msg-skel msg-skel-rect" style="width:100%;height:40px;border-radius:13px"></span>
            <span class="msg-skel msg-skel-rect" style="width:100%;height:40px;border-radius:13px"></span>
          </div>
        </div>
      </div>`;
    }
    if (kind === 'card') {
      return `<div class="msg-cards-grid" role="status" aria-label="Loading connections">${Array.from({ length: count }, (_, i) => `
        <div class="msg-person-card msg-card-skel" style="--skel-delay:${i * 55}ms">
          <div class="msg-person-head">
            <span class="msg-skel msg-skel-circle msg-skel-av-md"></span>
            <div class="msg-skel-col">
              <span class="msg-skel msg-skel-line" style="width:120px;height:13px"></span>
              <span class="msg-skel msg-skel-line" style="width:82px;height:10px"></span>
            </div>
          </div>
          <div class="msg-person-actions">
            <span class="msg-skel msg-skel-pill" style="width:76px;height:28px"></span>
            <span class="msg-skel msg-skel-pill" style="width:70px;height:28px"></span>
          </div>
        </div>`).join('')}</div>`;
    }
    if (kind === 'hit') {
      return `<div class="msg-skeleton-list" role="status" aria-label="Searching messages">${Array.from({ length: count }, (_, i) => `
        <div class="msg-hit-skel" style="--skel-delay:${i * 60}ms">
          <div class="msg-conv-top">
            <span class="msg-skel msg-skel-line" style="width:116px;height:12px"></span>
            <span class="msg-skel msg-skel-line" style="width:42px;height:10px"></span>
          </div>
          <span class="msg-skel msg-skel-line" style="width:84%;height:11px"></span>
        </div>`).join('')}</div>`;
    }
    const isPerson = kind === 'person';
    return `<div class="msg-skeleton-list" role="status" aria-label="${isPerson ? 'Loading people' : 'Loading conversations'}">${Array.from({ length: count }, (_, i) => `
      <div class="msg-row-skel" style="--skel-delay:${i * 55}ms">
        <span class="msg-skel msg-skel-circle msg-skel-av-md"></span>
        <div class="msg-skel-col">
          <div class="msg-conv-top">
            <span class="msg-skel msg-skel-line" style="width:${isPerson ? 124 : 132 - (i % 3) * 14}px;height:12.5px"></span>
            ${isPerson ? '' : '<span class="msg-skel msg-skel-line" style="width:36px;height:10px"></span>'}
          </div>
          <span class="msg-skel msg-skel-line" style="width:${isPerson ? 76 : 64 + (i % 2) * 18}%;height:10.5px"></span>
        </div>
        ${isPerson ? '<span class="msg-skel msg-skel-pill" style="width:50px;height:26px"></span>' : ''}
      </div>`).join('')}</div>`;
  }

  function userAvatarHtml(user, sizeClass = 'avatar-md', { clickable = true, showPresence = true } = {}) {
    if (!user) return '';
    const rawUrl = typeof user.avatar_url === 'string' ? user.avatar_url.trim() : '';
    const safeUrl = (rawUrl.startsWith('data:image/') || /^https:\/\//i.test(rawUrl)) ? rawUrl : '';
    const name = String(user.full_name || 'User');
    const letters = escapeHtml(ipon().initials(name));
    const cls = escapeHtml(sizeClass);
    const inner = safeUrl
      ? `<span class="avatar-circle ${cls}" title="${escapeHtml(name)}"><img src="${safeUrl}" alt="${escapeHtml(name)}" data-avatar-img><span class="avatar-fallback-inner" hidden>${letters}</span></span>`
      : `<span class="avatar-circle avatar-fallback ${cls}" title="${escapeHtml(name)}">${letters}</span>`;
    const isOnline = showPresence && user.allow_online_status !== false && ipon().isUserOnline(user.id);
    const dot = showPresence && user.allow_online_status !== false
      ? `<span class="presence-dot${isOnline ? ' is-online' : ''}" data-presence-id="${escapeHtml(user.id)}" aria-label="${isOnline ? 'Active now' : 'Offline'}" title="${isOnline ? 'Active now' : 'Offline'}"></span>`
      : '';
    const wrap = `<span class="avatar-presence-wrap msg-avatar-wrap">${inner}${dot}</span>`;
    if (!clickable || !user.id || String(user.id) === String(initializedProfile?.id)) return wrap;
    return `<button type="button" class="msg-dp-btn" data-social-user-dp="${escapeHtml(user.id)}" aria-label="View profile options for ${escapeHtml(name)}" title="Profile & options">${wrap}</button>`;
  }

  function highlightMatches(escapedText, query) {
    if (!query) return escapedText;
    const cleanQ = escapeHtml(query.trim());
    if (!cleanQ) return escapedText;
    const pattern = cleanQ.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return escapedText.replace(new RegExp(`(${pattern})`, 'gi'), '<mark class="msg-search-hit">$1</mark>');
  }

  function formatMessageBodyHtml(rawText, query = '') {
    const raw = String(rawText || '');
    if (!raw) return '';
    const parts = raw.split(/(https?:\/\/[^\s<>"']+)/gi);
    return parts.map((part, idx) => {
      if (idx % 2 === 1 && /^https?:\/\//i.test(part)) {
        const cleanHref = part.replace(/[),.?!;:'"]+$/, '');
        const trailing = part.slice(cleanHref.length);
        return `<a class="msg-link" href="${escAttr(cleanHref)}" target="_blank" rel="noopener noreferrer">${highlightMatches(escapeHtml(cleanHref), query)}</a>${highlightMatches(escapeHtml(trailing), query)}`;
      }
      return highlightMatches(escapeHtml(part), query);
    }).join('').replace(/\n/g, '<br>');
  }

  function detectAttachmentKind(file) {
    const type = String(file?.type || '').toLowerCase();
    const name = String(file?.name || '').toLowerCase();
    if (type.startsWith('image/')) return 'image';
    if (type.startsWith('audio/')) return 'audio';
    if (type.startsWith('video/')) return 'video';
    if (IMAGE_EXT_RE.test(name)) return 'image';
    if (/\.(mp3|wav|ogg|m4a|aac)$/i.test(name)) return 'audio';
    if (/\.(mp4|mov|webm)$/i.test(name)) return 'video';
    if (DOC_EXT_RE.test(name) || /pdf|word|excel|spreadsheet|powerpoint|presentation|text|csv/i.test(type)) return 'document';
    return 'file';
  }

  function formatBadgeLabel(att) {
    const name = String(att?.name || '');
    const ext = name.includes('.') ? name.split('.').pop().toUpperCase().slice(0, 6) : '';
    if (ext) return ext;
    return String(att?.kind || 'FILE').toUpperCase().slice(0, 6);
  }

  function ensureDialogsMounted() {
    if (rootMounted || !isEligible()) return;
    rootMounted = true;
    document.body.insertAdjacentHTML('beforeend', `
      <dialog class="msg-dialog" id="msg-workspace-dialog" aria-labelledby="msg-workspace-title">
        <div class="msg-shell">
          <header class="msg-topbar">
            <div class="msg-brand">
              <h2 id="msg-workspace-title">Messages &amp; Connections</h2>
              <p id="msg-workspace-subtitle">Private chats, friends, and social connections</p>
            </div>
            <nav class="msg-tabs" role="tablist" aria-label="Messaging sections">
              <button class="msg-tab is-active" type="button" role="tab" data-msg-tab="chats" aria-selected="true">
                <span>Chats</span>
                <b id="msg-tab-chats-badge" hidden>0</b>
              </button>
              <button class="msg-tab" type="button" role="tab" data-msg-tab="requests" aria-selected="false" aria-label="Message Requests" title="Message Requests">
                <span>Requests</span>
                <b id="msg-tab-req-badge" hidden>0</b>
              </button>
              <button class="msg-tab" type="button" role="tab" data-msg-tab="friends" aria-selected="false">
                <span>Friends</span>
                <b id="msg-tab-friends-badge" hidden>0</b>
              </button>
            </nav>
            <div class="msg-topbar-actions">
              <button class="msg-icon-btn" id="msg-alerts-btn" type="button" aria-label="Social alerts" title="Messaging & friend notifications">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9m-8 13h4"/></svg>
                <b id="msg-alerts-badge" hidden>0</b>
              </button>
              <button class="msg-icon-btn" id="msg-privacy-btn" type="button" aria-label="Privacy & handle settings" title="Messaging privacy & blocked users">
                <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.26.6.85 1 1.51 1H21a2 2 0 0 1 0 4h-.09c-.66 0-1.25.4-1.51 1Z"/></svg>
              </button>
              <button class="dialog-close" id="msg-workspace-close" type="button" aria-label="Close messaging">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>
              </button>
            </div>
          </header>

          <div class="msg-body" id="msg-body-root">
            <!-- Split-pane Chats & Message Requests view -->
            <section class="msg-chat-layout" id="msg-view-chats">
              <aside class="msg-sidebar" id="msg-conv-sidebar" aria-label="Conversations">
                <div class="msg-sidebar-search">
                  <div class="msg-sidebar-search-row">
                    <div class="msg-search-input-wrap">
                      <svg class="msg-search-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
                      <input id="msg-list-search" type="search" placeholder="Search chats, people, or messages…" aria-label="Search chats, people, or messages" autocomplete="off">
                      <button type="button" class="msg-search-clear" id="msg-list-search-clear" aria-label="Clear search" title="Clear search" hidden>
                        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>
                      </button>
                    </div>
                    <button type="button" class="msg-new-chat-btn" id="msg-new-chat-btn" data-mode="compose" aria-label="Browse people directory" aria-pressed="false" title="New chat / Browse people">
                      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
                    </button>
                  </div>
                  <div class="msg-filter-pills" id="msg-filter-pills">
                    <button type="button" class="msg-pill is-active" data-msg-filter="inbox">Inbox</button>
                    <button type="button" class="msg-pill" data-msg-filter="unread">Unread</button>
                    <button type="button" class="msg-pill" data-msg-filter="archived">Archived</button>
                  </div>
                </div>
                <div class="msg-conv-list" id="msg-conv-list" role="listbox" aria-label="Conversation list"></div>
              </aside>

              <section class="msg-thread-pane" id="msg-thread-pane" aria-label="Active conversation">
                <div id="msg-thread-empty" class="empty-state msg-thread-empty">
                  <div class="msg-empty-art" aria-hidden="true">
                    <svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                  </div>
                  <h3>Select a conversation</h3>
                  <p>Pick an existing chat on the left, check Message Requests, or use the search bar to find people.</p>
                  <button type="button" class="button button-primary button-sm" id="msg-empty-find-btn">Browse people &amp; start chat</button>
                </div>

                <div class="msg-thread-active" id="msg-thread-active" hidden>
                  <div class="msg-thread-main">
                    <header class="msg-thread-header" id="msg-thread-header"></header>
                    <div class="msg-thread-search-bar" id="msg-thread-search-bar" hidden>
                      <div class="msg-thread-search-controls">
                        <div class="msg-search-input-wrap msg-thread-search-wrap">
                          <svg class="msg-search-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
                          <input id="msg-thread-search-input" type="search" placeholder="Search words, files, or phrases…" aria-label="Search in conversation" autocomplete="off">
                        </div>
                        <select id="msg-thread-search-sender" aria-label="Filter by sender">
                          <option value="">All senders</option>
                        </select>
                        <span class="msg-search-counter" id="msg-thread-search-count"></span>
                        <button type="button" class="msg-mini-btn" id="msg-search-prev" aria-label="Previous match" title="Previous match">&#8593;</button>
                        <button type="button" class="msg-mini-btn" id="msg-search-next" aria-label="Next match" title="Next match">&#8595;</button>
                        <button type="button" class="dialog-close msg-mini-close" id="msg-thread-search-close" aria-label="Close thread search"><svg viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18"/></svg></button>
                      </div>
                    </div>
                    <div class="msg-pinned-banner" id="msg-pinned-banner" hidden></div>
                    <div class="msg-request-banner" id="msg-request-banner" hidden></div>

                    <div class="msg-thread-stage" id="msg-thread-stage">
                      <div class="msg-scroll-wrap" id="msg-scroll-wrap">
                        <div class="msg-load-older-wrap" id="msg-load-older-wrap" hidden>
                          <button type="button" class="button button-secondary button-sm" id="msg-load-older-btn">Load older messages</button>
                        </div>
                        <div class="msg-messages-list" id="msg-messages-list" role="log" aria-live="polite"></div>
                        <div class="msg-typing-live" id="msg-typing-live" aria-hidden="true" aria-live="polite">
                          <div class="msg-typing-live-inner">
                            <div class="msg-typing-avatar" id="msg-typing-avatar"></div>
                            <div class="msg-typing-bubble">
                              <span class="msg-typing-text" aria-hidden="true">is typing<span class="msg-typing-dots"><span>.</span><span>.</span><span>.</span></span></span>
                              <span class="sr-only" id="msg-typing-live-text">Typing…</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    <footer class="msg-composer-wrap" id="msg-composer-wrap">
                      <div class="msg-blocked-banner" id="msg-blocked-banner" hidden></div>
                      <div class="msg-context-bar" id="msg-context-bar" hidden></div>
                      <div class="msg-upload-queue" id="msg-upload-queue" hidden></div>
                      <div class="msg-emoji-popover" id="msg-emoji-popover" hidden></div>
                      <form class="msg-composer-form" id="msg-composer-form">
                        <input id="msg-file-input" type="file" multiple accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.rtf,.odt,.ods,.odp,.md,.zip" hidden>
                        <div class="msg-composer-tools">
                          <button type="button" class="msg-tool-btn" id="msg-attach-btn" aria-label="Attach photos or documents" title="Attach photos, videos, or documents (original quality)">
                            <svg viewBox="0 0 24 24"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
                          </button>
                          <button type="button" class="msg-tool-btn" id="msg-emoji-btn" aria-label="Insert emoji" title="Emoji picker">
                            <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>
                          </button>
                          <button type="button" class="msg-tool-btn" id="msg-voice-btn" aria-label="Record voice message" aria-pressed="false" title="Record voice note">
                            <svg viewBox="0 0 24 24"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
                          </button>
                        </div>
                        <div class="msg-voice-recording" id="msg-voice-recording" role="status" aria-live="polite" hidden>
                          <div class="msg-voice-rec-status">
                            <span class="msg-voice-rec-eyebrow"><span class="msg-rec-dot" aria-hidden="true"></span><span class="msg-voice-rec-label">RECORDING</span></span>
                            <span id="msg-voice-timer">0:00</span>
                          </div>
                          <button type="button" class="button msg-voice-cancel" id="msg-voice-cancel">Cancel</button>
                          <button type="button" class="button msg-voice-send" id="msg-voice-send"><span>Send</span> <span>voice</span></button>
                        </div>
                        <label class="sr-only" for="msg-composer-input">Message text</label>
                        <textarea id="msg-composer-input" rows="1" maxlength="500" placeholder="Write a message…"></textarea>
                        <button type="submit" class="msg-send-btn" id="msg-send-btn" aria-label="Send message" title="Send">
                          <svg viewBox="0 0 24 24" aria-hidden="true"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
                        </button>
                      </form>
                      <div class="msg-composer-meta">
                        <span class="msg-retention-note">Messages &amp; media older than 90 days automatically clear to keep storage fast.</span>
                        <span class="msg-char-counter" id="msg-char-counter" hidden>0 / 500</span>
                      </div>
                    </footer>
                  </div>
                  <aside class="msg-thread-drawer" id="msg-thread-drawer" hidden aria-label="Shared media and thread details"></aside>
                </div>
              </section>
            </section>

            <!-- Friends & connections view -->
            <section class="msg-panel-view" id="msg-view-friends" hidden></section>

            <!-- Dedicated Social Notifications view -->
            <section class="msg-panel-view" id="msg-view-alerts" hidden></section>
          </div>
        </div>
      </dialog>

      <!-- Viewport-aware Profile Quick Action Popover -->
      <div class="msg-profile-popover" id="msg-profile-popover" role="dialog" aria-modal="false" aria-labelledby="msg-pop-name" hidden></div>

      <!-- Privacy, Handle & Blocked Users Dialog -->
      <dialog class="form-dialog msg-sub-dialog" id="msg-settings-dialog" aria-labelledby="msg-settings-title">
        <div class="form-dialog-sheet">
          <header class="form-dialog-header">
            <div>
              <h2 id="msg-settings-title">Messaging &amp; Privacy</h2>
              <p>Manage your handle, visibility, request controls, and blocked accounts.</p>
            </div>
            <button class="dialog-close" type="button" data-msg-settings-close aria-label="Close privacy settings"><svg viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18"/></svg></button>
          </header>
          <div class="msg-settings-body" id="msg-settings-body"></div>
        </div>
      </dialog>

      <!-- Forward Message Picker Dialog -->
      <dialog class="form-dialog msg-sub-dialog" id="msg-forward-dialog" aria-labelledby="msg-forward-title">
        <div class="form-dialog-sheet">
          <header class="form-dialog-header">
            <div>
              <h2 id="msg-forward-title">Forward message</h2>
              <p>Select a person or conversation to forward this message to.</p>
            </div>
            <button class="dialog-close" type="button" data-msg-forward-close aria-label="Close forward dialog"><svg viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18"/></svg></button>
          </header>
          <div class="msg-forward-body" id="msg-forward-body"></div>
        </div>
      </dialog>
    `);

    document.getElementById('msg-workspace-dialog')?.addEventListener('close', () => {
      sendTypingBroadcast(false);
      clearTimeout(typingIdleTimer);
      typingIdleTimer = null;
      state.typingPeers.forEach((entry) => { if (entry?.timer) clearTimeout(entry.timer); });
      state.typingPeers.clear();
      const liveRow = document.getElementById('msg-typing-live');
      if (liveRow) {
        liveRow.classList.remove('is-visible');
        liveRow.setAttribute('aria-hidden', 'true');
      }
      closeProfilePopover();
      closeFloatingMenus();
      state.showThreadInfo = false;
      state.threadInfoView = 'root';
      document.querySelectorAll('#msg-messages-list video, #msg-messages-list audio').forEach((m) => { try { m.pause?.(); } catch { } });
      if (typeof disconnectTypingChannel === 'function') disconnectTypingChannel();
      clearActiveThreadSelection();
      state.mobileShowThread = false;
      syncMobilePaneState();
      state.lastTypingState = false;
      state.lastTypingSentAt = 0;
    });
    document.getElementById('msg-scroll-wrap')?.addEventListener('scroll', closeFloatingMenus, { passive: true });
  }

  function disconnectTypingChannel() {
    if (typingChannel) {
      try { ipon().client?.removeChannel(typingChannel); } catch { }
      typingChannel = null;
      state.typingChannelConvId = null;
    }
  }

  const missingUrlRetry = new Map(); // path -> { attempts, lastAt }
  let missingUrlTimer = null;

  // Edge Storage helpers (raw lossless upload & XHR byte progress)
  async function ensureSignedViewUrls(conversationId, paths = []) {
    const missing = [...new Set(paths.map((p) => String(p || '').trim()).filter((p) => p && !state.signedUrlCache.has(p)))];
    if (!missing.length || !conversationId) return;
    try {
      const { urls = {} } = await ipon().invokeAccountFunction({
        action: 'chat-view-urls',
        conversation_id: conversationId,
        paths: missing
      });
      Object.entries(urls).forEach(([path, signed]) => {
        if (path && signed) {
          state.signedUrlCache.set(path, signed);
          missingUrlRetry.delete(path);
        }
      });
    } catch (_) { }
  }

  function scheduleMissingSignedUrls(conversationId, paths = []) {
    if (!conversationId || state.activeConvId !== conversationId || typeof setTimeout !== 'function') return;
    const now = Date.now();
    const eligible = [...new Set(paths.map((p) => String(p || '').trim()).filter((p) => {
      if (!p || state.signedUrlCache.has(p)) return false;
      const info = missingUrlRetry.get(p);
      return !info || (info.attempts < 3 && (now - info.lastAt) >= info.attempts * 1500);
    }))];
    if (!eligible.length) return;
    if (missingUrlTimer) clearTimeout(missingUrlTimer);
    missingUrlTimer = setTimeout(async () => {
      missingUrlTimer = null;
      if (state.activeConvId !== conversationId) return;
      const runAt = Date.now();
      const batch = eligible.filter((p) => !state.signedUrlCache.has(p));
      if (!batch.length) return;
      batch.forEach((p) => {
        const prev = missingUrlRetry.get(p);
        missingUrlRetry.set(p, { attempts: (prev?.attempts || 0) + 1, lastAt: runAt });
      });
      await ensureSignedViewUrls(conversationId, batch);
      if (state.activeConvId !== conversationId || !state.activeThread?.conversation) return;
      if (batch.some((p) => state.signedUrlCache.has(p))) {
        state.lastThreadFingerprint = computeThreadFingerprint(state.activeThread);
        renderMessagesList();
      }
    }, 450);
  }

  function uploadFileRawWithProgress(entry, uploadMeta, onProgress) {
    return new Promise((resolve, reject) => {
      if (uploadMeta.signedUrl && typeof XMLHttpRequest !== 'undefined') {
        const xhr = new XMLHttpRequest();
        xhr.open('PUT', uploadMeta.signedUrl, true);
        if (entry.file.type) xhr.setRequestHeader('Content-Type', entry.file.type);
        xhr.upload.onprogress = (ev) => {
          if (ev.lengthComputable) onProgress(Math.min(99, Math.round((ev.loaded / ev.total) * 100)));
        };
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            onProgress(100);
            resolve();
          } else {
            reject(new Error(`Upload failed (${xhr.status}).`));
          }
        };
        xhr.onerror = () => reject(new Error('Network error during file upload.'));
        xhr.send(entry.file); // Exact untouched raw File object (zero compression)
      } else {
        ipon().client.storage
          .from('chat-attachments')
          .uploadToSignedUrl(uploadMeta.path, uploadMeta.token, entry.file, { contentType: entry.file.type || undefined })
          .then(({ error }) => {
            if (error) reject(error);
            else {
              onProgress(100);
              resolve();
            }
          })
          .catch(reject);
      }
    });
  }

  async function downloadOriginalAttachment(conversationId, path, fileName) {
    try {
      const { downloadUrl } = await ipon().invokeAccountFunction({
        action: 'chat-view-urls',
        conversation_id: conversationId,
        download_path: path,
        download_name: fileName || 'attachment'
      });
      if (!downloadUrl) throw new Error('Download link unavailable.');
      if (typeof ipon().downloadFile === 'function') {
        await ipon().downloadFile(downloadUrl, fileName || 'attachment');
      } else {
        const a = document.createElement('a');
        a.href = downloadUrl;
        a.download = fileName || 'attachment';
        a.rel = 'noopener';
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
    } catch (error) {
      ipon().toast(ipon().friendlyError(error), 'error');
    }
  }

  const VIDEO_POSTER_FALLBACK = "data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D'http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg'%20viewBox%3D'0%200%2016%209'%3E%3Cdefs%3E%3ClinearGradient%20id%3D'g'%20x1%3D'0'%20y1%3D'0'%20x2%3D'1'%20y2%3D'1'%3E%3Cstop%20offset%3D'0'%20stop-color%3D'%230f241c'%2F%3E%3Cstop%20offset%3D'1'%20stop-color%3D'%23071510'%2F%3E%3C%2FlinearGradient%3E%3C%2Fdefs%3E%3Crect%20width%3D'16'%20height%3D'9'%20fill%3D'url(%23g)'%2F%3E%3C%2Fsvg%3E";
  const videoMetaCache = new Map();
  const videoPosterInFlight = new Set();

  function getVideoMetaKey(path, url) {
    return String(path || url || '').trim();
  }

  function formatVideoBoxStyle(meta) {
    const w = Number(meta?.width || 0);
    const h = Number(meta?.height || 0);
    if (!(w > 0 && h > 0)) return '';
    const ar = w / h;
    const clampedW = Math.max(140, Math.min(260, Math.round(300 * ar)));
    return `--vid-w:${clampedW}px;--vid-ar:${w} / ${h};`;
  }

  function applyCachedVideoMetaToDom(key, meta) {
    if (!key || !meta || typeof document?.querySelectorAll !== 'function') return;
    const selKey = typeof CSS?.escape === 'function' ? CSS.escape(key) : key.replace(/"/g, '\\"');
    const styleStr = formatVideoBoxStyle(meta);
    document.querySelectorAll(`[data-vid-key="${selKey}"]`).forEach((node) => {
      if (styleStr && node.classList?.contains?.('msg-video-player')) {
        const wMatch = styleStr.match(/--vid-w:([^;]+);/);
        const arMatch = styleStr.match(/--vid-ar:([^;]+);/);
        if (wMatch) node.style?.setProperty?.('--vid-w', wMatch[1]);
        if (arMatch) node.style?.setProperty?.('--vid-ar', arMatch[1]);
      }
      const vid = node.tagName === 'VIDEO' ? node : node.querySelector?.('video');
      if (vid && meta.poster && vid.getAttribute?.('poster') !== meta.poster) {
        vid.setAttribute?.('poster', meta.poster);
        try { vid.poster = meta.poster; } catch { }
      }
    });
  }

  function copyVideoMetaAlias(fromKey, toKey) {
    if (!fromKey || !toKey || fromKey === toKey) return;
    const existing = videoMetaCache.get(fromKey);
    if (existing) {
      videoMetaCache.set(toKey, { ...existing });
      applyCachedVideoMetaToDom(toKey, existing);
    }
  }

  function probeAndCaptureVideoMeta(src, key, { isLocalBlob = false } = {}) {
    if (!src || !key || typeof document?.createElement !== 'function') return;
    const prev = videoMetaCache.get(key);
    if (prev?.poster || videoPosterInFlight.has(key)) return;
    if (prev?.failed) return;
    videoPosterInFlight.add(key);

    let settled = false;
    let probeVid = null;
    const finish = (patch = null) => {
      if (settled) return;
      settled = true;
      videoPosterInFlight.delete(key);
      clearTimeout(timeoutId);
      if (patch) {
        const merged = { ...(videoMetaCache.get(key) || {}), ...patch };
        videoMetaCache.set(key, merged);
        applyCachedVideoMetaToDom(key, merged);
      }
      if (probeVid) {
        try {
          probeVid.pause?.();
          probeVid.removeAttribute?.('src');
          probeVid.load?.();
        } catch { }
        probeVid = null;
      }
    };
    const timeoutId = setTimeout(() => finish({ failed: true }), 9000);

    try {
      probeVid = document.createElement('video');
      if (!probeVid || typeof probeVid.addEventListener !== 'function') {
        finish({ failed: true });
        return;
      }
      probeVid.muted = true;
      probeVid.playsInline = true;
      probeVid.preload = 'auto';
      const canUseCors = !isLocalBlob && !src.startsWith('blob:') && !src.startsWith('data:');
      if (canUseCors) probeVid.crossOrigin = 'anonymous';

      const captureFrame = () => {
        if (settled || !probeVid) return false;
        const vw = Number(probeVid.videoWidth || 0);
        const vh = Number(probeVid.videoHeight || 0);
        if (!(vw > 0 && vh > 0)) return false;
        try {
          const canvas = document.createElement('canvas');
          if (!canvas?.getContext) return false;
          const scale = Math.min(1, 480 / Math.max(vw, vh));
          canvas.width = Math.max(1, Math.round(vw * scale));
          canvas.height = Math.max(1, Math.round(vh * scale));
          const ctx = canvas.getContext('2d');
          if (!ctx) return false;
          ctx.drawImage(probeVid, 0, 0, canvas.width, canvas.height);
          const poster = canvas.toDataURL('image/jpeg', 0.82);
          if (poster && poster.startsWith('data:image/')) {
            finish({ width: vw, height: vh, duration: Number(probeVid.duration || 0), poster });
            return true;
          }
        } catch {
          finish({ width: vw, height: vh, duration: Number(probeVid.duration || 0), failed: true });
          return true;
        }
        return false;
      };

      probeVid.addEventListener('loadedmetadata', () => {
        const vw = Number(probeVid?.videoWidth || 0);
        const vh = Number(probeVid?.videoHeight || 0);
        if (vw > 0 && vh > 0) {
          const base = { ...(videoMetaCache.get(key) || {}), width: vw, height: vh, duration: Number(probeVid?.duration || 0) };
          videoMetaCache.set(key, base);
          applyCachedVideoMetaToDom(key, base);
        }
        try {
          const targetTime = Number.isFinite(probeVid.duration) && probeVid.duration > 0.25
            ? Math.min(0.25, probeVid.duration * 0.1)
            : 0.05;
          probeVid.currentTime = targetTime;
        } catch { }
      });
      probeVid.addEventListener('seeked', () => { if (!captureFrame()) finish({ failed: true }); });
      probeVid.addEventListener('loadeddata', () => { captureFrame(); });
      probeVid.addEventListener('error', () => finish({ failed: true }));
      probeVid.src = src;
    } catch {
      finish({ failed: true });
    }
  }

  function openVideoViewerForPlayer(triggerEl) {
    if (!triggerEl || typeof ipon()?.openVideoViewer !== 'function') return;
    const convId = triggerEl.dataset?.vidConv || state.activeConvId || '';
    const path = triggerEl.dataset?.vidPath || '';
    const name = triggerEl.dataset?.vidName || 'video.mp4';
    const inlineVideo = triggerEl.querySelector?.('video') || (triggerEl.tagName === 'VIDEO' ? triggerEl : null);
    const src = inlineVideo?.currentSrc || inlineVideo?.src || (path ? state.signedUrlCache.get(path) : '') || triggerEl.dataset?.openVid || '';
    if (!src) return;
    const key = getVideoMetaKey(path, src);
    const cached = videoMetaCache.get(key);
    const rawPoster = cached?.poster || (inlineVideo?.poster && inlineVideo.poster !== VIDEO_POSTER_FALLBACK ? inlineVideo.poster : '');
    const dur = Number.isFinite(inlineVideo?.duration) && inlineVideo.duration > 0
      ? inlineVideo.duration
      : Number(cached?.duration || 0);
    const sub = dur > 0 ? formatMediaDuration(dur) : '';
    pauseOtherChatMedia(null);
    if (inlineVideo && !inlineVideo.paused) {
      try { inlineVideo.pause?.(); } catch { }
    }
    ipon().openVideoViewer(src, name || 'Video', sub, name || 'video.mp4', {
      poster: rawPoster,
      startTime: Number(inlineVideo?.currentTime || 0),
      muted: Boolean(inlineVideo?.muted),
      autoplay: true,
      onDownload: path && convId ? () => downloadOriginalAttachment(convId, path, name || 'video.mp4') : null,
      onClose: ({ currentTime, muted } = {}) => {
        if (!inlineVideo || inlineVideo.isConnected === false) return;
        try {
          if (typeof muted === 'boolean') inlineVideo.muted = muted;
          if (Number.isFinite(currentTime) && Number.isFinite(inlineVideo.duration) && inlineVideo.duration > 0) {
            inlineVideo.currentTime = Math.max(0, Math.min(inlineVideo.duration, currentTime));
          }
        } catch { }
        syncVideoPlayerUi(inlineVideo);
      }
    });
  }

  function isThreadActivelyVisible() {
    const dialog = document.getElementById('msg-workspace-dialog');
    if (!dialog?.open || !state.activeConvId) return false;
    if (typeof document.visibilityState === 'string' && document.visibilityState !== 'visible') return false;
    if (!isWindowFocused) return false;
    if (typeof document.hasFocus === 'function' && !document.hasFocus()) return false;
    const blockingOverlayIds = ['msg-settings-dialog', 'msg-forward-dialog', 'notification-dialog', 'account-dialog', 'confirm-dialog', 'record-action-dialog', 'notif-unblock-dialog'];
    if (blockingOverlayIds.some((id) => Boolean(document.getElementById(id)?.open))) return false;
    if (typeof document.querySelector === 'function' && document.querySelector('dialog[open]:not(#msg-workspace-dialog):not(#ipon-image-viewer):not(#ipon-video-viewer)')) {
      return false;
    }
    const isCompact = (typeof window.matchMedia === 'function' && (window.matchMedia('(max-width: 820px)').matches || window.matchMedia('(max-width: 720px)').matches))
      || (Number(window.innerWidth) > 0 && Number(window.innerWidth) <= 820);
    if (isCompact && (!state.mobileShowThread || state.showThreadInfo || state.searchActive)) {
      return false;
    }
    return state.tab === 'chats' || state.tab === 'requests';
  }

  function renderReactionsRowHtml(m) {
    const reactionCounts = new Map();
    (m?.reactions || []).forEach((r) => {
      const prev = reactionCounts.get(r.emoji) || { count: 0, mine: false, users: [] };
      prev.count += 1;
      if (r.user_id === initializedProfile?.id) prev.mine = true;
      prev.users.push(r.user_name || 'User');
      reactionCounts.set(r.emoji, prev);
    });
    return reactionCounts.size
      ? `<div class="msg-reactions-row">${Array.from(reactionCounts.entries()).map(([emoji, meta]) =>
          `<button type="button" class="msg-reaction-pill${meta.mine ? ' is-mine' : ''}" data-react-msg="${escapeHtml(m.id)}" data-react-emoji="${escAttr(emoji)}" title="${escapeHtml(meta.users.join(', '))}">${escapeHtml(emoji)} <span>${meta.count}</span></button>`
        ).join('')}</div>`
      : '';
  }

  function renderReceiptTickHtml(m, conv) {
    const mine = m?.sender_id === initializedProfile?.id;
    const isDeleted = Boolean(m?.deleted_for_everyone_at);
    if (!mine || isDeleted) return '';
    if (conv?.receipts_enabled && m.read_at) {
      return `<span class="msg-tick is-read" title="Seen" aria-label="Seen">${DOUBLE_CHECK_SVG}</span>`;
    }
    if (m.delivered_at) {
      return `<span class="msg-tick is-delivered" title="Delivered" aria-label="Delivered">${DOUBLE_CHECK_SVG}</span>`;
    }
    return `<span class="msg-tick is-sent" title="Sent" aria-label="Sent">${SINGLE_CHECK_SVG}</span>`;
  }

  function patchMessageReactionsDom(msg) {
    const list = document.getElementById('msg-messages-list');
    if (!msg?.id || !list?.querySelector) return false;
    const escId = typeof CSS?.escape === 'function' ? CSS.escape(String(msg.id)) : String(msg.id);
    const row = list.querySelector(`.msg-row[data-msg-id="${escId}"]`);
    const col = row?.querySelector?.('.msg-bubble-col');
    if (!row || !col) return false;
    const wrap = document.getElementById('msg-scroll-wrap');
    const prevTop = wrap ? wrap.scrollTop : 0;
    const nearBottom = !wrap || (wrap.scrollHeight - wrap.scrollTop - wrap.clientHeight < 96);
    const html = renderReactionsRowHtml(msg);
    const existing = col.querySelector('.msg-reactions-row');
    if (!html) {
      existing?.remove?.();
    } else if (existing) {
      existing.outerHTML = html;
    } else {
      col.insertAdjacentHTML('beforeend', html);
    }
    if (wrap) {
      if (nearBottom) wrap.scrollTop = wrap.scrollHeight;
      else wrap.scrollTop = prevTop;
    }
    return true;
  }

  function patchMessageReceiptsDom(msg, conv = state.activeThread?.conversation) {
    const list = document.getElementById('msg-messages-list');
    if (!msg?.id || !list?.querySelector) return false;
    const escId = typeof CSS?.escape === 'function' ? CSS.escape(String(msg.id)) : String(msg.id);
    const row = list.querySelector(`.msg-row[data-msg-id="${escId}"]`);
    if (!row) return false;
    const nextTick = renderReceiptTickHtml(msg, conv);
    const metaEl = row.querySelector('.msg-bubble-meta');
    if (metaEl) {
      const oldTick = metaEl.querySelector('.msg-tick');
      if (oldTick) oldTick.outerHTML = nextTick;
      else if (nextTick) metaEl.insertAdjacentHTML('beforeend', nextTick);
      return true;
    }
    return false;
  }

  function tryPatchActiveThreadInPlace(prevThread, nextThread) {
    if (!prevThread?.conversation || !nextThread?.conversation) return false;
    const pc = prevThread.conversation;
    const nc = nextThread.conversation;
    if (
      pc.conversation_id !== nc.conversation_id
      || pc.status !== nc.status
      || pc.chat_theme !== nc.chat_theme
      || Boolean(pc.receipts_enabled) !== Boolean(nc.receipts_enabled)
      || pc.friendship_status !== nc.friendship_status
      || Boolean(prevThread.has_older) !== Boolean(nextThread.has_older)
    ) {
      return false;
    }
    if (JSON.stringify(prevThread.pinned_messages || []) !== JSON.stringify(nextThread.pinned_messages || [])) {
      return false;
    }
    if (typeof document !== 'undefined' && document.querySelector?.('#msg-messages-list .msg-att-loading')) {
      return false;
    }
    const prevMsgs = prevThread.messages || [];
    const nextMsgs = nextThread.messages || [];
    if (prevMsgs.length !== nextMsgs.length) return false;
    const changedReactions = [];
    const changedReceipts = [];
    for (let i = 0; i < prevMsgs.length; i += 1) {
      const a = prevMsgs[i];
      const b = nextMsgs[i];
      if (
        a.id !== b.id
        || a.body !== b.body
        || a.edited_at !== b.edited_at
        || a.deleted_for_everyone_at !== b.deleted_for_everyone_at
        || JSON.stringify(a.attachments || []) !== JSON.stringify(b.attachments || [])
      ) {
        return false;
      }
      if (JSON.stringify(a.reactions || []) !== JSON.stringify(b.reactions || [])) {
        changedReactions.push(b);
      }
      if (a.delivered_at !== b.delivered_at || a.read_at !== b.read_at) {
        changedReceipts.push(b);
      }
    }
    for (const m of changedReactions) {
      if (!patchMessageReactionsDom(m)) return false;
    }
    for (const m of changedReceipts) {
      patchMessageReceiptsDom(m, nc);
    }
    return true;
  }

  function revealVideoControls(player, { autoHideMs = 2400 } = {}) {
    if (!player) return;
    player.classList.add('is-controls-visible');
    player.closest?.('.msg-bubble')?.classList?.toggle('is-video-controls-active', true);
    clearTimeout(player._hideTimer);
    if (autoHideMs > 0) {
      player._hideTimer = setTimeout(() => {
        if (!player.dataset.seeking) {
          player.classList.remove('is-controls-visible');
          player.closest?.('.msg-bubble')?.classList?.toggle('is-video-controls-active', false);
        }
      }, autoHideMs);
    }
  }

  function syncVideoPlayerUi(video) {
    const player = video?.closest?.('.msg-video-player');
    if (!player) return;
    const playing = !video.paused && !video.ended;
    const muted = Boolean(video.muted || video.volume === 0);
    player.classList.toggle('is-playing', playing);
    player.classList.toggle('is-muted', muted);
    const playBtn = player.querySelector('[data-vact="play"]');
    if (playBtn) {
      playBtn.innerHTML = playing ? VIDEO_PAUSE_SVG : VIDEO_PLAY_SVG;
      playBtn.setAttribute('aria-label', playing ? 'Pause video' : 'Play video');
      playBtn.setAttribute('title', playing ? 'Pause' : 'Play');
    }
    const muteBtn = player.querySelector('[data-vact="mute"]');
    if (muteBtn) {
      muteBtn.innerHTML = muted ? VIDEO_VOL_OFF_SVG : VIDEO_VOL_ON_SVG;
      muteBtn.setAttribute('aria-label', muted ? 'Unmute audio' : 'Mute audio');
      muteBtn.setAttribute('title', muted ? 'Unmute' : 'Mute');
    }
    const seek = player.querySelector('.msg-video-seek');
    if (seek && !player.dataset.seeking) {
      const dur = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
      const pct = dur ? Math.min(100, Math.max(0, (video.currentTime / dur) * 100)) : 0;
      seek.value = String(Math.round(pct * 10));
      seek.style.setProperty('--seek-pct', `${pct}%`);
    }
  }

  function pauseOtherChatMedia(activeMedia) {
    document.querySelectorAll('#msg-messages-list audio, #msg-messages-list video').forEach((el) => {
      if (el !== activeMedia && !el.paused) {
        try { el.pause?.(); } catch { }
      }
    });
  }

  function renderVoicePlayerHtml(url, durationSec = 0) {
    const initDur = Number.isFinite(Number(durationSec)) && Number(durationSec) > 0 ? Number(durationSec) : 0;
    const barsHtml = VOICE_WAVE_HEIGHTS.map((h) => `<span class="msg-voice-wave-bar" style="--bar-h:${h}%"></span>`).join('');
    return `<div class="msg-voice-card" data-dur="${initDur}">
      <button type="button" class="msg-voice-play-btn" data-aact="play" aria-label="Play voice message" title="Play">${VIDEO_PLAY_SVG}</button>
      <div class="msg-voice-mid">
        <div class="msg-voice-wave" role="slider" tabindex="0" aria-label="Seek voice message" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">${barsHtml}</div>
        <div class="msg-voice-time">0:00 / ${escapeHtml(formatMediaDuration(initDur))}</div>
      </div>
      <button type="button" class="msg-voice-mute-btn" data-aact="mute" aria-label="Mute voice message" title="Mute">${VIDEO_VOL_ON_SVG}</button>
      <audio class="msg-att-audio" preload="metadata" src="${escAttr(url)}"></audio>
    </div>`;
  }

  function syncVoicePlayerUi(audio) {
    const card = audio?.closest?.('.msg-voice-card');
    if (!card) return;
    const playing = !audio.paused && !audio.ended;
    const muted = Boolean(audio.muted || audio.volume === 0);
    card.classList.toggle('is-playing', playing);
    card.classList.toggle('is-muted', muted);
    const playBtn = card.querySelector('[data-aact="play"]');
    if (playBtn) {
      playBtn.innerHTML = playing ? VIDEO_PAUSE_SVG : VIDEO_PLAY_SVG;
      playBtn.setAttribute('aria-label', playing ? 'Pause voice message' : 'Play voice message');
      playBtn.setAttribute('title', playing ? 'Pause' : 'Play');
    }
    const muteBtn = card.querySelector('[data-aact="mute"]');
    if (muteBtn) {
      muteBtn.innerHTML = muted ? VIDEO_VOL_OFF_SVG : VIDEO_VOL_ON_SVG;
      muteBtn.setAttribute('aria-label', muted ? 'Unmute voice message' : 'Mute voice message');
      muteBtn.setAttribute('title', muted ? 'Unmute' : 'Mute');
    }
    const fallbackDur = Number(card.dataset.dur || 0);
    const dur = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : fallbackDur;
    const cur = Number.isFinite(audio.currentTime) && audio.currentTime > 0 ? audio.currentTime : 0;
    const ratio = dur > 0 ? Math.min(1, Math.max(0, cur / dur)) : 0;
    const wave = card.querySelector('.msg-voice-wave');
    if (wave) {
      wave.setAttribute('aria-valuenow', String(Math.round(ratio * 100)));
      const bars = wave.querySelectorAll('.msg-voice-wave-bar');
      const playedCount = Math.round(ratio * bars.length);
      bars.forEach((bar, i) => bar.classList.toggle('is-played', i < playedCount));
    }
    const timeEl = card.querySelector('.msg-voice-time');
    if (timeEl) {
      timeEl.textContent = `${formatMediaDuration(cur)} / ${formatMediaDuration(dur)}`;
    }
  }

  function seekVoiceAudio(card, audio, ratio) {
    const fallbackDur = Number(card?.dataset?.dur || 0);
    const dur = Number.isFinite(audio?.duration) && audio.duration > 0 ? audio.duration : fallbackDur;
    if (!audio || !(dur > 0)) return;
    audio.currentTime = Math.min(dur, Math.max(0, ratio * dur));
    syncVoicePlayerUi(audio);
  }

  function getBubbleMediaLayout(atts, { hasText = false, hasHeaderMeta = false } = {}) {
    const list = Array.isArray(atts) ? atts : [];
    if (!list.length) return { hasTopMedia: false, hasAudioOnly: false };
    const allVisual = list.every((a) => a?.kind === 'image' || a?.kind === 'video');
    const allAudio = list.every((a) => a?.kind === 'audio');
    return {
      hasTopMedia: allVisual && !hasHeaderMeta,
      hasAudioOnly: allAudio && !hasText && !hasHeaderMeta
    };
  }

  function showVideoOptionsMenu(player, anchorBtn) {
    closeFloatingMenus({ immediate: true });
    activeVideoMenuPlayer = player;
    const menu = document.createElement('div');
    menu.className = 'msg-floating-menu msg-ctx-menu';
    const convId = player.dataset.vidConv || state.activeConvId || '';
    const path = player.dataset.vidPath || '';
    const name = player.dataset.vidName || 'video';
    const video = player.querySelector('video');
    const curRate = Number(video?.playbackRate || 1);
    const nextSpeed = curRate >= 2 ? 1 : (curRate >= 1.5 ? 2 : 1.5);
    menu.innerHTML = `
      ${path ? `<button type="button" data-dl-conv="${escAttr(convId)}" data-dl-path="${escAttr(path)}" data-dl-name="${escAttr(name)}">Download</button>` : ''}
      ${video ? `<button type="button" data-vspeed="${nextSpeed}">Playback speed (${curRate}x → ${nextSpeed}x)</button>` : ''}`;
    document.getElementById('msg-workspace-dialog')?.appendChild(menu);
    placeFloatingMenu(menu, anchorBtn, { preferAbove: true, estWidth: 196, estHeight: 84, align: 'end' });
    revealFloatingMenu(menu);
  }

  // Data loading & badge counters
  function computeTotalBadgeCount() {
    const convUnread = state.conversations
      .filter((c) => !c.is_archived && !c.is_muted)
      .reduce((sum, c) => sum + ((c.unread_count > 0 || c.marked_unread) ? Math.max(1, Number(c.unread_count || 0)) : 0), 0);
    const friendReqCount = (state.overview?.incoming_requests || []).length;
    const msgReqCount = state.conversations.filter((c) => c.is_incoming_request && !c.is_archived).length;
    const chatsUnread = state.conversations
      .filter((c) => !c.is_incoming_request && !c.is_archived && !c.is_muted)
      .reduce((sum, c) => sum + ((c.unread_count > 0 || c.marked_unread) ? Math.max(1, Number(c.unread_count || 0)) : 0), 0);
    const alertUnread = state.socialNotifications.filter((n) => !n.read_at).length;

    const chatsBadge = document.getElementById('msg-tab-chats-badge');
    if (chatsBadge) { chatsBadge.textContent = String(chatsUnread); chatsBadge.hidden = chatsUnread === 0; }
    const reqBadge = document.getElementById('msg-tab-req-badge');
    if (reqBadge) { reqBadge.textContent = String(msgReqCount); reqBadge.hidden = msgReqCount === 0; }
    const friendsBadge = document.getElementById('msg-tab-friends-badge');
    if (friendsBadge) { friendsBadge.textContent = String(friendReqCount); friendsBadge.hidden = friendReqCount === 0; }
    const alertsBadge = document.getElementById('msg-alerts-badge');
    if (alertsBadge) { alertsBadge.textContent = String(alertUnread); alertsBadge.hidden = alertUnread === 0; }

    ipon().syncMessagesBadges?.(convUnread + friendReqCount);
  }

  async function refreshConversations({ render = true } = {}) {
    if (!isEligible()) return [];
    const data = await ipon().rpc('get_conversations');
    state.conversations = Array.isArray(data) ? data : [];
    state.conversationsLoaded = true;
    state.loadingConvs = false;
    computeTotalBadgeCount();
    if (render && document.getElementById('msg-workspace-dialog')?.open) {
      renderConversationList();
    }
    return state.conversations;
  }

  async function refreshOverview({ render = true } = {}) {
    if (!isEligible()) return null;
    const data = await ipon().rpc('get_social_overview');
    state.overviewLoaded = true;
    if (data) {
      state.overview = data;
      if (data.me) meSocial = data.me;
    }
    computeTotalBadgeCount();
    if (render && document.getElementById('msg-workspace-dialog')?.open && state.tab === 'friends') {
      renderFriendsView();
    }
    return state.overview;
  }

  async function refreshSocialNotifications({ render = true } = {}) {
    if (!isEligible()) return [];
    const { data, error } = await ipon().client
      .from('notifications')
      .select('id,type,title,message,link,dedupe_key,read_at,created_at')
      .like('type', 'SOCIAL_%')
      .order('created_at', { ascending: false })
      .limit(50);
    if (!error) {
      state.socialNotifications = data || [];
      computeTotalBadgeCount();
      if (render && document.getElementById('msg-workspace-dialog')?.open && state.tab === 'notifications') {
        renderAlertsView();
      }
    }
    return state.socialNotifications;
  }

  // Rendering: Conversation List & Unified Inline Search
  function getFilteredConversations({ ignoreFilter = false } = {}) {
    const q = state.chatListQuery.trim().toLowerCase();
    const isRequestsTab = state.tab === 'requests';
    return state.conversations.filter((conv) => {
      if (isRequestsTab) {
        if (!conv.is_incoming_request || conv.is_archived) return false;
      } else {
        if (conv.is_incoming_request) return false;
        if (!ignoreFilter) {
          if (state.chatFilter === 'archived' && !conv.is_archived) return false;
          if (state.chatFilter !== 'archived' && conv.is_archived) return false;
          if (state.chatFilter === 'unread' && !(conv.unread_count > 0 || conv.marked_unread)) return false;
        } else if (conv.is_archived) {
          return false;
        }
      }
      if (!q) return true;
      const name = String(conv.peer?.full_name || '').toLowerCase();
      const uname = String(conv.peer?.username || '').toLowerCase();
      const preview = String(conv.last_message_preview || '').toLowerCase();
      return name.includes(q) || uname.includes(q) || preview.includes(q);
    });
  }

  function renderConversationRowHtml(conv) {
    const peer = conv.peer || {};
    const active = conv.id === state.activeConvId;
    const isTyping = state.typingPeers.has(conv.id);
    const hasUnread = conv.unread_count > 0 || conv.marked_unread;
    const previewText = isTyping
      ? '<span class="msg-typing-preview"><span class="msg-wave-dots is-inline" aria-hidden="true"><i></i><i></i><i></i></span><span>Typing…</span></span>'
      : `${conv.last_message_sender_id === initializedProfile?.id ? 'You: ' : ''}${escapeHtml(conv.last_message_preview || 'Start a conversation')}`;
    const pinIcon = conv.is_pinned
      ? '<svg class="msg-meta-icon" viewBox="0 0 24 24" role="img" aria-label="Pinned"><title>Pinned</title><path d="M12 17v5M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16h14v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6a1 1 0 0 1 1-1h.5a.5.5 0 0 0 .5-.5v-1a.5.5 0 0 0-.5-.5h-9a.5.5 0 0 0-.5.5v1a.5.5 0 0 0 .5.5H8a1 1 0 0 1 1 1z"/></svg>'
      : '';
    const muteIcon = conv.is_muted
      ? '<svg class="msg-meta-icon" viewBox="0 0 24 24" role="img" aria-label="Muted"><title>Muted</title><path d="M13.73 21a2 2 0 0 1-3.46 0"/><path d="M18.63 13A17.89 17.89 0 0 1 18 8"/><path d="M6.26 6.26A5.86 5.86 0 0 0 6 8c0 7-3 9-3 9h14"/><path d="M18 8a6 6 0 0 0-9.33-5"/><line x1="2" y1="2" x2="22" y2="22"/></svg>'
      : '';
    return `<article class="msg-conv-row${active ? ' is-active' : ''}${hasUnread ? ' is-unread' : ''}" data-conv-row="${escapeHtml(conv.id)}" role="option" aria-selected="${active ? 'true' : 'false'}">
      <div class="msg-conv-avatar">${userAvatarHtml(peer, 'avatar-md')}</div>
      <button type="button" class="msg-conv-main" data-open-conv="${escapeHtml(conv.id)}">
        <div class="msg-conv-top">
          <strong class="msg-conv-name"><span class="msg-conv-name-text">${escapeHtml(peer.full_name || 'User')}</span>${pinIcon}${muteIcon}</strong>
          <time class="msg-conv-time">${escapeHtml(formatShortDate(conv.last_message_at))}</time>
        </div>
        <div class="msg-conv-bottom">
          <span class="msg-conv-preview">${previewText}</span>
          ${hasUnread ? `<b class="msg-unread-pill">${conv.unread_count > 0 ? (conv.unread_count > 99 ? '99+' : conv.unread_count) : '•'}</b>` : ''}
        </div>
      </button>
      <div class="msg-conv-more-wrap">
        <button type="button" class="msg-conv-more-btn" data-conv-menu-toggle="${escapeHtml(conv.id)}" aria-label="Conversation options" title="Options">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/><circle cx="5" cy="12" r="1.6"/></svg>
        </button>
      </div>
    </article>`;
  }

  function renderSearchPersonRowHtml(u) {
    let relChip = '';
    if (u.friendship_status === 'FRIENDS') {
      relChip = '<span class="msg-rel-badge">Friend</span>';
    } else if (u.friendship_status === 'OUTGOING_REQUEST') {
      relChip = `<button type="button" class="msg-row-chip-btn" data-cancel-req="${escapeHtml(u.friend_request_id)}">Requested</button>`;
    } else if (u.friendship_status === 'INCOMING_REQUEST') {
      relChip = `<button type="button" class="msg-row-chip-btn is-accent" data-req-decision="ACCEPT" data-req-id="${escapeHtml(u.friend_request_id)}">Accept</button>`;
    } else {
      relChip = `<button type="button" class="msg-row-chip-btn" data-social-action="add_friend" data-target-id="${escapeHtml(u.id)}">Add</button>`;
    }
    const subParts = [];
    if (u.username) subParts.push(`@${u.username}`);
    if (u.shared_groups?.length) subParts.push(u.shared_groups[0]);
    else if (u.mutual_friends_count) subParts.push(`${u.mutual_friends_count} mutual`);
    if (!subParts.length) subParts.push('Tap to message');

    return `<article class="msg-search-person-row" role="listitem">
      <div class="msg-conv-avatar">${userAvatarHtml(u, 'avatar-md')}</div>
      <button type="button" class="msg-search-person-main" data-social-action="message" data-target-id="${escapeHtml(u.id)}">
        <strong class="msg-conv-name-text">${escapeHtml(u.full_name || 'User')}</strong>
        <span class="msg-search-person-sub">${escapeHtml(subParts.join(' · '))}</span>
      </button>
      <div class="msg-search-person-act">${relChip}</div>
    </article>`;
  }

  function renderInlineSearchResults(listEl, rawQuery) {
    const q = rawQuery.trim();
    const convHits = q ? getFilteredConversations({ ignoreFilter: true }) : [];
    const peopleHits = state.discoverUsers || [];
    const msgHits = q.length >= 2 ? (state.discoverMessages || []) : [];

    if (!q && state.searchActive) {
      const header = `<div class="msg-search-section-label"><span>All people</span><b>${peopleHits.length}</b></div>`;
      if (state.searchLoading && !peopleHits.length) {
        listEl.innerHTML = `${header}${skeletonHtml('person', 5)}`;
        return;
      }
      if (!peopleHits.length) {
        listEl.innerHTML = `${header}<div class="empty-state msg-list-empty"><strong>No eligible people found</strong><p>Other active members and admins will appear here when available.</p></div>`;
        return;
      }
      listEl.innerHTML = `${header}${peopleHits.map(renderSearchPersonRowHtml).join('')}`;
      ipon().bindAvatarFallbacks(listEl);
      ipon().syncPresenceDots(listEl);
      return;
    }

    const parts = [];
    if (convHits.length) {
      parts.push(`<div class="msg-search-section-label"><span>Chats</span><b>${convHits.length}</b></div>`);
      parts.push(convHits.map(renderConversationRowHtml).join(''));
    }

    parts.push(`<div class="msg-search-section-label"><span>People</span><b>${peopleHits.length}</b></div>`);
    if (state.searchLoading && !peopleHits.length) {
      parts.push(skeletonHtml('person', 3));
    } else if (peopleHits.length) {
      parts.push(peopleHits.map(renderSearchPersonRowHtml).join(''));
    } else {
      parts.push('<p class="msg-search-hint">No people matched that name or @username.</p>');
    }

    if (q.length >= 2) {
      parts.push(`<div class="msg-search-section-label"><span>Messages</span><b>${msgHits.length}</b></div>`);
      if (state.searchLoading && !msgHits.length) {
        parts.push(skeletonHtml('hit', 2));
      } else if (msgHits.length) {
        parts.push(msgHits.map((hit) => `
          <button type="button" class="msg-search-hit-row" data-jump-conv="${escapeHtml(hit.conversation_id)}" data-jump-msg-id="${escapeHtml(hit.message_id)}">
            <div class="msg-conv-top">
              <strong class="msg-conv-name-text">${escapeHtml(hit.peer_name)}</strong>
              <time class="msg-conv-time">${escapeHtml(formatShortDate(hit.created_at))}</time>
            </div>
            <span class="msg-search-hit-snippet">${escapeHtml(hit.sender_name)}: ${highlightMatches(escapeHtml(hit.body), q)}</span>
          </button>`).join(''));
      } else {
        parts.push('<p class="msg-search-hint">No messages matched that keyword.</p>');
      }
    }

    if (!state.searchLoading && !convHits.length && !peopleHits.length && !msgHits.length) {
      listEl.innerHTML = `<div class="empty-state msg-list-empty"><strong>No results for “${escapeHtml(q)}”</strong><p>Check spelling or search by full name, @username, or at least 2 message characters.</p><button type="button" class="button button-secondary button-sm" id="msg-search-empty-clear">Clear search</button></div>`;
      return;
    }

    listEl.innerHTML = parts.join('');
    ipon().bindAvatarFallbacks(listEl);
    ipon().syncPresenceDots(listEl);
  }

  function renderConversationList() {
    const listEl = document.getElementById('msg-conv-list');
    const filterPills = document.getElementById('msg-filter-pills');
    const clearBtn = document.getElementById('msg-list-search-clear');
    const newChatBtn = document.getElementById('msg-new-chat-btn');
    if (!listEl) return;

    const hasQuery = Boolean(state.chatListQuery.trim());
    const inDirectoryMode = state.tab === 'chats' && (state.searchActive || hasQuery);
    listEl.setAttribute?.('role', inDirectoryMode ? 'region' : 'listbox');
    if (clearBtn) clearBtn.hidden = !hasQuery;
    if (newChatBtn) {
      const targetMode = inDirectoryMode ? 'back' : 'compose';
      if (newChatBtn.dataset?.mode !== targetMode) {
        newChatBtn.dataset.mode = targetMode;
        newChatBtn.innerHTML = inDirectoryMode ? BACK_ARROW_ICON_SVG : NEW_CHAT_ICON_SVG;
      }
      newChatBtn.classList.toggle('is-active', inDirectoryMode);
      newChatBtn.setAttribute('aria-pressed', inDirectoryMode ? 'true' : 'false');
      newChatBtn.setAttribute('aria-label', inDirectoryMode ? 'Back to inbox' : 'Browse people directory');
      newChatBtn.setAttribute('title', inDirectoryMode ? 'Back to inbox' : 'New chat / Browse people');
    }
    if (filterPills) filterPills.hidden = state.tab === 'requests' || inDirectoryMode;
    filterPills?.querySelectorAll('[data-msg-filter]').forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset.msgFilter === state.chatFilter);
    });

    if (inDirectoryMode) {
      renderInlineSearchResults(listEl, state.chatListQuery);
      return;
    }

    if (state.loadingConvs && !state.conversations.length) {
      listEl.innerHTML = skeletonHtml('conv', 5);
      return;
    }

    const items = getFilteredConversations();
    if (!items.length) {
      const emptyCopy = state.tab === 'requests'
        ? { title: 'No message requests', body: 'Messages from people who are not in your friends list appear here before reaching your inbox.' }
        : state.chatFilter === 'archived'
          ? { title: 'No archived chats', body: 'Archived conversations stay tucked away cleanly until you unarchive them.' }
          : state.chatListQuery
            ? { title: 'No matching requests', body: 'Try clearing the filter to view all incoming message requests.' }
            : { title: 'No conversations yet', body: 'Search by name or @username above to start a direct conversation.' };
      listEl.innerHTML = `<div class="empty-state msg-list-empty"><strong>${escapeHtml(emptyCopy.title)}</strong><p>${escapeHtml(emptyCopy.body)}</p>${!state.chatListQuery && state.tab !== 'requests' ? '<button type="button" class="button button-secondary button-sm" data-goto-discover>Browse people</button>' : ''}</div>`;
      return;
    }

    listEl.innerHTML = items.map(renderConversationRowHtml).join('');
    ipon().bindAvatarFallbacks(listEl);
    ipon().syncPresenceDots(listEl);
  }

  function computeThreadFingerprint(data) {
    if (!data?.conversation) return '';
    const resolvedPaths = [];
    (data.messages || []).forEach((m) => {
      if (m.deleted_for_everyone_at) return;
      (m.attachments || []).forEach((a) => {
        if (a?.path && state.signedUrlCache.has(a.path)) resolvedPaths.push(a.path);
      });
    });
    return JSON.stringify({
      c: data.conversation,
      h: Boolean(data.has_older),
      u: data.unread_first_id || null,
      p: data.pinned_messages || [],
      m: data.messages || [],
      r: resolvedPaths
    });
  }

  // Conversation opening & thread loading
  async function openConversation(conversationId, { aroundMessageId = null, markRead = true, silent = false, scrollToBottom = null, forceMarkRead = false, previewPeer = null } = {}) {
    if (!conversationId || !isEligible()) return;
    const isSwitchingConv = state.activeConvId !== conversationId;
    const isSameLoadedThread = Boolean(
      !isSwitchingConv &&
      state.activeThread?.conversation?.conversation_id === conversationId &&
      !aroundMessageId &&
      !state.threadError
    );
    const backgroundRefresh = Boolean(silent || isSameLoadedThread);

    if (state.activeConvId && isSwitchingConv) {
      sendTypingBroadcast(false);
      state.threadInfoView = 'root';
      state.activePinnedId = null;
      const prevInput = document.getElementById('msg-composer-input');
      if (prevInput) state.draftsByConv.set(state.activeConvId, prevInput.value);
    }

    state.activeConvId = conversationId;
    if (!silent) state.mobileShowThread = true;
    state.threadError = '';
    const reqSeq = ++state.openConvSeq;
    if (!silent) {
      syncMobilePaneState();
      renderConversationList();
    }

    if (!backgroundRefresh) {
      state.replyToMsg = null;
      state.editingMsg = null;
      state.showThreadSearch = false;
      state.showPinnedList = false;
      if (isSwitchingConv) state.activePinnedId = null;
      state.threadSearchQuery = '';
      state.threadSearchMatches = [];
      state.loadingThread = true;
      state.lastThreadFingerprint = '';
      renderThreadHeaderLoading(conversationId, previewPeer);
    }

    try {
      const data = await ipon().rpc('get_conversation_messages', {
        p_conversation_id: conversationId,
        p_before: null,
        p_limit: 60,
        p_around_message_id: aroundMessageId || null
      });
      if (state.activeConvId !== conversationId || reqSeq !== state.openConvSeq) return;

      const scrollWrap = document.getElementById('msg-scroll-wrap');
      const prevScrollTop = scrollWrap ? scrollWrap.scrollTop : 0;
      const wasNearBottom = !scrollWrap || (scrollWrap.scrollHeight - scrollWrap.scrollTop - scrollWrap.clientHeight < 96);
      const prevThreadSnapshot = state.activeThread;
      const prevMsgs = state.activeThread?.messages || [];
      const prevLastId = prevMsgs.length ? prevMsgs[prevMsgs.length - 1]?.id : null;
      const nextMsgs = data?.messages || [];
      const nextLastId = nextMsgs.length ? nextMsgs[nextMsgs.length - 1]?.id : null;
      const hasNewBottomMsg = Boolean(nextLastId && nextLastId !== prevLastId);

      state.activeThread = data;
      state.loadingThread = false;

      const attPaths = [];
      nextMsgs.forEach((m) => (m.attachments || []).forEach((a) => { if (a?.path) attPaths.push(a.path); }));
      await ensureSignedViewUrls(conversationId, attPaths);
      if (state.activeConvId !== conversationId || reqSeq !== state.openConvSeq) return;

      const dialogOpen = Boolean(document.getElementById('msg-workspace-dialog')?.open);
      const convItem = state.conversations.find((c) => c.id === conversationId);
      const hasUnreadSocialNotif = state.socialNotifications.some(
        (n) => !n.read_at && String(n.link || '').includes(conversationId)
      );
      const shouldMarkRead = Boolean(
        markRead && dialogOpen && isThreadActivelyVisible() && (
          forceMarkRead ||
          data?.unread_first_id ||
          convItem?.unread_count > 0 ||
          convItem?.marked_unread ||
          hasUnreadSocialNotif ||
          (!backgroundRefresh && !convItem)
        )
      );

      if (shouldMarkRead) {
        state.recentMarkReadAt.set(conversationId, Date.now());
        await ipon().rpc('mark_conversation_read', { p_conversation_id: conversationId }).catch(() => { });
        state.recentMarkReadAt.set(conversationId, Date.now());
        if (convItem) {
          convItem.unread_count = 0;
          convItem.marked_unread = false;
        }
        const readStamp = new Date().toISOString();
        state.socialNotifications.forEach((n) => {
          if (!n.read_at && String(n.link || '').includes(conversationId)) n.read_at = readStamp;
        });
        computeTotalBadgeCount();
        renderConversationList();
      }

      const nextFingerprint = computeThreadFingerprint(data);
      const shouldScrollBottom = typeof scrollToBottom === 'boolean'
        ? scrollToBottom
        : (!aroundMessageId && (!backgroundRefresh || (wasNearBottom && hasNewBottomMsg)));

      if (!backgroundRefresh || nextFingerprint !== state.lastThreadFingerprint) {
        state.lastThreadFingerprint = nextFingerprint;
        if (backgroundRefresh && !aroundMessageId && tryPatchActiveThreadInPlace(prevThreadSnapshot, data)) {
          const activeWrap = document.getElementById('msg-thread-active');
          ipon().syncPresenceDots(activeWrap);
          const subEl = document.getElementById('msg-peer-status-text');
          if (subEl && data?.conversation) {
            const typing = state.typingPeers.has(conversationId);
            subEl.textContent = formatStatusLine(data.conversation, typing);
            subEl.classList.toggle('is-typing', typing);
          }
        } else {
          renderActiveThread({
            scrollToBottom: shouldScrollBottom,
            highlightMessageId: aroundMessageId,
            preserveScrollTop: backgroundRefresh && !shouldScrollBottom ? prevScrollTop : null,
            animate: !backgroundRefresh
          });
        }
      } else {
        const activeWrap = document.getElementById('msg-thread-active');
        ipon().syncPresenceDots(activeWrap);
        const subEl = document.getElementById('msg-peer-status-text');
        if (subEl && data?.conversation) {
          const typing = state.typingPeers.has(conversationId);
          subEl.textContent = formatStatusLine(data.conversation, typing);
          subEl.classList.toggle('is-typing', typing);
        }
      }

      bindTypingChannel(conversationId);
      if (!backgroundRefresh) {
        const nextDraft = state.draftsByConv.get(conversationId) || '';
        const composerInput = document.getElementById('msg-composer-input');
        if (composerInput) {
          composerInput.value = nextDraft;
          autoResizeTextarea(composerInput);
        }
        renderContextBar();
      }
    } catch (error) {
      if (state.activeConvId !== conversationId || reqSeq !== state.openConvSeq) return;
      state.loadingThread = false;
      if (!backgroundRefresh) {
        state.threadError = ipon().friendlyError(error);
        renderThreadErrorState();
      }
    }
  }

  function applyThreadTheme(theme = 'paper') {
    const normalized = ['paper', 'emerald', 'sage', 'sand', 'midnight'].includes(theme) ? theme : 'paper';
    const pane = document.getElementById('msg-thread-pane');
    const stage = document.getElementById('msg-thread-stage');
    if (pane) pane.dataset.chatTheme = normalized;
    if (stage) stage.dataset.chatTheme = normalized;
  }

  function renderThreadHeaderLoading(conversationId = state.activeConvId, explicitPeer = null) {
    document.getElementById('msg-thread-empty').hidden = true;
    const activeEl = document.getElementById('msg-thread-active');
    activeEl.hidden = false;
    for (const bannerId of ['msg-pinned-banner', 'msg-request-banner', 'msg-thread-search-bar', 'msg-blocked-banner', 'msg-context-bar', 'msg-load-older-wrap']) {
      const b = document.getElementById(bannerId);
      if (b) b.hidden = true;
    }
    const typingEl = document.getElementById('msg-typing-live');
    if (typingEl) {
      typingEl.classList.remove('is-visible');
      typingEl.setAttribute('aria-hidden', 'true');
    }
    const peer = findKnownPeer(conversationId, explicitPeer?.id) || explicitPeer;
    applyThreadTheme(peer?.chat_theme || 'paper');

    const headerEl = document.getElementById('msg-thread-header');
    if (headerEl) {
      if (peer) {
        headerEl.innerHTML = `
          <div class="msg-thread-header-left">
            <button type="button" class="msg-back-mobile-btn" id="msg-back-to-list" aria-label="Back to conversations">
              <svg viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></svg>
            </button>
            ${userAvatarHtml(peer, 'avatar-md')}
            <div class="msg-thread-peer-meta">
              <div class="msg-thread-peer-title">
                <strong>${escapeHtml(peer.full_name || 'User')}</strong>
              </div>
              <div class="msg-thread-peer-sub">
                ${peer.username ? `<span class="msg-handle-chip">@${escapeHtml(peer.username)}</span>` : ''}
                <small class="msg-peer-status is-syncing"><span class="msg-sync-dot" aria-hidden="true"></span>Syncing messages…</small>
              </div>
            </div>
          </div>
          <div class="msg-thread-header-actions">
            <span class="msg-skel msg-skel-circle msg-skel-icon" aria-hidden="true"></span>
            <span class="msg-skel msg-skel-circle msg-skel-icon" aria-hidden="true"></span>
          </div>`;
        ipon().bindAvatarFallbacks?.(headerEl);
        ipon().syncPresenceDots?.(headerEl);
      } else {
        headerEl.innerHTML = skeletonHtml('header');
      }
    }

    const list = document.getElementById('msg-messages-list');
    if (list) {
      list.classList.remove('is-thread-entering');
      list.innerHTML = skeletonHtml('thread');
    }
  }

  function renderThreadErrorState() {
    const list = document.getElementById('msg-messages-list');
    if (!list) return;
    list.innerHTML = `<div class="empty-state"><p>${escapeHtml(state.threadError || 'Unable to load messages.')}</p><button type="button" class="button button-secondary button-sm" id="msg-retry-thread-btn">Try again</button></div>`;
  }

  function bindTypingChannel(conversationId) {
    const client = ipon().client;
    if (!client || !conversationId) return;
    if (typingChannel && state.typingChannelConvId === conversationId) return;
    clearTimeout(typingIdleTimer);
    typingIdleTimer = null;
    state.lastTypingState = false;
    state.lastTypingSentAt = 0;
    if (typingChannel) {
      try { client.removeChannel(typingChannel); } catch { }
      typingChannel = null;
      state.typingChannelConvId = null;
    }
    state.typingChannelConvId = conversationId;
    typingChannel = client.channel(`chat-typing:${conversationId}`)
      .on('broadcast', { event: 'typing' }, ({ payload }) => {
        if (!payload || payload.user_id === initializedProfile?.id) return;
        const prev = state.typingPeers.get(conversationId);
        const wasTyping = Boolean(prev);
        if (prev?.timer) clearTimeout(prev.timer);
        if (payload.typing) {
          const timer = setTimeout(() => {
            state.typingPeers.delete(conversationId);
            updateTypingIndicators({ listChanged: true });
          }, 2600);
          state.typingPeers.set(conversationId, { timer, at: Date.now() });
        } else {
          state.typingPeers.delete(conversationId);
        }
        updateTypingIndicators({ listChanged: wasTyping !== Boolean(payload.typing) });
      })
      .subscribe();
  }

  function syncLiveTypingBubble(typing) {
    const liveRow = document.getElementById('msg-typing-live');
    if (!liveRow) return;
    const conv = state.activeThread?.conversation;
    const wasVisible = liveRow.classList.contains('is-visible');
    const avatarHost = document.getElementById('msg-typing-avatar');
    const liveTxt = document.getElementById('msg-typing-live-text');
    if (typing && conv) {
      if (avatarHost && avatarHost.dataset.peerId !== String(conv.id || '')) {
        avatarHost.dataset.peerId = String(conv.id || '');
        avatarHost.innerHTML = userAvatarHtml(conv, 'avatar-sm', { clickable: false, showPresence: true });
        ipon().bindAvatarFallbacks?.(avatarHost);
        ipon().syncPresenceDots?.(avatarHost);
      }
      if (liveTxt) liveTxt.textContent = `${conv.full_name || 'User'} is typing…`;
    } else if (!typing && liveTxt) {
      liveTxt.textContent = 'Typing…';
    }
    liveRow.classList.toggle('is-visible', Boolean(typing));
    liveRow.setAttribute('aria-hidden', typing ? 'false' : 'true');
    if (!wasVisible && typing) {
      requestAnimationFrame(() => {
        const wrap = document.getElementById('msg-scroll-wrap');
        if (wrap && (wrap.scrollHeight - wrap.scrollTop - wrap.clientHeight < 140)) {
          wrap.scrollTop = wrap.scrollHeight;
        }
      });
    }
  }

  function updateTypingIndicators({ listChanged = true } = {}) {
    if (listChanged) renderConversationList();
    if (!state.activeConvId || !state.activeThread?.conversation) return;
    const typing = state.typingPeers.has(state.activeConvId);
    const subEl = document.getElementById('msg-peer-status-text');
    if (subEl) {
      subEl.textContent = formatStatusLine(state.activeThread.conversation, typing);
      subEl.classList.toggle('is-typing', typing);
    }
    syncLiveTypingBubble(typing);
  }

  function getPinnedPreviewText(pin) {
    const body = String(pin?.body || '').trim();
    if (body) return body;
    const match = (state.activeThread?.messages || []).find((m) => m.id === pin?.id);
    const att = (match?.attachments || [])[0];
    if (att?.kind === 'image') return 'Photo';
    if (att?.kind === 'video') return 'Video';
    if (att?.kind === 'audio') return 'Voice message';
    if (att?.name) return att.name;
    return 'Attachment';
  }

  function renderPinnedBanner() {
    const pinnedBanner = document.getElementById('msg-pinned-banner');
    if (!pinnedBanner) return;
    const conv = state.activeThread?.conversation;
    const pins = state.activeThread?.pinned_messages || [];
    const canInteract = Boolean(conv && conv.friendship_status !== 'BLOCKED_BY_ME' && conv.friendship_status !== 'BLOCKED_ME');
    if (!pins.length || !canInteract) {
      state.showPinnedList = false;
      state.activePinnedId = null;
      pinnedBanner.hidden = true;
      pinnedBanner.innerHTML = '';
      return;
    }
    if (!state.activePinnedId || !pins.some((p) => p.id === state.activePinnedId)) {
      state.activePinnedId = pins[0].id;
    }
    const activePin = pins.find((p) => p.id === state.activePinnedId) || pins[0];
    const expanded = Boolean(state.showPinnedList);
    pinnedBanner.hidden = false;
    pinnedBanner.innerHTML = `
      <div class="msg-pinned-pill${expanded ? ' is-open' : ''}">
        <button type="button" class="msg-pinned-jump" data-jump-msg="${escapeHtml(activePin.id)}" title="Jump to pinned message">
          <span class="msg-pinned-icon" aria-hidden="true">${MSG_PIN_SVG}</span>
          <span class="msg-pinned-copy">
            <span class="msg-pinned-kicker">PINNED MESSAGE <span class="msg-pinned-count">${pins.length}</span></span>
            <strong>${escapeHtml(getPinnedPreviewText(activePin))}</strong>
          </span>
        </button>
        <button type="button" class="msg-pinned-toggle" data-pinned-toggle aria-expanded="${expanded}" aria-label="${expanded ? 'Collapse pinned messages' : 'Show pinned messages'}">${MSG_CHEVRON_SVG}</button>
      </div>
      <div class="msg-pinned-panel" id="msg-pinned-panel"${expanded ? '' : ' hidden'}>
        <div class="msg-pinned-panel-head">
          <h3>Pinned messages <em>${pins.length}</em></h3>
        </div>
        <div class="msg-pinned-list">
          ${pins.map((p, idx) => {
            const isCurrent = p.id === activePin.id;
            return `<div class="msg-pinned-item${isCurrent ? ' is-active' : ''}">
              <button type="button" class="msg-pinned-item-jump" data-pinned-select="${escapeHtml(p.id)}" data-jump-msg="${escapeHtml(p.id)}">
                <span class="msg-pinned-item-num">${idx + 1}</span>
                <span class="msg-pinned-item-text">${escapeHtml(getPinnedPreviewText(p))}</span>
              </button>
            </div>`;
          }).join('')}
        </div>
      </div>`;
  }

  function syncActivePinnedHighlight() {
    const list = document.getElementById('msg-messages-list');
    if (!list?.querySelectorAll) return;
    list.querySelectorAll('.msg-row[data-msg-id]').forEach((row) => {
      const bubble = row.querySelector?.('.msg-bubble');
      if (bubble) bubble.classList.toggle('is-pinned', Boolean(state.activePinnedId && row.dataset?.msgId === state.activePinnedId));
    });
  }

  function renderActiveThread({ scrollToBottom = false, highlightMessageId = null, preserveScrollTop = null, animate = false } = {}) {
    const thread = state.activeThread;
    if (!thread?.conversation) return;
    document.getElementById('msg-thread-empty').hidden = true;
    document.getElementById('msg-thread-active').hidden = false;

    const conv = thread.conversation;
    applyThreadTheme(conv.chat_theme || 'paper');

    const canInteract = conv.friendship_status !== 'BLOCKED_BY_ME' && conv.friendship_status !== 'BLOCKED_ME';
    const isPendingReq = conv.status === 'PENDING_REQUEST';
    const isIncomingReq = isPendingReq && conv.initiator_id !== initializedProfile?.id;
    const isTyping = state.typingPeers.has(conv.conversation_id);

    const headerEl = document.getElementById('msg-thread-header');
    headerEl.innerHTML = `
      <div class="msg-thread-header-left">
        <button type="button" class="msg-back-mobile-btn" id="msg-back-to-list" aria-label="Back to conversations">
          <svg viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></svg>
        </button>
        ${userAvatarHtml(conv, 'avatar-md')}
        <div class="msg-thread-peer-meta">
          <div class="msg-thread-peer-title">
            <strong>${escapeHtml(conv.full_name || 'User')}</strong>
          </div>
          <div class="msg-thread-peer-sub">
            ${conv.username ? `<span class="msg-handle-chip">@${escapeHtml(conv.username)}</span>` : ''}
            ${conv.friendship_status === 'FRIENDS' ? '<span class="msg-rel-chip">Friend</span>' : ''}
            <small class="msg-peer-status${isTyping ? ' is-typing' : ''}" id="msg-peer-status-text">${escapeHtml(formatStatusLine(conv, isTyping))}</small>
          </div>
        </div>
      </div>
      <div class="msg-thread-header-actions">
        <button type="button" class="msg-icon-btn${state.showThreadSearch ? ' is-active' : ''}" id="msg-thread-search-toggle" aria-label="Search in conversation" title="Search conversation">
          <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
        </button>
        <button type="button" class="msg-icon-btn${state.showThreadInfo ? ' is-active' : ''}" id="msg-thread-info-toggle" aria-label="Conversation info and shared files" title="Shared media, files & options">
          <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
        </button>
      </div>`;

    const senderSelect = document.getElementById('msg-thread-search-sender');
    if (senderSelect) {
      senderSelect.innerHTML = `<option value="">All senders</option><option value="${escAttr(initializedProfile?.id)}">You</option><option value="${escAttr(conv.id)}">${escapeHtml(conv.full_name || 'Peer')}</option>`;
      senderSelect.value = state.threadSearchSenderId;
    }

    const reqBanner = document.getElementById('msg-request-banner');
    if (reqBanner) {
      if (isIncomingReq) {
        reqBanner.hidden = false;
        reqBanner.innerHTML = `
          <div class="msg-req-banner-copy">
            <strong>Message Request from ${escapeHtml(conv.full_name || 'User')}</strong>
            <p>Read receipts are disabled until you accept. Accept to move this chat to your Inbox.</p>
          </div>
          <div class="msg-req-banner-actions">
            <button type="button" class="button button-primary button-sm" data-msg-req-decision="ACCEPT">Accept</button>
            <button type="button" class="button button-secondary button-sm" data-msg-req-decision="DELETE">Delete</button>
            <button type="button" class="button button-secondary button-sm is-danger" data-msg-req-decision="BLOCK">Block</button>
          </div>`;
      } else if (isPendingReq) {
        reqBanner.hidden = false;
        reqBanner.innerHTML = `<div class="msg-req-banner-copy"><strong>Message request pending</strong><p>Waiting for ${escapeHtml(conv.full_name || 'recipient')} to accept. Read receipts stay hidden until accepted.</p></div>`;
      } else {
        reqBanner.hidden = true;
      }
    }

    renderPinnedBanner();

    const blockedBanner = document.getElementById('msg-blocked-banner');
    const composerForm = document.getElementById('msg-composer-form');
    if (!canInteract) {
      if (composerForm) composerForm.hidden = true;
      if (blockedBanner) {
        blockedBanner.hidden = false;
        blockedBanner.innerHTML = conv.friendship_status === 'BLOCKED_BY_ME'
          ? `<span>You blocked <strong>${escapeHtml(conv.full_name)}</strong>.</span><button type="button" class="button button-secondary button-sm" data-unblock-user="${escapeHtml(conv.id)}">Unblock</button>`
          : '<span>You cannot reply to this conversation.</span>';
      }
    } else {
      if (composerForm) composerForm.hidden = false;
      if (blockedBanner) blockedBanner.hidden = true;
    }

    const olderWrap = document.getElementById('msg-load-older-wrap');
    if (olderWrap) olderWrap.hidden = !thread.has_older;

    renderMessagesList({ animate });
    syncLiveTypingBubble(isTyping);
    if (state.showThreadInfo) renderThreadInfoDrawer();

    ipon().bindAvatarFallbacks(headerEl);
    ipon().syncPresenceDots(headerEl);

    if (highlightMessageId) {
      requestAnimationFrame(() => jumpToMessageElement(highlightMessageId));
    } else if (scrollToBottom) {
      requestAnimationFrame(() => {
        const wrap = document.getElementById('msg-scroll-wrap');
        if (wrap) wrap.scrollTop = wrap.scrollHeight;
      });
    } else if (typeof preserveScrollTop === 'number') {
      requestAnimationFrame(() => {
        const wrap = document.getElementById('msg-scroll-wrap');
        if (wrap) wrap.scrollTop = preserveScrollTop;
      });
    }
  }

  function getPendingList(convId) {
    return convId ? (state.pendingByConv.get(convId) || []) : [];
  }

  function findPendingItem(convId, localId) {
    return getPendingList(convId).find((item) => item.localId === localId) || null;
  }

  function removePendingItem(convId, localId, { revokeUrls = true, cleanupRemote = false } = {}) {
    const arr = state.pendingByConv.get(convId);
    if (!arr) return;
    const idx = arr.findIndex((item) => item.localId === localId);
    if (idx === -1) return;
    const [removed] = arr.splice(idx, 1);
    if (!arr.length) state.pendingByConv.delete(convId);

    if (cleanupRemote && removed?.files?.length) {
      const remotePaths = removed.files.map((f) => f.uploaded?.path).filter(Boolean);
      if (remotePaths.length) {
        ipon().invokeAccountFunction?.({ action: 'chat-cleanup-media', paths: remotePaths }).catch(() => { });
      }
    }
    if (revokeUrls && removed?.files?.length) {
      removed.files.forEach((f) => {
        if (f.previewUrl && f.uploaded?.path && state.signedUrlCache.get(f.uploaded.path) === f.previewUrl) return;
        if (f.previewUrl) try { URL.revokeObjectURL(f.previewUrl); } catch { }
      });
    }
    if (state.activeConvId === convId && !state.loadingThread && state.activeThread?.conversation) {
      renderMessagesList();
    }
  }

  function updatePendingProgressDom(pending) {
    if (!pending || pending.conversationId !== state.activeConvId) return;
    const row = document.querySelector(`#msg-messages-list [data-pending-id="${CSS.escape(pending.localId)}"]`);
    if (!row) return;
    const bar = row.querySelector('.msg-send-progress span');
    if (bar) bar.style.width = `${pending.progressPct}%`;
    const metaLabel = row.querySelector('.msg-pending-status-text');
    if (metaLabel) {
      metaLabel.textContent = pending.files?.length && pending.progressPct > 0 && pending.progressPct < 100
        ? `Sending ${pending.progressPct}%…`
        : 'Sending…';
    }
  }

  function renderPendingAttachmentHtml(item) {
    const safeName = escapeHtml(item.name || 'file');
    const sizeText = escapeHtml(formatBytes(item.size));
    if (item.kind === 'image' && item.previewUrl) {
      return `<figure class="msg-att-image">
        <button type="button" class="msg-img-open-btn" data-open-img="${escAttr(item.previewUrl)}" data-img-name="${escAttr(item.name || 'image')}" aria-label="Preview ${safeName}">
          <img src="${escAttr(item.previewUrl)}" alt="${safeName}" loading="lazy">
        </button>
      </figure>`;
    }
    if (item.kind === 'video' && item.previewUrl) {
      const vKey = getVideoMetaKey(item.uploaded?.path, item.previewUrl);
      const meta = videoMetaCache.get(vKey);
      const boxStyle = formatVideoBoxStyle(meta);
      return `<div class="msg-att-media-card">
        <div class="msg-video-player" data-vid-key="${escAttr(vKey)}"${boxStyle ? ` style="${escAttr(boxStyle)}"` : ''}>
          <video class="msg-att-video" muted preload="metadata" playsinline poster="${escAttr(meta?.poster || VIDEO_POSTER_FALLBACK)}" src="${escAttr(item.previewUrl)}"></video>
          <span class="msg-video-center-play is-passive" aria-hidden="true">${VIDEO_PLAY_SVG}</span>
        </div>
      </div>`;
    }
    if (item.kind === 'audio' && item.previewUrl) {
      return `<div class="msg-att-audio-card">${renderVoicePlayerHtml(item.previewUrl, item.duration_seconds)}</div>`;
    }
    return `<div class="msg-att-doc-card">
      <span class="msg-doc-badge">${escapeHtml(formatBadgeLabel(item))}</span>
      <div class="msg-doc-meta">
        <strong>${safeName}</strong>
        <small>${item.duration_seconds ? `${item.duration_seconds}s · ` : ''}${sizeText}</small>
      </div>
    </div>`;
  }

  function buildMetaHtml({ ts, showTime = true, pinned = false, edited = false, rightHtml = '', overlay = false } = {}) {
    const timePart = showTime && ts ? `<time datetime="${escAttr(ts)}">${escapeHtml(formatClock(ts))}</time>` : '';
    const pinPart = pinned ? '<span title="Pinned message">📌</span>' : '';
    const editPart = edited ? '<span>Edited ·</span>' : '';
    if (!pinPart && !editPart && !timePart && !rightHtml) return '';
    const tickOnly = !pinPart && !editPart && !timePart && Boolean(rightHtml);
    return `<div class="msg-bubble-meta${overlay ? ' is-media-overlay' : ''}${tickOnly ? ' is-tick-only' : ''}">
      ${pinPart}${editPart}${timePart}${rightHtml}
    </div>`;
  }

  function renderPendingRowHtml(p, clockState = null) {
    const isFailed = p.status === 'failed';
    const isSending = p.status === 'sending';
    const atts = p.files || [];
    const attHtml = atts.length
      ? `<div class="msg-attachments${atts.length > 1 ? ' is-carousel' : ''}">${atts.map(renderPendingAttachmentHtml).join('')}</div>`
      : '';
    const replyHtml = p.replyPreview
      ? `<div class="msg-reply-quote is-static">
          <strong>${escapeHtml(p.replyPreview.senderLabel || 'Message')}</strong>
          <span>${escapeHtml(p.replyPreview.body || 'Attachment')}</span>
        </div>`
      : '';
    const statusLabel = isSending && atts.length && p.progressPct > 0 && p.progressPct < 100
      ? `Sending ${p.progressPct}%…`
      : 'Sending…';
    const metaRight = isFailed
      ? '<span class="msg-tick is-failed-meta">! Not sent</span>'
      : `<span class="msg-tick is-sending"><span class="msg-mini-spin" aria-hidden="true"></span><span class="msg-pending-status-text">${escapeHtml(statusLabel)}</span></span>`;
    const bodyHtml = p.body ? `<p class="msg-text">${formatMessageBodyHtml(p.body)}</p>` : '';
    const { hasTopMedia, hasAudioOnly } = getBubbleMediaLayout(atts, {
      hasText: Boolean(p.body),
      hasHeaderMeta: false
    });
    const isMediaOnly = hasTopMedia && !bodyHtml;
    const progressBar = isSending && atts.length && p.progressPct < 100
      ? `<div class="msg-send-progress${isMediaOnly ? ' is-media-overlay' : ''}" aria-hidden="true"><span style="width:${p.progressPct}%"></span></div>`
      : '';
    const dateStr = formatDateDivider(p.createdAt);
    const clockLabel = formatClock(p.createdAt);
    const clockKey = clockLabel ? `${dateStr}|${clockLabel}` : '';
    const showTime = clockState ? Boolean(clockKey && clockKey !== clockState.lastKey) : true;
    if (showTime && clockState) clockState.lastKey = clockKey;
    const metaHtml = buildMetaHtml({
      ts: p.createdAt,
      showTime,
      rightHtml: metaRight,
      overlay: isMediaOnly
    });
    const bubbleInner = isMediaOnly
      ? `${attHtml}${progressBar}${metaHtml}`
      : (hasTopMedia
          ? `${attHtml}<div class="msg-bubble-body-pad">${bodyHtml}${progressBar}${metaHtml}</div>`
          : `${bodyHtml}${attHtml}${progressBar}${metaHtml}`);

    return `<article class="msg-row is-mine is-pending${isFailed ? ' is-failed' : ' is-sending'}" data-pending-id="${escapeHtml(p.localId)}">
      <div class="msg-bubble-col">
        ${replyHtml}
        <div class="msg-bubble${isFailed ? ' is-failed' : ' is-sending'}${hasTopMedia ? ' has-top-media' : ''}${isMediaOnly ? ' is-media-only' : ''}${hasAudioOnly ? ' has-audio-only' : ''}">
          ${bubbleInner}
        </div>
        ${isFailed ? `
          <div class="msg-failed-bar" role="alert">
            <span class="msg-failed-reason">${escapeHtml(p.errorText || 'Couldn’t send')}</span>
            <div class="msg-failed-actions">
              <button type="button" class="msg-failed-btn is-retry" data-pending-retry="${escAttr(p.localId)}">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><polyline points="21 3 21 9 15 9"/></svg>
                <span>Retry</span>
              </button>
              <button type="button" class="msg-failed-btn is-delete" data-pending-delete="${escAttr(p.localId)}">Delete</button>
            </div>
          </div>` : ''}
      </div>
    </article>`;
  }

  async function processPendingMessage(pending) {
    const convId = pending.conversationId;
    pending.status = 'sending';
    pending.errorText = '';
    if (convId === state.activeConvId) {
      renderMessagesList();
      requestAnimationFrame(() => {
        const wrap = document.getElementById('msg-scroll-wrap');
        if (wrap) wrap.scrollTop = wrap.scrollHeight;
      });
    }

    try {
      const files = pending.files || [];
      const needUpload = files.filter((entry) => !entry.uploaded);
      if (needUpload.length) {
        const { uploads = [] } = await ipon().invokeAccountFunction({
          action: 'chat-upload-urls',
          conversation_id: convId,
          files: needUpload.map((f) => ({ name: f.name, kind: f.kind, type: f.type, size: f.size }))
        });
        for (let i = 0; i < needUpload.length; i += 1) {
          const entry = needUpload[i];
          const up = uploads[i];
          if (!up?.path || !up?.token) throw new Error('Upload authorization failed.');
          await uploadFileRawWithProgress(entry, up, (pct) => {
            entry.progress = pct;
            const totalPct = files.reduce((sum, item) => sum + (item.uploaded ? 100 : (item.progress || 0)), 0);
            pending.progressPct = Math.min(99, Math.round(totalPct / Math.max(1, files.length)));
            updatePendingProgressDom(pending);
          });
          entry.progress = 100;
          if (entry.previewUrl) {
            state.signedUrlCache.set(up.path, entry.previewUrl);
            if (entry.kind === 'video') copyVideoMetaAlias(entry.previewUrl, up.path);
          }
          entry.uploaded = {
            path: up.path,
            name: up.name,
            kind: entry.kind,
            type: up.type,
            size: entry.size,
            ...(entry.duration_seconds ? { duration_seconds: entry.duration_seconds } : {})
          };
        }
        pending.progressPct = 100;
        updatePendingProgressDom(pending);
      }

      const attachments = files.map((entry) => entry.uploaded).filter(Boolean);
      const sentRow = await ipon().rpc('send_chat_message', {
        p_conversation_id: convId,
        p_body: pending.body || '',
        p_message_type: pending.messageType || (attachments.length ? 'MEDIA' : 'TEXT'),
        p_reply_to_id: pending.replyToId || null,
        p_forwarded_from_id: null,
        p_attachments: attachments
      });
      pending.serverMessageId = sentRow?.id || null;

      await Promise.all([
        convId === state.activeConvId
          ? openConversation(convId, { markRead: false, silent: true, scrollToBottom: true })
          : Promise.resolve(),
        refreshConversations()
      ]);
      removePendingItem(convId, pending.localId, { revokeUrls: false });
    } catch (error) {
      pending.status = 'failed';
      pending.errorText = ipon().friendlyError(error) || 'Message failed to send';
      if (convId === state.activeConvId && state.activeThread?.conversation) {
        renderMessagesList();
        requestAnimationFrame(() => {
          const wrap = document.getElementById('msg-scroll-wrap');
          if (wrap) wrap.scrollTop = wrap.scrollHeight;
        });
      }
    }
  }

  function enqueuePendingMessage({ conversationId, body = '', messageType = null, replyToMsg = null, files = [], deferProcess = false }) {
    if (!conversationId) return null;
    const conv = state.activeThread?.conversation;
    const pending = {
      localId: `pending-${Date.now()}-${++pendingMsgSeq}`,
      conversationId,
      body: String(body || '').trim(),
      messageType: messageType || (files.length ? 'MEDIA' : 'TEXT'),
      replyToId: replyToMsg?.id || null,
      replyPreview: replyToMsg ? {
        senderLabel: replyToMsg.sender_id === initializedProfile?.id ? 'Replying to yourself' : `Replying to ${conv?.full_name || 'User'}`,
        body: replyToMsg.body || 'Attachment'
      } : null,
      files: files.map((f) => ({ ...f, progress: f.uploaded ? 100 : 0 })),
      status: 'sending',
      progressPct: 0,
      errorText: '',
      serverMessageId: null,
      createdAt: new Date().toISOString()
    };
    if (!state.pendingByConv.has(conversationId)) state.pendingByConv.set(conversationId, []);
    state.pendingByConv.get(conversationId).push(pending);
    if (!deferProcess) processPendingMessage(pending);
    return pending;
  }

  function renderMessagesList({ animate = false } = {}) {
    const list = document.getElementById('msg-messages-list');
    if (!list || !state.activeThread) return;
    const msgs = state.activeThread.messages || [];
    const conv = state.activeThread.conversation || {};
    const myId = initializedProfile?.id;
    const searchQuery = state.showThreadSearch ? state.threadSearchQuery.trim() : '';
    const unreadFirstId = state.activeThread.unread_first_id;

    // Prune any pending message that has already synced into server history
    if (conv.conversation_id && state.pendingByConv.has(conv.conversation_id)) {
      const confirmedIds = new Set(msgs.map((m) => m.id));
      const kept = (state.pendingByConv.get(conv.conversation_id) || []).filter(
        (p) => !(p.serverMessageId && confirmedIds.has(p.serverMessageId))
      );
      if (kept.length) state.pendingByConv.set(conv.conversation_id, kept);
      else state.pendingByConv.delete(conv.conversation_id);
    }
    const pendingList = getPendingList(conv.conversation_id);

    if (!msgs.length && !pendingList.length) {
      list.classList.remove('is-thread-entering');
      list.innerHTML = `<div class="empty-state msg-thread-welcome"><p>Say hello to <strong>${escapeHtml(conv.full_name || 'your connection')}</strong>. Messages and lossless files stay private between you two.</p></div>`;
      return;
    }

    let lastDateStr = '';
    let lastShownClockKey = '';
    const pinnedIds = new Set((state.activeThread.pinned_messages || []).map((p) => p.id));
    const html = msgs.map((m, idx) => {
      const curDateStr = formatDateDivider(m.created_at);
      const isNewDate = curDateStr !== lastDateStr;
      if (isNewDate) lastShownClockKey = '';
      const dateDivider = isNewDate
        ? `<div class="msg-date-sep"><span>${escapeHtml(curDateStr)}</span></div>`
        : '';
      lastDateStr = curDateStr;

      const unreadDivider = unreadFirstId && m.id === unreadFirstId
        ? '<div class="msg-unread-sep" id="msg-unread-sep"><span>Unread messages</span></div>'
        : '';

      if (m.message_type === 'CALL_EVENT' || m.message_type === 'SYSTEM') {
        lastShownClockKey = '';
        const sysLabel = escapeHtml(m.body || (m.message_type === 'CALL_EVENT' ? 'Call event' : 'System notice'));
        return `${dateDivider}${unreadDivider}<div class="msg-system-event" data-msg-id="${escapeHtml(m.id)}"><span>${sysLabel} · ${escapeHtml(formatClock(m.created_at))}</span></div>`;
      }

      const mine = m.sender_id === myId;
      const isDeleted = Boolean(m.deleted_for_everyone_at);
      const prev = msgs[idx - 1];
      const next = msgs[idx + 1];
      const groupedWithPrev = prev && !prev.deleted_for_everyone_at && prev.sender_id === m.sender_id && prev.message_type !== 'CALL_EVENT'
        && (Date.parse(m.created_at) - Date.parse(prev.created_at) < 120000);
      const groupedWithNext = next && !next.deleted_for_everyone_at && next.sender_id === m.sender_id && next.message_type !== 'CALL_EVENT'
        && (Date.parse(next.created_at) - Date.parse(m.created_at) < 120000);

      const attHtml = !isDeleted && Array.isArray(m.attachments) && m.attachments.length
        ? `<div class="msg-attachments${m.attachments.length > 1 ? ' is-carousel' : ''}">${m.attachments.map((att) => renderAttachmentItem(conv.conversation_id, att)).join('')}</div>`
        : '';

      const replyHtml = !isDeleted && m.reply_preview
        ? `<button type="button" class="msg-reply-quote" data-jump-msg="${escapeHtml(m.reply_preview.id)}">
            <strong>${escapeHtml(m.reply_preview.sender_id === myId ? 'You' : (m.reply_preview.sender_name || 'User'))}</strong>
            <span>${escapeHtml(m.reply_preview.body || 'Attachment')}</span>
          </button>`
        : '';

      const fwdHtml = !isDeleted && m.forwarded_from_id ? '<div class="msg-forwarded-tag">Forwarded</div>' : '';

      // Group reactions by emoji
      const reactionHtml = isDeleted ? '' : renderReactionsRowHtml(m);

      const receiptIcon = renderReceiptTickHtml(m, conv);

      const activeMatch = state.threadSearchMatches[state.threadSearchCursor] === m.id;
      const isMatch = searchQuery && state.threadSearchMatches.includes(m.id);
      const { hasTopMedia, hasAudioOnly } = isDeleted
        ? { hasTopMedia: false, hasAudioOnly: false }
        : getBubbleMediaLayout(m.attachments, {
            hasText: Boolean(m.body),
            hasHeaderMeta: Boolean(fwdHtml)
          });
      const bodyHtml = m.body ? `<p class="msg-text">${formatMessageBodyHtml(m.body, searchQuery)}</p>` : '';
      const clockLabel = formatClock(m.created_at);
      const curClockKey = clockLabel ? `${curDateStr}|${clockLabel}` : '';
      const showTime = Boolean(curClockKey && curClockKey !== lastShownClockKey);
      if (showTime) lastShownClockKey = curClockKey;
      const isMediaOnly = !isDeleted && hasTopMedia && !bodyHtml;
      const isPinned = Boolean(m.pinned_at || pinnedIds.has(m.id));
      const metaHtml = buildMetaHtml({
        ts: m.created_at,
        showTime,
        pinned: isPinned && !isDeleted,
        edited: Boolean(m.edited_at && !isDeleted),
        rightHtml: receiptIcon,
        overlay: isMediaOnly
      });
      const bubbleContent = isDeleted
        ? `${fwdHtml}<p class="msg-deleted-note">This message was unsent.</p>${metaHtml}`
        : (isMediaOnly
            ? `${attHtml}${metaHtml}`
            : (hasTopMedia
                ? `${attHtml}<div class="msg-bubble-body-pad">${bodyHtml}${metaHtml}</div>`
                : `${fwdHtml}${bodyHtml}${attHtml}${metaHtml}`));

      const isActivePinned = Boolean(isPinned && !isDeleted && state.activePinnedId && m.id === state.activePinnedId);
      return `${dateDivider}${unreadDivider}
        <article class="msg-row${mine ? ' is-mine' : ' is-peer'}${groupedWithPrev ? ' is-grouped-prev' : ''}${groupedWithNext ? ' is-grouped-next' : ''}${isMatch ? ' is-search-match' : ''}${activeMatch ? ' is-active-search-match' : ''}" data-msg-id="${escapeHtml(m.id)}">
          ${!mine ? `<div class="msg-row-avatar">${groupedWithNext ? '' : userAvatarHtml(conv, 'avatar-sm')}</div>` : ''}
          <div class="msg-bubble-col">
            ${replyHtml}
            <div class="msg-bubble-wrap">
              <div class="msg-bubble${isDeleted ? ' is-deleted' : ''}${isActivePinned ? ' is-pinned' : ''}${hasTopMedia ? ' has-top-media' : ''}${isMediaOnly ? ' is-media-only' : ''}${hasAudioOnly ? ' has-audio-only' : ''}">
                ${bubbleContent}
              </div>
              ${!isDeleted ? `
                <div class="msg-row-actions">
                  <button type="button" class="msg-action-mini" data-msg-act="react" data-msg-id="${escapeHtml(m.id)}" aria-label="React" title="React">${MSG_REACT_SVG}</button>
                  <button type="button" class="msg-action-mini" data-msg-act="reply" data-msg-id="${escapeHtml(m.id)}" aria-label="Reply" title="Reply">${MSG_REPLY_SVG}</button>
                  <button type="button" class="msg-action-mini" data-msg-act="menu" data-msg-id="${escapeHtml(m.id)}" aria-label="More message actions" title="More options">${MSG_MORE_SVG}</button>
                </div>` : ''}
            </div>
            ${reactionHtml}
          </div>
        </article>`;
    }).join('');

    const pendingClockState = { lastKey: lastShownClockKey };
    const pendingHtml = pendingList.map((p) => renderPendingRowHtml(p, pendingClockState)).join('');
    list.innerHTML = `${html}${pendingHtml}`;
    list.classList.toggle('is-thread-entering', Boolean(animate));
    ipon().bindAvatarFallbacks(list);
    ipon().syncPresenceDots(list);
    if (conv.conversation_id) {
      const missingAttPaths = [];
      msgs.forEach((m) => {
        if (m.deleted_for_everyone_at) return;
        (m.attachments || []).forEach((att) => {
          if (att?.path && !state.signedUrlCache.has(att.path)) missingAttPaths.push(att.path);
        });
      });
      if (missingAttPaths.length) scheduleMissingSignedUrls(conv.conversation_id, missingAttPaths);
    }
  }

  function renderAttachmentItem(conversationId, att) {
    const url = state.signedUrlCache.get(att.path) || '';
    const safeName = escapeHtml(att.name || 'file');
    const sizeText = escapeHtml(formatBytes(att.size));
    if (att.kind === 'image') {
      return `<figure class="msg-att-image">
        ${url
          ? `<button type="button" class="msg-img-open-btn" data-open-img="${escAttr(url)}" data-img-name="${escAttr(att.name || 'image')}" data-img-conv="${escAttr(conversationId)}" data-img-path="${escAttr(att.path)}" aria-label="View original ${safeName}">
              <img src="${escAttr(url)}" alt="${safeName}" loading="lazy">
            </button>`
          : '<div class="msg-att-loading msg-skel" role="status"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg><span>Loading image…</span></div>'}
      </figure>`;
    }
    if (att.kind === 'video') {
      const vidKey = getVideoMetaKey(att.path, url);
      const cached = vidKey ? videoMetaCache.get(vidKey) : null;
      const boxStyle = formatVideoBoxStyle(cached);
      if (url && vidKey && !cached?.poster && !cached?.failed && !videoPosterInFlight.has(vidKey)) {
        Promise.resolve().then(() => probeAndCaptureVideoMeta(url, vidKey));
      }
      return `<div class="msg-att-media-card">
        ${url ? `<div class="msg-video-player" data-vid-conv="${escAttr(conversationId)}" data-vid-path="${escAttr(att.path)}" data-vid-name="${escAttr(att.name || 'video')}" data-vid-key="${escAttr(vidKey)}"${boxStyle ? ` style="${escAttr(boxStyle)}"` : ''}>
          <video class="msg-att-video" preload="metadata" playsinline poster="${escAttr(cached?.poster || VIDEO_POSTER_FALLBACK)}" src="${escAttr(url)}"></video>
          <button type="button" class="msg-video-center-play" data-vact="play" aria-label="Play video">${VIDEO_PLAY_SVG}</button>
          <div class="msg-video-controls">
            <input type="range" class="msg-video-seek" min="0" max="1000" value="0" aria-label="Seek video">
            <div class="msg-video-bar-actions">
              <div class="msg-video-bar-left">
                <button type="button" class="msg-video-ctrl-btn" data-vact="play" aria-label="Play video" title="Play">${VIDEO_PLAY_SVG}</button>
                <button type="button" class="msg-video-ctrl-btn" data-vact="mute" aria-label="Mute audio" title="Mute">${VIDEO_VOL_ON_SVG}</button>
              </div>
              <div class="msg-video-bar-right">
                <button type="button" class="msg-video-ctrl-btn" data-vact="fs" aria-label="Toggle fullscreen" title="Fullscreen">${VIDEO_FS_SVG}</button>
                <button type="button" class="msg-video-ctrl-btn" data-vact="menu" aria-label="Video options" title="More options">${VIDEO_MORE_SVG}</button>
              </div>
            </div>
          </div>
        </div>` : '<div class="msg-att-loading msg-skel" role="status"><svg viewBox="0 0 24 24" aria-hidden="true"><polygon points="6 4 20 12 6 20 6 4"/></svg><span>Loading video…</span></div>'}
      </div>`;
    }
    if (att.kind === 'audio') {
      return `<div class="msg-att-audio-card">
        ${url ? renderVoicePlayerHtml(url, att.duration_seconds) : '<div class="msg-att-loading is-audio msg-skel" role="status"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/></svg><span>Loading voice note…</span></div>'}
      </div>`;
    }
    return `<button type="button" class="msg-att-doc-card msg-att-doc-btn" data-dl-conv="${escAttr(conversationId)}" data-dl-path="${escAttr(att.path)}" data-dl-name="${escAttr(att.name)}" title="Download ${safeName}">
      <span class="msg-doc-badge">${escapeHtml(formatBadgeLabel(att))}</span>
      <div class="msg-doc-meta">
        <strong>${safeName}</strong>
        <small>${sizeText}</small>
      </div>
    </button>`;
  }

  function jumpToMessageElement(msgId) {
    const el = document.querySelector(`#msg-messages-list [data-msg-id="${CSS.escape(msgId)}"]`);
    if (!el) return;
    clearTimeout(el._focusTimer);
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.remove('is-highlight-focus');
    void el.offsetWidth;
    el.classList.add('is-highlight-focus');
    el._focusTimer = setTimeout(() => {
      el.classList.remove('is-highlight-focus');
      el._focusTimer = null;
    }, 3600);
  }

  function renderThreadInfoDrawer() {
    const drawer = document.getElementById('msg-thread-drawer');
    document.getElementById('msg-thread-info-toggle')?.classList?.toggle?.('is-active', Boolean(state.showThreadInfo));
    if (!drawer) return;
    drawer.hidden = !state.showThreadInfo;
    if (!state.showThreadInfo || !state.activeThread?.conversation) return;
    const conv = state.activeThread.conversation;
    const msgs = state.activeThread.messages || [];
    const view = (state.threadInfoView === 'media' || state.threadInfoView === 'files') ? state.threadInfoView : 'root';
    state.threadInfoView = view;
    const media = [];
    const docs = [];
    msgs.forEach((m) => {
      if (m.deleted_for_everyone_at) return;
      (m.attachments || []).forEach((a) => {
        const entry = { att: a, msgId: m.id, createdAt: m.created_at };
        if (a.kind === 'image' || a.kind === 'video') media.push(entry);
        else docs.push(entry);
      });
    });

    const closeBtnHtml = `<button type="button" class="dialog-close msg-drawer-close-btn" id="msg-drawer-close" aria-label="Close chat details">${MSG_CLOSE_X_SVG}</button>`;

    if (view === 'media') {
      const orderedMedia = media.slice().reverse();
      const missingPaths = orderedMedia
        .map((x) => x.att?.path)
        .filter((p) => p && !state.signedUrlCache.has(p));
      if (missingPaths.length && conv.conversation_id) {
        ensureSignedViewUrls(conv.conversation_id, missingPaths)
          .then(() => {
            if (
              missingPaths.some((p) => state.signedUrlCache.has(p))
              && state.showThreadInfo
              && state.threadInfoView === 'media'
              && state.activeConvId === conv.conversation_id
            ) {
              renderThreadInfoDrawer();
            }
          })
          .catch(() => { });
      }
      drawer.innerHTML = `
        <div class="msg-drawer-head is-subview">
          <div class="msg-drawer-head-left">
            <button type="button" class="msg-drawer-back" data-drawer-view="root" aria-label="Back to chat info">${BACK_ARROW_ICON_SVG}</button>
            <h3>Shared media</h3>
            <span class="msg-drawer-head-count">${media.length}</span>
          </div>
          ${closeBtnHtml}
        </div>
        <div class="msg-drawer-body" data-drawer-screen="media">
          ${orderedMedia.length
            ? `<div class="msg-drawer-media-grid">${orderedMedia.map(({ att: a, msgId }) => {
                const url = state.signedUrlCache.get(a.path) || '';
                if (!url) return `<span class="msg-drawer-thumb is-loading msg-skel" title="${escapeHtml(a.name || 'Media')}" aria-label="Loading ${escapeHtml(a.name || 'media')}"></span>`;
                if (a.kind === 'video') {
                  const vidKey = getVideoMetaKey(a.path, url);
                  const cached = vidKey ? videoMetaCache.get(vidKey) : null;
                  if (url && vidKey && !cached?.poster && !cached?.failed && !videoPosterInFlight.has(vidKey)) {
                    Promise.resolve().then(() => probeAndCaptureVideoMeta(url, vidKey));
                  }
                  return `<button type="button" class="msg-drawer-thumb is-video" data-open-vid="${escAttr(url)}" data-vid-conv="${escAttr(conv.conversation_id)}" data-vid-path="${escAttr(a.path)}" data-vid-name="${escAttr(a.name || 'video')}" data-vid-key="${escAttr(vidKey)}" title="Play ${escapeHtml(a.name || 'video')}" aria-label="Play video ${escapeHtml(a.name || 'video')}"><video muted preload="metadata" playsinline poster="${escAttr(cached?.poster || VIDEO_POSTER_FALLBACK)}" src="${escAttr(url)}"></video><span class="msg-drawer-video-badge" aria-hidden="true">${VIDEO_PLAY_SVG}</span></button>`;
                }
                return `<button type="button" class="msg-drawer-thumb" data-open-img="${escAttr(url)}" data-img-name="${escAttr(a.name || 'image')}" data-img-conv="${escAttr(conv.conversation_id)}" data-img-path="${escAttr(a.path)}" aria-label="View ${escapeHtml(a.name || 'image')}"><img src="${escAttr(url)}" alt="${escapeHtml(a.name || 'Shared media')}" loading="lazy"></button>`;
              }).join('')}</div>`
            : `<div class="msg-drawer-empty empty-state"><strong>No shared media yet</strong><span>Photos and videos shared in this chat will appear here.</span></div>`}
        </div>`;
      return;
    }

    if (view === 'files') {
      const orderedDocs = docs.slice().reverse();
      drawer.innerHTML = `
        <div class="msg-drawer-head is-subview">
          <div class="msg-drawer-head-left">
            <button type="button" class="msg-drawer-back" data-drawer-view="root" aria-label="Back to chat info">${BACK_ARROW_ICON_SVG}</button>
            <h3>Shared files</h3>
            <span class="msg-drawer-head-count">${docs.length}</span>
          </div>
          ${closeBtnHtml}
        </div>
        <div class="msg-drawer-body" data-drawer-screen="files">
          ${orderedDocs.length
            ? `<ul class="msg-drawer-files">${orderedDocs.map(({ att: d, createdAt }) => {
                const metaParts = [formatBytes(d.size), formatShortDate(createdAt)].filter(Boolean).join(' · ');
                return `
                <li>
                  <span class="msg-drawer-file-badge">${escapeHtml(formatBadgeLabel(d))}</span>
                  <div class="msg-drawer-file-meta">
                    <strong title="${escapeHtml(d.name || 'File')}">${escapeHtml(d.name || 'Attachment')}</strong>
                    ${metaParts ? `<small>${escapeHtml(metaParts)}</small>` : ''}
                  </div>
                  <button type="button" class="msg-att-dl-btn" data-dl-conv="${escAttr(conv.conversation_id)}" data-dl-path="${escAttr(d.path)}" data-dl-name="${escAttr(d.name || 'file')}">Download</button>
                </li>`;
              }).join('')}</ul>`
            : `<div class="msg-drawer-empty empty-state"><strong>No shared files yet</strong><span>Documents and other attachments sent in this chat will appear here.</span></div>`}
        </div>`;
      return;
    }

    const themes = ['paper', 'emerald', 'sage', 'sand', 'midnight'];
    const currentTheme = themes.includes(conv.chat_theme) ? conv.chat_theme : 'paper';
    const mediaIconSvg = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="m21 16-5-5L5 21"/></svg>';
    const fileIconSvg = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h8"/><path d="M8 17h6"/></svg>';
    const chevronRightSvg = '<svg class="msg-drawer-nav-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>';
    const themeCheckSvg = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 13l4 4L19 7"/></svg>';
    const bellMuteSvg = conv.is_muted
      ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>'
      : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13.73 21a2 2 0 0 1-3.46 0"/><path d="M18.63 13A17.89 17.89 0 0 1 18 8"/><path d="M6.26 6.26A5.86 5.86 0 0 0 6 8c0 7-3 9-3 9h14"/><path d="M18 8a6 6 0 0 0-9.33-5"/><line x1="2" y1="2" x2="22" y2="22"/></svg>';
    const archiveIconSvg = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="4" width="20" height="5" rx="1.5"/><path d="M4 9v9a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9"/><path d="M10 13h4"/></svg>';
    const mailUnreadIconSvg = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 6L2 7"/></svg>';
    const trashIconSvg = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>';
    const blockIconSvg = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="m5.64 5.64 12.72 12.72"/></svg>';
    const isBlockedByMe = conv.friendship_status === 'BLOCKED_BY_ME';
    drawer.innerHTML = `
      <div class="msg-drawer-head">
        <h3>Chat Info &amp; Options</h3>
        ${closeBtnHtml}
      </div>
      <div class="msg-drawer-body is-root" data-drawer-screen="root">
        <div class="msg-drawer-section is-top">
          <div class="msg-drawer-profile">
            ${userAvatarHtml(conv, 'avatar-lg', { showPresence: false })}
            <strong>${escapeHtml(conv.full_name || 'User')}</strong>
            ${conv.username ? `<small>@${escapeHtml(conv.username)}</small>` : ''}
            ${conv.bio ? `<p class="msg-drawer-bio">${escapeHtml(conv.bio)}</p>` : ''}
          </div>
          <div class="msg-drawer-actions-block">
            <h4>Chat actions</h4>
            <div class="msg-drawer-actions">
              <button type="button" class="msg-drawer-action-btn" data-conv-act="${conv.is_pinned ? 'unpin' : 'pin'}">${MSG_PIN_SVG}<span>${conv.is_pinned ? 'Unpin chat' : 'Pin chat'}</span></button>
              <button type="button" class="msg-drawer-action-btn" data-conv-act="${conv.is_muted ? 'unmute' : 'mute'}">${bellMuteSvg}<span>${conv.is_muted ? 'Unmute' : 'Mute'}</span></button>
              <button type="button" class="msg-drawer-action-btn" data-conv-act="${conv.is_archived ? 'unarchive' : 'archive'}">${archiveIconSvg}<span>${conv.is_archived ? 'Unarchive' : 'Archive'}</span></button>
              <button type="button" class="msg-drawer-action-btn" data-conv-act="mark_unread">${mailUnreadIconSvg}<span>Mark unread</span></button>
              <button type="button" class="msg-drawer-action-btn" data-conv-act="delete_for_me">${trashIconSvg}<span>Delete for me</span></button>
              <button type="button" class="msg-drawer-action-btn is-danger" data-social-action="${isBlockedByMe ? 'unblock' : 'block'}" data-target-id="${escapeHtml(conv.id)}">${blockIconSvg}<span>${isBlockedByMe ? 'Unblock user' : 'Block user'}</span></button>
            </div>
          </div>
        </div>
        <div class="msg-drawer-section">
          <h4>Theme</h4>
          <div class="msg-theme-swatches">
            ${themes.map((t) => {
              const active = currentTheme === t;
              return `<button type="button" class="msg-theme-chip${active ? ' is-active' : ''}" data-conv-theme="${t}" aria-pressed="${active ? 'true' : 'false'}"><span class="msg-theme-swatch is-${t}" aria-hidden="true">${themeCheckSvg}</span><span class="msg-theme-label">${escapeHtml(t[0].toUpperCase() + t.slice(1))}</span></button>`;
            }).join('')}
          </div>
        </div>
        <div class="msg-drawer-section">
          <h4>Media &amp; files</h4>
          <div class="msg-drawer-nav-list">
            <button type="button" class="msg-drawer-nav-btn" data-drawer-view="media">
              <span class="msg-drawer-nav-icon" aria-hidden="true">${mediaIconSvg}</span>
              <span class="msg-drawer-nav-copy">
                <strong>Shared media</strong>
                <small>Photos &amp; videos</small>
              </span>
              <span class="msg-drawer-nav-right">
                <span class="msg-drawer-nav-count">${media.length}</span>
                ${chevronRightSvg}
              </span>
            </button>
            <button type="button" class="msg-drawer-nav-btn" data-drawer-view="files">
              <span class="msg-drawer-nav-icon" aria-hidden="true">${fileIconSvg}</span>
              <span class="msg-drawer-nav-copy">
                <strong>Shared files</strong>
                <small>Documents &amp; attachments</small>
              </span>
              <span class="msg-drawer-nav-right">
                <span class="msg-drawer-nav-count">${docs.length}</span>
                ${chevronRightSvg}
              </span>
            </button>
          </div>
        </div>
      </div>`;
  }

  // Friends, Requests & Sent Connections View
  function renderFriendsView() {
    const view = document.getElementById('msg-view-friends');
    if (!view) return;
    const { friends = [], incoming_requests = [], sent_requests = [] } = state.overview || {};
    const sub = ['all', 'incoming', 'sent'].includes(state.friendsSubTab) ? state.friendsSubTab : 'all';
    state.friendsSubTab = sub;
    view.innerHTML = `
      <section class="msg-friends-hero" aria-label="Friends and Connections">
        <div class="msg-friends-hero-copy">
          <h3>Friends <span class="msg-hero-amp">&amp;</span> Connections</h3>
          <p>Manage accepted friends, incoming requests, and sent requests.</p>
        </div>
        <div class="msg-friends-tabs" role="tablist" aria-label="Connections sections">
          <button type="button" role="tab" aria-selected="${sub === 'all'}" class="msg-friends-tab${sub === 'all' ? ' is-active' : ''}" data-friends-sub="all">
            <span>My Friends</span><em class="msg-tab-count">${friends.length}</em>
          </button>
          <button type="button" role="tab" aria-selected="${sub === 'incoming'}" class="msg-friends-tab${sub === 'incoming' ? ' is-active' : ''}" data-friends-sub="incoming">
            <span>Friend Requests</span>${incoming_requests.length ? `<em class="msg-tab-count">${incoming_requests.length}</em>` : ''}
          </button>
          <button type="button" role="tab" aria-selected="${sub === 'sent'}" class="msg-friends-tab${sub === 'sent' ? ' is-active' : ''}" data-friends-sub="sent">
            <span>Sent</span><em class="msg-tab-count">${sent_requests.length}</em>
          </button>
        </div>
      </section>
      <div class="msg-friends-body" id="msg-friends-list-host"></div>`;

    const host = document.getElementById('msg-friends-list-host');
    if (!host) return;
    if (!state.overviewLoaded) {
      host.innerHTML = skeletonHtml('card', 4);
      return;
    }

    if (sub === 'all') {
      host.innerHTML = friends.length
        ? `<div class="msg-friends-search-row">
             <div class="msg-search-input-wrap msg-friends-search-wrap">
               <svg class="msg-search-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
               <input id="msg-friend-filter" type="search" placeholder="Filter your friends by name or @username…" aria-label="Filter friends" autocomplete="off">
               <button type="button" class="msg-search-clear" id="msg-friend-filter-clear" aria-label="Clear friend filter" hidden>
                 <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>
               </button>
             </div>
           </div>
           <div class="msg-cards-grid">${friends.map((f) => renderFriendCardHtml(f)).join('')}</div>
           <div class="empty-state msg-friend-filter-empty" id="msg-friend-filter-empty" hidden><strong>No matching friends</strong><p>Try another name or @username, or search all eligible members in Chats.</p></div>`
        : '<div class="empty-state"><strong>No friends added yet</strong><p>Search eligible members to send a friend request and start chatting.</p><div class="msg-empty-cta-row"><button type="button" class="button button-primary button-sm" data-goto-discover>Search people</button></div></div>';
    } else if (sub === 'incoming') {
      host.innerHTML = incoming_requests.length
        ? `<div class="msg-cards-grid">${incoming_requests.map((r) => `
            <article class="msg-person-card">
              <div class="msg-person-head">
                ${userAvatarHtml({ id: r.user_id, full_name: r.full_name, avatar_url: r.avatar_url, allow_online_status: false }, 'avatar-md', { showPresence: false })}
                <div>
                  <strong>${escapeHtml(r.full_name)}</strong>
                  ${r.username ? `<small>@${escapeHtml(r.username)}</small>` : `<small>Sent ${escapeHtml(formatShortDate(r.created_at))}</small>`}
                </div>
              </div>
              <div class="msg-person-actions">
                <button type="button" class="button button-primary button-sm" data-req-decision="ACCEPT" data-req-id="${escapeHtml(r.id)}">Accept</button>
                <button type="button" class="button button-secondary button-sm" data-req-decision="DECLINE" data-req-id="${escapeHtml(r.id)}">Decline</button>
                <button type="button" class="button button-secondary button-sm is-danger" data-social-action="block" data-target-id="${escapeHtml(r.user_id)}">Block</button>
              </div>
            </article>`).join('')}</div>`
        : '<div class="empty-state"><strong>No incoming friend requests</strong><p>New friend requests appear here with real-time badge updates.</p></div>';
    } else {
      host.innerHTML = sent_requests.length
        ? `<div class="msg-cards-grid">${sent_requests.map((r) => `
            <article class="msg-person-card">
              <div class="msg-person-head">
                ${userAvatarHtml({ id: r.user_id, full_name: r.full_name, avatar_url: r.avatar_url, allow_online_status: false }, 'avatar-md', { showPresence: false })}
                <div>
                  <strong>${escapeHtml(r.full_name)}</strong>
                  <small>Sent ${escapeHtml(formatShortDate(r.created_at))}</small>
                </div>
              </div>
              <div class="msg-person-actions">
                <button type="button" class="button button-secondary button-sm" data-cancel-req="${escapeHtml(r.id)}">Cancel request</button>
              </div>
            </article>`).join('')}</div>`
        : '<div class="empty-state"><strong>No pending sent requests</strong><p>Requests you send remain here until accepted, declined, or cancelled.</p></div>';
    }

    ipon().bindAvatarFallbacks(view);
    ipon().syncPresenceDots(view);
  }

  function renderFriendCardHtml(f) {
    return `<article class="msg-person-card" data-friend-card data-search-blob="${escAttr(`${f.full_name} ${f.username || ''}`.toLowerCase())}">
      <div class="msg-person-head">
        ${userAvatarHtml(f, 'avatar-md')}
        <div>
          <strong>${escapeHtml(f.full_name)}</strong>
          ${f.username ? `<small>@${escapeHtml(f.username)}</small>` : ''}
          <small>${escapeHtml(formatStatusLine(f))}</small>
        </div>
      </div>
      <div class="msg-person-actions">
        <button type="button" class="button button-primary button-sm" data-social-action="message" data-target-id="${escapeHtml(f.id)}">Message</button>
        <button type="button" class="button button-secondary button-sm" data-social-action="remove_friend" data-target-id="${escapeHtml(f.id)}">Remove</button>
        <button type="button" class="button button-secondary button-sm is-danger" data-social-action="block" data-target-id="${escapeHtml(f.id)}">Block</button>
      </div>
    </article>`;
  }

  // Unified Inline Discovery (User search + Cross-conversation Message search)
  async function runGlobalDiscovery(query) {
    const reqSeq = ++state.discoverySeq;
    const q = String(query || '');
    state.discoverQuery = q;
    state.searchLoading = true;
    if (state.tab === 'chats' && (state.searchActive || state.chatListQuery.trim())) {
      renderConversationList();
    }
    try {
      const [users, msgHits] = await Promise.all([
        ipon().rpc('search_social_users', { p_query: q, p_limit: 30 }).catch(() => []),
        q.trim().length >= 2
          ? ipon().rpc('search_conversation_messages', { p_conversation_id: null, p_query: q, p_sender_id: null, p_limit: 30 }).catch(() => [])
          : Promise.resolve([])
      ]);
      if (reqSeq !== state.discoverySeq) return;
      state.discoverUsers = Array.isArray(users) ? users : [];
      state.discoverMessages = Array.isArray(msgHits) ? msgHits : [];
    } finally {
      if (reqSeq === state.discoverySeq) {
        state.searchLoading = false;
        if (state.tab === 'chats' && (state.searchActive || state.chatListQuery.trim())) {
          renderConversationList();
        }
      }
    }
  }

  function renderAlertsView() {
    const view = document.getElementById('msg-view-alerts');
    if (!view) return;
    const rows = state.socialNotifications || [];
    const hasUnread = rows.some((r) => !r.read_at);
    view.innerHTML = `
      <div class="msg-panel-header">
        <div>
          <h3>Messaging &amp; Social Notifications</h3>
          <p>Friend requests, accepted connections, new messages, and message requests.</p>
        </div>
        ${hasUnread ? '<button type="button" class="button button-secondary button-sm" id="msg-mark-alerts-read">Mark all read</button>' : ''}
      </div>
      <div class="msg-alerts-list">
        ${rows.length ? rows.map((n) => `
          <button type="button" class="msg-alert-row${n.read_at ? '' : ' is-unread'}" data-social-alert-id="${escapeHtml(n.id)}" data-social-link="${escAttr(n.link || '')}" data-social-type="${escAttr(n.type || '')}">
            <div class="msg-alert-copy">
              <strong>${escapeHtml(n.title)}</strong>
              <p>${escapeHtml(n.message)}</p>
              <small>${escapeHtml(ipon().dateLabel(n.created_at, { dateStyle: 'medium', timeStyle: 'short' }))}</small>
            </div>
            ${n.read_at ? '' : '<i class="notification-unread" aria-label="Unread"></i>'}
          </button>`).join('') : '<div class="empty-state"><strong>No messaging notifications yet</strong><p>Friend requests, replies, and message requests will show up here in real time.</p></div>'}
      </div>`;
  }

  // Profile Quick Action Popover (anchored near clicked DP with automatic edge clamping)
  let activePopoverAnchor = null;

  function renderSharedGroupsCard(rawGroups) {
    const groups = Array.isArray(rawGroups)
      ? rawGroups.map((g) => String(g || '').trim()).filter(Boolean)
      : [];
    if (!groups.length) return '';
    if (groups.length === 1) {
      return `<div class="msg-pop-groups-card">
        <div class="msg-pop-groups-bar">
          <span class="msg-pop-groups-label">Groups</span>
          <span class="msg-pop-groups-name" title="${escapeHtml(groups[0])}">${escapeHtml(groups[0])}</span>
        </div>
      </div>`;
    }
    const extra = groups.length - 1;
    const firstGroup = groups[0];
    return `<div class="msg-pop-groups-card" data-pop-groups-card>
      <button type="button" class="msg-pop-groups-bar msg-pop-groups-toggle" data-pop-groups-toggle aria-expanded="false" aria-label="Show all ${groups.length} shared groups">
        <span class="msg-pop-groups-label">Groups</span>
        <span class="msg-pop-groups-name" title="${escapeHtml(firstGroup)}">${escapeHtml(firstGroup)}</span>
        <span class="msg-pop-groups-more">+${extra}<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></span>
      </button>
      <div class="msg-pop-groups-list" hidden>
        <div class="msg-pop-groups-chips" role="list" aria-label="Shared groups">
          ${groups.map((name) => `<span class="msg-pop-group-chip" role="listitem">${escapeHtml(name)}</span>`).join('')}
        </div>
      </div>
    </div>`;
  }

  async function openProfilePopover(targetUserId, anchorEl) {
    const pop = document.getElementById('msg-profile-popover');
    if (!pop || !targetUserId || String(targetUserId) === String(initializedProfile?.id)) return;
    // Keep the popover inside the top-most open modal dialog so Top Layer stacking never obscures it.
    const activeDialog = document.querySelector('#msg-workspace-dialog[open], #msg-forward-dialog[open], #msg-settings-dialog[open], dialog[open]');
    const targetHost = activeDialog || document.body;
    if (pop.parentElement !== targetHost) targetHost.appendChild(pop);
    activePopoverAnchor = anchorEl || null;
    pop.hidden = false;
    pop.innerHTML = skeletonHtml('popover');
    positionPopoverNearAnchor(pop, activePopoverAnchor);

    try {
      const profile = await ipon().rpc('get_social_user_profile', { p_target_id: targetUserId });
      if (pop.hidden) return;
      const fs = profile.friendship_status;
      let friendAction = '';
      if (fs === 'FRIENDS') {
        friendAction = `<button type="button" class="msg-pop-btn msg-pop-secondary-btn" data-social-action="remove_friend" data-target-id="${escapeHtml(profile.id)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg><span>Friends · Remove</span></button>`;
      } else if (fs === 'OUTGOING_REQUEST') {
        friendAction = `<button type="button" class="msg-pop-btn msg-pop-secondary-btn" data-cancel-req="${escapeHtml(profile.friend_request_id)}"><span>Cancel Request</span></button>`;
      } else if (fs === 'INCOMING_REQUEST') {
        friendAction = `<button type="button" class="msg-pop-btn msg-pop-primary-btn" data-req-decision="ACCEPT" data-req-id="${escapeHtml(profile.friend_request_id)}"><svg class="msg-pop-btn-check" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg><span>Accept Friend</span></button>`;
      } else if (profile.can_send_friend_request) {
        friendAction = `<button type="button" class="msg-pop-btn msg-pop-primary-btn" data-social-action="add_friend" data-target-id="${escapeHtml(profile.id)}"><span>Add Friend</span></button>`;
      }

      const statusLabels = {
        FRIENDS: 'Friends',
        OUTGOING_REQUEST: 'Friend request sent',
        INCOMING_REQUEST: 'Sent you a friend request',
        BLOCKED_BY_ME: 'Blocked by you',
        BLOCKED_ME: 'Messaging restricted',
        NONE: 'Not friends yet'
      };
      const mutualCount = Number(profile.mutual_friends_count || 0);
      const statusLine = statusLabels[fs] || 'Community member';
      const subtitle = mutualCount > 0
        ? `${statusLine} · ${mutualCount} mutual friend${mutualCount === 1 ? '' : 's'}`
        : statusLine;
      const groupsHtml = renderSharedGroupsCard(profile.shared_groups);
      const bioText = String(profile.bio || '').trim();
      const canMessage = Boolean(profile.can_message);

      pop.innerHTML = `
        <button type="button" class="dialog-close msg-pop-close" id="msg-pop-close" aria-label="Close profile popover"><svg viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18"/></svg></button>
        <div class="msg-pop-head">
          ${userAvatarHtml(profile, 'avatar-lg', { clickable: false, showPresence: false })}
          <div class="msg-pop-title">
            <strong id="msg-pop-name">${escapeHtml(profile.full_name)}</strong>
            <small class="msg-pop-status">${escapeHtml(subtitle)}</small>
          </div>
        </div>
        ${bioText ? `<p class="msg-pop-bio">${escapeHtml(bioText)}</p>` : ''}
        ${groupsHtml}
        <div class="msg-pop-actions">
          ${friendAction}
          <div class="msg-pop-secondary-row${canMessage ? '' : ' is-single'}">
            ${canMessage ? `<button type="button" class="msg-pop-btn msg-pop-outline-btn" data-social-action="message" data-target-id="${escapeHtml(profile.id)}">Message</button>` : ''}
            <button type="button" class="msg-pop-btn msg-pop-outline-btn is-danger" data-social-action="${fs === 'BLOCKED_BY_ME' ? 'unblock' : 'block'}" data-target-id="${escapeHtml(profile.id)}">${fs === 'BLOCKED_BY_ME' ? 'Unblock User' : 'Block User'}</button>
          </div>
        </div>`;

      ipon().bindAvatarFallbacks(pop);
      ipon().syncPresenceDots(pop);
      positionPopoverNearAnchor(pop, activePopoverAnchor);
    } catch (error) {
      pop.innerHTML = `<button type="button" class="dialog-close msg-pop-close" id="msg-pop-close" aria-label="Close profile popover"><svg viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18"/></svg></button><p class="empty-state">${escapeHtml(ipon().friendlyError(error))}</p>`;
      positionPopoverNearAnchor(pop, activePopoverAnchor);
    }
  }

  function positionPopoverNearAnchor(pop, anchorEl) {
    if (!pop || !anchorEl) return;
    const rect = anchorEl.getBoundingClientRect();
    const popRect = pop.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const pad = 12;
    const pw = Math.min(popRect.width || 364, vw - pad * 2);
    const ph = popRect.height || 260;
    let left = rect.right + 10;
    if (left + pw > vw - pad) left = rect.left - pw - 10;
    if (left < pad) left = Math.max(pad, Math.min(vw - pw - pad, rect.left));
    let top = rect.top;
    if (top + ph > vh - pad) top = Math.max(pad, vh - ph - pad);
    if (top < pad) top = pad;
    pop.style.left = `${Math.round(left)}px`;
    pop.style.top = `${Math.round(top)}px`;
  }

  function closeProfilePopover() {
    activePopoverAnchor = null;
    const pop = document.getElementById('msg-profile-popover');
    if (pop) pop.hidden = true;
  }

  // Composer Context, Emoji, Upload Queue, Voice Note & Sending
  function autoResizeTextarea(el) {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(140, Math.max(40, el.scrollHeight))}px`;
  }

  function renderContextBar() {
    const bar = document.getElementById('msg-context-bar');
    if (!bar) return;
    if (state.editingMsg) {
      bar.hidden = false;
      bar.innerHTML = `<div><strong>Editing message</strong><span>${escapeHtml(state.editingMsg.body || '')}</span></div><button type="button" class="dialog-close msg-mini-close" id="msg-cancel-context" aria-label="Cancel editing"><svg viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18"/></svg></button>`;
      return;
    }
    if (state.replyToMsg) {
      const senderLabel = state.replyToMsg.sender_id === initializedProfile?.id ? 'yourself' : (state.activeThread?.conversation?.full_name || 'User');
      bar.hidden = false;
      bar.innerHTML = `<div><strong>Replying to ${escapeHtml(senderLabel)}</strong><span>${escapeHtml(state.replyToMsg.body || 'Attachment')}</span></div><button type="button" class="dialog-close msg-mini-close" id="msg-cancel-context" aria-label="Cancel reply"><svg viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18"/></svg></button>`;
      return;
    }
    bar.hidden = true;
  }

  function renderUploadQueue() {
    const box = document.getElementById('msg-upload-queue');
    if (!box) return;
    if (!state.uploadQueue.length) {
      box.hidden = true;
      box.innerHTML = '';
      delete box.dataset.count;
      return;
    }
    box.hidden = false;
    box.dataset.count = String(state.uploadQueue.length);
    box.innerHTML = state.uploadQueue.map((item, idx) => `
      <div class="msg-queue-card">
        ${item.previewUrl ? `<img class="msg-queue-thumb" src="${escAttr(item.previewUrl)}" alt="${escapeHtml(item.name)}">` : `<span class="msg-doc-badge">${escapeHtml(formatBadgeLabel(item))}</span>`}
        <div class="msg-queue-meta">
          <strong title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</strong>
          <small>${escapeHtml(formatBytes(item.size))}</small>
        </div>
        <button type="button" class="dialog-close msg-queue-remove" data-remove-queue="${idx}" aria-label="Remove ${escapeHtml(item.name)}"><svg viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18"/></svg></button>
      </div>`).join('');
  }

  function queuePickedFiles(fileList) {
    const files = [...(fileList || [])];
    if (!files.length) return;
    const prevBatches = Math.ceil(state.uploadQueue.length / MAX_ATTACHMENTS_PER_MSG);
    for (const file of files) {
      if (state.uploadQueue.length >= MAX_QUEUE_ATTACHMENTS) {
        ipon().toast(`Attach up to ${MAX_QUEUE_ATTACHMENTS} files at a time (up to ${MAX_ATTACHMENTS_PER_MSG} per batch).`, 'error');
        break;
      }
      const name = String(file.name || 'attachment');
      const mime = String(file.type || '').toLowerCase();
      if (file.size > MAX_ATTACHMENT_BYTES) {
        ipon().toast(`"${name}" exceeds the 50 MB size limit.`, 'error');
        continue;
      }
      if (BLOCKED_EXT_RE.test(name) || mime.includes('svg') || mime.includes('html') || mime.includes('javascript')) {
        ipon().toast(`"${name}" is not allowed for security reasons.`, 'error');
        continue;
      }
      if (!ALLOWED_EXT_RE.test(name) && !mime.startsWith('image/') && !mime.startsWith('audio/')) {
        ipon().toast(`"${name}" format is not supported.`, 'error');
        continue;
      }
      const kind = detectAttachmentKind(file);
      const previewUrl = (kind === 'image' || kind === 'video' || kind === 'audio') && typeof URL?.createObjectURL === 'function' ? URL.createObjectURL(file) : '';
      if (kind === 'video' && previewUrl) {
        probeAndCaptureVideoMeta(previewUrl, previewUrl, { isLocalBlob: true });
      }
      state.uploadQueue.push({ file, name, type: file.type || '', size: file.size, kind, previewUrl, progress: 0, error: '' });
    }
    const nextBatches = Math.ceil(state.uploadQueue.length / MAX_ATTACHMENTS_PER_MSG);
    if (nextBatches > 1 && nextBatches > prevBatches) {
      ipon().toast(`${state.uploadQueue.length} files queued — will send in ${nextBatches} batches (up to ${MAX_ATTACHMENTS_PER_MSG} per message).`);
    }
    renderUploadQueue();
    const qBox = document.getElementById('msg-upload-queue');
    if (qBox) requestAnimationFrame(() => { qBox.scrollLeft = qBox.scrollWidth; });
  }

  function clearUploadQueue({ keepUrls = false } = {}) {
    state.uploadQueue.forEach((entry) => {
      if (!keepUrls && entry.previewUrl) try { URL.revokeObjectURL(entry.previewUrl); } catch { }
    });
    state.uploadQueue = [];
    renderUploadQueue();
    const qBox = document.getElementById('msg-upload-queue');
    if (qBox) requestAnimationFrame(() => { qBox.scrollLeft = qBox.scrollWidth; });
  }

  function syncComposerCharCounter(len) {
    const el = document.getElementById('msg-char-counter');
    if (!el) return;
    const count = Math.max(0, Number(len || 0));
    el.textContent = `${count} / 500`;
    el.hidden = count < 350;
    el.classList?.toggle?.('is-near-limit', count >= 460);
  }

  async function submitComposer(event) {
    event?.preventDefault();
    if (!state.activeConvId || !isEligible()) return;
    const input = document.getElementById('msg-composer-input');
    const sendBtn = document.getElementById('msg-send-btn');
    const body = String(input?.value || '').trim();

    if (state.editingMsg) {
      if (!body) {
        ipon().toast('Message cannot be empty.', 'error');
        return;
      }
      if (sendBtn) { sendBtn.disabled = true; sendBtn.classList.add('is-submitting'); }
      try {
        await ipon().rpc('edit_chat_message', { p_message_id: state.editingMsg.id, p_body: body });
        state.editingMsg = null;
        if (input) { input.value = ''; autoResizeTextarea(input); }
        renderContextBar();
        await Promise.all([openConversation(state.activeConvId, { markRead: false, silent: true }), refreshConversations()]);
      } catch (err) {
        ipon().toast(ipon().friendlyError(err), 'error');
      } finally {
        if (sendBtn) { sendBtn.disabled = false; sendBtn.classList.remove('is-submitting'); }
      }
      return;
    }

    if (!body && !state.uploadQueue.length) {
      input?.focus();
      return;
    }

    const convId = state.activeConvId;
    const queuedFiles = [...state.uploadQueue];
    const replyTarget = state.replyToMsg;

    sendTypingBroadcast(false);
    if (input) { input.value = ''; autoResizeTextarea(input); }
    syncComposerCharCounter(0);
    state.draftsByConv.delete(convId);
    state.replyToMsg = null;
    renderContextBar();
    clearUploadQueue({ keepUrls: true });
    input?.focus();

    if (queuedFiles.length <= MAX_ATTACHMENTS_PER_MSG) {
      enqueuePendingMessage({
        conversationId: convId,
        body,
        messageType: queuedFiles.length ? 'MEDIA' : 'TEXT',
        replyToMsg: replyTarget,
        files: queuedFiles
      });
      return;
    }

    const batches = [];
    for (let i = 0; i < queuedFiles.length; i += MAX_ATTACHMENTS_PER_MSG) {
      const chunkIdx = batches.length;
      const item = enqueuePendingMessage({
        conversationId: convId,
        body: chunkIdx === 0 ? body : '',
        messageType: 'MEDIA',
        replyToMsg: chunkIdx === 0 ? replyTarget : null,
        files: queuedFiles.slice(i, i + MAX_ATTACHMENTS_PER_MSG),
        deferProcess: true
      });
      if (item) batches.push(item);
    }
    if (convId === state.activeConvId) {
      renderMessagesList();
      requestAnimationFrame(() => {
        const wrap = document.getElementById('msg-scroll-wrap');
        if (wrap) wrap.scrollTop = wrap.scrollHeight;
      });
    }
    (async () => {
      for (const item of batches) {
        if (findPendingItem(convId, item.localId)) await processPendingMessage(item);
      }
    })();
  }

  function sendTypingBroadcast(isTyping) {
    clearTimeout(typingIdleTimer);
    typingIdleTimer = null;
    if (!typingChannel || !state.activeConvId || !initializedProfile?.id) {
      state.lastTypingState = false;
      state.lastTypingSentAt = 0;
      return;
    }
    const next = Boolean(isTyping);
    const now = Date.now();
    if (next) {
      typingIdleTimer = setTimeout(() => { sendTypingBroadcast(false); }, 1500);
      if (state.lastTypingState && now - state.lastTypingSentAt < 1200) return;
      state.lastTypingState = true;
      state.lastTypingSentAt = now;
    } else {
      if (!state.lastTypingState) return;
      state.lastTypingState = false;
      state.lastTypingSentAt = 0;
    }
    typingChannel.send?.({
      type: 'broadcast',
      event: 'typing',
      payload: { user_id: initializedProfile.id, typing: next }
    })?.catch?.(() => { });
  }

  // Voice Note Recording
  function isAndroidNativeShell() {
    const capPlatform = String(window.Capacitor?.getPlatform?.() || '').toLowerCase();
    if (capPlatform) return capPlatform === 'android';
    return /myIPONApp/i.test(navigator.userAgent || '') && /Android/i.test(navigator.userAgent || '');
  }

  async function ensureMicrophoneAccess() {
    const bgPlugin = window.Capacitor?.Plugins?.BackgroundNotifications || null;
    if (typeof bgPlugin?.ensureMicrophonePermission !== 'function') {
      return {
        granted: true,
        native: isAndroidNativeShell(),
        hasNativeBridge: false,
        manifestMissing: false
      };
    }
    try {
      const res = await bgPlugin.ensureMicrophonePermission();
      return {
        native: true,
        hasNativeBridge: true,
        granted: Boolean(res?.granted),
        canAskAgain: res?.canAskAgain !== false,
        manifestMissing: Boolean(res?.manifestMissing || res?.manifestDeclared === false)
      };
    } catch (err) {
      const missingManifest = /Missing the following permissions in AndroidManifest\.xml/i.test(String(err?.message || err || ''));
      return {
        granted: false,
        native: true,
        hasNativeBridge: true,
        canAskAgain: !missingManifest,
        manifestMissing: missingManifest
      };
    }
  }

  async function offerOpenAppSettingsForMic() {
    const bgPlugin = window.Capacitor?.Plugins?.BackgroundNotifications || null;
    if (typeof bgPlugin?.openAppSettings === 'function' && typeof ipon().confirmAction === 'function') {
      const openSettings = await ipon().confirmAction({
        title: 'Microphone access needed',
        message: 'Allow Microphone permission in your phone settings to record and send voice messages.',
        confirmLabel: 'Open Settings',
        cancelLabel: 'Not now'
      });
      if (openSettings) await bgPlugin.openAppSettings().catch(() => { });
      return true;
    }
    return false;
  }

  async function showMicApkUpdateNotice() {
    if (typeof ipon().confirmAction === 'function') {
      const downloadNow = await ipon().confirmAction({
        title: 'App update needed for voice messages',
        message: 'This installed myIPON APK build does not include Android Microphone permission yet, which is why only Notifications appears in App Settings. Install the latest myIPON APK build to enable Microphone permission and voice messages.',
        confirmLabel: 'Download APK',
        cancelLabel: 'Close'
      });
      if (downloadNow) {
        if (typeof ipon().openLatestApkDownload === 'function') {
          ipon().openLatestApkDownload();
        } else if (typeof window !== 'undefined' && typeof window.open === 'function') {
          window.open('https://github.com/zediskaaa/Ipon-Tracking-System/releases/latest/download/myIPON.apk', '_blank', 'noopener');
        }
      }
      return true;
    }
    return false;
  }

  function syncVoiceRecordingUi(isRecording) {
    const active = Boolean(isRecording);
    const form = document.getElementById('msg-composer-form');
    const voiceBtn = document.getElementById('msg-voice-btn');
    const recBar = document.getElementById('msg-voice-recording');
    const input = document.getElementById('msg-composer-input');
    const sendBtn = document.getElementById('msg-send-btn');
    const timerEl = document.getElementById('msg-voice-timer');
    if (form?.classList) form.classList.toggle('is-recording', active);
    if (voiceBtn?.classList) voiceBtn.classList.toggle('is-recording', active);
    if (voiceBtn?.setAttribute) voiceBtn.setAttribute('aria-pressed', active ? 'true' : 'false');
    if (input) input.hidden = active;
    if (sendBtn) sendBtn.hidden = active;
    if (recBar) recBar.hidden = !active;
    if (timerEl) timerEl.textContent = '0:00';
  }

  async function startVoiceRecording() {
    if (state.voiceRecorder) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      return ipon().toast('Voice recording is not supported on this device or browser.', 'error');
    }
    const nativeMic = await ensureMicrophoneAccess();
    if (nativeMic.native && nativeMic.hasNativeBridge && !nativeMic.granted) {
      if (nativeMic.manifestMissing) {
        const shown = await showMicApkUpdateNotice();
        if (shown) return;
      }
      if (!nativeMic.canAskAgain) {
        const offered = await offerOpenAppSettingsForMic();
        if (offered) return;
      }
      return ipon().toast('Allow microphone access when prompted to record a voice message.', 'error');
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported('audio/webm')
        ? 'audio/webm'
        : (MediaRecorder.isTypeSupported('audio/ogg')
          ? 'audio/ogg'
          : (MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4' : ''));
      const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      state.voiceRecorder = rec;
      state.voiceChunks = [];
      state.voiceStartedAt = Date.now();
      rec.ondataavailable = (ev) => { if (ev.data?.size) state.voiceChunks.push(ev.data); };
      rec.start();

      syncVoiceRecordingUi(true);
      const timerEl = document.getElementById('msg-voice-timer');
      state.voiceTimer = setInterval(() => {
        const sec = Math.floor((Date.now() - state.voiceStartedAt) / 1000);
        if (timerEl) timerEl.textContent = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
      }, 350);
    } catch (err) {
      syncVoiceRecordingUi(false);
      if (err?.name === 'NotAllowedError') {
        if (nativeMic.native && !nativeMic.hasNativeBridge) {
          const shown = await showMicApkUpdateNotice();
          if (shown) return;
        }
        const offered = await offerOpenAppSettingsForMic();
        if (offered) return;
        return ipon().toast('Microphone access is blocked. Allow microphone permission in your browser or phone settings and try again.', 'error');
      }
      ipon().toast(ipon().friendlyError(err), 'error');
    }
  }

  function stopVoiceRecorderStream({ send = false } = {}) {
    if (state.voiceTimer) { clearInterval(state.voiceTimer); state.voiceTimer = null; }
    syncVoiceRecordingUi(false);
    const rec = state.voiceRecorder;
    if (!rec) return;
    state.voiceRecorder = null;

    rec.onstop = () => {
      rec.stream?.getTracks?.().forEach((t) => t.stop());
      if (!send || !state.voiceChunks.length || !state.activeConvId) return;
      const durationSeconds = Math.max(1, Math.round((Date.now() - state.voiceStartedAt) / 1000));
      const blob = new Blob(state.voiceChunks, { type: rec.mimeType || 'audio/webm' });
      const ext = (rec.mimeType || '').includes('ogg') ? 'ogg' : 'webm';
      const fileName = `voice-note-${Date.now()}.${ext}`;
      const file = new File([blob], fileName, { type: blob.type });
      const replyTarget = state.replyToMsg;
      const convId = state.activeConvId;
      state.replyToMsg = null;
      renderContextBar();
      const previewUrl = typeof URL?.createObjectURL === 'function' ? URL.createObjectURL(file || blob) : '';
      enqueuePendingMessage({
        conversationId: convId,
        body: '',
        messageType: 'VOICE',
        replyToMsg: replyTarget,
        files: [{ file, name: fileName, type: blob.type, size: blob.size, kind: 'audio', previewUrl, duration_seconds: durationSeconds }]
      });
    };
    try { rec.stop(); } catch { rec.stream?.getTracks?.().forEach((t) => t.stop()); }
  }

  // Forward, Delete, Privacy & Settings Modals
  async function openForwardDialog(messageObj) {
    const dialog = document.getElementById('msg-forward-dialog');
    const body = document.getElementById('msg-forward-body');
    if (!dialog || !body) return;
    const candidates = new Map();
    state.conversations.filter((c) => c.status === 'ACCEPTED' && !c.peer?.is_blocked).forEach((c) => {
      if (c.peer?.id) candidates.set(c.peer.id, { userId: c.peer.id, name: c.peer.full_name, avatar_url: c.peer.avatar_url, convId: c.id });
    });
    (state.overview?.friends || []).forEach((f) => {
      if (!candidates.has(f.id)) candidates.set(f.id, { userId: f.id, name: f.full_name, avatar_url: f.avatar_url, convId: null });
    });

    const items = [...candidates.values()];
    body.innerHTML = items.length
      ? `<p class="msg-forward-quote">"${escapeHtml(String(messageObj.body || 'Attachment').slice(0, 140))}"</p>
         <div class="msg-forward-list">${items.map((item) => `
           <button type="button" class="msg-forward-row" data-fwd-user="${escAttr(item.userId)}" data-fwd-conv="${escAttr(item.convId || '')}">
             ${userAvatarHtml({ id: item.userId, full_name: item.name, avatar_url: item.avatar_url, allow_online_status: false }, 'avatar-sm', { clickable: false, showPresence: false })}
             <strong>${escapeHtml(item.name)}</strong>
             <span class="button button-secondary button-sm">Send</span>
           </button>`).join('')}</div>`
      : '<p class="empty-state">Add friends or open conversations first to forward messages.</p>';
    body.dataset.fwdMsgId = messageObj.id;
    body.dataset.fwdBody = messageObj.body || '';
    if (!dialog.open) dialog.showModal();
  }

  async function openPrivacySettingsModal() {
    const dialog = document.getElementById('msg-settings-dialog');
    const body = document.getElementById('msg-settings-body');
    if (!dialog || !body) return;
    await refreshOverview({ render: false });
    const me = state.overview?.me || initializedProfile || {};
    const priv = me.chat_privacy || {};
    const blocked = state.overview?.blocked_users || [];

    const shieldSvg = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>';

    body.innerHTML = `
      <form id="msg-privacy-form" class="form-grid msg-privacy-form" novalidate>
        <div class="field">
          <label for="msg-set-username">Username handle (optional)</label>
          <input id="msg-set-username" name="username" type="text" maxlength="24" value="${escAttr(me.username || '')}" placeholder="e.g. juan_delacruz" autocomplete="off">
          <small class="field-help msg-field-help" id="msg-set-username-help">3–24 lowercase letters, numbers, or underscores.</small>
          <small class="field-error msg-field-help" id="msg-set-username-error" role="alert" hidden></small>
        </div>
        <div class="field">
          <label for="msg-set-friend-req">Who can send friend requests</label>
          <select id="msg-set-friend-req" name="allow_friend_requests">
            <option value="EVERYONE"${(priv.allow_friend_requests || 'EVERYONE') === 'EVERYONE' ? ' selected' : ''}>Everyone</option>
            <option value="MUTUAL_GROUPS"${priv.allow_friend_requests === 'MUTUAL_GROUPS' ? ' selected' : ''}>Shared group connections only</option>
            <option value="NOBODY"${priv.allow_friend_requests === 'NOBODY' ? ' selected' : ''}>No one</option>
          </select>
        </div>
        <div class="field field-wide">
          <label for="msg-set-bio">Short bio (optional)</label>
          <textarea id="msg-set-bio" name="bio" rows="3" maxlength="240" placeholder="Share a short intro visible when people view your profile…">${escapeHtml(me.bio || '')}</textarea>
          <small class="field-help msg-bio-counter" id="msg-set-bio-count">${(me.bio || '').length} / 240 characters</small>
        </div>
        <div class="field field-wide">
          <label for="msg-set-msg-req">Who can message you (non-friends)</label>
          <select id="msg-set-msg-req" name="allow_message_requests">
            <option value="EVERYONE"${(priv.allow_message_requests || 'EVERYONE') === 'EVERYONE' ? ' selected' : ''}>Deliver to Message Requests (recommended)</option>
            <option value="FRIENDS_ONLY"${priv.allow_message_requests === 'FRIENDS_ONLY' ? ' selected' : ''}>Friends only (reject non-friend messages)</option>
          </select>
        </div>
        <label class="msg-switch-row toggle-switch-row field-wide"><span><strong>Show active status</strong><small>Let connections see when you are online</small></span><input type="checkbox" class="toggle-switch-input" name="show_online"${priv.show_online !== false ? ' checked' : ''}></label>
        <label class="msg-switch-row toggle-switch-row field-wide"><span><strong>Show last seen timestamp</strong><small>Share when you were last active (requires active status enabled)</small></span><input type="checkbox" class="toggle-switch-input" name="show_last_seen"${priv.show_last_seen !== false ? ' checked' : ''}></label>
        <label class="msg-switch-row toggle-switch-row field-wide"><span><strong>Send &amp; receive read receipts</strong><small>Turning this off hides Seen indicators on accepted conversations</small></span><input type="checkbox" class="toggle-switch-input" name="read_receipts"${priv.read_receipts !== false ? ' checked' : ''}></label>
        <p class="mfa-message field-wide" id="msg-settings-error" role="alert" hidden></p>
        <div class="form-actions field-wide">
          <button type="submit" class="button button-primary msg-settings-save-btn" id="msg-settings-save">Save messaging settings</button>
        </div>
      </form>
      <section class="msg-blocked-section">
        <h4><span>Blocked accounts</span><span class="msg-blocked-count">${blocked.length}</span></h4>
        ${blocked.length ? `<div class="msg-blocked-list">${blocked.map((b) => `
          <div class="msg-blocked-row">
            <span><strong>${escapeHtml(b.full_name)}</strong>${b.username ? ` <small>@${escapeHtml(b.username)}</small>` : ''}</span>
            <button type="button" class="button button-secondary button-sm" data-unblock-user="${escapeHtml(b.id)}">Unblock</button>
          </div>`).join('')}</div>` : `<p class="msg-blocked-empty">${shieldSvg}<span>You have not blocked anyone.</span></p>`}
      </section>`;

    const form = document.getElementById('msg-privacy-form');
    const unameInput = document.getElementById('msg-set-username');
    const unameHelp = document.getElementById('msg-set-username-help');
    const bioInput = document.getElementById('msg-set-bio');
    const bioCounter = document.getElementById('msg-set-bio-count');

    const validateUsernameLive = () => {
      if (!unameInput) return true;
      const val = unameInput.value.trim().toLowerCase();
      unameInput.value = val;
      const ok = !val || /^[a-z0-9_]{3,24}$/.test(val);
      if (unameHelp) unameHelp.hidden = !ok;
      ipon().setFieldError(unameInput, ok ? '' : 'Use 3–24 lowercase letters, numbers, or underscores.');
      return ok;
    };
    unameInput?.addEventListener('input', validateUsernameLive);
    unameInput?.addEventListener('blur', validateUsernameLive);
    bioInput?.addEventListener('input', () => {
      if (bioCounter) bioCounter.textContent = `${bioInput.value.length} / 240 characters`;
    });

    form.onsubmit = async (ev) => {
      ev.preventDefault();
      if (!validateUsernameLive()) return;
      const saveBtn = document.getElementById('msg-settings-save');
      const errEl = document.getElementById('msg-settings-error');
      errEl.hidden = true;
      const fd = new FormData(form);
      const nextPrivacy = {
        show_online: Boolean(form.elements.show_online.checked),
        show_last_seen: Boolean(form.elements.show_last_seen.checked),
        read_receipts: Boolean(form.elements.read_receipts.checked),
        allow_friend_requests: String(fd.get('allow_friend_requests') || 'EVERYONE'),
        allow_message_requests: String(fd.get('allow_message_requests') || 'EVERYONE')
      };
      ipon().setBusy(saveBtn, true, 'Saving…');
      try {
        const res = await ipon().rpc('update_social_profile_and_privacy', {
          p_username: String(fd.get('username') || ''),
          p_bio: String(fd.get('bio') || ''),
          p_chat_privacy: nextPrivacy
        });
        ipon().updateLocalProfile?.({ username: res.username, bio: res.bio, chat_privacy: res.chat_privacy });
        ipon().setOnlineVisibility?.(nextPrivacy.show_online);
        ipon().toast('Messaging settings saved.');
        await refreshOverview();
        dialog.close();
      } catch (err) {
        errEl.textContent = ipon().friendlyError(err);
        errEl.hidden = false;
      } finally {
        ipon().setBusy(saveBtn, false);
      }
    };

    if (!dialog.open) dialog.showModal();
  }

  // UI View Switcher & Event Delegation
  function syncTabUi() {
    document.querySelectorAll('[data-msg-tab]').forEach((btn) => {
      const act = btn.dataset.msgTab === state.tab;
      btn.classList.toggle('is-active', act);
      btn.setAttribute('aria-selected', act ? 'true' : 'false');
    });
    document.getElementById('msg-alerts-btn')?.classList.toggle('is-active', state.tab === 'notifications');
    const showChats = state.tab === 'chats' || state.tab === 'requests';
    const chatsView = document.getElementById('msg-view-chats');
    const friendsView = document.getElementById('msg-view-friends');
    const alertsView = document.getElementById('msg-view-alerts');
    if (chatsView) chatsView.hidden = !showChats;
    if (friendsView) friendsView.hidden = state.tab !== 'friends';
    if (alertsView) alertsView.hidden = state.tab !== 'notifications';
  }

  function activateSidebarSearch(focusInput = true) {
    state.tab = 'chats';
    state.searchActive = true;
    state.mobileShowThread = false;
    syncTabUi();
    syncMobilePaneState();
    renderConversationList();
    if (focusInput) {
      const inp = document.getElementById('msg-list-search');
      if (inp) {
        inp.focus();
        inp.select?.();
      }
    }
    runGlobalDiscovery(state.chatListQuery).catch(() => { });
  }

  function clearSidebarSearch() {
    clearTimeout(searchDebounce);
    searchDebounce = null;
    state.discoverySeq += 1;
    state.searchActive = false;
    state.chatListQuery = '';
    state.discoverQuery = '';
    state.searchLoading = false;
    state.discoverUsers = [];
    state.discoverMessages = [];
    const inp = document.getElementById('msg-list-search');
    if (inp) inp.value = '';
    renderConversationList();
  }

  function clearActiveThreadSelection() {
    disconnectTypingChannel();
    state.activeConvId = null;
    state.activeThread = null;
    state.replyToMsg = null;
    state.editingMsg = null;
    state.showThreadSearch = false;
    state.threadSearchQuery = '';
    state.threadSearchMatches = [];
    const searchBar = document.getElementById('msg-thread-search-bar');
    if (searchBar) searchBar.hidden = true;
    state.showThreadInfo = false;
    state.threadInfoView = 'root';
    renderThreadInfoDrawer();
    applyThreadTheme('paper');
    const activePane = document.getElementById('msg-thread-active');
    const emptyPane = document.getElementById('msg-thread-empty');
    if (activePane) activePane.hidden = true;
    if (emptyPane) emptyPane.hidden = false;
  }

  function switchTab(nextTab) {
    closeFloatingMenus();
    closeProfilePopover();
    if (nextTab === 'discover') {
      activateSidebarSearch(true);
      return;
    }
    state.tab = nextTab;
    if (nextTab === 'chats' || nextTab === 'requests') {
      state.mobileShowThread = false;
      syncMobilePaneState();
      const activeConv = state.activeThread?.conversation;
      const isReq = Boolean(activeConv?.is_incoming_request);
      if (state.activeConvId && activeConv && ((nextTab === 'requests' && !isReq) || (nextTab === 'chats' && isReq))) {
        clearActiveThreadSelection();
      }
    }
    syncTabUi();

    if (nextTab === 'chats' || nextTab === 'requests') {
      renderConversationList();
    } else if (nextTab === 'friends') {
      refreshOverview().catch(() => { });
      renderFriendsView();
    } else if (nextTab === 'notifications') {
      refreshSocialNotifications().catch(() => { });
      renderAlertsView();
    }
  }

  function syncMobilePaneState() {
    const view = document.getElementById('msg-view-chats');
    if (view) view.classList.toggle('is-mobile-thread', state.mobileShowThread);
  }

  async function runThreadSearch() {
    if (!state.activeConvId) return;
    const q = state.threadSearchQuery.trim();
    const sender = state.threadSearchSenderId || null;
    if (!q && !sender) {
      state.threadSearchMatches = [];
      state.threadSearchCursor = 0;
      document.getElementById('msg-thread-search-count').textContent = '';
      renderMessagesList();
      return;
    }
    try {
      const hits = await ipon().rpc('search_conversation_messages', {
        p_conversation_id: state.activeConvId,
        p_query: q,
        p_sender_id: sender,
        p_limit: 50
      });
      state.threadSearchMatches = (hits || []).map((h) => h.message_id);
      state.threadSearchCursor = 0;
      await focusThreadSearchMatch();
    } catch { }
  }

  async function focusThreadSearchMatch() {
    const countEl = document.getElementById('msg-thread-search-count');
    if (!state.threadSearchMatches.length) {
      if (countEl) countEl.textContent = '0 matches';
      renderMessagesList();
      return;
    }
    const targetId = state.threadSearchMatches[state.threadSearchCursor];
    if (countEl) countEl.textContent = `${state.threadSearchCursor + 1} of ${state.threadSearchMatches.length}`;
    if (!(state.activeThread?.messages || []).some((m) => m.id === targetId)) {
      await openConversation(state.activeConvId, { aroundMessageId: targetId, markRead: false });
    } else {
      renderMessagesList();
      jumpToMessageElement(targetId);
    }
  }

  async function handleSocialAction(action, targetId, extra = {}) {
    if (!targetId) return;
    closeProfilePopover();
    try {
      if (action === 'add_friend') {
        const res = await ipon().rpc('send_friend_request', { p_target_id: targetId });
        ipon().toast(res?.auto_accepted ? 'Friend request accepted!' : 'Friend request sent.');
        await refreshOverview();
        if (state.searchActive || state.chatListQuery.trim()) await runGlobalDiscovery(state.chatListQuery);
      } else if (action === 'remove_friend') {
        const ok = await ipon().confirmAction({ title: 'Remove friend?', message: 'They will no longer appear in your Friends list.', confirmText: 'Remove' });
        if (!ok) return;
        await ipon().rpc('remove_friend', { p_friend_id: targetId });
        ipon().toast('Friend removed.');
        await refreshOverview();
      } else if (action === 'block') {
        const ok = await ipon().confirmAction({ title: 'Block this user?', message: 'They will no longer be able to message or find you.', confirmText: 'Block user', danger: true });
        if (!ok) return;
        await ipon().rpc('block_social_user', { p_target_id: targetId });
        ipon().toast('User blocked.');
        await Promise.all([refreshOverview(), refreshConversations()]);
        if (state.activeConvId) await openConversation(state.activeConvId, { markRead: false, silent: true });
      } else if (action === 'unblock') {
        await ipon().rpc('unblock_social_user', { p_target_id: targetId });
        ipon().toast('User unblocked.');
        await Promise.all([refreshOverview(), refreshConversations()]);
        if (document.getElementById('msg-settings-dialog')?.open) await openPrivacySettingsModal();
        if (state.activeConvId) await openConversation(state.activeConvId, { markRead: false, silent: true });
      } else if (action === 'message') {
        if (openingChatTargetId === targetId) return;
        openingChatTargetId = targetId;
        try {
          const previewPeer = findKnownPeer(null, targetId);
          const conv = await ipon().rpc('start_or_open_direct_chat', { p_target_id: targetId });
          clearSidebarSearch();
          await refreshConversations();
          switchTab(conv.status === 'PENDING_REQUEST' && conv.initiator_id !== initializedProfile?.id ? 'requests' : 'chats');
          await openConversation(conv.id, { previewPeer });
        } finally {
          if (openingChatTargetId === targetId) openingChatTargetId = null;
        }
      }
      void extra;
    } catch (err) {
      ipon().toast(ipon().friendlyError(err), 'error');
    }
  }

  function closeFloatingMenus(opts) {
    const immediate = Boolean(opts && opts.immediate === true);
    document.querySelectorAll('#msg-messages-list .msg-row.is-menu-target').forEach((row) => row.classList.remove('is-menu-target'));
    activeVideoMenuPlayer = null;
    activeFloatingMenuAnchor = null;
    document.querySelectorAll('.msg-floating-menu').forEach((node) => {
      if (immediate) {
        if (node._closeTimer) {
          clearTimeout(node._closeTimer);
          node._closeTimer = null;
        }
        node.remove?.();
        return;
      }
      if (node.classList?.contains?.('is-leaving')) return;
      node.classList?.remove?.('is-visible');
      node.classList?.add?.('is-leaving');
      node.setAttribute?.('aria-hidden', 'true');
      node._closeTimer = setTimeout(() => {
        node._closeTimer = null;
        node.remove?.();
      }, MENU_EXIT_MS);
    });
  }

  function placeFloatingMenu(menu, anchorEl, { preferAbove = true, estWidth = 250, estHeight = 52, align = 'center' } = {}) {
    const rect = anchorEl?.getBoundingClientRect?.() || { left: 16, right: 200, top: 80, bottom: 120, width: 184 };
    const vw = window.innerWidth || 390;
    const vh = window.innerHeight || 844;
    const w = Math.min(vw - 24, menu.offsetWidth || estWidth);
    const h = Math.min(vh - 24, menu.offsetHeight || estHeight);
    let left = rect.left;
    if (align === 'center') left = rect.left + ((rect.width || 0) / 2) - (w / 2);
    else if (align === 'end') left = rect.right - w;
    left = Math.max(12, Math.min(vw - w - 12, left));
    const gap = 8;
    let placedAbove = Boolean(preferAbove);
    let top = preferAbove ? (rect.top - h - gap) : (rect.bottom + gap);
    if (preferAbove && top < 12) {
      top = rect.bottom + gap;
      placedAbove = false;
    } else if (!preferAbove && top + h > vh - 12) {
      top = rect.top - h - gap;
      placedAbove = true;
    }
    top = Math.max(12, Math.min(vh - h - 12, top));
    menu.style.left = `${Math.round(left)}px`;
    menu.style.top = `${Math.round(top)}px`;
    if (menu.dataset) menu.dataset.placed = placedAbove ? 'above' : 'below';
    menu.style.transformOrigin = placedAbove ? 'center bottom' : 'center top';
  }

  function revealFloatingMenu(menu) {
    if (!menu) return;
    const show = () => {
      if (menu.isConnected === false || menu.classList?.contains?.('is-leaving')) return;
      menu.classList?.add?.('is-visible');
    };
    if (typeof window.requestAnimationFrame === 'function') {
      window.getComputedStyle?.(menu)?.opacity;
      window.requestAnimationFrame(show);
    } else {
      show();
    }
  }

  function showReactionFloatingMenu(msgId, anchorEl, { toggle = true } = {}) {
    const existing = Array.from(document.querySelectorAll('.msg-floating-menu.msg-react-menu') || [])
      .find((node) => !node.classList?.contains?.('is-leaving'));
    if (existing && existing.getAttribute?.('data-react-menu-for') === String(msgId)) {
      if (toggle) closeFloatingMenus();
      return;
    }
    closeFloatingMenus({ immediate: true });
    const msg = (state.activeThread?.messages || []).find((m) => m.id === msgId);
    if (!msg || msg.deleted_for_everyone_at) return;
    const myReactions = new Set(
      (msg.reactions || [])
        .filter((r) => r.user_id === initializedProfile?.id)
        .map((r) => r.emoji)
    );
    const quickSet = new Set(QUICK_REACTIONS);
    const extraEmojis = EMOJI_PALETTE.filter((e) => !quickSet.has(e));
    const rowEl = anchorEl?.closest?.('.msg-row');
    const bubbleAnchor = rowEl?.querySelector('.msg-bubble') || anchorEl;
    if (rowEl) rowEl.classList.add('is-menu-target');
    activeFloatingMenuAnchor = anchorEl || bubbleAnchor;

    const renderEmojiButtons = (emojis) => emojis.map((e) => {
      const selected = myReactions.has(e);
      return `<button type="button" class="msg-react-btn${selected ? ' is-selected' : ''}" data-react-msg="${escAttr(msgId)}" data-react-emoji="${escAttr(e)}" aria-pressed="${selected}" title="React with ${escAttr(e)}">${e}</button>`;
    }).join('');

    const menu = document.createElement('div');
    menu.className = 'msg-floating-menu msg-react-menu';
    menu.setAttribute('data-react-menu-for', String(msgId));
    menu.setAttribute('role', 'toolbar');
    menu.setAttribute('aria-label', 'Message reactions');
    menu.innerHTML = `
      <div class="msg-react-strip">
        ${renderEmojiButtons(QUICK_REACTIONS)}
        <button type="button" class="msg-react-more-btn" data-react-expand aria-expanded="false" aria-label="More reactions" title="More reactions">${MSG_PLUS_SVG}</button>
      </div>
      <div class="msg-react-palette" hidden>
        ${renderEmojiButtons(extraEmojis)}
      </div>`;
    document.getElementById('msg-workspace-dialog')?.appendChild(menu);
    placeFloatingMenu(menu, anchorEl, {
      preferAbove: true,
      estWidth: 276,
      estHeight: 48,
      align: 'center'
    });
    revealFloatingMenu(menu);
  }

  function startReplyToMessage(msgObj) {
    if (!msgObj) return;
    closeFloatingMenus();
    state.editingMsg = null;
    state.replyToMsg = msgObj;
    renderContextBar();
    document.getElementById('msg-composer-input')?.focus();
  }

  function showMessageContextMenu(msgId, anchorBtn) {
    closeFloatingMenus({ immediate: true });
    const msg = (state.activeThread?.messages || []).find((m) => m.id === msgId);
    if (!msg) return;
    const rowEl = anchorBtn?.closest?.('.msg-row');
    if (rowEl) rowEl.classList.add('is-menu-target');
    const mine = msg.sender_id === initializedProfile?.id;
    const atts = !msg.deleted_for_everyone_at ? (msg.attachments || []).filter((a) => a?.path) : [];
    const menu = document.createElement('div');
    menu.className = 'msg-floating-menu msg-ctx-menu';
    menu.innerHTML = `
      <button type="button" data-ctx-do="reply" data-msg-id="${escAttr(msgId)}">Reply</button>
      ${atts.length ? `<button type="button" data-ctx-do="download" data-msg-id="${escAttr(msgId)}">${atts.length > 1 ? `Download all (${atts.length})` : 'Download'}</button>` : ''}
      ${msg.body ? `<button type="button" data-ctx-do="copy" data-msg-id="${escAttr(msgId)}">Copy text</button>` : ''}
      <button type="button" data-ctx-do="forward" data-msg-id="${escAttr(msgId)}">Forward</button>
      ${state.activeThread?.conversation?.status === 'ACCEPTED' ? `<button type="button" data-ctx-do="pin" data-msg-id="${escAttr(msgId)}">${msg.pinned_at ? 'Unpin' : 'Pin message'}</button>` : ''}
      ${mine ? `<button type="button" data-ctx-do="edit" data-msg-id="${escAttr(msgId)}">Edit message</button>` : ''}
      <button type="button" data-ctx-do="del_me" data-msg-id="${escAttr(msgId)}">Delete for me</button>
      ${mine ? `<button type="button" class="is-danger" data-ctx-do="del_all" data-msg-id="${escAttr(msgId)}">Unsend for everyone</button>` : ''}`;
    document.getElementById('msg-workspace-dialog')?.appendChild(menu);
    placeFloatingMenu(menu, anchorBtn, { preferAbove: false, estWidth: 184, estHeight: 236, align: 'end' });
    revealFloatingMenu(menu);
  }

  function showConvContextMenu(convId, anchorBtn) {
    closeFloatingMenus({ immediate: true });
    const conv = state.conversations.find((c) => c.id === convId);
    if (!conv) return;
    const menu = document.createElement('div');
    menu.className = 'msg-floating-menu msg-ctx-menu';
    menu.innerHTML = `
      <button type="button" data-row-conv-act="${conv.is_pinned ? 'unpin' : 'pin'}" data-conv-id="${escAttr(convId)}">${conv.is_pinned ? 'Unpin chat' : 'Pin chat'}</button>
      <button type="button" data-row-conv-act="${conv.is_muted ? 'unmute' : 'mute'}" data-conv-id="${escAttr(convId)}">${conv.is_muted ? 'Unmute notifications' : 'Mute notifications'}</button>
      <button type="button" data-row-conv-act="${conv.is_archived ? 'unarchive' : 'archive'}" data-conv-id="${escAttr(convId)}">${conv.is_archived ? 'Move to Inbox' : 'Archive chat'}</button>
      <button type="button" data-row-conv-act="${conv.unread_count > 0 || conv.marked_unread ? 'mark_read' : 'mark_unread'}" data-conv-id="${escAttr(convId)}">${conv.unread_count > 0 || conv.marked_unread ? 'Mark as read' : 'Mark as unread'}</button>
      <button type="button" class="is-danger" data-row-conv-act="delete_for_me" data-conv-id="${escAttr(convId)}">Delete conversation</button>`;
    document.getElementById('msg-workspace-dialog')?.appendChild(menu);
    placeFloatingMenu(menu, anchorBtn, { preferAbove: false, estWidth: 196, estHeight: 190, align: 'end' });
    revealFloatingMenu(menu);
  }

  function bindEvents() {
    if (document.documentElement.dataset.msgEventsBound) return;
    document.documentElement.dataset.msgEventsBound = '1';

    document.addEventListener('click', async (ev) => {
      const openBtn = ev.target.closest?.('[data-messages-open]');
      if (openBtn) {
        if (!isEligible()) return;
        await openWorkspace();
        return;
      }

      if (suppressBubbleClickId && ev.target.closest?.(`[data-msg-id="${CSS.escape(suppressBubbleClickId)}"]`)) {
        suppressBubbleClickId = null;
        return;
      }
      suppressBubbleClickId = null;

      // Close floating contextual menus on outside click
      if (!ev.target.closest('.msg-floating-menu') && !ev.target.closest('[data-msg-act]') && !ev.target.closest('[data-conv-menu-toggle]') && !ev.target.closest('[data-vact="menu"]')) {
        closeFloatingMenus();
      }
      if (state.showPinnedList && !ev.target.closest?.('#msg-pinned-banner')) {
        state.showPinnedList = false;
        renderPinnedBanner();
      }
      const pop = document.getElementById('msg-profile-popover');
      if (pop && !pop.hidden && !(pop.contains?.(ev.target) || ev.target.closest?.('#msg-profile-popover')) && !ev.target.closest('[data-social-user-dp]')) {
        closeProfilePopover();
      }

      if (ev.target.closest?.('[data-pinned-toggle]')) {
        ev.stopPropagation();
        state.showPinnedList = !state.showPinnedList;
        renderPinnedBanner();
        return;
      }

      const dpBtn = ev.target.closest?.('[data-social-user-dp]');
      if (dpBtn) {
        ev.stopPropagation();
        await openProfilePopover(dpBtn.dataset.socialUserDp, dpBtn);
        return;
      }

      if (ev.target.closest?.('#msg-pop-close')) { closeProfilePopover(); return; }
      const groupsToggle = ev.target.closest?.('[data-pop-groups-toggle]');
      if (groupsToggle) {
        ev.stopPropagation();
        const card = groupsToggle.closest('[data-pop-groups-card]');
        const list = card?.querySelector('.msg-pop-groups-list');
        if (card && list) {
          const open = list.hidden;
          list.hidden = !open;
          card.classList.toggle('is-open', open);
          groupsToggle.setAttribute?.('aria-expanded', String(open));
          if (pop && !pop.hidden && activePopoverAnchor) {
            positionPopoverNearAnchor(pop, activePopoverAnchor);
          }
        }
        return;
      }
      if (ev.target.closest?.('#msg-workspace-close')) { document.getElementById('msg-workspace-dialog')?.close(); return; }
      if (ev.target.closest?.('[data-msg-settings-close]')) { document.getElementById('msg-settings-dialog')?.close(); return; }
      if (ev.target.closest?.('[data-msg-forward-close]')) { document.getElementById('msg-forward-dialog')?.close(); return; }
      if (ev.target.closest?.('#msg-privacy-btn')) { await openPrivacySettingsModal(); return; }
      if (ev.target.closest?.('#msg-alerts-btn')) { switchTab('notifications'); return; }
      if (ev.target.closest?.('#msg-empty-find-btn') || ev.target.closest?.('[data-goto-discover]')) { activateSidebarSearch(true); return; }
      if (ev.target.closest?.('#msg-new-chat-btn')) {
        if (state.searchActive || state.chatListQuery.trim()) clearSidebarSearch();
        else activateSidebarSearch(true);
        return;
      }
      if (ev.target.closest?.('#msg-list-search-clear')) {
        if (state.searchActive) {
          clearTimeout(searchDebounce);
          state.chatListQuery = '';
          const inp = document.getElementById('msg-list-search');
          if (inp) { inp.value = ''; inp.focus(); }
          renderConversationList();
          runGlobalDiscovery('').catch(() => { });
        } else {
          clearSidebarSearch();
          document.getElementById('msg-list-search')?.focus();
        }
        return;
      }
      if (ev.target.closest?.('#msg-search-empty-clear')) {
        clearSidebarSearch();
        document.getElementById('msg-list-search')?.focus();
        return;
      }
      if (ev.target.closest?.('#msg-friend-filter-clear')) {
        const finp = document.getElementById('msg-friend-filter');
        if (finp) {
          finp.value = '';
          finp.dispatchEvent(new Event('input', { bubbles: true }));
          finp.focus();
        }
        return;
      }
      if (ev.target.closest?.('#msg-back-to-list')) { closeFloatingMenus(); state.mobileShowThread = false; syncMobilePaneState(); return; }
      if (ev.target.closest?.('#msg-retry-thread-btn') && state.activeConvId) { await openConversation(state.activeConvId); return; }

      const tabBtn = ev.target.closest?.('[data-msg-tab]');
      if (tabBtn) { switchTab(tabBtn.dataset.msgTab); return; }

      const filterBtn = ev.target.closest?.('[data-msg-filter]');
      if (filterBtn) { state.chatFilter = filterBtn.dataset.msgFilter; renderConversationList(); return; }

      const subBtn = ev.target.closest?.('[data-friends-sub]');
      if (subBtn) { state.friendsSubTab = ['all', 'incoming', 'sent'].includes(subBtn.dataset.friendsSub) ? subBtn.dataset.friendsSub : 'all'; renderFriendsView(); return; }

      const openConvBtn = ev.target.closest?.('[data-open-conv]');
      const openConvFallback = (!openConvBtn && !ev.target.closest?.('[data-social-user-dp], [data-conv-menu-toggle]'))
        ? ev.target.closest?.('[data-conv-row]')
        : null;
      const convIdToOpen = openConvBtn?.dataset?.openConv || openConvFallback?.dataset?.convRow;
      if (convIdToOpen) { await openConversation(convIdToOpen); return; }

      const convMoreBtn = ev.target.closest?.('[data-conv-menu-toggle]');
      if (convMoreBtn) { ev.stopPropagation(); showConvContextMenu(convMoreBtn.dataset.convMenuToggle, convMoreBtn); return; }

      const rowConvAct = ev.target.closest?.('[data-row-conv-act]');
      if (rowConvAct) {
        closeFloatingMenus();
        const act = rowConvAct.dataset.rowConvAct;
        const cId = rowConvAct.dataset.convId;
        if (act === 'delete_for_me') {
          const ok = await ipon().confirmAction({ title: 'Delete conversation from your inbox?', message: 'This removes the chat history for you only.', confirmText: 'Delete' });
          if (!ok) return;
        }
        try {
          await ipon().rpc('update_conversation_member_state', { p_conversation_id: cId, p_action: act });
          if (act === 'delete_for_me' && state.activeConvId === cId) {
            clearActiveThreadSelection();
          }
          await refreshConversations();
        } catch (err) { ipon().toast(ipon().friendlyError(err), 'error'); }
        return;
      }

      const convActBtn = ev.target.closest?.('[data-conv-act]');
      if (convActBtn && state.activeConvId) {
        const act = convActBtn.dataset.convAct;
        if (act === 'delete_for_me') {
          const ok = await ipon().confirmAction({ title: 'Delete conversation for you?', message: 'Messages will be cleared from your own inbox view.', confirmText: 'Delete' });
          if (!ok) return;
        }
        try {
          await ipon().rpc('update_conversation_member_state', { p_conversation_id: state.activeConvId, p_action: act });
          if (act === 'delete_for_me') {
            clearActiveThreadSelection();
          } else {
            await openConversation(state.activeConvId, { markRead: false, silent: true });
          }
          await refreshConversations();
        } catch (err) { ipon().toast(ipon().friendlyError(err), 'error'); }
        return;
      }

      const themeBtn = ev.target.closest?.('[data-conv-theme]');
      if (themeBtn && state.activeConvId) {
        const nextTheme = themeBtn.dataset.convTheme || 'paper';
        const conv = state.activeThread?.conversation;
        const prevTheme = conv?.chat_theme || 'paper';
        if (conv) conv.chat_theme = nextTheme;
        applyThreadTheme(nextTheme);
        if (state.showThreadInfo) renderThreadInfoDrawer();
        try {
          await ipon().rpc('update_conversation_member_state', { p_conversation_id: state.activeConvId, p_action: 'theme', p_theme: nextTheme });
          await openConversation(state.activeConvId, { markRead: false, silent: true });
        } catch (err) {
          if (conv) conv.chat_theme = prevTheme;
          applyThreadTheme(prevTheme);
          if (state.showThreadInfo) renderThreadInfoDrawer();
          ipon().toast(ipon().friendlyError(err), 'error');
        }
        return;
      }

      if (ev.target.closest?.('#msg-thread-search-toggle')) {
        state.showThreadSearch = !state.showThreadSearch;
        const bar = document.getElementById('msg-thread-search-bar');
        if (bar) bar.hidden = !state.showThreadSearch;
        if (state.showThreadSearch) document.getElementById('msg-thread-search-input')?.focus();
        else { state.threadSearchQuery = ''; state.threadSearchMatches = []; renderMessagesList(); }
        return;
      }
      if (ev.target.closest?.('#msg-thread-search-close')) {
        state.showThreadSearch = false;
        state.threadSearchQuery = '';
        state.threadSearchMatches = [];
        document.getElementById('msg-thread-search-bar').hidden = true;
        renderMessagesList();
        return;
      }
      if (ev.target.closest?.('#msg-search-prev') && state.threadSearchMatches.length) {
        state.threadSearchCursor = (state.threadSearchCursor - 1 + state.threadSearchMatches.length) % state.threadSearchMatches.length;
        await focusThreadSearchMatch();
        return;
      }
      if (ev.target.closest?.('#msg-search-next') && state.threadSearchMatches.length) {
        state.threadSearchCursor = (state.threadSearchCursor + 1) % state.threadSearchMatches.length;
        await focusThreadSearchMatch();
        return;
      }

      const drawerViewBtn = ev.target.closest?.('[data-drawer-view]');
      if (drawerViewBtn) {
        const nextView = drawerViewBtn.dataset.drawerView;
        state.threadInfoView = (nextView === 'media' || nextView === 'files') ? nextView : 'root';
        renderThreadInfoDrawer();
        const bodyEl = document.getElementById('msg-thread-drawer')?.querySelector?.('.msg-drawer-body');
        if (bodyEl) bodyEl.scrollTop = 0;
        return;
      }

      if (ev.target.closest?.('#msg-thread-info-toggle') || ev.target.closest?.('#msg-drawer-close')) {
        state.showThreadInfo = !state.showThreadInfo;
        state.threadInfoView = 'root';
        renderThreadInfoDrawer();
        return;
      }

      if (ev.target.closest?.('#msg-load-older-btn') && state.activeThread?.messages?.length) {
        const oldest = state.activeThread.messages[0].created_at;
        const wrap = document.getElementById('msg-scroll-wrap');
        const prevHeight = wrap ? wrap.scrollHeight : 0;
        const convLoadingId = state.activeConvId;
        try {
          const older = await ipon().rpc('get_conversation_messages', { p_conversation_id: convLoadingId, p_before: oldest, p_limit: 50 });
          if (state.activeConvId !== convLoadingId) return;
          const attPaths = [];
          (older?.messages || []).forEach((m) => (m.attachments || []).forEach((a) => { if (a?.path) attPaths.push(a.path); }));
          await ensureSignedViewUrls(convLoadingId, attPaths);
          if (state.activeConvId !== convLoadingId) return;
          state.activeThread.messages = [...(older.messages || []), ...(state.activeThread.messages || [])];
          state.activeThread.has_older = older.has_older;
          state.lastThreadFingerprint = computeThreadFingerprint(state.activeThread);
          renderActiveThread({ scrollToBottom: false });
          if (wrap) requestAnimationFrame(() => { wrap.scrollTop = Math.max(0, wrap.scrollHeight - prevHeight); });
        } catch (err) { ipon().toast(ipon().friendlyError(err), 'error'); }
        return;
      }

      const jumpMsg = ev.target.closest?.('[data-jump-msg]');
      if (jumpMsg) {
        const id = jumpMsg.dataset.jumpMsg;
        if (jumpMsg.closest?.('#msg-thread-drawer') && window.innerWidth && window.innerWidth <= 980) {
          state.showThreadInfo = false;
          state.threadInfoView = 'root';
          renderThreadInfoDrawer();
        }
        if (jumpMsg.dataset.pinnedSelect || jumpMsg.closest?.('.msg-pinned-pill')) {
          if (jumpMsg.dataset.pinnedSelect) state.activePinnedId = jumpMsg.dataset.pinnedSelect;
          if (state.showPinnedList || jumpMsg.dataset.pinnedSelect) {
            state.showPinnedList = false;
            renderPinnedBanner();
            syncActivePinnedHighlight();
          }
        }
        if ((state.activeThread?.messages || []).some((m) => m.id === id)) jumpToMessageElement(id);
        else if (state.activeConvId) await openConversation(state.activeConvId, { aroundMessageId: id, markRead: false });
        return;
      }

      const globalHit = ev.target.closest?.('[data-jump-conv]');
      if (globalHit) {
        switchTab('chats');
        await openConversation(globalHit.dataset.jumpConv, { aroundMessageId: globalHit.dataset.jumpMsgId });
        return;
      }

      const reqBtn = ev.target.closest?.('[data-msg-req-decision]');
      if (reqBtn && state.activeConvId) {
        const dec = reqBtn.dataset.msgReqDecision;
        if (dec === 'BLOCK') {
          const ok = await ipon().confirmAction({ title: 'Block sender?', message: 'This sender will be blocked from contacting you again.', confirmText: 'Block', danger: true });
          if (!ok) return;
        }
        try {
          await ipon().rpc('respond_message_request', { p_conversation_id: state.activeConvId, p_decision: dec });
          ipon().toast(dec === 'ACCEPT' ? 'Moved to Inbox.' : dec === 'BLOCK' ? 'Sender blocked.' : 'Message request deleted.');
          await refreshConversations();
          if (dec === 'ACCEPT') { switchTab('chats'); await openConversation(state.activeConvId); }
          else {
            clearActiveThreadSelection();
          }
        } catch (err) { ipon().toast(ipon().friendlyError(err), 'error'); }
        return;
      }

      const socialBtn = ev.target.closest?.('[data-social-action]');
      if (socialBtn) {
        await handleSocialAction(socialBtn.dataset.socialAction, socialBtn.dataset.targetId);
        return;
      }
      const unblockBtn = ev.target.closest?.('[data-unblock-user]');
      if (unblockBtn) {
        await handleSocialAction('unblock', unblockBtn.dataset.unblockUser);
        return;
      }
      const fReqBtn = ev.target.closest?.('[data-req-decision]');
      if (fReqBtn) {
        try {
          await ipon().rpc('respond_friend_request', { p_request_id: fReqBtn.dataset.reqId, p_decision: fReqBtn.dataset.reqDecision });
          ipon().toast(fReqBtn.dataset.reqDecision === 'ACCEPT' ? 'Friend request accepted!' : 'Friend request declined.');
          closeProfilePopover();
          await Promise.all([refreshOverview(), refreshConversations()]);
          if (state.searchActive || state.chatListQuery.trim()) await runGlobalDiscovery(state.chatListQuery);
        } catch (err) { ipon().toast(ipon().friendlyError(err), 'error'); }
        return;
      }
      const cancelBtn = ev.target.closest?.('[data-cancel-req]');
      if (cancelBtn) {
        try {
          await ipon().rpc('cancel_friend_request', { p_request_id: cancelBtn.dataset.cancelReq });
          ipon().toast('Friend request cancelled.');
          closeProfilePopover();
          await refreshOverview();
          if (state.searchActive || state.chatListQuery.trim()) await runGlobalDiscovery(state.chatListQuery);
        } catch (err) { ipon().toast(ipon().friendlyError(err), 'error'); }
        return;
      }

      // Message reactions & actions
      const expandReactBtn = ev.target.closest?.('[data-react-expand]');
      if (expandReactBtn) {
        ev.stopPropagation();
        const menu = expandReactBtn.closest('.msg-react-menu');
        const palette = menu?.querySelector('.msg-react-palette');
        if (menu && palette) {
          const isOpen = !palette.hidden;
          palette.hidden = isOpen;
          menu.classList.toggle('has-extra', !isOpen);
          expandReactBtn.setAttribute('aria-expanded', String(!isOpen));
          expandReactBtn.setAttribute('aria-label', isOpen ? 'More reactions' : 'Fewer reactions');
          if (activeFloatingMenuAnchor) {
            placeFloatingMenu(menu, activeFloatingMenuAnchor, {
              preferAbove: true,
              estWidth: 276,
              estHeight: isOpen ? 56 : 220,
              align: 'center'
            });
          }
        }
        return;
      }

      const reactPill = ev.target.closest?.('[data-react-msg]');
      if (reactPill) {
        closeFloatingMenus();
        const rMsgId = reactPill.dataset.reactMsg;
        const rEmoji = reactPill.dataset.reactEmoji;
        const targetMsg = (state.activeThread?.messages || []).find((m) => String(m.id) === String(rMsgId));
        const prevReactions = targetMsg ? [...(targetMsg.reactions || [])] : null;
        if (targetMsg) {
          const myId = initializedProfile?.id;
          const myName = initializedProfile?.full_name || 'You';
          const existingMine = (targetMsg.reactions || []).find((r) => r.user_id === myId);
          const others = (targetMsg.reactions || []).filter((r) => r.user_id !== myId);
          targetMsg.reactions = existingMine?.emoji === rEmoji
            ? others
            : [...others, { user_id: myId, user_name: myName, emoji: rEmoji }];
          patchMessageReactionsDom(targetMsg);
          state.lastThreadFingerprint = computeThreadFingerprint(state.activeThread);
        }
        try {
          await ipon().rpc('toggle_message_reaction', { p_message_id: rMsgId, p_emoji: rEmoji });
          if (!targetMsg && state.activeConvId) {
            await openConversation(state.activeConvId, { markRead: false, silent: true });
          }
        } catch (err) {
          if (targetMsg && prevReactions) {
            targetMsg.reactions = prevReactions;
            patchMessageReactionsDom(targetMsg);
            state.lastThreadFingerprint = computeThreadFingerprint(state.activeThread);
          }
          ipon().toast(ipon().friendlyError(err), 'error');
        }
        return;
      }

      const msgActBtn = ev.target.closest?.('[data-msg-act]');
      if (msgActBtn) {
        ev.stopPropagation();
        const act = msgActBtn.dataset.msgAct;
        const mId = msgActBtn.dataset.msgId;
        const msgObj = (state.activeThread?.messages || []).find((m) => m.id === mId);
        if (!msgObj) return;
        if (act === 'react') showReactionFloatingMenu(mId, msgActBtn);
        else if (act === 'reply') startReplyToMessage(msgObj);
        else if (act === 'menu') showMessageContextMenu(mId, msgActBtn);
        return;
      }

      const ctxBtn = ev.target.closest?.('[data-ctx-do]');
      if (ctxBtn) {
        closeFloatingMenus();
        const op = ctxBtn.dataset.ctxDo;
        const mId = ctxBtn.dataset.msgId;
        const msgObj = (state.activeThread?.messages || []).find((m) => m.id === mId);
        if (!msgObj) return;
        if (op === 'reply') {
          startReplyToMessage(msgObj);
          return;
        }
        if (op === 'download') {
          const atts = (msgObj.attachments || []).filter((a) => a?.path);
          for (let i = 0; i < atts.length; i += 1) {
            const att = atts[i];
            await downloadOriginalAttachment(state.activeConvId, att.path, att.name || 'attachment');
            if (i + 1 < atts.length) await new Promise((r) => setTimeout(r, 140));
          }
          return;
        }
        if (op === 'copy') {
          try { await navigator.clipboard.writeText(msgObj.body || ''); ipon().toast('Copied message.'); } catch { }
        } else if (op === 'edit') {
          state.replyToMsg = null; state.editingMsg = msgObj; renderContextBar();
          const inp = document.getElementById('msg-composer-input');
          if (inp) { inp.value = msgObj.body || ''; autoResizeTextarea(inp); inp.focus(); }
        } else if (op === 'forward') {
          await openForwardDialog(msgObj);
        } else if (op === 'pin') {
          await ipon().rpc('pin_chat_message', { p_message_id: mId }).catch((e) => ipon().toast(ipon().friendlyError(e), 'error'));
          state.activePinnedId = null;
          await openConversation(state.activeConvId, { markRead: false, silent: true });
        } else if (op === 'del_me' || op === 'del_all') {
          if (op === 'del_all') {
            const ok = await ipon().confirmAction({ title: 'Unsend for everyone?', message: 'This removes the message and its attachments for both participants.', confirmText: 'Unsend', danger: true });
            if (!ok) return;
          }
          try {
            const delRes = await ipon().rpc('delete_chat_message', { p_message_id: mId, p_mode: op === 'del_all' ? 'FOR_EVERYONE' : 'FOR_ME' });
            if (Array.isArray(delRes?.removed_paths) && delRes.removed_paths.length) {
              ipon().invokeAccountFunction({ action: 'chat-cleanup-media', paths: delRes.removed_paths }).catch(() => { });
            }
            await Promise.all([openConversation(state.activeConvId, { markRead: false, silent: true }), refreshConversations()]);
          } catch (err) { ipon().toast(ipon().friendlyError(err), 'error'); }
        }
        return;
      }

      const fwdRow = ev.target.closest?.('[data-fwd-user]');
      if (fwdRow) {
        const dialog = document.getElementById('msg-forward-dialog');
        const body = document.getElementById('msg-forward-body');
        try {
          let convId = fwdRow.dataset.fwdConv;
          if (!convId) {
            const opened = await ipon().rpc('start_or_open_direct_chat', { p_target_id: fwdRow.dataset.fwdUser });
            convId = opened.id;
          }
          await ipon().rpc('send_chat_message', {
            p_conversation_id: convId,
            p_body: body.dataset.fwdBody || '',
            p_message_type: 'FORWARDED',
            p_forwarded_from_id: body.dataset.fwdMsgId
          });
          dialog?.close();
          ipon().toast('Message forwarded.');
          await refreshConversations();
        } catch (err) { ipon().toast(ipon().friendlyError(err), 'error'); }
        return;
      }

      // Composer attachments, retry/delete failed messages, emoji, voice note, cancel context
      const retryPendingBtn = ev.target.closest?.('[data-pending-retry]');
      if (retryPendingBtn && state.activeConvId) {
        const item = findPendingItem(state.activeConvId, retryPendingBtn.dataset.pendingRetry);
        if (item && item.status !== 'sending') processPendingMessage(item);
        return;
      }
      const deletePendingBtn = ev.target.closest?.('[data-pending-delete]');
      if (deletePendingBtn && state.activeConvId) {
        removePendingItem(state.activeConvId, deletePendingBtn.dataset.pendingDelete, { revokeUrls: true, cleanupRemote: true });
        return;
      }
      if (ev.target.closest?.('#msg-cancel-context')) { state.replyToMsg = null; state.editingMsg = null; renderContextBar(); return; }
      if (ev.target.closest?.('#msg-attach-btn')) { document.getElementById('msg-file-input')?.click(); return; }
      const remQ = ev.target.closest?.('[data-remove-queue]');
      if (remQ) {
        const idx = Number(remQ.dataset.removeQueue);
        if (state.uploadQueue[idx]?.previewUrl) try { URL.revokeObjectURL(state.uploadQueue[idx].previewUrl); } catch { }
        state.uploadQueue.splice(idx, 1);
        renderUploadQueue();
        return;
      }

      if (ev.target.closest?.('#msg-emoji-btn')) {
        const popEmoji = document.getElementById('msg-emoji-popover');
        if (popEmoji) {
          popEmoji.hidden = !popEmoji.hidden;
          if (!popEmoji.innerHTML) {
            popEmoji.innerHTML = EMOJI_PALETTE.map((e) => `<button type="button" data-insert-emoji="${escAttr(e)}">${e}</button>`).join('');
          }
        }
        return;
      }
      const insEmoji = ev.target.closest?.('[data-insert-emoji]');
      if (insEmoji) {
        const inp = document.getElementById('msg-composer-input');
        if (inp) {
          inp.value += insEmoji.dataset.insertEmoji;
          autoResizeTextarea(inp);
          inp.focus();
        }
        return;
      }
      if (ev.target.closest?.('#msg-voice-btn')) { await startVoiceRecording(); return; }
      if (ev.target.closest?.('#msg-voice-cancel')) { stopVoiceRecorderStream({ send: false }); return; }
      if (ev.target.closest?.('#msg-voice-send')) { stopVoiceRecorderStream({ send: true }); return; }

      // Attachment viewers, custom video player & downloads
      const vSpeedBtn = ev.target.closest?.('[data-vspeed]');
        if (vSpeedBtn) {
        const video = activeVideoMenuPlayer?.querySelector('video');
        if (video) {
          video.playbackRate = Number(vSpeedBtn.dataset.vspeed || 1);
          revealVideoControls(activeVideoMenuPlayer);
        }
        closeFloatingMenus();
        return;
      }
      const vCtrlBtn = ev.target.closest?.('[data-vact]');
      if (vCtrlBtn) {
        ev.stopPropagation();
        const player = vCtrlBtn.closest('.msg-video-player');
        const video = player?.querySelector('video');
        const vact = vCtrlBtn.dataset.vact;
        if (!player || !video) return;
        if (vact === 'play') {
          if (video.paused || video.ended) {
            pauseOtherChatMedia(video);
            video.play?.().catch(() => { });
          } else video.pause?.();
          syncVideoPlayerUi(video);
          revealVideoControls(player);
        } else if (vact === 'mute') {
          video.muted = !video.muted;
          syncVideoPlayerUi(video);
          revealVideoControls(player);
        } else if (vact === 'fs') {
          openVideoViewerForPlayer(player);
          revealVideoControls(player);
        } else if (vact === 'menu') {
          const existingMenu = Array.from(document.querySelectorAll('.msg-floating-menu') || [])
            .find((n) => !n.classList?.contains?.('is-leaving'));
          if (existingMenu && activeVideoMenuPlayer === player) {
            closeFloatingMenus();
            revealVideoControls(player);
          } else {
            revealVideoControls(player, { autoHideMs: 4000 });
            showVideoOptionsMenu(player, vCtrlBtn);
          }
        }
        return;
      }
      if (ev.target.closest?.('.msg-video-controls')) {
        revealVideoControls(ev.target.closest('.msg-video-player'));
        return;
      }
      const vidPlayer = ev.target.closest?.('.msg-video-player');
      if (vidPlayer) {
        const video = vidPlayer.querySelector('video');
        if (!video) return;
        const shown = vidPlayer.classList.contains('is-controls-visible');
        if (video.paused || video.ended) {
          pauseOtherChatMedia(video);
          video.play?.().catch(() => { });
          syncVideoPlayerUi(video);
          revealVideoControls(vidPlayer);
        } else if (!shown) {
          syncVideoPlayerUi(video);
          revealVideoControls(vidPlayer);
        } else {
          video.pause?.();
          syncVideoPlayerUi(video);
          revealVideoControls(vidPlayer);
        }
        return;
      }
      const aCtrlBtn = ev.target.closest?.('[data-aact]');
      if (aCtrlBtn) {
        ev.stopPropagation();
        const card = aCtrlBtn.closest('.msg-voice-card');
        const audio = card?.querySelector('audio.msg-att-audio');
        const aact = aCtrlBtn.dataset.aact;
        if (!card || !audio) return;
        if (aact === 'play') {
          if (audio.paused || audio.ended) {
            pauseOtherChatMedia(audio);
            audio.play?.().catch(() => { });
          } else {
            audio.pause?.();
          }
          syncVoicePlayerUi(audio);
        } else if (aact === 'mute') {
          audio.muted = !audio.muted;
          syncVoicePlayerUi(audio);
        }
        return;
      }
      const waveEl = ev.target.closest?.('.msg-voice-wave');
      if (waveEl) {
        const card = waveEl.closest('.msg-voice-card');
        const audio = card?.querySelector('audio.msg-att-audio');
        const rect = waveEl.getBoundingClientRect?.();
        if (card && audio && rect && rect.width > 0) {
          seekVoiceAudio(card, audio, (ev.clientX - rect.left) / rect.width);
        }
        return;
      }
      const openVidBtn = ev.target.closest?.('[data-open-vid]');
      if (openVidBtn) {
        openVideoViewerForPlayer(openVidBtn);
        return;
      }
      const imgBtn = ev.target.closest?.('[data-open-img]');
      if (imgBtn) {
        const dlPath = imgBtn.dataset.imgPath || '';
        const dlConv = imgBtn.dataset.imgConv || state.activeConvId || '';
        const imgName = imgBtn.dataset.imgName || 'Image';
        ipon().openImageViewer(imgBtn.dataset.openImg, imgName, '', imgName, {
          onDownload: dlPath && dlConv ? () => downloadOriginalAttachment(dlConv, dlPath, imgName) : null
        });
        return;
      }
      const dlBtn = ev.target.closest?.('[data-dl-path]');
      if (dlBtn) {
        if (dlBtn.closest?.('.msg-floating-menu')) closeFloatingMenus();
        await downloadOriginalAttachment(dlBtn.dataset.dlConv, dlBtn.dataset.dlPath, dlBtn.dataset.dlName);
        return;
      }

      // Social alerts actions
      if (ev.target.closest?.('#msg-mark-alerts-read')) {
        await ipon().rpc('mark_all_notifications_read').catch(() => { });
        await refreshSocialNotifications();
        return;
      }
      const alertBtn = ev.target.closest?.('[data-social-alert-id]');
      if (alertBtn) {
        const nId = Number(alertBtn.dataset.socialAlertId);
        if (nId) ipon().rpc('mark_notification_read', { p_notification_id: nId }).catch(() => { });
        await openFromNotification({ type: alertBtn.dataset.socialType, link: alertBtn.dataset.socialLink });
        return;
      }
    });

    document.addEventListener('submit', (ev) => {
      if (ev.target?.id === 'msg-composer-form') submitComposer(ev);
    });

    document.addEventListener('input', (ev) => {
      if (ev.target?.id === 'msg-list-search') {
        const q = ev.target.value;
        state.chatListQuery = q;
        renderConversationList();
        if (state.tab === 'chats' && (q.trim() || state.searchActive)) {
          clearTimeout(searchDebounce);
          searchDebounce = setTimeout(() => runGlobalDiscovery(q), 180);
        } else {
          clearTimeout(searchDebounce);
        }
      } else if (ev.target?.id === 'msg-friend-filter') {
        const q = ev.target.value.trim().toLowerCase();
        let visibleCount = 0;
        document.querySelectorAll('[data-friend-card]').forEach((card) => {
          const hide = q ? !card.dataset.searchBlob?.includes(q) : false;
          card.hidden = hide;
          if (!hide) visibleCount += 1;
        });
        const fClear = document.getElementById('msg-friend-filter-clear');
        if (fClear) fClear.hidden = !q;
        const fEmpty = document.getElementById('msg-friend-filter-empty');
        if (fEmpty) fEmpty.hidden = visibleCount > 0;
      } else if (ev.target?.id === 'msg-thread-search-input') {
        state.threadSearchQuery = ev.target.value;
        clearTimeout(threadSearchDebounce);
        threadSearchDebounce = setTimeout(runThreadSearch, 200);
      } else if (ev.target?.id === 'msg-composer-input') {
        autoResizeTextarea(ev.target);
        syncComposerCharCounter(ev.target.value.length);
        if (state.activeConvId) state.draftsByConv.set(state.activeConvId, ev.target.value);
        sendTypingBroadcast(Boolean(ev.target.value.trim()));
      } else if (ev.target?.classList?.contains('msg-video-seek')) {
        const player = ev.target.closest('.msg-video-player');
        const video = player?.querySelector('video');
        if (player && video) {
          player.dataset.seeking = '1';
          clearTimeout(player._hideTimer);
          const pct = Math.min(100, Math.max(0, Number(ev.target.value || 0) / 10));
          ev.target.style.setProperty('--seek-pct', `${pct}%`);
          if (Number.isFinite(video.duration) && video.duration > 0) {
            video.currentTime = (pct / 100) * video.duration;
          }
        }
      }
    });

    document.addEventListener('focusout', (ev) => {
      if (ev.target?.id === 'msg-composer-input') {
        sendTypingBroadcast(false);
      }
    });

    document.addEventListener('change', (ev) => {
      if (ev.target?.id === 'msg-file-input') {
        queuePickedFiles(ev.target.files);
        ev.target.value = '';
      } else if (ev.target?.id === 'msg-thread-search-sender') {
        state.threadSearchSenderId = ev.target.value;
        runThreadSearch();
      } else if (ev.target?.classList?.contains('msg-video-seek')) {
        const player = ev.target.closest('.msg-video-player');
        if (player) {
          delete player.dataset.seeking;
          revealVideoControls(player);
        }
      }
    });

    const onMediaEvent = (ev) => {
      if (ev.target?.classList?.contains('msg-att-video')) {
        const video = ev.target;
        const player = video.closest?.('.msg-video-player');
        if (player && (ev.type === 'loadedmetadata' || ev.type === 'loadeddata' || ev.type === 'seeked')) {
          const vKey = player.dataset?.vidKey || getVideoMetaKey(player.dataset?.vidPath, video.currentSrc || video.src);
          const vw = Number(video.videoWidth || 0);
          const vh = Number(video.videoHeight || 0);
          if (vw > 0 && vh > 0 && vKey && !player.dataset.arLocked) {
            player.dataset.arLocked = '1';
            const merged = { ...(videoMetaCache.get(vKey) || {}), width: vw, height: vh, duration: Number(video.duration || 0) };
            videoMetaCache.set(vKey, merged);
            applyCachedVideoMetaToDom(vKey, merged);
          }
          const curPoster = video.getAttribute?.('poster') || '';
          if (curPoster === VIDEO_POSTER_FALLBACK && video.readyState >= 2) {
            if (ev.type === 'loadeddata' && video.paused && Number(video.currentTime || 0) === 0 && !video.dataset?.thumbSeeked && Number(video.duration || 0) > 0.1) {
              if (video.dataset) video.dataset.thumbSeeked = '1';
              try { video.currentTime = 0.05; } catch { }
            } else if (ev.type === 'seeked' || Number(video.duration || 0) <= 0.1) {
              video.removeAttribute?.('poster');
            }
          }
        }
        syncVideoPlayerUi(video);
      } else if (ev.target?.classList?.contains('msg-att-audio')) {
        syncVoicePlayerUi(ev.target);
      }
    };
    for (const evt of ['play', 'pause', 'ended', 'timeupdate', 'loadedmetadata', 'loadeddata', 'seeked', 'volumechange']) {
      document.addEventListener(evt, onMediaEvent, true);
    }

    document.addEventListener('keydown', (ev) => {
      if (ev.target?.classList?.contains('msg-voice-wave')) {
        const card = ev.target.closest('.msg-voice-card');
        const audio = card?.querySelector('audio.msg-att-audio');
        if (card && audio) {
          const fallbackDur = Number(card.dataset.dur || 0);
          const dur = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : fallbackDur;
          if (ev.key === 'ArrowRight' || ev.key === 'ArrowLeft') {
            ev.preventDefault();
            const delta = ev.key === 'ArrowRight' ? 2 : -2;
            if (dur > 0) seekVoiceAudio(card, audio, (Number(audio.currentTime || 0) + delta) / dur);
            return;
          }
          if (ev.key === ' ' || ev.key === 'Enter') {
            ev.preventDefault();
            card.querySelector('[data-aact="play"]')?.click();
            return;
          }
        }
      }
      if (ev.key === 'Escape') {
        if (ev.target?.id === 'msg-list-search' && (state.searchActive || state.chatListQuery.trim())) {
          ev.preventDefault();
          clearSidebarSearch();
          return;
        }
        closeProfilePopover();
        closeFloatingMenus();
        if (state.showPinnedList) {
          state.showPinnedList = false;
          renderPinnedBanner();
        }
        const emojiPop = document.getElementById('msg-emoji-popover');
        if (emojiPop) emojiPop.hidden = true;
      }
      if (ev.target?.id === 'msg-composer-input') {
        if (ev.key !== 'Enter' || ev.shiftKey || ev.ctrlKey || ev.metaKey || ev.altKey) return;
        ev.preventDefault();
        if (ev.isComposing || ev.keyCode === 229) return;
        if (!ev.repeat) document.getElementById('msg-composer-form')?.requestSubmit();
      }
    });

    document.addEventListener('paste', (ev) => {
      if (ev.target?.id === 'msg-composer-input' && ev.clipboardData?.files?.length) {
        ev.preventDefault();
        queuePickedFiles(ev.clipboardData.files);
      }
    });

    document.addEventListener('wheel', (ev) => {
      const strip = ev.target.closest?.('.msg-upload-queue, .msg-attachments.is-carousel');
      if (!strip || strip.scrollWidth <= strip.clientWidth) return;
      if (Math.abs(ev.deltaY) > Math.abs(ev.deltaX)) {
        ev.preventDefault();
        strip.scrollLeft += ev.deltaY;
      }
    }, { passive: false });

    let pressTimer = null;
    let pressStart = null;
    let pressHoldTriggeredId = null;
    let suppressClearTimer = null;
    const clearSuppressedClickSoon = (msgId) => {
      if (suppressClearTimer) {
        clearTimeout(suppressClearTimer);
        suppressClearTimer = null;
      }
      if (!msgId) return;
      suppressClearTimer = setTimeout(() => {
        if (suppressBubbleClickId === msgId) suppressBubbleClickId = null;
        suppressClearTimer = null;
      }, 140);
    };
    const cancelLongPress = () => {
      if (pressTimer) {
        clearTimeout(pressTimer);
        pressTimer = null;
      }
      pressStart = null;
      if (pressHoldTriggeredId) {
        clearSuppressedClickSoon(pressHoldTriggeredId);
        pressHoldTriggeredId = null;
      }
    };
    const resolveHoldTarget = (target) => {
      const bubble = target?.closest?.('#msg-messages-list .msg-bubble:not(.is-deleted)');
      if (!bubble || target?.closest?.(HOLD_EXCLUDE_SEL)) return null;
      const msgId = bubble.closest?.('[data-msg-id]')?.dataset?.msgId;
      if (!msgId) return null;
      const anchor = target?.closest?.('.msg-att-image, .msg-video-player') || bubble;
      return { msgId, anchor };
    };
    document.addEventListener('pointerdown', (ev) => {
      if (ev.pointerType === 'mouse' && typeof ev.button === 'number' && ev.button !== 0) return;
      const target = resolveHoldTarget(ev.target);
      if (!target) {
        cancelLongPress();
        return;
      }
      cancelLongPress();
      suppressBubbleClickId = null;
      const hadSelection = Boolean(window.getSelection?.()?.toString()?.trim());
      pressStart = { x: ev.clientX || 0, y: ev.clientY || 0 };
      pressTimer = setTimeout(() => {
        pressTimer = null;
        pressStart = null;
        if (!hadSelection && ev.pointerType !== 'mouse') {
          window.getSelection?.()?.removeAllRanges?.();
        }
        pressHoldTriggeredId = target.msgId;
        suppressBubbleClickId = target.msgId;
        recentHoldMsgId = target.msgId;
        recentHoldAt = Date.now();
        showReactionFloatingMenu(target.msgId, target.anchor, { toggle: false });
      }, MSG_HOLD_DELAY_MS);
    });
    document.addEventListener('pointermove', (ev) => {
      if (!pressStart) return;
      if (Math.hypot((ev.clientX || 0) - pressStart.x, (ev.clientY || 0) - pressStart.y) > 10) cancelLongPress();
    });
    document.addEventListener('pointerup', cancelLongPress);
    document.addEventListener('pointercancel', cancelLongPress);
    document.addEventListener('dragstart', (ev) => {
      if (ev.target?.closest?.('#msg-messages-list .msg-bubble img, #msg-messages-list .msg-bubble video')) {
        ev.preventDefault?.();
      }
    });

    document.addEventListener('contextmenu', (ev) => {
      const target = resolveHoldTarget(ev.target);
      if (!target) return;
      if (window.getSelection?.()?.toString()?.trim()) return;
      ev.preventDefault?.();
      cancelLongPress();
      if (recentHoldMsgId === target.msgId && Date.now() - recentHoldAt < 900) return;
      suppressBubbleClickId = target.msgId;
      clearSuppressedClickSoon(target.msgId);
      showReactionFloatingMenu(target.msgId, target.anchor, { toggle: false });
    });

    window.addEventListener('resize', () => {
      closeProfilePopover();
      closeFloatingMenus({ immediate: true });
    });
  }

  async function openWorkspace({ tab = null, conversationId = null, messageId = null } = {}) {
    if (!isEligible()) return;
    ensureDialogsMounted();
    const dialog = document.getElementById('msg-workspace-dialog');
    if (!dialog) return;
    const defaultLanding = !tab && !conversationId;
    const targetTab = tab || 'chats';
    if (!dialog.open) dialog.showModal();
    if (defaultLanding) {
      clearSidebarSearch();
      clearActiveThreadSelection();
    }
    switchTab(targetTab);
    if (!state.conversationsLoaded && !state.conversations.length) {
      state.loadingConvs = true;
      renderConversationList();
    }
    await Promise.all([refreshConversations(), refreshOverview(), refreshSocialNotifications()]);
    if (conversationId) {
      switchTab(targetTab);
      await openConversation(conversationId, { aroundMessageId: messageId });
    } else {
      syncTabUi();
      syncMobilePaneState();
      if (state.tab === 'friends') renderFriendsView();
      else if (state.tab === 'notifications') renderAlertsView();
      else renderConversationList();
    }
  }

  async function openFromNotification(itemOrLink, parsedUrl = null) {
    if (!isEligible()) return;
    let urlObj = parsedUrl;
    if (!urlObj) {
      const link = typeof itemOrLink === 'string' ? itemOrLink : (itemOrLink?.link || '');
      try { urlObj = new URL(link || 'dashboard.html?messages=inbox', location.href); } catch { urlObj = new URL('dashboard.html', location.href); }
    }
    const sp = urlObj.searchParams;
    const chatId = sp.get('chat');
    const msgId = sp.get('msg');
    const mode = sp.get('messages');
    const type = String(itemOrLink?.type || '').toUpperCase();

    if (mode === 'friends' || type === 'SOCIAL_FRIEND_ACCEPTED') {
      state.friendsSubTab = 'all';
      await openWorkspace({ tab: 'friends' });
    } else if (type === 'SOCIAL_FRIEND_REQUEST') {
      state.friendsSubTab = 'incoming';
      await openWorkspace({ tab: 'friends' });
    } else if (mode === 'requests' || type === 'SOCIAL_MESSAGE_REQUEST') {
      await openWorkspace({ tab: 'requests', conversationId: chatId, messageId: msgId });
    } else {
      await openWorkspace({ tab: 'chats', conversationId: chatId, messageId: msgId });
    }
  }

  function subscribeRealtime(profile) {
    const client = ipon().client;
    if (!client || !profile?.id || realtimeChannel) return;
    let refreshTimer = null;
    let isRefreshingRealtime = false;
    let pendingRefresh = { convs: false, thread: false, markRead: false, forceMarkRead: false, overview: false, alerts: false };

    const flushRefresh = async () => {
      if (isRefreshingRealtime) {
        clearTimeout(refreshTimer);
        refreshTimer = setTimeout(flushRefresh, 200);
        return;
      }
      const opts = { ...pendingRefresh };
      pendingRefresh = { convs: false, thread: false, markRead: false, forceMarkRead: false, overview: false, alerts: false };
      if (!opts.convs && !opts.thread && !opts.overview && !opts.alerts) return;

      isRefreshingRealtime = true;
      try {
        await Promise.all([
          opts.convs ? refreshConversations() : Promise.resolve(),
          opts.overview ? refreshOverview() : Promise.resolve(),
          opts.alerts ? refreshSocialNotifications() : Promise.resolve()
        ]);
        const dialogOpen = Boolean(document.getElementById('msg-workspace-dialog')?.open);
        if (opts.thread && state.activeConvId && dialogOpen) {
          await openConversation(state.activeConvId, {
            markRead: Boolean(opts.markRead),
            forceMarkRead: Boolean(opts.forceMarkRead),
            silent: true
          });
        }
      } finally {
        isRefreshingRealtime = false;
      }
    };

    const scheduleRefresh = (opts = {}) => {
      if (opts.convs !== false) pendingRefresh.convs = true;
      if (opts.thread) pendingRefresh.thread = true;
      if (opts.markRead) pendingRefresh.markRead = true;
      if (opts.forceMarkRead) pendingRefresh.forceMarkRead = true;
      if (opts.overview) pendingRefresh.overview = true;
      if (opts.alerts) pendingRefresh.alerts = true;
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(flushRefresh, 240);
    };

    if (realtimeChannel) {
      try { client.removeChannel(realtimeChannel)?.catch?.(() => { }); } catch { }
      realtimeChannel = null;
    }
    const baseRealtimeTopic = `msg-social-live:${profile.id}`;
    const createChannel = ipon().createRealtimeChannel;
    realtimeChannel = (createChannel ? createChannel(baseRealtimeTopic, undefined, client) : client.channel(baseRealtimeTopic))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, (payload) => {
        const row = payload?.new || payload?.old || {};
        const cId = row.conversation_id;
        const isForActive = Boolean(cId && cId === state.activeConvId);
        const fromPeer = Boolean(row.sender_id && row.sender_id !== profile.id);
        const isInsert = payload?.eventType === 'INSERT';
        if (isInsert && fromPeer && cId) {
          if (state.typingPeers.has(cId)) {
            const prevTyping = state.typingPeers.get(cId);
            if (prevTyping?.timer) clearTimeout(prevTyping.timer);
            state.typingPeers.delete(cId);
            updateTypingIndicators({ listChanged: true });
          }
          const threadActiveHere = isForActive && isThreadActivelyVisible();
          if (!threadActiveHere) {
            ipon().rpc('mark_messages_delivered', { p_conversation_id: cId }).catch(() => { });
          }
        }
        const markIncomingReadHere = Boolean(isForActive && isInsert && fromPeer && isThreadActivelyVisible());
        scheduleRefresh({
          convs: true,
          thread: isForActive,
          markRead: markIncomingReadHere,
          forceMarkRead: markIncomingReadHere,
          alerts: Boolean(isInsert && fromPeer)
        });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'message_reactions' }, (payload) => {
        const mId = payload?.new?.message_id || payload?.old?.message_id;
        const dialogOpen = Boolean(document.getElementById('msg-workspace-dialog')?.open);
        if (!dialogOpen || !state.activeConvId) return;
        const inActive = !mId || (state.activeThread?.messages || []).some((m) => m.id === mId);
        if (inActive) scheduleRefresh({ convs: false, thread: true, markRead: false });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'message_receipts' }, (payload) => {
        const row = payload?.new || payload?.old || {};
        // Ignore our own read/delivered receipts so marking read never triggers a self-refresh loop.
        if (row.user_id === profile.id) return;
        const dialogOpen = Boolean(document.getElementById('msg-workspace-dialog')?.open);
        if (!dialogOpen || !state.activeConvId) return;
        const msgItem = row.message_id ? (state.activeThread?.messages || []).find((m) => m.id === row.message_id) : null;
        if (msgItem) {
          if (row.delivered_at) msgItem.delivered_at = row.delivered_at;
          if (row.read_at && state.activeThread?.conversation?.receipts_enabled !== false) {
            msgItem.read_at = row.read_at;
          }
          if (!patchMessageReceiptsDom(msgItem, state.activeThread?.conversation)) {
            renderMessagesList();
          }
          state.lastThreadFingerprint = computeThreadFingerprint(state.activeThread);
        }
        const inActive = !row.message_id || Boolean(msgItem);
        if (inActive) scheduleRefresh({ convs: false, thread: true, markRead: false });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversations' }, (payload) => {
        const row = payload?.new || payload?.old || {};
        const cId = row.id;
        const curConv = state.activeThread?.conversation;
        const statusChanged = Boolean(
          cId &&
          cId === state.activeConvId &&
          row.status &&
          curConv?.status &&
          row.status !== curConv.status
        );
        scheduleRefresh({
          convs: true,
          thread: statusChanged,
          markRead: false
        });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversation_participants', filter: `user_id=eq.${profile.id}` }, (payload) => {
        const row = payload?.new || payload?.old || {};
        const cId = row.conversation_id;
        // Skip self-triggered last_read_at / marked_unread echoes immediately after mark_conversation_read.
        if (cId && (Date.now() - (state.recentMarkReadAt.get(cId) || 0) < 2500)) return;
        const curConv = state.activeThread?.conversation;
        const metaChanged = Boolean(
          cId &&
          cId === state.activeConvId &&
          curConv &&
          row.chat_theme && (
            row.chat_theme !== curConv.chat_theme ||
            Boolean(row.is_pinned) !== Boolean(curConv.is_pinned) ||
            Boolean(row.is_muted) !== Boolean(curConv.is_muted) ||
            Boolean(row.is_archived) !== Boolean(curConv.is_archived)
          )
        );
        scheduleRefresh({
          convs: true,
          thread: metaChanged,
          markRead: false
        });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'friend_requests' }, () => {
        scheduleRefresh({ overview: true, alerts: true });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'friendships' }, () => {
        scheduleRefresh({ overview: true });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'blocked_users', filter: `blocker_id=eq.${profile.id}` }, () => {
        scheduleRefresh({ overview: true, thread: Boolean(state.activeConvId), markRead: false });
      })
      .subscribe();
  }

  async function init(profile) {
    if (!profile || profile.role === 'SUPER_ADMIN' || profile.status !== 'ACTIVE') return;
    initializedProfile = profile;
    bindEvents();
    ensureDialogsMounted();
    subscribeRealtime(profile);

    await Promise.all([
      refreshConversations({ render: false }).catch(() => { }),
      refreshOverview({ render: false }).catch(() => { }),
      refreshSocialNotifications({ render: false }).catch(() => { }),
      ipon().rpc('mark_messages_delivered', { p_conversation_id: null }).catch(() => { })
    ]);

    // Last seen heartbeat respecting privacy + instant delivery receipt ping on foreground focus
    const pingLastSeen = () => {
      if (document.visibilityState === 'visible' && (initializedProfile?.chat_privacy?.show_online !== false)) {
        ipon().rpc('touch_user_last_seen').catch(() => { });
      }
    };
    const syncForegroundReceipts = () => {
      pingLastSeen();
      ipon().rpc('mark_messages_delivered', { p_conversation_id: null }).catch(() => { });
      if (isThreadActivelyVisible()) {
        openConversation(state.activeConvId, { markRead: true, silent: true }).catch(() => { });
      }
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        sendTypingBroadcast(false);
      } else if (document.visibilityState === 'visible') {
        syncForegroundReceipts();
      }
    };
    const onWindowBlur = () => {
      isWindowFocused = false;
      sendTypingBroadcast(false);
    };
    const onWindowFocus = () => {
      isWindowFocused = true;
      if (document.visibilityState === 'visible') {
        syncForegroundReceipts();
      }
    };
    pingLastSeen();
    if (!lastSeenTimer) {
      lastSeenTimer = setInterval(pingLastSeen, 60000);
      document.addEventListener('visibilitychange', onVisibilityChange);
      if (typeof window.addEventListener === 'function') {
        window.addEventListener('focus', onWindowFocus);
        window.addEventListener('blur', onWindowBlur);
      }
    }

    // Consume deep-link params (?chat=..., ?messages=...)
    const params = new URLSearchParams(location.search);
    if (params.get('chat') || params.get('messages')) {
      await openFromNotification({ link: location.href });
    }
  }

  bindEvents();

  function dismissTransientMenus() {
    let dismissed = false;
    const activeMenu = Array.from(document.querySelectorAll('.msg-floating-menu') || [])
      .find((node) => !node.classList?.contains?.('is-leaving'));
    if (activeMenu) {
      closeFloatingMenus();
      dismissed = true;
    }
    const pop = document.getElementById('msg-profile-popover');
    if (pop && !pop.hidden) {
      closeProfilePopover();
      dismissed = true;
    }
    const emojiPop = document.getElementById('msg-emoji-popover');
    if (emojiPop && !emojiPop.hidden) {
      emojiPop.hidden = true;
      dismissed = true;
    }
    if (state.showPinnedList) {
      state.showPinnedList = false;
      renderPinnedBanner();
      dismissed = true;
    }
    return dismissed;
  }

  function handleBackNavigation() {
    if (state.showThreadInfo) {
      if (state.threadInfoView !== 'root') {
        state.threadInfoView = 'root';
      } else {
        state.showThreadInfo = false;
        state.threadInfoView = 'root';
      }
      renderThreadInfoDrawer();
      return true;
    }
    if (state.showThreadSearch) {
      state.showThreadSearch = false;
      state.threadSearchQuery = '';
      state.threadSearchMatches = [];
      const bar = document.getElementById('msg-thread-search-bar');
      if (bar) bar.hidden = true;
      renderMessagesList();
      return true;
    }
    if (state.mobileShowThread) {
      closeFloatingMenus();
      state.mobileShowThread = false;
      syncMobilePaneState();
      return true;
    }
    if (state.searchActive) {
      clearSidebarSearch();
      return true;
    }
    if (state.tab !== 'chats') {
      switchTab('chats');
      return true;
    }
    return false;
  }

  window.IponMessages = {
    init,
    openWorkspace,
    openFromNotification,
    openProfilePopover,
    dismissTransientMenus,
    handleBackNavigation,
    formatBytes,
    detectAttachmentKind
  };
})();
