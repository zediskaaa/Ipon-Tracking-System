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
  const DOUBLE_TAP_WINDOW_MS = 320;
  const DOUBLE_HOLD_TEXT_WINDOW_MS = 3500;
  const DEFAULT_DOUBLE_TAP_EMOJI = '❤️';
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
  let typingChannelSubscribed = false;
  let myTrackedConvoId = null;
  let typingIdleTimer = null;
  let lastSeenTimer = null;
  let vanishUiTimer = null;
  const vanishRingObserver = typeof ResizeObserver === 'function'
    ? new ResizeObserver((entries) => entries.forEach(({ target }) => positionVanishRing(target)))
    : null;
  let searchDebounce = null;
  let threadSearchDebounce = null;
  let openingChatTargetId = null;
  let pendingMsgSeq = 0;
  const sendTailByConv = new Map();
  let activeVideoMenuPlayer = null;
  let activeFloatingMenuAnchor = null;
  let activeMutualAnchor = null;
  let mutualHoverTimer = null;
  let profileHoverTimer = null;
  let profileLeaveTimer = null;
  let profileEffectStage = null;
  const mutualFriendsCache = new Map();
  const liveLastSeenMap = new Map();
  const profileAppearanceCache = new Map();
  let suppressBubbleClickId = null;
  let recentHoldMsgId = null;
  let recentHoldAt = 0;
  let lastBubbleTap = null;
  let lastTextHold = null;
  let unlockedSelectBubble = null;
  let suppressOutsideMenuClickUntil = 0;
  let isWindowFocused = typeof document !== 'undefined' && typeof document.hasFocus === 'function'
    ? Boolean(document.hasFocus())
    : true;

  const NEW_CHAT_ICON_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';
  const NEW_GROUP_ICON_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6"/><path d="M22 11h-6"/></svg>';
  const BACK_ARROW_ICON_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 12H5"/><path d="m12 19-7-7 7-7"/></svg>';
  const CAMERA_ICON_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>';

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
    loadingOlder: false,
    olderLoadError: '',
    olderAutoArmed: false,
    threadError: '',
    mobileShowThread: false,
    showThreadInfo: false,
    savingProtection: false,
    checkingProtection: false,
    savingVanish: false,
    vanishError: '',
    vanishDraftSeconds: 300,
    vanishDraftCustom: false,
    vanishCustomValue: '',
    vanishCustomUnit: 'seconds',
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
    signedUrlExpiry: new Map(), // path -> expiresAtMs
    loadedMediaUrls: new Set(), // decoded image URLs
    threadStickyBottom: true,
    lastScrollWrapHeight: 0,
    typingPeers: new Map(), // convId -> { timer, at }
    convoPresencePeers: new Map(), // convId -> Set<userId>
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
    activePinnedId: null,
    groupEditAvatarDataUrl: null,
    groupEditAvatarClear: false,
    groupEditAvatarConvId: null,
    unreadAnchorConvId: null,
    unreadAnchorFirstId: null
  };

  function ipon() { return window.Ipon; }
  function escapeHtml(v) { return ipon().escapeHtml(v); }
  function escAttr(v) { return escapeHtml(String(v ?? '')).replace(/`/g, '&#96;'); }
  function isEligible() {
    const p = initializedProfile || ipon()?.profile;
    return Boolean(p && p.role && p.role !== 'SUPER_ADMIN' && p.status === 'ACTIVE');
  }

  const VANISH_PRESETS = [10, 30, 60, 300, 900, 1800, 3600];
  const VANISH_HINT_TEXT = '1–3600 seconds or 1–60 minutes';

  function formatVanishDuration(seconds) {
    const value = Number(seconds) || 0;
    if (!value) return 'Off';
    if (value < 60) return `${value} ${value === 1 ? 'second' : 'seconds'}`;
    if (value % 60 === 0) return `${value / 60} ${value === 60 ? 'minute' : 'minutes'}`;
    return `${Math.floor(value / 60)}m ${value % 60}s`;
  }

  function formatVanishShort(seconds) {
    const value = Number(seconds) || 0;
    if (!value) return 'Off';
    if (value === 3600) return '60 min';
    if (value >= 60 && value % 60 === 0) return `${value / 60} min`;
    if (value < 60) return `${value} sec`;
    return `${Math.floor(value / 60)}m ${value % 60}s`;
  }

  function vanishBubbleStyle(message, now = Date.now()) {
    const expiresAt = Date.parse(message?.vanish_at || '');
    const duration = Number(message?.vanish_after_seconds) * 1000;
    if (!Number.isFinite(expiresAt) || !duration || expiresAt <= now) return '';
    const remaining = expiresAt - now;
    const angle = Math.min(360, Math.max(0, remaining / duration * 360));
    const dashStart = Math.min(100, Math.max(0, (1 - (remaining / duration)) * 100));
    return `--vanish-angle:${angle.toFixed(2)}deg;--vanish-remaining:${Math.ceil(remaining)}ms;--vanish-dash-start:${dashStart.toFixed(2)}`;
  }

  function buildVanishRectPath(width, height, { mine = false, rTL = 16, rTR = 16, rBR = 16, rBL = 16, inset = 1.25 } = {}) {
    const w = Math.max(8, Number(width) || 0);
    const h = Math.max(8, Number(height) || 0);
    const p = Math.min(inset, w / 4, h / 4);
    const maxR = Math.min((w - p * 2) / 2, (h - p * 2) / 2);
    const tl = Math.max(0, Math.min(maxR, Number(rTL) || 0));
    const tr = Math.max(0, Math.min(maxR, Number(rTR) || 0));
    const br = Math.max(0, Math.min(maxR, Number(rBR) || 0));
    const bl = Math.max(0, Math.min(maxR, Number(rBL) || 0));
    const x0 = p;
    const y0 = p;
    const x1 = w - p;
    const y1 = h - p;
    const f = (n) => Number(n.toFixed(2));
    if (mine) {
      return `M ${f(x1 - br)} ${f(y1)} L ${f(x0 + bl)} ${f(y1)} A ${f(bl)} ${f(bl)} 0 0 1 ${f(x0)} ${f(y1 - bl)} L ${f(x0)} ${f(y0 + tl)} A ${f(tl)} ${f(tl)} 0 0 1 ${f(x0 + tl)} ${f(y0)} L ${f(x1 - tr)} ${f(y0)} A ${f(tr)} ${f(tr)} 0 0 1 ${f(x1)} ${f(y0 + tr)} L ${f(x1)} ${f(y1 - br)} A ${f(br)} ${f(br)} 0 0 1 ${f(x1 - br)} ${f(y1)} Z`;
    }
    return `M ${f(x0)} ${f(y1 - bl)} L ${f(x0)} ${f(y0 + tl)} A ${f(tl)} ${f(tl)} 0 0 1 ${f(x0 + tl)} ${f(y0)} L ${f(x1 - tr)} ${f(y0)} A ${f(tr)} ${f(tr)} 0 0 1 ${f(x1)} ${f(y0 + tr)} L ${f(x1)} ${f(y1 - br)} A ${f(br)} ${f(br)} 0 0 1 ${f(x1 - br)} ${f(y1)} L ${f(x0 + bl)} ${f(y1)} A ${f(bl)} ${f(bl)} 0 0 1 ${f(x0)} ${f(y1 - bl)} Z`;
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

  function isGroupConv(conv) {
    return Boolean(conv && String(conv.kind || '').toUpperCase() === 'GROUP');
  }

  function isSelfUser(userOrConv) {
    const myId = String(initializedProfile?.id || '');
    if (!myId || !userOrConv) return false;
    if (typeof userOrConv === 'string') return String(userOrConv) === myId;
    if (isGroupConv(userOrConv)) return false;
    const peerId = String(userOrConv.peer?.id || userOrConv.id || '');
    return Boolean(peerId && peerId === myId);
  }

  function isBlockedThread(conv) {
    if (!conv || isGroupConv(conv) || isSelfUser(conv)) return false;
    const fs = String(conv.friendship_status || '').toUpperCase();
    return Boolean(conv.is_blocked || fs === 'BLOCKED_BY_ME' || fs === 'BLOCKED_ME');
  }

  function isFriendsOnlyLocked(conv) {
    if (!conv || isGroupConv(conv) || isSelfUser(conv) || isBlockedThread(conv)) return false;
    return conv.friends_only_locked === true || conv.can_message === false;
  }

  function canInteractInThread(conv) {
    return Boolean(conv && (isGroupConv(conv) || (!isBlockedThread(conv) && !isFriendsOnlyLocked(conv))));
  }

  function peerFirstName(conv) {
    const raw = String(conv?.full_name || conv?.peer?.full_name || '').trim();
    const first = raw.split(/\s+/).filter(Boolean)[0] || '';
    return first || 'this user';
  }

  function renderFriendsOnlyBannerHtml(conv) {
    const first = peerFirstName(conv);
    const status = String(conv?.friendship_status || 'NONE').toUpperCase();
    const canSendReq = conv?.can_send_friend_request !== false;
    const reqId = conv?.friend_request_id || '';
    let sub = `${first} only accepts messages and files from friends.`;
    let actionHtml = '';
    if (status === 'INCOMING_REQUEST' && reqId) {
      sub = `${first} sent you a friend request. Accept to start messaging.`;
      actionHtml = `<button type="button" class="button button-primary button-sm msg-friends-only-action" data-req-decision="ACCEPT" data-req-id="${escAttr(reqId)}">Accept</button>`;
    } else if (status === 'OUTGOING_REQUEST') {
      sub = `Friend request sent. Messaging unlocks once ${first} accepts.`;
      actionHtml = '<span class="msg-friends-only-pill">Request sent</span>';
    } else if (status === 'NONE' && canSendReq && conv?.id) {
      sub = `Add ${first} as a friend to send messages or files.`;
      actionHtml = `<button type="button" class="button button-primary button-sm msg-friends-only-action" data-social-action="add_friend" data-target-id="${escAttr(conv.id)}">Add friend</button>`;
    }
    return `<div class="msg-friends-only-lead">
      <span class="msg-friends-only-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><rect x="4.5" y="11" width="15" height="9.5" rx="2.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg></span>
      <div class="msg-friends-only-copy">
        <strong>Friends only</strong>
        <span>${escapeHtml(sub)}</span>
      </div>
    </div>${actionHtml}`;
  }

  function convDisplayTitle(conv) {
    if (!conv) return 'Conversation';
    if (conv.anonymous_enabled && !isGroupConv(conv)) return 'Anonymous';
    if (isGroupConv(conv)) return String(conv.title || conv.full_name || 'Group Chat');
    return String(conv.peer?.full_name || conv.full_name || 'User');
  }

  function groupSenderRoleBadgeHtml(appRole, chatRole) {
    const sys = String(appRole || '').toUpperCase();
    const grp = String(chatRole || '').toUpperCase();
    if (sys === 'ADMIN' || grp === 'ADMIN') {
      return '<span class="msg-sender-role is-admin">Admin</span>';
    }
    if (sys === 'TREASURER') {
      return '<span class="msg-sender-role is-treasurer">Treasurer</span>';
    }
    return '';
  }

  function userBadgesHtml(userOrId) {
    if (!userOrId || (typeof userOrId === 'object' && userOrId.profile_visible === false)) return '';
    return typeof ipon === 'function' && typeof ipon().verifiedBadgesHtml === 'function'
      ? ipon().verifiedBadgesHtml(userOrId)
      : '';
  }

  function findGroupMember(conv, userId) {
    if (!conv || !userId) return null;
    const target = String(userId);
    const pool = [...(conv.members || []), ...(conv.members_preview || [])];
    return pool.find((m) => String(m?.id || '') === target) || null;
  }

  function getTypingEntries(convId) {
    const bucket = convId ? state.typingPeers.get(convId) : null;
    if (!bucket) return [];
    if (bucket instanceof Map) return [...bucket.values()].filter(Boolean);
    return bucket.at ? [bucket] : [];
  }

  function isConvTyping(convId) {
    return getTypingEntries(convId).length > 0;
  }

  function recordLastSeen(userId, ts) {
    const key = String(userId || '').trim();
    if (!key || !ts) return;
    const ms = Date.parse(ts);
    if (!Number.isFinite(ms)) return;
    const prevMs = Date.parse(liveLastSeenMap.get(key) || '') || 0;
    if (ms > prevMs) liveLastSeenMap.set(key, new Date(ms).toISOString());
  }

  function formatLastSeenTime(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return '';
    const timeStr = formatClock(d);
    if (!timeStr) return '';
    const now = new Date();
    if (d.toDateString() === now.toDateString()) {
      return `Offline since ${timeStr}`;
    }
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const datePart = d.getFullYear() === now.getFullYear() ? `${mm}/${dd}` : `${mm}/${dd}/${d.getFullYear()}`;
    return `Offline since ${datePart} · ${timeStr}`;
  }

  function formatFriendCountText(rawCount) {
    const count = Math.max(0, Math.floor(Number(rawCount || 0)));
    return count > 0 ? `${count} friend${count === 1 ? '' : 's'}` : '';
  }

  function personIsOnline(user) {
    return isSelfUser(user) || user?.is_self === true || (user?.allow_online_status !== false && ipon().isUserOnline(user?.id));
  }

  function visibleLastSeenAt(user) {
    if (!user?.last_seen_at || user.allow_online_status === false) return '';
    const liveTs = liveLastSeenMap.get(String(user.id || ''));
    return (Date.parse(liveTs || '') || 0) > (Date.parse(user.last_seen_at) || 0) ? liveTs : user.last_seen_at;
  }

  function sortPeopleByPresence(people) {
    return [...people].sort((a, b) => {
      const aOnline = personIsOnline(a);
      const bOnline = personIsOnline(b);
      if (aOnline !== bOnline) return aOnline ? -1 : 1;
      if (aOnline) {
        const aSelf = isSelfUser(a) || a?.is_self === true;
        const bSelf = isSelfUser(b) || b?.is_self === true;
        if (aSelf !== bSelf) return aSelf ? -1 : 1;
      } else {
        const byLastSeen = (Date.parse(visibleLastSeenAt(b)) || 0) - (Date.parse(visibleLastSeenAt(a)) || 0);
        if (byLastSeen) return byLastSeen;
      }
      return String(a?.full_name || '').localeCompare(String(b?.full_name || ''));
    });
  }

  function formatStatusLine(user, isTyping = false) {
    const typingList = Array.isArray(isTyping) ? isTyping : [];
    const typingOn = Array.isArray(isTyping) ? typingList.length > 0 : Boolean(isTyping);
    if (typingOn) {
      if (user?.anonymous_enabled) return 'Typing...';
      if (isGroupConv(user) && typingList.length === 1 && typingList[0]?.name) {
        const first = String(typingList[0].name).trim().split(/\s+/)[0] || 'Someone';
        return `${first} is typing…`;
      }
      if (isGroupConv(user) && typingList.length > 1) {
        return `${typingList.length} people are typing…`;
      }
      return 'Typing…';
    }
    if (!user) return '';
    if (isGroupConv(user)) {
      const members = Array.isArray(user.members) && user.members.length ? user.members : (user.members_preview || []);
      const count = Math.max(Number(user.member_count || 0), Array.isArray(user.members) ? user.members.length : 0);
      const myId = String(initializedProfile?.id || '');
      const onlineOthers = members.filter((m) => m && String(m.id || '') !== myId && m.allow_online_status !== false && ipon().isUserOnline(m.id)).length;
      const base = `${count || 2} ${count === 1 ? 'member' : 'members'}`;
      return onlineOthers > 0 ? `${base} · ${onlineOthers} active now` : base;
    }
    if (user.is_blocked || user.friendship_status === 'BLOCKED_BY_ME' || user.friendship_status === 'BLOCKED_ME') {
      return 'Messaging restricted';
    }
    if (isSelfUser(user)) return '';
    if (!user.allow_online_status) return 'Privacy mode';
    if (ipon().isUserOnline(user.id)) return user.profile_visible === false ? 'Active now' : '';
    const lastSeenAt = visibleLastSeenAt(user);
    if (lastSeenAt) {
      return formatLastSeenTime(lastSeenAt) || 'Offline';
    }
    return 'Offline';
  }

  function findKnownPeer(conversationId, userId = null) {
    if (conversationId) {
      const conv = state.conversations.find((c) => c.id === conversationId);
      if (conv && isGroupConv(conv)) {
        return {
          id: conv.id,
          conversation_id: conv.id,
          kind: 'GROUP',
          title: conv.title,
          full_name: conv.title || 'Group Chat',
          description: conv.description || '',
          avatar_url: conv.avatar_url || null,
          member_count: conv.member_count || 2,
          members_preview: conv.members_preview || [],
          chat_theme: conv.chat_theme || 'paper',
          anonymous_enabled: Boolean(conv.anonymous_enabled)
        };
      }
      if (conv?.peer) return { ...conv.peer, chat_theme: conv.chat_theme || 'paper', anonymous_enabled: Boolean(conv.anonymous_enabled) };
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

  function safeDpUrl(raw) {
    const s = typeof raw === 'string' ? raw.trim() : '';
    return (s.startsWith('data:image/') || /^https:\/\//i.test(s)) ? s : '';
  }

  function dpPreviewTriggerHtml(dpUrl, displayName, innerHtml, extraClass = '') {
    const safeSrc = safeDpUrl(dpUrl);
    if (!safeSrc) return innerHtml;
    const label = String(displayName || 'Display picture').trim();
    const cls = ['msg-dp-preview-trigger', extraClass].filter(Boolean).join(' ');
    return `<button type="button" class="${cls}" data-view-dp-src="${escAttr(safeSrc)}" data-view-dp-name="${escAttr(label)}" aria-label="View photo for ${escAttr(label)}" title="View photo">${innerHtml}</button>`;
  }

  function openDpViewer(src, alt = 'Display picture') {
    const raw = String(src || '').trim();
    const isSafeUrl = raw.startsWith('data:image/') || raw.startsWith('blob:') || /^https?:\/\//i.test(raw);
    if (!raw || !isSafeUrl) return;
    let dialog = document.getElementById('ipon-dp-viewer');
    if (!dialog) {
      dialog = document.createElement('dialog');
      dialog.id = 'ipon-dp-viewer';
      dialog.className = 'dp-viewer-dialog';
      dialog.setAttribute('aria-label', 'Display picture preview');
      dialog.innerHTML = '<img id="ipon-dp-img" alt="">';
      document.body.appendChild(dialog);
      dialog.addEventListener('click', (event) => {
        event.stopPropagation();
        if (event.target?.id !== 'ipon-dp-img') dialog.close();
      });
    }
    const img = dialog.querySelector('#ipon-dp-img');
    const fitImg = () => {
      const nw = Number(img.naturalWidth) || 0;
      const nh = Number(img.naturalHeight) || 0;
      if (!nw || !nh) return;
      const maxW = Math.min(Math.max(240, (window.innerWidth || 0) - 16), 720);
      const maxH = Math.max(240, (window.innerHeight || 0) * 0.86);
      const ratio = Math.min(maxW / nw, maxH / nh);
      img.style.width = `${Math.round(nw * ratio)}px`;
      img.style.height = `${Math.round(nh * ratio)}px`;
    };
    img.style.width = '';
    img.style.height = '';
    img.onload = fitImg;
    img.src = raw;
    img.alt = String(alt || 'Display picture');
    if (!dialog.open) dialog.showModal();
    if (img.complete && img.naturalWidth) fitImg();
  }

  function userAvatarHtml(user, sizeClass = 'avatar-md', { clickable = true, showPresence = true } = {}) {
    if (!user) return '';
    if (user.anonymous_enabled) return `<span class="avatar-presence-wrap msg-avatar-wrap"><img class="avatar-circle ${escapeHtml(sizeClass)}" src="assets/anonymous-avatar.svg" alt="Anonymous profile"></span>`;
    const safeUrl = user.profile_visible === false ? '' : safeDpUrl(user.avatar_url);
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
    const wrapCls = cls ? `${cls}-wrap` : '';
    const wrap = `<span class="avatar-presence-wrap msg-avatar-wrap${wrapCls ? ` ${wrapCls}` : ''}">${inner}${dot}</span>`;
    if (!clickable || !user.id || String(user.id) === String(initializedProfile?.id)) return wrap;
    return `<button type="button" class="msg-dp-btn" data-social-user-dp="${escapeHtml(user.id)}" aria-label="View profile options for ${escapeHtml(name)}" title="Profile & options">${wrap}</button>`;
  }

  function groupAvatarHtml(conv, sizeClass = 'avatar-md', { clickable = false, showPresence = true } = {}) {
    if (!conv) return '';
    if (conv.anonymous_enabled) return userAvatarHtml({ anonymous_enabled: true }, sizeClass);
    const title = convDisplayTitle(conv);
    const cls = escapeHtml(sizeClass);
    const safeUrl = safeDpUrl(conv.avatar_url);
    const myId = String(initializedProfile?.id || '');
    const pool = (Array.isArray(conv.members_preview) && conv.members_preview.length
      ? conv.members_preview
      : (Array.isArray(conv.members) ? conv.members : [])
    ).filter((m) => m && String(m.id || '') !== myId);
    const activeOnline = showPresence && pool.some((m) => m.profile_visible !== false && m.allow_online_status !== false && ipon().isUserOnline(m.id));
    const dot = showPresence
      ? `<span class="presence-dot${activeOnline ? ' is-online' : ''}" aria-label="${activeOnline ? 'Members online' : 'Offline'}" title="${activeOnline ? 'Members active now' : 'No other members online'}"></span>`
      : '';

    let coreHtml = '';
    if (safeUrl) {
      const letters = escapeHtml(ipon().initials(title));
      coreHtml = `<span class="avatar-circle ${cls}" title="${escapeHtml(title)}"><img src="${safeUrl}" alt="${escapeHtml(title)}" data-avatar-img><span class="avatar-fallback-inner" hidden>${letters}</span></span>`;
    } else if (pool.length >= 2) {
      const renderMini = (m, slotCls) => {
        const mSafe = m?.profile_visible === false ? '' : safeDpUrl(m?.avatar_url);
        const mName = String(m?.full_name || 'Member');
        const mLetters = escapeHtml(ipon().initials(mName));
        return mSafe
          ? `<span class="msg-group-av-tile ${slotCls}"><img src="${mSafe}" alt="${escapeHtml(mName)}" data-avatar-img><span class="avatar-fallback-inner" hidden>${mLetters}</span></span>`
          : `<span class="msg-group-av-tile ${slotCls} is-fallback">${mLetters}</span>`;
      };
      coreHtml = `<span class="msg-group-avatar ${cls}" title="${escapeHtml(title)}">${renderMini(pool[1], 'is-back')}${renderMini(pool[0], 'is-front')}</span>`;
    } else if (pool.length === 1) {
      const m = pool[0];
      const mSafe = m?.profile_visible === false ? '' : safeDpUrl(m?.avatar_url);
      const mName = String(m?.full_name || 'Member');
      const mLetters = escapeHtml(ipon().initials(mName));
      const gLetters = escapeHtml(ipon().initials(title));
      const gTile = `<span class="msg-group-av-tile is-back is-group-badge">${gLetters}</span>`;
      const mTile = mSafe
        ? `<span class="msg-group-av-tile is-front"><img src="${mSafe}" alt="${escapeHtml(mName)}" data-avatar-img><span class="avatar-fallback-inner" hidden>${mLetters}</span></span>`
        : `<span class="msg-group-av-tile is-front is-fallback">${mLetters}</span>`;
      coreHtml = `<span class="msg-group-avatar ${cls}" title="${escapeHtml(title)}">${gTile}${mTile}</span>`;
    } else {
      coreHtml = `<span class="avatar-circle avatar-fallback msg-group-monogram ${cls}" title="${escapeHtml(title)}">${escapeHtml(ipon().initials(title))}</span>`;
    }

    const wrap = `<span class="avatar-presence-wrap msg-avatar-wrap msg-group-avatar-wrap">${coreHtml}${dot}</span>`;
    if (!clickable) return wrap;
    return `<button type="button" class="msg-dp-btn" data-open-group-info aria-label="View group chat info for ${escapeHtml(title)}" title="Group info & members">${wrap}</button>`;
  }

  function convAvatarHtml(conv, sizeClass = 'avatar-md', opts = {}) {
    if (!conv) return '';
    if (isGroupConv(conv)) return groupAvatarHtml(conv, sizeClass, opts);
    return userAvatarHtml(conv.anonymous_enabled ? { ...(conv.peer || conv), anonymous_enabled: true } : (conv.peer || conv), sizeClass, opts);
  }

  function groupPicPreviewMarkup({ conv = null, dataUrl = null, clear = false, title = '', sizeClass = 'avatar-lg' } = {}) {
    const label = String(title || convDisplayTitle(conv) || 'Group Chat').trim();
    const safeDraft = !clear && typeof dataUrl === 'string' && dataUrl.startsWith('data:image/') ? dataUrl : '';
    if (safeDraft) {
      return `<span class="avatar-circle ${escapeHtml(sizeClass)}" title="${escapeHtml(label)}"><img src="${safeDraft}" alt="${escapeHtml(label)}" data-avatar-img><span class="avatar-fallback-inner" hidden>${escapeHtml(ipon().initials(label))}</span></span>`;
    }
    if (conv) {
      const targetConv = clear ? { ...conv, avatar_url: null } : conv;
      return groupAvatarHtml(targetConv, sizeClass, { showPresence: false });
    }
    const cleanInitials = label ? escapeHtml(ipon().initials(label)) : '';
    return `<span class="avatar-circle ${escapeHtml(sizeClass)} msg-group-pic-placeholder" title="${escapeHtml(label || 'Group photo')}">${cleanInitials || CAMERA_ICON_SVG}</span>`;
  }

  async function prepareGroupPicDataUrl(file) {
    if (!file) return null;
    const prep = ipon()?.prepareAvatarDataUrl;
    if (typeof prep !== 'function') throw new Error('Image processor is unavailable.');
    const prepared = await prep(file);
    const dataUrl = prepared?.dataUrl || (typeof prepared === 'string' ? prepared : '');
    if (!dataUrl || !dataUrl.startsWith('data:image/')) {
      throw new Error('Please choose a valid picture file.');
    }
    return dataUrl;
  }

  async function uploadGroupPicIfNeeded(dataUrl) {
    if (!dataUrl) return null;
    const uploader = ipon()?.uploadMediaDataUrl;
    if (typeof uploader !== 'function') return dataUrl;
    return await uploader(dataUrl, { category: 'group-avatars', name: 'group-avatar.jpg' });
  }

  function syncGroupEditAvatarUi() {
    const conv = state.activeThread?.conversation;
    if (!conv || !isGroupConv(conv)) return;
    const titleVal = document.getElementById('msg-group-edit-title')?.value || conv.title || '';
    const hasDraft = Boolean(state.groupEditAvatarDataUrl);
    const hasEffectivePic = hasDraft || (!state.groupEditAvatarClear && Boolean(conv.avatar_url));
    const drawerPreview = document.getElementById('msg-group-drawer-avatar-slot');
    if (drawerPreview) {
      drawerPreview.innerHTML = groupPicPreviewMarkup({
        conv,
        dataUrl: state.groupEditAvatarDataUrl,
        clear: state.groupEditAvatarClear,
        title: titleVal,
        sizeClass: 'avatar-lg'
      });
      ipon().bindAvatarFallbacks?.(drawerPreview);
    }
    const formPreview = document.getElementById('msg-group-edit-pic-preview');
    if (formPreview) {
      formPreview.innerHTML = groupPicPreviewMarkup({
        conv,
        dataUrl: state.groupEditAvatarDataUrl,
        clear: state.groupEditAvatarClear,
        title: titleVal,
        sizeClass: 'avatar-md'
      });
      ipon().bindAvatarFallbacks?.(formPreview);
    }
    const pickBtn = document.getElementById('msg-group-edit-pic-btn');
    if (pickBtn) pickBtn.textContent = hasEffectivePic ? 'Change photo' : 'Upload photo';
    const removeBtn = document.getElementById('msg-group-edit-pic-remove');
    if (removeBtn) removeBtn.hidden = !hasEffectivePic;
    syncGroupEditDirtyState();
  }

  function syncGroupEditDirtyState() {
    const conv = state.activeThread?.conversation;
    const saveBtn = document.getElementById('msg-group-edit-save');
    if (!conv || !isGroupConv(conv) || !saveBtn) return;
    const titleVal = String(document.getElementById('msg-group-edit-title')?.value ?? conv.title ?? '').trim().replace(/\s+/g, ' ');
    const descVal = String(document.getElementById('msg-group-edit-desc')?.value ?? conv.description ?? '').trim();
    const origTitle = String(conv.title || '').trim().replace(/\s+/g, ' ');
    const origDesc = String(conv.description || '').trim();
    const dirty = titleVal !== origTitle
      || descVal !== origDesc
      || Boolean(state.groupEditAvatarDataUrl)
      || Boolean(state.groupEditAvatarClear && conv.avatar_url);
    if (saveBtn.dataset) {
      if (dirty) delete saveBtn.dataset.dirtyLocked;
      else saveBtn.dataset.dirtyLocked = 'true';
    }
    if (!saveBtn.classList?.contains?.('is-busy')) saveBtn.disabled = !dirty;
    saveBtn.title = dirty ? '' : 'Make a change before saving.';
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
    if (type.startsWith('audio/') || /^voice-note-/i.test(name)) return 'audio';
    if (type.startsWith('video/')) return 'video';
    if (IMAGE_EXT_RE.test(name)) return 'image';
    if (/\.(mp3|wav|ogg|m4a|aac|opus)$/i.test(name)) return 'audio';
    if (/\.(mp4|mov|webm)$/i.test(name)) return 'video';
    if (DOC_EXT_RE.test(name) || /pdf|word|excel|spreadsheet|powerpoint|presentation|text|csv/i.test(type)) return 'document';
    return 'file';
  }

  function isVoiceAttachment(att, msg = null) {
    const kind = String(att?.kind || '').toLowerCase();
    const type = String(att?.type || '').toLowerCase();
    const name = String(att?.name || '').toLowerCase();
    return kind === 'audio'
      || String(msg?.message_type || '').toUpperCase() === 'VOICE'
      || /^voice-note-/i.test(name)
      || type.startsWith('audio/')
      || /\.(mp3|wav|ogg|m4a|aac|opus)$/i.test(name)
      || (Number(att?.duration_seconds) > 0 && kind !== 'video');
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
              <button class="msg-icon-btn" id="msg-privacy-btn" type="button" aria-label="Messaging & privacy settings" title="Messaging privacy & blocked users">
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
                      <input id="msg-list-search" type="search" placeholder="Search chats or people…" aria-label="Search chats, people, or messages" autocomplete="off">
                      <button type="button" class="msg-search-clear" id="msg-list-search-clear" aria-label="Clear search" title="Clear search" hidden>
                        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>
                      </button>
                    </div>
                    <button type="button" class="msg-new-chat-btn" id="msg-new-chat-btn" data-mode="compose" aria-label="Browse people directory" aria-pressed="false" title="New chat / Browse people">
                      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
                    </button>
                    <button type="button" class="msg-new-chat-btn msg-new-group-btn" id="msg-new-group-btn" aria-label="Create group chat" title="New group chat">
                      ${NEW_GROUP_ICON_SVG}
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
                  <p>Pick an existing chat on the left, create a group chat, or use the search bar to find people.</p>
                  <div class="msg-empty-cta-row">
                    <button type="button" class="button button-primary button-sm" id="msg-empty-find-btn">Browse people &amp; start chat</button>
                    <button type="button" class="button button-secondary button-sm" id="msg-empty-group-btn">Create group chat</button>
                  </div>
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
                          <span class="msg-load-older-status" id="msg-load-older-status" role="status" aria-live="polite" hidden>
                            <span class="msg-load-older-spinner" aria-hidden="true"></span>
                            <span>Loading older messages…</span>
                          </span>
                          <button type="button" class="button button-secondary button-sm" id="msg-load-older-btn" hidden>Retry loading older messages</button>
                        </div>
                        <div class="msg-messages-list" id="msg-messages-list" role="log" aria-live="polite"></div>
                        <div class="msg-typing-live" id="msg-typing-live" aria-hidden="true" aria-live="polite">
                          <div class="msg-typing-live-inner">
                            <div class="msg-typing-avatar" id="msg-typing-avatar"></div>
                            <div class="msg-typing-bubble">
                              <span class="msg-typing-sender" id="msg-typing-sender" hidden></span>
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
                      <div class="msg-attach-menu" id="msg-attach-menu" role="menu" aria-label="Choose attachment source" hidden>
                        <button type="button" class="msg-attach-option" role="menuitem" data-attach-source="gallery">
                          <span class="msg-attach-option-icon is-gallery" aria-hidden="true"><svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="m21 15-4.5-4.5a1.5 1.5 0 0 0-2.1 0L7 18"/></svg></span>
                          <span class="msg-attach-option-copy"><strong>Phone Gallery</strong><small>Photos &amp; videos from camera roll</small></span>
                        </button>
                        <button type="button" class="msg-attach-option" role="menuitem" data-attach-source="files">
                          <span class="msg-attach-option-icon is-files" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M3 6a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/></svg></span>
                          <span class="msg-attach-option-copy"><strong>File Manager</strong><small>Documents, audio &amp; device storage</small></span>
                        </button>
                        <button type="button" class="msg-attach-option" role="menuitem" data-attach-source="gdrive">
                          <span class="msg-attach-option-icon is-gdrive" aria-hidden="true"><svg viewBox="0 0 24 24"><polygon fill="#0F9D58" stroke="none" points="9 4 12 9.2 6 19.6 3 14.4"/><polygon fill="#FFCD40" stroke="none" points="9 4 15 4 21 14.4 15 14.4"/><polygon fill="#4285F4" stroke="none" points="9 14.4 21 14.4 18 19.6 6 19.6"/></svg></span>
                          <span class="msg-attach-option-copy"><strong>Google Drive</strong><small>Open Google Drive files or folders</small></span>
                        </button>
                      </div>
                      <div class="msg-emoji-popover" id="msg-emoji-popover" hidden></div>
                      <form class="msg-composer-form" id="msg-composer-form">
                        <input id="msg-file-input" type="file" multiple accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.rtf,.odt,.ods,.odp,.md,.zip" hidden>
                        <input id="msg-gallery-input" type="file" multiple accept="image/*,video/*" hidden>
                        <input id="msg-drive-input" type="file" multiple accept="*/*" hidden>
                        <div class="msg-composer-tools">
                          <button type="button" class="msg-tool-btn" id="msg-attach-btn" aria-expanded="false" aria-controls="msg-attach-menu" aria-label="Attach files or media" title="Attach from Gallery, File Manager, or Google Drive">
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

      <!-- Mutual Friends Avatar Stack Popover -->
      <div class="msg-mutual-popover" id="msg-mutual-popover" role="dialog" aria-modal="false" aria-label="Mutual friends" hidden></div>

      <!-- Privacy, Handle & Blocked Users Dialog -->
      <dialog class="form-dialog msg-sub-dialog" id="msg-settings-dialog" aria-labelledby="msg-settings-title">
        <div class="form-dialog-sheet">
          <header class="form-dialog-header">
            <div>
              <h2 id="msg-settings-title">Messaging &amp; Privacy</h2>
              <p>Manage message requests, visibility preferences, and blocked accounts.</p>
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

      <!-- Create Group Chat / Add Members Dialog -->
      <dialog class="form-dialog msg-sub-dialog msg-group-dialog" id="msg-group-dialog" aria-labelledby="msg-group-dialog-title">
        <div class="form-dialog-sheet">
          <header class="form-dialog-header">
            <div>
              <h2 id="msg-group-dialog-title">New Group Chat</h2>
              <p id="msg-group-dialog-sub">Pick friends or connections to start a shared group conversation.</p>
            </div>
            <button class="dialog-close" type="button" data-msg-group-close aria-label="Close group dialog"><svg viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18"/></svg></button>
          </header>
          <div class="msg-group-dialog-body" id="msg-group-body"></div>
        </div>
      </dialog>

      <!-- Google Drive Picker Dialog (web browsers where file input cannot jump straight into Drive) -->
      <dialog class="form-dialog msg-sub-dialog msg-gdrive-dialog" id="msg-gdrive-dialog" aria-labelledby="msg-gdrive-title">
        <div class="form-dialog-sheet">
          <header class="form-dialog-header">
            <div>
              <h2 id="msg-gdrive-title">Google Drive</h2>
              <p>Open your Google Drive files or folders, or browse Drive storage synced on this device.</p>
            </div>
            <button class="dialog-close" type="button" data-msg-gdrive-close aria-label="Close Google Drive dialog"><svg viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18"/></svg></button>
          </header>
          <div class="msg-gdrive-body">
            <div class="msg-gdrive-launch-card">
              <div class="msg-gdrive-launch-meta">
                <span class="msg-attach-option-icon is-gdrive" aria-hidden="true"><svg viewBox="0 0 24 24"><polygon fill="#0F9D58" stroke="none" points="9 4 12 9.2 6 19.6 3 14.4"/><polygon fill="#FFCD40" stroke="none" points="9 4 15 4 21 14.4 15 14.4"/><polygon fill="#4285F4" stroke="none" points="9 14.4 21 14.4 18 19.6 6 19.6"/></svg></span>
                <span><strong>My Drive files &amp; folders</strong><small>Opens drive.google.com directly to your Drive folders so you can pick or download a file.</small></span>
              </div>
              <a class="button button-primary button-sm" id="msg-gdrive-open-web" href="https://drive.google.com/drive/my-drive" target="_blank" rel="noopener noreferrer">Open Google Drive</a>
            </div>
            <div class="msg-gdrive-local-row">
              <span><strong>Synced Drive folder on this device?</strong><small>Browse local files or mounted Drive folders directly.</small></span>
              <button class="button button-secondary button-sm" id="msg-gdrive-browse-local" type="button">Browse device</button>
            </div>
          </div>
        </div>
      </dialog>

      <!-- Vanishing Messages Set-Duration Modal -->
      <dialog class="msg-vanish-modal" id="msg-vanish-dialog" aria-labelledby="msg-vanish-modal-title">
        <div class="msg-vanish-modal-in" id="msg-vanish-modal-body"></div>
      </dialog>
    `);

    document.getElementById('msg-workspace-dialog')?.addEventListener('close', () => {
      sendTypingBroadcast(false);
      clearTimeout(typingIdleTimer);
      typingIdleTimer = null;
      state.typingPeers.forEach((bucket) => {
        if (bucket instanceof Map) {
          bucket.forEach((entry) => { if (entry?.timer) clearTimeout(entry.timer); });
          bucket.clear();
        } else if (bucket?.timer) {
          clearTimeout(bucket.timer);
        }
      });
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
      syncNativeScreenshotLock(null);
    });
    const scrollWrapEl = document.getElementById('msg-scroll-wrap');
    scrollWrapEl?.addEventListener('scroll', handleThreadScroll, { passive: true });
    document.getElementById('msg-conv-list')?.addEventListener('scroll', closeFloatingMenus, { passive: true });
    scrollWrapEl?.addEventListener('load', () => syncThreadScrollLock(), true);
  }

  function isPeerInActiveConvo(conv) {
    if (!conv?.conversation_id || isSelfUser(conv)) return false;
    if (!isGroupConv(conv) && conv.allow_online_status === false) return false;
    const peers = state.convoPresencePeers.get(conv.conversation_id);
    if (!(peers instanceof Set) || !peers.size) return false;
    return isGroupConv(conv) ? peers.size > 0 : peers.has(String(conv.id || ''));
  }

  function syncActiveThreadPresenceUi(conv = state.activeThread?.conversation) {
    const dialog = document.getElementById('msg-workspace-dialog');
    if (dialog) ipon().syncPresenceDots?.(dialog);
    const activeWrap = document.getElementById('msg-thread-active');
    if (activeWrap && activeWrap !== dialog) ipon().syncPresenceDots?.(activeWrap);
    if (!conv) return;
    const liveStatus = conv.anonymous_enabled ? '' : formatStatusLine(conv);
    const subEl = document.getElementById('msg-peer-status-text');
    if (subEl) {
      subEl.textContent = liveStatus;
      subEl.hidden = !liveStatus;
    }
    const isGrp = isGroupConv(conv);
    let dotOnline = false;
    if (isGrp) {
      const myId = String(initializedProfile?.id || '');
      const pool = (Array.isArray(conv.members_preview) && conv.members_preview.length
        ? conv.members_preview
        : (Array.isArray(conv.members) ? conv.members : [])
      ).filter((m) => m && String(m.id || '') !== myId);
      dotOnline = pool.some((m) => m.profile_visible !== false && m.allow_online_status !== false && ipon().isUserOnline(m.id));
    } else if (!isSelfUser(conv) && conv.profile_visible !== false && conv.allow_online_status !== false && !conv.is_blocked && conv.friendship_status !== 'BLOCKED_BY_ME' && conv.friendship_status !== 'BLOCKED_ME') {
      dotOnline = Boolean(ipon().isUserOnline(conv.id));
    }
    const applyDot = (dot) => {
      if (!dot) return;
      dot.classList.toggle('is-online', dotOnline);
      const label = dotOnline ? (isGrp ? 'Members online' : 'Active now') : 'Offline';
      dot.setAttribute?.('aria-label', label);
      dot.title = label;
    };
    applyDot(document.getElementById('msg-thread-header')?.querySelector?.('.presence-dot'));
    applyDot(document.getElementById('msg-messages-list')?.querySelector?.('.msg-welcome-avatar .presence-dot'));
    const welcomeStatus = document.getElementById('msg-welcome-status-text');
    if (welcomeStatus) {
      const isOn = !isGrp && (isSelfUser(conv) || dotOnline);
      welcomeStatus.classList.toggle('is-online', isOn);
      welcomeStatus.textContent = liveStatus;
      welcomeStatus.hidden = !liveStatus;
      const welcomeMeta = document.getElementById('msg-welcome-meta');
      if (welcomeMeta) {
        welcomeMeta.hidden = !liveStatus && !isGrp;
      }
    }
  }

  function syncThreadPresenceRipple() {
    const conv = state.activeThread?.conversation;
    const active = Boolean(conv && isPeerInActiveConvo(conv));
    const headerAvatar = document.getElementById('msg-thread-header')?.querySelector?.('.msg-avatar-wrap');
    headerAvatar?.classList?.toggle('is-in-convo-ripple', active);
  }

  function isThreadOpenForPresence() {
    const dialog = document.getElementById('msg-workspace-dialog');
    if (!dialog?.open || !state.activeConvId) return false;
    if (typeof document.visibilityState === 'string' && document.visibilityState !== 'visible') return false;
    const blockingOverlayIds = ['msg-settings-dialog', 'msg-forward-dialog', 'msg-group-dialog', 'msg-gdrive-dialog', 'msg-vanish-dialog', 'notification-dialog', 'account-dialog', 'confirm-dialog', 'record-action-dialog', 'notif-unblock-dialog'];
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

  function syncMyThreadPresence() {
    const myId = String(initializedProfile?.id || '');
    const shouldTrack = Boolean(
      myId &&
      typingChannel &&
      typingChannelSubscribed &&
      state.typingChannelConvId &&
      state.typingChannelConvId === state.activeConvId &&
      initializedProfile?.chat_privacy?.show_online !== false &&
      isThreadOpenForPresence()
    );
    if (shouldTrack) {
      if (myTrackedConvoId !== state.typingChannelConvId) {
        myTrackedConvoId = state.typingChannelConvId;
        try { Promise.resolve(typingChannel.track?.({ user_id: myId, in_convo: true })).catch(() => { }); } catch { }
      }
    } else if (myTrackedConvoId) {
      myTrackedConvoId = null;
      try { Promise.resolve(typingChannel?.untrack?.()).catch(() => { }); } catch { }
    }
  }

  function disconnectTypingChannel() {
    const prevConvId = state.typingChannelConvId;
    typingChannelSubscribed = false;
    myTrackedConvoId = null;
    if (typingChannel) {
      try { Promise.resolve(typingChannel.untrack?.()).catch(() => { }); } catch { }
      try { ipon().client?.removeChannel(typingChannel); } catch { }
      typingChannel = null;
      state.typingChannelConvId = null;
    }
    if (prevConvId) state.convoPresencePeers.delete(prevConvId);
    syncThreadPresenceRipple();
  }

  const SIGNED_URL_TTL_MS = 45 * 60 * 1000;
  const missingUrlRetry = new Map(); // path -> { attempts, lastAt }
  const preloadingImageUrls = new Set();
  let missingUrlTimer = null;

  function getCachedSignedUrl(path) {
    const key = String(path || '').trim();
    if (!key) return '';
    const url = state.signedUrlCache.get(key) || '';
    if (!url) return '';
    const exp = state.signedUrlExpiry?.get?.(key);
    if (exp && Date.now() >= exp && !url.startsWith('blob:') && !url.startsWith('data:')) {
      state.signedUrlCache.delete(key);
      state.signedUrlExpiry.delete(key);
      return '';
    }
    return url;
  }

  function preloadSignedImageUrls(urls = []) {
    if (typeof Image !== 'function') return;
    for (const raw of urls) {
      const url = String(raw || '').trim();
      if (!url || state.loadedMediaUrls.has(url) || preloadingImageUrls.has(url)) continue;
      preloadingImageUrls.add(url);
      try {
        const img = new Image();
        img.decoding = 'async';
        img.onload = () => {
          preloadingImageUrls.delete(url);
          state.loadedMediaUrls.add(url);
        };
        img.onerror = () => {
          preloadingImageUrls.delete(url);
        };
        img.src = url;
      } catch {
        preloadingImageUrls.delete(url);
      }
    }
  }

  // Edge Storage helpers with XHR byte progress
  async function ensureSignedViewUrls(conversationId, paths = [], { imagePaths = null } = {}) {
    const normalized = [...new Set(paths.map((p) => String(p || '').trim()).filter(Boolean))];
    const missing = normalized.filter((p) => !getCachedSignedUrl(p));
    if (imagePaths?.size) {
      const cachedImgUrls = [];
      imagePaths.forEach((p) => {
        const u = getCachedSignedUrl(p);
        if (u) cachedImgUrls.push(u);
      });
      if (cachedImgUrls.length) preloadSignedImageUrls(cachedImgUrls);
    }
    if (!missing.length || !conversationId) return;
    try {
      const { urls = {} } = await ipon().invokeAccountFunction({
        action: 'chat-view-urls',
        conversation_id: conversationId,
        paths: missing
      });
      const expiresAt = Date.now() + SIGNED_URL_TTL_MS;
      const preloadQueue = [];
      Object.entries(urls).forEach(([path, signed]) => {
        if (path && signed) {
          state.signedUrlCache.set(path, signed);
          state.signedUrlExpiry?.set?.(path, expiresAt);
          missingUrlRetry.delete(path);
          if (imagePaths?.has?.(path) || /\.(?:png|jpe?g|webp|gif|avif|bmp|heic)(?:\?|$)/i.test(path)) {
            preloadQueue.push(signed);
          }
        }
      });
      if (preloadQueue.length) preloadSignedImageUrls(preloadQueue);
    } catch (_) { }
  }

  function scheduleMissingSignedUrls(conversationId, paths = []) {
    if (!conversationId || state.activeConvId !== conversationId || typeof setTimeout !== 'function') return;
    const now = Date.now();
    const eligible = [...new Set(paths.map((p) => String(p || '').trim()).filter((p) => {
      if (!p || getCachedSignedUrl(p)) return false;
      const info = missingUrlRetry.get(p);
      return !info || (info.attempts < 3 && (now - info.lastAt) >= info.attempts * 1500);
    }))];
    if (!eligible.length) return;
    if (missingUrlTimer) clearTimeout(missingUrlTimer);
    missingUrlTimer = setTimeout(async () => {
      missingUrlTimer = null;
      if (state.activeConvId !== conversationId) return;
      const runAt = Date.now();
      const batch = eligible.filter((p) => !getCachedSignedUrl(p));
      if (!batch.length) return;
      batch.forEach((p) => {
        const prev = missingUrlRetry.get(p);
        missingUrlRetry.set(p, { attempts: (prev?.attempts || 0) + 1, lastAt: runAt });
      });
      await ensureSignedViewUrls(conversationId, batch);
      if (state.activeConvId !== conversationId || !state.activeThread?.conversation) return;
      if (batch.some((p) => getCachedSignedUrl(p))) {
        const wrap = document.getElementById('msg-scroll-wrap');
        const prevTop = wrap ? wrap.scrollTop : 0;
        const nearBottom = isThreadNearBottom(wrap, 96);
        state.lastThreadFingerprint = computeThreadFingerprint(state.activeThread);
        renderMessagesList();
        if (wrap) wrap.scrollTop = nearBottom ? wrap.scrollHeight : prevTop;
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
        xhr.send(entry.file);
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
      if (meta.poster && node.classList?.contains?.('msg-video-player') && node.dataset) {
        node.dataset.vidState = 'ready';
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
    const viewerMsgId = triggerEl.closest?.('[data-msg-id]')?.dataset?.msgId || triggerEl.dataset?.vidMsgId || null;
    state.activeVideoViewerMsgId = viewerMsgId ? String(viewerMsgId) : null;
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
        state.activeVideoViewerMsgId = null;
        if (inlineVideo && inlineVideo.isConnected !== false) {
          try {
            if (typeof muted === 'boolean') inlineVideo.muted = muted;
            if (Number.isFinite(currentTime) && Number.isFinite(inlineVideo.duration) && inlineVideo.duration > 0) {
              inlineVideo.currentTime = Math.max(0, Math.min(inlineVideo.duration, currentTime));
            }
          } catch { }
          syncVideoPlayerUi(inlineVideo);
        }
        scheduleVanishExpiry();
      }
    });
  }

  function isThreadActivelyVisible({ ignoreFocus = false } = {}) {
    const dialog = document.getElementById('msg-workspace-dialog');
    if (!dialog?.open || !state.activeConvId) return false;
    if (!ignoreFocus && typeof document.visibilityState === 'string' && document.visibilityState !== 'visible') return false;
    if (!ignoreFocus && !isWindowFocused) return false;
    if (!ignoreFocus && typeof document.hasFocus === 'function' && !document.hasFocus()) return false;
    const blockingOverlayIds = ['msg-settings-dialog', 'msg-forward-dialog', 'msg-group-dialog', 'msg-gdrive-dialog', 'msg-vanish-dialog', 'notification-dialog', 'account-dialog', 'confirm-dialog', 'record-action-dialog', 'notif-unblock-dialog'];
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
      prev.users.push(state.activeThread?.conversation?.anonymous_enabled ? (r.user_id === initializedProfile?.id ? 'You' : 'Anonymous') : (r.user_name || 'User'));
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
      const seenTip = !conv.anonymous_enabled && isGroupConv(conv) && Array.isArray(m.seen_by) && m.seen_by.length
        ? `Seen by ${m.seen_by.map((x) => x?.full_name).filter(Boolean).join(', ')}`
        : 'Seen';
      return `<span class="msg-tick is-read" title="${escAttr(seenTip)}" aria-label="${escAttr(seenTip)}">${DOUBLE_CHECK_SVG}</span>`;
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
      || pc.kind !== nc.kind
      || pc.title !== nc.title
      || pc.description !== nc.description
      || (pc.avatar_url || '') !== (nc.avatar_url || '')
      || pc.status !== nc.status
      || pc.chat_theme !== nc.chat_theme
      || Boolean(pc.is_muted) !== Boolean(nc.is_muted)
      || Boolean(pc.is_pinned) !== Boolean(nc.is_pinned)
      || Boolean(pc.is_archived) !== Boolean(nc.is_archived)
      || Boolean(pc.marked_unread) !== Boolean(nc.marked_unread)
      || Boolean(pc.receipts_enabled) !== Boolean(nc.receipts_enabled)
      || Boolean(pc.block_screenshots) !== Boolean(nc.block_screenshots)
      || Boolean(pc.screenshot_block_eligible) !== Boolean(nc.screenshot_block_eligible)
      || Boolean(pc.screenshot_notices_enabled) !== Boolean(nc.screenshot_notices_enabled)
      || Boolean(pc.block_forwarding) !== Boolean(nc.block_forwarding)
      || Boolean(pc.protection_unavailable) !== Boolean(nc.protection_unavailable)
      || Boolean(pc.vanish_unavailable) !== Boolean(nc.vanish_unavailable)
      || pc.vanish_after_seconds !== nc.vanish_after_seconds
      || pc.friendship_status !== nc.friendship_status
      || (pc.members?.length || 0) !== (nc.members?.length || 0)
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
        || a.vanish_at !== b.vanish_at
        || a.vanish_after_seconds !== b.vanish_after_seconds
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
    const vidMenuKey = player?.dataset?.vidPath || player?.dataset?.vidName || 'video';
    if (toggleExistingFloatingMenu('video', vidMenuKey)) return;
    closeFloatingMenus({ immediate: true });
    activeVideoMenuPlayer = player;
    anchorBtn?.setAttribute?.('aria-expanded', 'true');
    const menu = document.createElement('div');
    menu.className = 'msg-floating-menu msg-ctx-menu';
    menu.setAttribute('data-menu-kind', 'video');
    menu.setAttribute('data-menu-for', String(vidMenuKey));
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

  function activeThreadLagsBehindTimestamp(convId, incomingIso) {
    if (!convId || !incomingIso || state.activeConvId !== convId || state.loadingThread || sendTailByConv.has(convId)) return false;
    const incomingMs = Date.parse(incomingIso);
    if (!Number.isFinite(incomingMs) || incomingMs <= 0) return false;
    const thread = state.activeThread;
    if (!thread?.conversation || thread.conversation.conversation_id !== convId) return false;
    const msgs = Array.isArray(thread.messages) ? thread.messages : [];
    const latestLoadedMs = msgs.length ? (Date.parse(msgs[msgs.length - 1]?.created_at || '') || 0) : 0;
    return incomingMs > latestLoadedMs;
  }

  async function refreshConversations({ render = true } = {}) {
    if (!isEligible()) return [];
    const data = await ipon().rpc('get_conversations');
    state.conversations = Array.isArray(data) ? data : [];
    state.conversationsLoaded = true;
    state.loadingConvs = false;
    computeTotalBadgeCount();
    const dialogOpen = Boolean(document.getElementById('msg-workspace-dialog')?.open);
    if (render && dialogOpen) {
      renderConversationList();
    }
    if (dialogOpen && state.activeConvId) {
      const activeSummary = state.conversations.find((c) => c.id === state.activeConvId);
      if (activeSummary && activeThreadLagsBehindTimestamp(state.activeConvId, activeSummary.last_message_at)) {
        const visibleHere = isThreadActivelyVisible({ ignoreFocus: true }) && document.visibilityState !== 'hidden';
        openConversation(state.activeConvId, { markRead: visibleHere, forceMarkRead: visibleHere, silent: true }).catch(() => { });
      }
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
    let { data, error } = await ipon().client
      .from('notifications')
      .select('id,type,title,message,link,dedupe_key,actor_id,actor_avatar_url,read_at,created_at')
      .like('type', 'SOCIAL_%')
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) {
      ({ data, error } = await ipon().client
        .from('notifications')
        .select('id,type,title,message,link,dedupe_key,read_at,created_at')
        .like('type', 'SOCIAL_%')
        .order('created_at', { ascending: false })
        .limit(50));
    }
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
      const isGrp = isGroupConv(conv);
      const name = convDisplayTitle(conv).toLowerCase();
      const uname = isGrp ? '' : String(conv.peer?.username || '').toLowerCase();
      const preview = String(conv.last_message_preview || '').toLowerCase();
      const memberBlob = isGrp
        ? (conv.members_preview || []).map((m) => String(m?.full_name || '').toLowerCase()).join(' ')
        : '';
      return name.includes(q) || uname.includes(q) || preview.includes(q) || memberBlob.includes(q);
    });
  }

  function renderConversationRowHtml(conv) {
    const isGrp = isGroupConv(conv);
    const active = conv.id === state.activeConvId;
    const typingEntries = getTypingEntries(conv.id);
    const isTyping = typingEntries.length > 0;
    const hasUnread = conv.unread_count > 0 || conv.marked_unread;
    let previewPrefix = '';
    if (conv.last_message_type === 'SYSTEM') {
      previewPrefix = '';
    } else if (conv.last_message_sender_id === initializedProfile?.id) {
      previewPrefix = 'You: ';
    } else if (isGrp && conv.last_message_sender_name) {
      const first = conv.anonymous_enabled ? 'Anonymous' : (String(conv.last_message_sender_name).trim().split(/\s+/)[0] || '');
      if (first) previewPrefix = `${first}: `;
    }
    const typingLabel = conv.anonymous_enabled ? 'Typing...' : isGrp && typingEntries.length === 1 && typingEntries[0]?.name
      ? `${String(typingEntries[0].name).trim().split(/\s+/)[0] || 'Someone'} is typing…`
      : (isGrp && typingEntries.length > 1 ? `${typingEntries.length} typing…` : 'Typing…');
    const rawPrevStr = String(conv.last_message_preview || '');
    const isMySystemPreview = conv.last_message_type === 'SYSTEM'
      && Boolean(initializedProfile?.id && String(conv.last_message_sender_id || '') === String(initializedProfile.id));
    const systemPreviewMatch = conv.last_message_type === 'SYSTEM'
      ? rawPrevStr.match(/ (took a screenshot|turned (?:on|off) screenshot blocking|turned (?:on|off) vanishing messages(?:\s+for\s+.+)?|changed vanishing messages to\s+.+|created the group\b.*|renamed the group to\b.*|updated the group\b.*|removed the group photo|added\b.*|made\b.*|removed\b.*|left the group)\.?$/i)
      : null;
    const rawLastPreview = systemPreviewMatch
      ? (isMySystemPreview
          ? `You ${systemPreviewMatch[1].replace(/\.$/, '')}`
          : rawPrevStr.replace(/\.$/, ''))
      : conv.last_message_preview;
    const safeLastPreview = conv.anonymous_enabled && ['SYSTEM', 'CALL_EVENT'].includes(conv.last_message_type)
      ? 'Conversation update'
      : conv.anonymous_enabled && / set a message\.$/.test(String(rawLastPreview))
        ? 'Vanishing message' : rawLastPreview;
    const previewText = isTyping
      ? `<span class="msg-typing-preview"><span class="msg-wave-dots is-inline" aria-hidden="true"><i></i><i></i><i></i></span><span>${escapeHtml(typingLabel)}</span></span>`
      : `${escapeHtml(previewPrefix)}${escapeHtml(safeLastPreview || (isGrp ? 'No recent messages' : 'Start a conversation'))}`;
    const pinIcon = conv.is_pinned
      ? '<svg class="msg-meta-icon" viewBox="0 0 24 24" role="img" aria-label="Pinned"><title>Pinned</title><path d="M12 17v5M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16h14v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6a1 1 0 0 1 1-1h.5a.5.5 0 0 0 .5-.5v-1a.5.5 0 0 0-.5-.5h-9a.5.5 0 0 0-.5.5v1a.5.5 0 0 0 .5.5H8a1 1 0 0 1 1 1z"/></svg>'
      : '';
    const muteIcon = conv.is_muted
      ? '<svg class="msg-meta-icon" viewBox="0 0 24 24" role="img" aria-label="Muted"><title>Muted</title><path d="M13.73 21a2 2 0 0 1-3.46 0"/><path d="M18.63 13A17.89 17.89 0 0 1 18 8"/><path d="M6.26 6.26A5.86 5.86 0 0 0 6 8c0 7-3 9-3 9h14"/><path d="M18 8a6 6 0 0 0-9.33-5"/><line x1="2" y1="2" x2="22" y2="22"/></svg>'
      : '';
    const groupPill = isGrp
      ? `<span class="msg-conv-group-pill" title="Group chat · ${Number(conv.member_count || 2)} members">${Number(conv.member_count || 2)}</span>`
      : '';
    return `<article class="msg-conv-row${active ? ' is-active' : ''}${hasUnread ? ' is-unread' : ''}${isGrp ? ' is-group' : ''}${conv.anonymous_enabled ? ' is-anonymous' : ''}" data-conv-row="${escapeHtml(conv.id)}" role="option" aria-selected="${active ? 'true' : 'false'}">
      <div class="msg-conv-avatar">${convAvatarHtml(conv, 'avatar-md')}</div>
      <button type="button" class="msg-conv-main" data-open-conv="${escapeHtml(conv.id)}">
        <div class="msg-conv-top">
          <strong class="msg-conv-name"><span class="msg-conv-name-text">${escapeHtml(convDisplayTitle(conv))}</span>${isGrp || conv.anonymous_enabled ? '' : userBadgesHtml(conv.peer || conv)}${groupPill}</strong>
        </div>
        <div class="msg-conv-bottom">
          <span class="msg-conv-preview">${previewText}</span>
          <span class="msg-conv-bottom-meta">
            ${pinIcon}${muteIcon}<time class="msg-conv-time">${escapeHtml(formatShortDate(conv.last_message_at))}</time>
            ${hasUnread ? `<b class="msg-unread-pill">${conv.unread_count > 0 ? (conv.unread_count > 99 ? '99+' : conv.unread_count) : '•'}</b>` : ''}
          </span>
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
    const isSelf = isSelfUser(u) || u.is_self || u.friendship_status === 'SELF';
    let relChip = '';
    if (isSelf) {
      relChip = '';
    } else if (u.friendship_status === 'FRIENDS') {
      relChip = '<span class="msg-rel-badge">Friend</span>';
    } else if (u.friendship_status === 'OUTGOING_REQUEST') {
      relChip = `<button type="button" class="msg-row-chip-btn" data-cancel-req="${escapeHtml(u.friend_request_id)}">Requested</button>`;
    } else if (u.friendship_status === 'INCOMING_REQUEST') {
      relChip = `<button type="button" class="msg-row-chip-btn is-accent" data-req-decision="ACCEPT" data-req-id="${escapeHtml(u.friend_request_id)}">Accept</button>`;
    } else {
      relChip = `<button type="button" class="msg-row-chip-btn" data-social-action="add_friend" data-target-id="${escapeHtml(u.id)}">Add</button>`;
    }
    const mutualCount = Number(u.mutual_friends_count || 0);
    const friendCountText = formatFriendCountText(u.friends_count);
    const subParts = [];
    if (u.username) subParts.push(`@${u.username}`);
    if (friendCountText) subParts.push(friendCountText);
    if (mutualCount > 0) subParts.push(`${mutualCount} mutual`);
    if (isSelf) subParts.unshift('Personal notes & saved messages');
    else if (!subParts.length) subParts.push('Tap to message');

    const presenceText = isSelf || personIsOnline(u) ? '' : formatStatusLine(u);
    const showPresenceDot = !presenceText && (isSelf || (u.profile_visible !== false && u.allow_online_status !== false && !u.is_blocked && u.friendship_status !== 'BLOCKED_BY_ME' && u.friendship_status !== 'BLOCKED_ME'));
    return `<article class="msg-search-person-row" role="listitem">
      <div class="msg-conv-avatar">${userAvatarHtml(u, 'avatar-md', { showPresence: showPresenceDot })}</div>
      <button type="button" class="msg-search-person-main" data-social-action="message" data-target-id="${escapeHtml(u.id)}">
        <strong class="msg-conv-name"><span class="msg-conv-name-text">${escapeHtml(u.full_name || 'User')}</span>${userBadgesHtml(u)}</strong>
        <span class="msg-search-person-sub">${escapeHtml(subParts.join(' · '))}</span>
        ${presenceText ? `<span class="msg-search-person-presence">${escapeHtml(presenceText)}</span>` : ''}
      </button>
      <div class="msg-search-person-act">${relChip}</div>
    </article>`;
  }

  function renderInlineSearchResults(listEl, rawQuery) {
    const q = rawQuery.trim();
    const convHits = q ? getFilteredConversations({ ignoreFilter: true }) : [];
    const peopleHits = sortPeopleByPresence(state.discoverUsers || []);
    const msgHits = q.length >= 2 ? (state.discoverMessages || []) : [];

    if (!q && state.searchActive) {
      const quickGroup = `<button type="button" class="msg-quick-group-btn" id="msg-inline-create-group">
        <span class="msg-quick-group-icon" aria-hidden="true">${NEW_GROUP_ICON_SVG}</span>
        <span class="msg-quick-group-copy">
          <strong>New group chat</strong>
          <small>Message multiple friends &amp; teammates together</small>
        </span>
      </button>`;
      const header = `<div class="msg-search-section-label"><span>All people</span><b>${peopleHits.length}</b></div>`;
      if (state.searchLoading && !peopleHits.length) {
        listEl.innerHTML = `${quickGroup}${header}${skeletonHtml('person', 5)}`;
        return;
      }
      if (!peopleHits.length) {
        listEl.innerHTML = `${quickGroup}${header}<div class="empty-state msg-list-empty"><strong>No eligible people found</strong><p>Other active members and admins will appear here when available.</p></div>`;
        return;
      }
      listEl.innerHTML = `${quickGroup}${header}${peopleHits.map(renderSearchPersonRowHtml).join('')}`;
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
              <strong class="msg-conv-name"><span class="msg-conv-name-text">${escapeHtml(hit.peer_name)}</span>${hit.peer_id && !hit.anonymous_enabled ? userBadgesHtml(hit.peer_id) : ''}</strong>
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

  function supportsNativeScreenshotProtection() {
    if (typeof ipon()?.supportsNativeScreenshotProtection === 'function') {
      return Boolean(ipon().supportsNativeScreenshotProtection());
    }
    return typeof window !== 'undefined' && (typeof window.IponNativePrivacy?.setScreenshotBlocked === 'function'
      || (window.Capacitor?.getPlatform?.() === 'android'
        && typeof window.Capacitor?.Plugins?.BackgroundNotifications?.setScreenshotBlocked === 'function'));
  }

  function hasLiveBrowserParticipant(conv) {
    const check = ipon()?.hasLiveBrowserSession;
    if (typeof check !== 'function' || !conv) return false;
    if (isGroupConv(conv)) {
      return (conv.members || []).some((m) => check(m?.user_id || m?.id));
    }
    return Boolean(check(conv.id) || (initializedProfile?.id && check(initializedProfile.id)));
  }

  function isScreenshotBlockEffective(conv) {
    return Boolean(conv && supportsNativeScreenshotProtection() && (conv.block_screenshots || (conv.screenshot_block_eligible && !hasLiveBrowserParticipant(conv))));
  }

  function syncNativeScreenshotLock(conv = state.activeThread?.conversation) {
    const blocked = Boolean(conv?.block_screenshots && isScreenshotBlockEffective(conv));
    if (typeof window.IponNativePrivacy?.setScreenshotBlocked === 'function') {
      window.IponNativePrivacy.setScreenshotBlocked(blocked);
    } else if (supportsNativeScreenshotProtection()) {
      const plugin = window.Capacitor?.Plugins?.BackgroundNotifications;
      const call = typeof plugin?.setScreenshotBlocked === 'function'
        ? plugin.setScreenshotBlocked({ blocked })
        : window.Capacitor?.nativePromise?.('BackgroundNotifications', 'setScreenshotBlocked', { blocked });
      call?.catch?.(() => { });
    }
    const monitoring = Boolean(conv && state.activeConvId && document.getElementById('msg-workspace-dialog')?.open
      && (!isGroupConv(conv) || conv.screenshot_notices_enabled) && !blocked);
    if (typeof window.IponNativePrivacy?.setScreenshotMonitoring === 'function') {
      window.IponNativePrivacy.setScreenshotMonitoring(monitoring);
    } else if (supportsNativeScreenshotProtection()) {
      const plugin = window.Capacitor?.Plugins?.BackgroundNotifications;
      const call = typeof plugin?.setScreenshotMonitoring === 'function'
        ? plugin.setScreenshotMonitoring({ enabled: monitoring })
        : window.Capacitor?.nativePromise?.('BackgroundNotifications', 'setScreenshotMonitoring', { enabled: monitoring });
      call?.catch?.(() => { });
    }
  }

  async function refreshActiveConversationProtection(convId = state.activeConvId) {
    if (!convId || !state.activeThread?.conversation || state.activeThread.conversation.conversation_id !== convId || state.savingProtection) return;
    try {
      await ipon().probeNativeScreenshotProtection?.();
      await ipon().reportClientPlatform?.()?.catch?.(() => { });
      const protection = await ipon().rpc('get_conversation_protection', { p_conversation_id: convId });
      if (!protection || state.activeConvId !== convId || state.activeThread?.conversation?.conversation_id !== convId) return;
      const conv = state.activeThread.conversation;
      const changed = Boolean(conv.block_screenshots) !== Boolean(protection.block_screenshots)
        || Boolean(conv.block_forwarding) !== Boolean(protection.block_forwarding)
        || Boolean(conv.screenshot_block_eligible) !== Boolean(protection.screenshot_block_eligible)
        || Boolean(conv.screenshot_notices_enabled) !== Boolean(protection.screenshot_notices_enabled)
        || conv.vanish_after_seconds !== protection.vanish_after_seconds
        || Boolean(conv.anonymous_enabled) !== Boolean(protection.anonymous_enabled);
      const anonymousChanged = Boolean(conv.anonymous_enabled) !== Boolean(protection.anonymous_enabled);
      Object.assign(conv, protection);
      conv.protection_unavailable = false;
      syncNativeScreenshotLock(conv);
      if (anonymousChanged) {
        state.pendingByConv.delete(convId);
        state.draftsByConv.delete(convId);
        state.threadSearchSenderId = '';
        await Promise.all([openConversation(convId, { markRead: false, silent: true }), refreshConversations(), refreshSocialNotifications()]);
        return;
      }
      const editForm = document.getElementById('msg-group-edit-form');
      if (changed && state.showThreadInfo && (!editForm || editForm.hidden)) renderThreadInfoDrawer();
    } catch (_) { }
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
      state.vanishError = '';
      state.vanishDraftSeconds = 300;
      state.vanishDraftCustom = false;
      state.vanishCustomValue = '';
      state.vanishCustomUnit = 'seconds';
      closeVanishModal();
      state.activePinnedId = null;
      state.unreadAnchorConvId = null;
      state.unreadAnchorFirstId = null;
      state.groupEditAvatarDataUrl = null;
      state.groupEditAvatarClear = false;
      state.groupEditAvatarConvId = conversationId;
      const prevInput = document.getElementById('msg-composer-input');
      if (prevInput && !state.editingMsg) state.draftsByConv.set(state.activeConvId, prevInput.value);
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
      state.loadingOlder = false;
      state.olderLoadError = '';
      state.olderAutoArmed = false;
      state.threadStickyBottom = !aroundMessageId;
      state.lastThreadFingerprint = '';
      renderThreadHeaderLoading(conversationId, previewPeer);
    }

    try {
      const [data, protection] = await Promise.all([
        ipon().rpc('get_conversation_messages', {
          p_conversation_id: conversationId,
          p_before: null,
          p_limit: 60,
          p_around_message_id: aroundMessageId || null
        }),
        (async () => {
          await ipon().reportClientPlatform?.()?.catch?.(() => { });
          return ipon().rpc('get_conversation_protection', { p_conversation_id: conversationId }).catch((error) => {
            if (error?.code === 'PGRST202') return null;
            throw error;
          });
        })()
      ]);
      if (data?.conversation) {
        if (protection) Object.assign(data.conversation, protection);
        data.conversation.protection_unavailable = !protection;
        data.conversation.vanish_unavailable = !protection || !Object.prototype.hasOwnProperty.call(protection, 'vanish_after_seconds');
      }
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
      const serverUnreadFirstId = data?.unread_first_id || null;

      if (!isSameLoadedThread || state.unreadAnchorConvId !== conversationId) {
        state.unreadAnchorConvId = conversationId;
        state.unreadAnchorFirstId = serverUnreadFirstId;
      } else if (state.unreadAnchorFirstId) {
        if (!nextMsgs.some((m) => m.id === state.unreadAnchorFirstId)) {
          state.unreadAnchorFirstId = null;
        }
      } else if (!wasNearBottom && serverUnreadFirstId) {
        state.unreadAnchorFirstId = serverUnreadFirstId;
      }
      if (data) data.unread_first_id = state.unreadAnchorFirstId;
      if (backgroundRefresh && isSameLoadedThread && !aroundMessageId && prevMsgs.length > nextMsgs.length && nextMsgs.length > 0) {
        const firstFreshAt = Date.parse(nextMsgs[0].created_at || '');
        const freshIds = new Set(nextMsgs.map((m) => m.id));
        const nowMs = Date.now();
        const olderPrefix = prevMsgs.filter((m) => (
          m && !freshIds.has(m.id)
          && (!m.vanish_at || Date.parse(m.vanish_at) > nowMs)
          && Number.isFinite(firstFreshAt)
          && Date.parse(m.created_at || '') <= firstFreshAt
        ));
        if (olderPrefix.length) {
          data.messages = [...olderPrefix, ...nextMsgs];
          data.has_older = Boolean(prevThreadSnapshot?.has_older);
        }
      }

      state.activeThread = data;
      syncNativeScreenshotLock(data?.conversation);
      state.loadingThread = false;

      const attPaths = [];
      const imagePaths = new Set();
      (data?.messages || nextMsgs).forEach((m) => (m.attachments || []).forEach((a) => {
        if (a?.path) {
          attPaths.push(a.path);
          if (a.kind === 'image') imagePaths.add(a.path);
        }
      }));
      await ensureSignedViewUrls(conversationId, attPaths, { imagePaths });
      if (state.activeConvId !== conversationId || reqSeq !== state.openConvSeq) return;

      const dialogOpen = Boolean(document.getElementById('msg-workspace-dialog')?.open);
      const convItem = state.conversations.find((c) => c.id === conversationId);
      const hasUnreadSocialNotif = state.socialNotifications.some(
        (n) => !n.read_at && String(n.link || '').includes(conversationId)
      );
      const shouldMarkRead = Boolean(
        markRead && dialogOpen && isThreadActivelyVisible() && (
          forceMarkRead ||
          serverUnreadFirstId ||
          convItem?.unread_count > 0 ||
          convItem?.marked_unread ||
          hasUnreadSocialNotif ||
          (!backgroundRefresh && !convItem)
        )
      );

      if (shouldMarkRead) {
        const hasPendingIncomingVanish = nextMsgs.some(
          (m) => m.sender_id !== initializedProfile?.id && m.vanish_after_seconds && !m.vanish_at
        );
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
        if (hasPendingIncomingVanish && state.activeConvId === conversationId && reqSeq === state.openConvSeq) {
          const refreshed = await ipon().rpc('get_conversation_messages', {
            p_conversation_id: conversationId,
            p_before: null,
            p_limit: 60,
            p_around_message_id: aroundMessageId || null
          }).catch(() => null);
          if (refreshed?.messages && state.activeConvId === conversationId && reqSeq === state.openConvSeq) {
            data.messages = refreshed.messages;
            state.activeThread = data;
          }
        }
      }

      const nextFingerprint = computeThreadFingerprint(data);
      const shouldScrollBottom = typeof scrollToBottom === 'boolean'
        ? scrollToBottom
        : (!aroundMessageId && (!backgroundRefresh || (wasNearBottom && hasNewBottomMsg)));

      if (!backgroundRefresh || nextFingerprint !== state.lastThreadFingerprint) {
        state.lastThreadFingerprint = nextFingerprint;
        if (backgroundRefresh && !aroundMessageId && tryPatchActiveThreadInPlace(prevThreadSnapshot, data)) {
          syncActiveThreadPresenceUi(data?.conversation);
        } else {
          renderActiveThread({
            scrollToBottom: shouldScrollBottom,
            highlightMessageId: aroundMessageId,
            preserveScrollTop: backgroundRefresh && !shouldScrollBottom ? prevScrollTop : null,
            animate: !backgroundRefresh
          });
        }
      } else {
        syncActiveThreadPresenceUi(data?.conversation);
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
    const normalized = ['paper', 'emerald', 'sage', 'sand', 'midnight', 'anonymous'].includes(theme) ? theme : 'paper';
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
    applyThreadTheme(peer?.anonymous_enabled ? 'anonymous' : (peer?.chat_theme || 'paper'));

    const headerEl = document.getElementById('msg-thread-header');
    if (headerEl) {
      headerEl.classList.remove('is-empty-intro');
      if (peer) {
        const isGrp = isGroupConv(peer);
        headerEl.innerHTML = `
          <div class="msg-thread-header-left">
            <button type="button" class="msg-back-mobile-btn" id="msg-back-to-list" aria-label="Back to conversations">
              <svg viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></svg>
            </button>
            ${isGrp ? groupAvatarHtml(peer, 'avatar-md') : userAvatarHtml(peer, 'avatar-md')}
            <div class="msg-thread-peer-meta">
              <div class="msg-thread-peer-title">
                <strong class="msg-thread-peer-name" title="${escAttr(convDisplayTitle(peer))}"><span class="verified-name-text">${escapeHtml(convDisplayTitle(peer))}</span>${isGrp || peer.anonymous_enabled ? '' : userBadgesHtml(peer)}</strong>
              </div>
              <div class="msg-thread-peer-sub">
                ${isGrp ? '<span class="msg-rel-chip is-group">Group</span>' : ''}
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
        ipon().fitVerifiedNameLines?.(headerEl);
      } else {
        headerEl.innerHTML = skeletonHtml('header');
      }
    }

    document.getElementById('msg-scroll-wrap')?.classList.remove('is-empty-thread');
    const list = document.getElementById('msg-messages-list');
    if (list) {
      list.classList.remove('is-thread-entering');
      list.innerHTML = skeletonHtml('thread');
    }
  }

  function renderThreadErrorState() {
    document.getElementById('msg-scroll-wrap')?.classList.remove('is-empty-thread');
    const list = document.getElementById('msg-messages-list');
    if (!list) return;
    list.innerHTML = `<div class="empty-state"><p>${escapeHtml(state.threadError || 'Unable to load messages.')}</p><button type="button" class="button button-secondary button-sm" id="msg-retry-thread-btn">Try again</button></div>`;
  }

  function bindTypingChannel(conversationId) {
    const client = ipon().client;
    if (!client || !conversationId) return;
    if (typingChannel && state.typingChannelConvId === conversationId) {
      syncMyThreadPresence();
      syncThreadPresenceRipple();
      return;
    }
    clearTimeout(typingIdleTimer);
    typingIdleTimer = null;
    state.lastTypingState = false;
    state.lastTypingSentAt = 0;
    const prevConvId = state.typingChannelConvId;
    typingChannelSubscribed = false;
    myTrackedConvoId = null;
    if (typingChannel) {
      try { Promise.resolve(typingChannel.untrack?.()).catch(() => { }); } catch { }
      try { client.removeChannel(typingChannel); } catch { }
      typingChannel = null;
      state.typingChannelConvId = null;
    }
    if (prevConvId) state.convoPresencePeers.delete(prevConvId);
    state.typingChannelConvId = conversationId;
    const myId = String(initializedProfile?.id || '');
    const ch = client.channel(`chat-typing:${conversationId}`, { config: { presence: { key: myId || 'anon' } } });
    typingChannel = ch;
    ch.on('presence', { event: 'sync' }, () => {
      if (ch !== typingChannel) return;
      const rawState = ch.presenceState?.() || {};
      const nextPeers = new Set();
      Object.entries(rawState).forEach(([key, entries]) => {
        (Array.isArray(entries) ? entries : []).forEach((entry) => {
          const uid = String(entry?.user_id || key || '');
          if (uid && uid !== myId && entry?.in_convo !== false) nextPeers.add(uid);
        });
      });
      state.convoPresencePeers.set(conversationId, nextPeers);
      syncThreadPresenceRipple();
    })
      .on('broadcast', { event: 'typing' }, ({ payload }) => {
        const senderUid = String(payload?.user_id || '');
        if (!senderUid || senderUid === String(initializedProfile?.id || '')) return;
        let bucket = state.typingPeers.get(conversationId);
        if (!(bucket instanceof Map)) {
          bucket = new Map();
          state.typingPeers.set(conversationId, bucket);
        }
        const prevCount = bucket.size;
        const prevEntry = bucket.get(senderUid);
        if (prevEntry?.timer) clearTimeout(prevEntry.timer);
        if (payload.typing) {
          const timer = setTimeout(() => {
            const cur = state.typingPeers.get(conversationId);
            if (cur instanceof Map) {
              cur.delete(senderUid);
              if (!cur.size) state.typingPeers.delete(conversationId);
            }
            updateTypingIndicators({ listChanged: true });
          }, 2600);
          const known = findKnownPeer(conversationId, senderUid)
            || findGroupMember(state.activeThread?.conversation, senderUid);
          bucket.set(senderUid, {
            id: senderUid,
            name: payload.user_name || known?.full_name || '',
            avatar_url: payload.avatar_url || known?.avatar_url || '',
            timer,
            at: Date.now()
          });
        } else {
          bucket.delete(senderUid);
          if (!bucket.size) state.typingPeers.delete(conversationId);
        }
        const nextCount = bucket.size;
        updateTypingIndicators({ listChanged: (prevCount > 0) !== (nextCount > 0) });
        if (payload.typing && prevCount === 0 && nextCount > 0 && conversationId === state.activeConvId && isThreadActivelyVisible()) {
          ipon().playUiSound?.('msg-typing');
        }
      })
      .subscribe((status) => {
        if (ch !== typingChannel) return;
        typingChannelSubscribed = (status === 'SUBSCRIBED');
        syncMyThreadPresence();
      });
  }

  function syncLiveTypingBubble(typingEntriesOrBool) {
    const liveRow = document.getElementById('msg-typing-live');
    if (!liveRow) return;
    const conv = state.activeThread?.conversation;
    const entries = Array.isArray(typingEntriesOrBool) ? typingEntriesOrBool : getTypingEntries(conv?.conversation_id);
    const typing = Array.isArray(typingEntriesOrBool) ? entries.length > 0 : Boolean(typingEntriesOrBool);
    const wasVisible = liveRow.classList.contains('is-visible');
    const wrap = document.getElementById('msg-scroll-wrap');
    const wasNearBottom = wrap && wrap.scrollHeight - wrap.scrollTop - wrap.clientHeight < 140;
    const avatarHost = document.getElementById('msg-typing-avatar');
    const senderLabel = document.getElementById('msg-typing-sender');
    const liveTxt = document.getElementById('msg-typing-live-text');
    if (typing && conv) {
      const firstEntry = entries[0] || null;
      const isGrp = isGroupConv(conv);
      const typerUser = isGrp && firstEntry?.id
        ? {
            id: firstEntry.id,
            full_name: firstEntry.name || findGroupMember(conv, firstEntry.id)?.full_name || 'Member',
            avatar_url: firstEntry.avatar_url || findGroupMember(conv, firstEntry.id)?.avatar_url || '',
            allow_online_status: !conv.anonymous_enabled,
            anonymous_enabled: Boolean(conv.anonymous_enabled)
          }
        : conv;
      const avatarKey = String(typerUser?.id || conv.id || '');
      if (avatarHost && avatarHost.dataset.peerId !== avatarKey) {
        avatarHost.dataset.peerId = avatarKey;
        avatarHost.innerHTML = userAvatarHtml(typerUser, 'avatar-sm', { clickable: false, showPresence: true });
        ipon().bindAvatarFallbacks?.(avatarHost);
        ipon().syncPresenceDots?.(avatarHost);
      }
      if (senderLabel) {
        if (isGrp && firstEntry?.name && !conv.anonymous_enabled) {
          const shortName = String(firstEntry.name).trim().split(/\s+/)[0] || 'Someone';
          senderLabel.textContent = entries.length > 1 ? `${shortName} +${entries.length - 1}` : shortName;
          senderLabel.hidden = false;
        } else {
          senderLabel.textContent = '';
          senderLabel.hidden = true;
        }
      }
      if (liveTxt) {
        liveTxt.textContent = conv.anonymous_enabled ? 'Typing...' : isGrp && firstEntry?.name
          ? `${firstEntry.name} is typing…`
          : `${convDisplayTitle(conv)} is typing…`;
      }
    } else if (!typing) {
      if (senderLabel) {
        senderLabel.textContent = '';
        senderLabel.hidden = true;
      }
      if (liveTxt) liveTxt.textContent = 'Typing…';
    }
    liveRow.classList.toggle('is-visible', Boolean(typing));
    liveRow.setAttribute('aria-hidden', typing ? 'false' : 'true');
    syncThreadScrollLock();
    if (!wasVisible && typing) {
      requestAnimationFrame(() => {
        syncThreadScrollLock();
        if (wasNearBottom && wrap && !wrap.classList?.contains('is-no-scroll')) {
          wrap.scrollTop = wrap.scrollHeight;
        }
      });
    } else if (wasVisible && !typing) {
      requestAnimationFrame(() => syncThreadScrollLock());
    }
  }

  function updateTypingIndicators({ listChanged = true } = {}) {
    if (listChanged) renderConversationList();
    if (!state.activeConvId || !state.activeThread?.conversation) return;
    const entries = getTypingEntries(state.activeConvId);
    const subEl = document.getElementById('msg-peer-status-text');
    if (subEl) {
      const nextStatus = formatStatusLine(state.activeThread.conversation);
      subEl.textContent = nextStatus;
      subEl.hidden = !nextStatus;
    }
    syncLiveTypingBubble(entries);
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
    const canInteract = Boolean(conv && (isGroupConv(conv) || (conv.friendship_status !== 'BLOCKED_BY_ME' && conv.friendship_status !== 'BLOCKED_ME')));
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
    const isGrp = isGroupConv(conv);
    applyThreadTheme(conv.anonymous_enabled ? 'anonymous' : (conv.chat_theme || 'paper'));

    const blockedThread = isBlockedThread(conv);
    const friendsOnlyLocked = isFriendsOnlyLocked(conv);
    const canInteract = isGrp || (!blockedThread && !friendsOnlyLocked);
    const isPendingReq = !isGrp && conv.status === 'PENDING_REQUEST';
    const isIncomingReq = isPendingReq && conv.initiator_id !== initializedProfile?.id;
    const hasSentMessages = Boolean((Array.isArray(thread.messages) && thread.messages.length) || getPendingList(conv.conversation_id).length);
    const typingEntries = getTypingEntries(conv.conversation_id);
    const peerStatus = conv.anonymous_enabled ? '' : formatStatusLine(conv);

    const headerEl = document.getElementById('msg-thread-header');
    headerEl.classList.toggle('is-empty-intro', !hasSentMessages);
    headerEl.innerHTML = `
      <div class="msg-thread-header-left">
        <button type="button" class="msg-back-mobile-btn" id="msg-back-to-list" aria-label="Back to conversations">
          <svg viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></svg>
        </button>
        ${isGrp ? groupAvatarHtml(conv, 'avatar-md', { clickable: true }) : userAvatarHtml(conv, 'avatar-md', { showPresence: !isSelfUser(conv) && conv.profile_visible !== false })}
        <div class="msg-thread-peer-meta">
          <div class="msg-thread-peer-title">
            <strong class="msg-thread-peer-name" title="${escAttr(convDisplayTitle(conv))}"><span class="verified-name-text">${escapeHtml(convDisplayTitle(conv))}</span>${isGrp || conv.anonymous_enabled ? '' : userBadgesHtml(conv)}</strong>
          </div>
          <div class="msg-thread-peer-sub">
            ${isGrp ? '<span class="msg-rel-chip is-group">Group</span>' : ''}
            <small class="msg-peer-status" id="msg-peer-status-text"${peerStatus ? '' : ' hidden'}>${escapeHtml(peerStatus)}</small>
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
    ipon().fitVerifiedNameLines?.(headerEl);

    const senderSelect = document.getElementById('msg-thread-search-sender');
    if (senderSelect) {
      if (isGrp) {
        const myId = String(initializedProfile?.id || '');
        const otherOpts = (conv.members || [])
          .filter((m) => m && String(m.id || '') !== myId)
          .map((m) => `<option value="${escAttr(m.id)}">${escapeHtml(m.full_name || 'Member')}</option>`)
          .join('');
        senderSelect.innerHTML = `<option value="">All senders</option><option value="${escAttr(initializedProfile?.id)}">You</option>${otherOpts}`;
      } else {
        senderSelect.innerHTML = isSelfUser(conv)
          ? `<option value="">All messages</option><option value="${escAttr(initializedProfile?.id)}">You</option>`
          : `<option value="">All senders</option><option value="${escAttr(initializedProfile?.id)}">You</option><option value="${escAttr(conv.id)}">${escapeHtml(conv.full_name || 'Peer')}</option>`;
      }
      senderSelect.value = state.threadSearchSenderId;
    }

    const reqBanner = document.getElementById('msg-request-banner');
    if (reqBanner) {
      if (isIncomingReq) {
        reqBanner.hidden = false;
        reqBanner.innerHTML = `
          <div class="msg-req-banner-copy">
            <strong>Message Request from ${escapeHtml(conv.full_name || 'User')}${userBadgesHtml(conv)}</strong>
            <p>Read receipts are disabled until you accept. Accept to move this chat to your Inbox.</p>
          </div>
          <div class="msg-req-banner-actions">
            <button type="button" class="button button-primary button-sm" data-msg-req-decision="ACCEPT">Accept</button>
            <button type="button" class="button button-secondary button-sm" data-msg-req-decision="DELETE">Delete</button>
            <button type="button" class="button button-secondary button-sm is-danger" data-msg-req-decision="BLOCK">Block</button>
          </div>`;
      } else if (isPendingReq && hasSentMessages && !friendsOnlyLocked) {
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
      closeAttachMenu();
      const emojiPop = document.getElementById('msg-emoji-popover');
      if (emojiPop) emojiPop.hidden = true;
      if (state.replyToMsg || state.editingMsg) {
        state.replyToMsg = null;
        state.editingMsg = null;
        renderContextBar();
      }
      if (state.uploadQueue.length) clearUploadQueue();
      if (state.voiceRecorder) stopVoiceRecorderStream({ send: false });
      if (composerForm) composerForm.hidden = true;
      if (blockedBanner) {
        blockedBanner.hidden = false;
        blockedBanner.classList?.toggle?.('is-friends-only', friendsOnlyLocked);
        blockedBanner.innerHTML = blockedThread
          ? (conv.friendship_status === 'BLOCKED_BY_ME'
            ? `<span>You blocked <strong>${escapeHtml(conv.full_name)}${userBadgesHtml(conv)}</strong>.</span><button type="button" class="button button-secondary button-sm" data-unblock-user="${escapeHtml(conv.id)}">Unblock</button>`
            : '<span>You cannot reply to this conversation.</span>')
          : renderFriendsOnlyBannerHtml(conv);
      }
    } else {
      if (composerForm) composerForm.hidden = false;
      if (blockedBanner) {
        blockedBanner.hidden = true;
        blockedBanner.classList?.remove?.('is-friends-only');
      }
    }

    syncLoadOlderUi();

    renderMessagesList({ animate });
    syncLiveTypingBubble(typingEntries);
    if (state.showThreadInfo) renderThreadInfoDrawer();

    ipon().bindAvatarFallbacks(headerEl);
    ipon().syncPresenceDots(headerEl);
    syncThreadPresenceRipple();
    syncMyThreadPresence();

    if (highlightMessageId) {
      requestAnimationFrame(() => {
        jumpToMessageElement(highlightMessageId);
        state.olderAutoArmed = true;
      });
    } else if (scrollToBottom) {
      requestAnimationFrame(() => {
        const wrap = document.getElementById('msg-scroll-wrap');
        if (wrap) {
          syncThreadScrollLock();
          if (!wrap.classList?.contains('is-no-scroll')) wrap.scrollTop = wrap.scrollHeight;
          state.threadStickyBottom = true;
          state.lastScrollWrapHeight = Number(wrap.clientHeight || 0);
        }
        state.olderAutoArmed = true;
      });
    } else if (typeof preserveScrollTop === 'number') {
      requestAnimationFrame(() => {
        const wrap = document.getElementById('msg-scroll-wrap');
        if (wrap) {
          wrap.scrollTop = preserveScrollTop;
          state.threadStickyBottom = isThreadNearBottom(wrap);
          state.lastScrollWrapHeight = Number(wrap.clientHeight || 0);
        }
        state.olderAutoArmed = true;
      });
    } else {
      state.olderAutoArmed = true;
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
      metaLabel.textContent = pending.optimizing ? 'Optimizing media…' : pending.files?.length && pending.progressPct > 0 && pending.progressPct < 100
        ? `Sending ${pending.progressPct}%…`
        : 'Sending…';
    }
  }

  function renderPendingAttachmentHtml(item) {
    const safeName = escapeHtml(item.name || 'file');
    const sizeText = escapeHtml(formatBytes(item.size));
    if (item.kind === 'image' && item.previewUrl) {
      return `<figure class="msg-att-image is-img-loaded">
        <button type="button" class="msg-img-open-btn" data-open-img="${escAttr(item.previewUrl)}" data-img-name="${escAttr(item.name || 'image')}" aria-label="Preview ${safeName}">
          <img src="${escAttr(item.previewUrl)}" alt="${safeName}" decoding="async">
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
    const isSending = p.status === 'sending' || p.status === 'queued';
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
    const statusLabel = p.optimizing ? 'Optimizing media…' : isSending && atts.length && p.progressPct > 0 && p.progressPct < 100
      ? `Sending ${p.progressPct}%…`
      : p.status === 'queued' ? 'Queued…' : 'Sending…';
    const metaRight = isFailed
      ? '<span class="msg-tick is-failed-meta">! Not sent</span>'
      : p.status === 'sent'
        ? `<span class="msg-tick is-sent" aria-label="Sent">${SINGLE_CHECK_SVG}</span>`
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

    return `<article class="msg-row is-mine is-pending${isFailed ? ' is-failed' : p.status === 'sent' ? ' is-sent' : ' is-sending'}" data-pending-id="${escapeHtml(p.localId)}">
      <div class="msg-bubble-col">
        ${replyHtml}
        <div class="msg-bubble${isFailed ? ' is-failed' : p.status === 'sent' ? ' is-sent' : ' is-sending'}${hasTopMedia ? ' has-top-media' : ''}${isMediaOnly ? ' is-media-only' : ''}${hasAudioOnly ? ' has-audio-only' : ''}">
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
    const pendingRow = convId === state.activeConvId
      ? document.querySelector(`#msg-messages-list [data-pending-id="${CSS.escape(pending.localId)}"]`)
      : null;
    const statusText = pendingRow?.querySelector('.msg-pending-status-text');
    if (statusText) statusText.textContent = 'Sending…';

    try {
      const files = pending.files || [];
      const needUpload = files.filter((entry) => !entry.uploaded);
      if (needUpload.length) {
        pending.optimizing = needUpload.some((entry) => /\.(mp4|mp3)$/i.test(entry.name) && entry.size >= 2 * 1024 * 1024 && entry.size <= 25 * 1024 * 1024);
        updatePendingProgressDom(pending);
        for (const entry of needUpload) {
          if (typeof ipon().optimizeUploadMedia === 'function') entry.file = await ipon().optimizeUploadMedia(entry.file);
          entry.name = entry.file.name;
          entry.type = entry.file.type;
          entry.size = entry.file.size;
        }
        pending.optimizing = false;
        updatePendingProgressDom(pending);
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
      pending.status = 'sent';
      const sentPendingRow = convId === state.activeConvId
        ? document.querySelector(`#msg-messages-list [data-pending-id="${CSS.escape(pending.localId)}"]`)
        : null;
      const tick = sentPendingRow?.querySelector('.msg-tick');
      if (tick) tick.outerHTML = `<span class="msg-tick is-sent" aria-label="Sent">${SINGLE_CHECK_SVG}</span>`;
      sentPendingRow?.classList.replace('is-sending', 'is-sent');
      sentPendingRow?.querySelector('.msg-bubble')?.classList.replace('is-sending', 'is-sent');
    } catch (error) {
      pending.status = 'failed';
      pending.errorText = ipon().friendlyError(error) || 'Message failed to send';
      const isFriendsOnlyErr = /only accepts messages from friends|cannot attach files to this conversation/i.test(pending.errorText);
      if (isFriendsOnlyErr) {
        ipon().toast(pending.errorText, 'error');
        refreshConversations().catch(() => { });
        if (convId === state.activeConvId) {
          openConversation(convId, { markRead: false, silent: true }).catch(() => { });
        }
      }
      if (convId === state.activeConvId && state.activeThread?.conversation) {
        const wrapBefore = document.getElementById('msg-scroll-wrap');
        const prevTop = wrapBefore ? wrapBefore.scrollTop : 0;
        renderMessagesList();
        requestAnimationFrame(() => {
          const wrap = document.getElementById('msg-scroll-wrap');
          if (wrap) wrap.scrollTop = pending.preserveScroll ? prevTop : wrap.scrollHeight;
        });
      }
    }
  }

  function queuePendingMessage(pending) {
    const convId = pending.conversationId;
    const previous = sendTailByConv.get(convId) || Promise.resolve();
    const job = previous.then(() => findPendingItem(convId, pending.localId) && processPendingMessage(pending));
    sendTailByConv.set(convId, job);
    job.finally(() => {
      if (sendTailByConv.get(convId) !== job) return;
      sendTailByConv.delete(convId);
      const sentItems = getPendingList(convId).filter((item) => item.status === 'sent');
      if (!sentItems.length) return;
      const keepScroll = sentItems.some((item) => item.preserveScroll) || state.threadStickyBottom === false;
      Promise.all([
        convId === state.activeConvId
          ? openConversation(convId, { markRead: false, silent: true, scrollToBottom: !keepScroll })
          : Promise.resolve(),
        refreshConversations()
      ]).catch(() => { });
    });
  }

  function isThreadNearBottom(wrap, threshold = 140) {
    if (!wrap) return true;
    const clientH = Number(wrap.clientHeight || 0);
    const scrollH = Number(wrap.scrollHeight || 0);
    if (clientH <= 0 || scrollH <= clientH) return true;
    return (scrollH - Number(wrap.scrollTop || 0) - clientH) < threshold;
  }

  function shouldAutoScrollOnComposer() {
    if (state.threadStickyBottom === false) return false;
    const wrap = document.getElementById('msg-scroll-wrap');
    if ((state.replyToMsg || state.editingMsg) && !isThreadNearBottom(wrap)) return false;
    return true;
  }

  function enqueuePendingMessage({ conversationId, body = '', messageType = null, replyToMsg = null, files = [], deferProcess = false, preserveScroll = false }) {
    if (!conversationId) return null;
    const conv = state.activeThread?.conversation;
    const wrap = conversationId === state.activeConvId ? document.getElementById('msg-scroll-wrap') : null;
    const keepScroll = Boolean(preserveScroll || (replyToMsg && (state.threadStickyBottom === false || !isThreadNearBottom(wrap))));
    const prevTop = wrap ? wrap.scrollTop : 0;
    const replyTargetName = replyToMsg
      ? (conv?.anonymous_enabled ? 'Anonymous' : (replyToMsg.sender_name || findGroupMember(conv, replyToMsg.sender_id)?.full_name || convDisplayTitle(conv)))
      : '';
    const pending = {
      localId: `pending-${Date.now()}-${++pendingMsgSeq}`,
      conversationId,
      body: String(body || '').trim(),
      messageType: messageType || (files.length ? 'MEDIA' : 'TEXT'),
      replyToId: replyToMsg?.id || null,
      replyPreview: replyToMsg ? {
        senderLabel: replyToMsg.sender_id === initializedProfile?.id ? 'Replying to yourself' : `Replying to ${replyTargetName || 'User'}`,
        body: replyToMsg.body || 'Attachment'
      } : null,
      files: files.map((f) => ({ ...f, progress: f.uploaded ? 100 : 0 })),
      status: 'queued',
      progressPct: 0,
      errorText: '',
      serverMessageId: null,
      preserveScroll: keepScroll,
      createdAt: new Date().toISOString()
    };
    if (!state.pendingByConv.has(conversationId)) state.pendingByConv.set(conversationId, []);
    state.pendingByConv.get(conversationId).push(pending);
    if (!deferProcess) {
      if (conversationId === state.activeConvId && state.activeThread?.conversation) {
        const list = document.getElementById('msg-messages-list');
        if (list?.insertAdjacentHTML && list.querySelector('.msg-row.is-pending')) {
          list.insertAdjacentHTML('beforeend', renderPendingRowHtml(pending));
          if (keepScroll) {
            if (wrap) wrap.scrollTop = prevTop;
          } else {
            scrollActiveThreadToBottom();
          }
        } else {
          renderMessagesList();
          if (keepScroll) {
            if (wrap) wrap.scrollTop = prevTop;
          } else {
            scrollActiveThreadToBottom();
          }
        }
      }
      queuePendingMessage(pending);
    }
    return pending;
  }

  function scrollActiveThreadToBottom() {
    if (!state.activeConvId || !document.getElementById('msg-workspace-dialog')?.open) return;
    requestAnimationFrame(() => {
      const wrap = document.getElementById('msg-scroll-wrap');
      if (!wrap) return;
      syncThreadScrollLock();
      if (!wrap.classList.contains('is-no-scroll')) wrap.scrollTop = wrap.scrollHeight;
      state.threadStickyBottom = true;
      state.lastScrollWrapHeight = Number(wrap.clientHeight || 0);
    });
  }

  function syncThreadScrollLock() {
    const wrap = document.getElementById('msg-scroll-wrap');
    if (!wrap) return;
    if (wrap.classList?.contains('is-empty-thread')) {
      wrap.classList.add('is-no-scroll');
      wrap.scrollTop = 0;
      return;
    }
    const clientH = Number(wrap.clientHeight || 0);
    if (clientH <= 0) return;
    const list = document.getElementById('msg-messages-list');
    const older = document.getElementById('msg-load-older-wrap');
    const typing = document.getElementById('msg-typing-live');
    const cs = typeof window !== 'undefined' && typeof window.getComputedStyle === 'function' ? window.getComputedStyle(wrap) : null;
    const padY = (parseFloat(cs?.paddingTop) || 0) + (parseFloat(cs?.paddingBottom) || 0);
    const olderH = older && !older.hidden ? (Number(older.offsetHeight || 0) + 14) : 0;
    const listH = Number(list?.offsetHeight || 0);
    const typingH = typing && typing.classList?.contains('is-visible') ? (Number(typing.offsetHeight || 0) + 8) : 0;
    const contentH = listH > 0 ? (padY + olderH + listH + typingH) : Number(wrap.scrollHeight || 0);
    const needsScroll = contentH > clientH + 2;
    wrap.classList?.toggle('is-no-scroll', !needsScroll);
    if (!needsScroll) wrap.scrollTop = 0;
  }

  const OLDER_SCROLL_THRESHOLD_PX = 180;

  function syncLoadOlderUi() {
    const wrap = document.getElementById('msg-load-older-wrap');
    const statusEl = document.getElementById('msg-load-older-status');
    const btn = document.getElementById('msg-load-older-btn');
    const hasOlder = Boolean(state.activeThread?.has_older);
    const showLoading = hasOlder && Boolean(state.loadingOlder);
    const showRetry = hasOlder && !state.loadingOlder && Boolean(state.olderLoadError);
    if (wrap) wrap.hidden = !(showLoading || showRetry);
    if (statusEl) statusEl.hidden = !showLoading;
    if (btn) btn.hidden = !showRetry;
  }

  async function loadOlderMessages() {
    if (state.loadingOlder || state.loadingThread || !state.activeConvId) return false;
    const curMsgs = state.activeThread?.messages || [];
    if (!state.activeThread?.has_older || !curMsgs.length) return false;
    const convLoadingId = state.activeConvId;
    const oldest = curMsgs[0].created_at;
    state.loadingOlder = true;
    state.olderLoadError = '';
    syncLoadOlderUi();
    try {
      const older = await ipon().rpc('get_conversation_messages', {
        p_conversation_id: convLoadingId,
        p_before: oldest,
        p_limit: 50
      });
      if (state.activeConvId !== convLoadingId || !state.activeThread) return false;
      const incoming = Array.isArray(older?.messages) ? older.messages : [];
      const attPaths = [];
      const imagePaths = new Set();
      incoming.forEach((m) => (m.attachments || []).forEach((a) => {
        if (a?.path) {
          attPaths.push(a.path);
          if (a.kind === 'image') imagePaths.add(a.path);
        }
      }));
      await ensureSignedViewUrls(convLoadingId, attPaths, { imagePaths });
      if (state.activeConvId !== convLoadingId || !state.activeThread) return false;

      const latestMsgs = state.activeThread.messages || [];
      const existingIds = new Set(latestMsgs.map((m) => m.id));
      const uniqueOlder = incoming.filter((m) => m && !existingIds.has(m.id));
      const wrap = document.getElementById('msg-scroll-wrap');
      const prevScrollTop = wrap ? wrap.scrollTop : 0;
      const prevScrollHeight = wrap ? wrap.scrollHeight : 0;

      state.loadingOlder = false;
      state.olderLoadError = '';
      if (uniqueOlder.length) {
        state.activeThread.messages = [...uniqueOlder, ...latestMsgs];
      }
      state.activeThread.has_older = uniqueOlder.length > 0 && Boolean(older?.has_older);
      state.lastThreadFingerprint = computeThreadFingerprint(state.activeThread);
      renderActiveThread({ scrollToBottom: false });
      if (wrap) {
        syncThreadScrollLock();
        const delta = Math.max(0, wrap.scrollHeight - prevScrollHeight);
        wrap.scrollTop = Math.max(0, prevScrollTop + delta);
      }
      return uniqueOlder.length > 0;
    } catch (err) {
      if (state.activeConvId !== convLoadingId) return false;
      state.loadingOlder = false;
      state.olderLoadError = ipon().friendlyError(err);
      syncLoadOlderUi();
      ipon().toast(state.olderLoadError, 'error');
      return false;
    }
  }

  function handleThreadScroll() {
    closeFloatingMenus();
    const wrap = document.getElementById('msg-scroll-wrap');
    if (wrap) {
      const curClientH = Number(wrap.clientHeight || 0);
      if (!state.lastScrollWrapHeight || curClientH === state.lastScrollWrapHeight) {
        state.threadStickyBottom = isThreadNearBottom(wrap);
      }
      if (curClientH > 0) state.lastScrollWrapHeight = curClientH;
    }
    if (!state.olderAutoArmed || state.loadingOlder || state.loadingThread || state.olderLoadError) return;
    if (!state.activeConvId || !state.activeThread?.has_older || !(state.activeThread?.messages?.length)) return;
    if (!wrap || wrap.classList?.contains('is-no-scroll')) return;
    if (wrap.scrollTop <= OLDER_SCROLL_THRESHOLD_PX) {
      loadOlderMessages();
    }
  }

  function scheduleVanishExpiry() {
    clearTimeout(vanishUiTimer);
    const conversationId = state.activeConvId;
    const heldVidId = state.activeVideoViewerMsgId && document.getElementById('ipon-video-viewer')?.open
      ? String(state.activeVideoViewerMsgId)
      : null;
    const active = (state.activeThread?.messages || []).filter(
      (m) => m.vanish_at && Number.isFinite(Date.parse(m.vanish_at)) && (!heldVidId || String(m.id) !== heldVidId)
    );
    if (!active.length) return;
    const nextExpiry = Math.min(...active.map((m) => Date.parse(m.vanish_at)));
    vanishUiTimer = setTimeout(() => {
      if (state.activeConvId !== conversationId || !state.activeThread) return;
      const curHeldVidId = state.activeVideoViewerMsgId && document.getElementById('ipon-video-viewer')?.open
        ? String(state.activeVideoViewerMsgId)
        : null;
      const now = Date.now();
      const expired = (state.activeThread.messages || []).filter(
        (m) => m.vanish_at && Date.parse(m.vanish_at) <= now && (!curHeldVidId || String(m.id) !== curHeldVidId)
      );
      if (!expired.length) { scheduleVanishExpiry(); return; }
      const expiredIds = new Set(expired.map((m) => m.id));
      const list = document.getElementById('msg-messages-list');
      expired.forEach((m) => list?.querySelector(`[data-msg-id="${m.id}"]`)?.classList.add('is-vanish-exit'));
      state.activeThread.messages = state.activeThread.messages.filter((m) => !expiredIds.has(m.id));
      setTimeout(() => {
        if (state.activeConvId !== conversationId) return;
        const wrap = document.getElementById('msg-scroll-wrap');
        const previousTop = wrap?.scrollTop || 0;
        const nearBottom = !wrap || wrap.scrollHeight - wrap.scrollTop - wrap.clientHeight < 96;
        renderMessagesList();
        if (wrap) wrap.scrollTop = nearBottom ? wrap.scrollHeight : previousTop;
        if (typeof loadConversations === 'function') loadConversations({ silent: true });
      }, 360);
    }, Math.max(0, nextExpiry - Date.now()));
  }

  function positionVanishRing(bubble, width = bubble.offsetWidth, height = bubble.offsetHeight) {
    if (!width || !height) return;
    const mine = Boolean(bubble.closest('.msg-row.is-mine'));
    const corner = Math.atan2(width, height) * 180 / Math.PI;
    const angle = mine ? 180 - corner : 180 + corner;
    bubble.style.setProperty('--vanish-start', `${angle.toFixed(2)}deg`);
    if (typeof document === 'undefined' || typeof document.createElementNS !== 'function' || typeof bubble.querySelector !== 'function' || typeof buildVanishRectPath !== 'function') return;
    const isAudioOnly = Boolean(bubble.classList?.contains?.('has-audio-only'));
    const isTopMedia = Boolean(bubble.classList?.contains?.('has-top-media'));
    const cs = typeof window !== 'undefined' && typeof window.getComputedStyle === 'function' ? window.getComputedStyle(bubble) : null;
    const rTL = parseFloat(cs?.borderTopLeftRadius) || 16;
    const rTR = parseFloat(cs?.borderTopRightRadius) || 16;
    const rBR = isAudioOnly ? 16 : (parseFloat(cs?.borderBottomRightRadius) || (mine ? 6 : 16));
    const rBL = isAudioOnly ? 16 : (parseFloat(cs?.borderBottomLeftRadius) || (mine ? 16 : 6));
    const d = buildVanishRectPath(width, height, { mine, rTL, rTR, rBR, rBL, inset: isTopMedia ? 1.5 : 1.25 });
    let svg = bubble.querySelector(':scope > .msg-vanish-ring') || bubble.querySelector('.msg-vanish-ring');
    if (!svg) {
      const ns = 'http://www.w3.org/2000/svg';
      svg = document.createElementNS(ns, 'svg');
      svg.setAttribute('class', 'msg-vanish-ring');
      svg.setAttribute('aria-hidden', 'true');
      svg.setAttribute('preserveAspectRatio', 'none');
      const track = document.createElementNS(ns, 'path');
      track.setAttribute('class', 'msg-vanish-track');
      const progress = document.createElementNS(ns, 'path');
      progress.setAttribute('class', 'msg-vanish-progress');
      progress.setAttribute('pathLength', '100');
      svg.appendChild(track);
      svg.appendChild(progress);
      bubble.appendChild(svg);
      bubble.classList?.add?.('has-vanish-svg');
    }
    svg.setAttribute('viewBox', `0 0 ${Number(width.toFixed(2))} ${Number(height.toFixed(2))}`);
    const trackEl = svg.querySelector('.msg-vanish-track');
    const progEl = svg.querySelector('.msg-vanish-progress');
    if (trackEl) trackEl.setAttribute('d', d);
    if (progEl) progEl.setAttribute('d', d);
  }

  function renderMessagesList({ animate = false } = {}) {
    const list = document.getElementById('msg-messages-list');
    if (!list || !state.activeThread) return;
    const heldVidId = state.activeVideoViewerMsgId && document.getElementById('ipon-video-viewer')?.open
      ? String(state.activeVideoViewerMsgId)
      : null;
    const msgs = (state.activeThread.messages || []).filter(
      (m) => !m.vanish_at || Date.parse(m.vanish_at) > Date.now() || (heldVidId && String(m.id) === heldVidId)
    );
    state.activeThread.messages = msgs;
    const conv = state.activeThread.conversation || {};
    const myId = initializedProfile?.id;
    const searchQuery = state.showThreadSearch ? state.threadSearchQuery.trim() : '';
    const unreadFirstId = state.activeThread.unread_first_id;

    // Prune any pending message that has already synced into server history
    if (conv.conversation_id && state.pendingByConv.has(conv.conversation_id)) {
      const confirmedIds = new Set(msgs.map((m) => m.id));
      const pendingItems = state.pendingByConv.get(conv.conversation_id) || [];
      const latestSent = pendingItems.slice().reverse().find((p) => p.status === 'sent' && p.serverMessageId);
      const sentBatchLoaded = latestSent && confirmedIds.has(latestSent.serverMessageId);
      const kept = pendingItems.filter(
        (p) => !(p.serverMessageId && (confirmedIds.has(p.serverMessageId) || (sentBatchLoaded && p.status === 'sent')))
      );
      if (kept.length) state.pendingByConv.set(conv.conversation_id, kept);
      else state.pendingByConv.delete(conv.conversation_id);
    }
    const pendingList = getPendingList(conv.conversation_id);

    const headerEl = document.getElementById('msg-thread-header');
    const reqBanner = document.getElementById('msg-request-banner');
    const isEmpty = !msgs.length && !pendingList.length;
    if (headerEl) headerEl.classList.toggle('is-empty-intro', isEmpty);
    if (reqBanner && conv && !isGroupConv(conv) && conv.status === 'PENDING_REQUEST' && conv.initiator_id === initializedProfile?.id) {
      if (!isEmpty) {
        reqBanner.hidden = false;
        reqBanner.innerHTML = `<div class="msg-req-banner-copy"><strong>Message request pending</strong><p>Waiting for ${escapeHtml(conv.full_name || 'recipient')} to accept. Read receipts stay hidden until accepted.</p></div>`;
      } else {
        reqBanner.hidden = true;
      }
    }

    const scrollWrap = document.getElementById('msg-scroll-wrap');
    scrollWrap?.classList.toggle('is-empty-thread', isEmpty);
    const isGrpHero = isGroupConv(conv);
    const isSelfHero = !isGrpHero && isSelfUser(conv);
    const heroProfileVisible = !conv.anonymous_enabled && (isGrpHero || isSelfHero || conv.profile_visible !== false);
    const heroTitle = convDisplayTitle(conv);
    const statusText = conv.anonymous_enabled ? '' : formatStatusLine(conv);
    const isHeroOnline = isSelfHero || (!isGrpHero && heroProfileVisible && conv.allow_online_status !== false && ipon().isUserOnline(conv.id));
    const heroAvatar = isGrpHero
      ? groupAvatarHtml(conv, 'avatar-lg', { clickable: false })
      : userAvatarHtml(conv, 'avatar-lg', { clickable: false, showPresence: !isSelfHero && heroProfileVisible });
    const heroAvatarNode = conv.anonymous_enabled ? heroAvatar : dpPreviewTriggerHtml(conv.avatar_url, heroTitle, heroAvatar);
    const renderedHeroAvatar = heroProfileVisible ? heroAvatarNode : heroAvatar;
    const welcomeCopy = isGrpHero
      ? 'Messages and files stay private to group members.'
      : isSelfHero
        ? 'Personal notes, reminders, photos, and files saved here are visible only to you.'
        : 'Messages and files in this conversation stay private between you two.';
    const welcomeHtml = `
      <div class="msg-thread-welcome msg-thread-welcome-hero">
        <div class="msg-welcome-avatar">${renderedHeroAvatar}</div>
        <h3 class="msg-welcome-name"><span>${escapeHtml(heroTitle)}</span>${isGrpHero || conv.anonymous_enabled ? '' : userBadgesHtml(conv)}</h3>
        ${!isGrpHero && heroProfileVisible && conv.username ? `<span class="msg-welcome-username">@${escapeHtml(conv.username)}</span>` : ''}
        ${!isSelfHero ? `<div class="msg-welcome-meta" id="msg-welcome-meta"${statusText || isGrpHero ? '' : ' hidden'}>
          <span class="msg-welcome-status${isHeroOnline ? ' is-online' : ''}" id="msg-welcome-status-text"${statusText ? '' : ' hidden'}>${escapeHtml(statusText)}</span>
          ${isGrpHero ? '<span class="msg-rel-chip is-group">Group</span>' : ''}
        </div>` : ''}
        ${heroProfileVisible && (isGrpHero ? conv.description : conv.bio) ? `<p class="msg-welcome-bio">${escapeHtml(isGrpHero ? conv.description : conv.bio)}</p>` : ''}
        ${!isGrpHero && heroProfileVisible && conv.social_links ? (ipon().renderSocialAppLinksHtml?.(conv.social_links, { variant: 'welcome' }) || '') : ''}
        <p class="msg-welcome-hint">${escapeHtml(welcomeCopy)}</p>
      </div>`;

    const isGrp = isGroupConv(conv);
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
        if (conv.anonymous_enabled) {
          return `${dateDivider}${unreadDivider}<div class="msg-system-event" data-msg-id="${escapeHtml(m.id)}"><span>Conversation update &middot; ${escapeHtml(formatClock(m.created_at))}</span></div>`;
        }
        const sysLabel = escapeHtml(m.body || (m.message_type === 'CALL_EVENT' ? 'Call event' : 'System notice'));
        const bodyText = String(m.body || '');
        const metaEvent = String(m.metadata?.event || '');
        const screenshotTaken = m.message_type === 'SYSTEM' && (
          ['screenshot_taken', 'SCREENSHOT'].includes(metaEvent)
          || / took a screenshot\.?$/i.test(bodyText)
        );
        const screenshotBlockToggle = m.message_type === 'SYSTEM' && (
          ['screenshot_block_enabled', 'screenshot_block_disabled'].includes(metaEvent)
          || / turned (on|off) screenshot blocking\.?$/i.test(bodyText)
        );
        const screenshotNotice = screenshotTaken || screenshotBlockToggle;
        const vanishNotice = m.message_type === 'SYSTEM' && (
          ['vanish_enabled', 'vanish_disabled', 'vanish_updated'].includes(m.metadata?.event)
          || / (?:turned (?:on|off) vanishing messages(?:\s+for\s+.+)?|changed vanishing messages to\s+.+)\.?$/i.test(bodyText)
        );
        const isMyActor = Boolean(myId && String(m.sender_id || '') === String(myId));
        const isMySystemActor = screenshotNotice && Boolean(myId && String(m.sender_id || '') === String(myId));
        const screenshotName = screenshotNotice
          ? (isMySystemActor
              ? 'You'
              : bodyText.replace(/ (?:took a screenshot|turned (?:on|off) screenshot blocking)\.?$/i, ''))
          : '';
        const screenshotBlockAction = screenshotBlockToggle
          ? (metaEvent === 'screenshot_block_disabled' || / turned off screenshot blocking\.?$/i.test(bodyText)
              ? 'turned off screenshot blocking'
              : 'turned on screenshot blocking')
          : '';
        const otherSystemMatch = !screenshotNotice && m.message_type === 'SYSTEM'
          ? bodyText.match(/^(.+?)\s+((?:turned (?:on|off) vanishing messages(?:\s+for\s+.+)?|changed vanishing messages to\s+.+|created the group\b.*|renamed the group to\b.*|updated the group\b.*|removed the group photo|added\b.*|made\b.*|removed\b.*|left the group))\.?$/i)
          : null;
        const otherSystemText = otherSystemMatch
          ? (vanishNotice
              ? `<strong>${escapeHtml(isMyActor ? 'You' : otherSystemMatch[1].trim())}</strong> ${escapeHtml(otherSystemMatch[2].trim())}`
              : escapeHtml(`${isMyActor ? 'You' : otherSystemMatch[1].trim()} ${otherSystemMatch[2].trim()}`))
          : sysLabel;
        const eventText = screenshotTaken
          ? `<strong>${escapeHtml(screenshotName)}</strong> took a screenshot`
          : screenshotBlockToggle
            ? `<strong>${escapeHtml(screenshotName)}</strong> ${screenshotBlockAction}`
            : otherSystemText;
        return `${dateDivider}${unreadDivider}<div class="msg-system-event${screenshotNotice ? ' is-screenshot' : vanishNotice ? ' is-vanish' : ''}" data-msg-id="${escapeHtml(m.id)}"><span>${eventText} · ${escapeHtml(formatClock(m.created_at))}</span></div>`;
      }

      const mine = m.sender_id === myId;
      const isDeleted = Boolean(m.deleted_for_everyone_at);
      const vanishStyle = isDeleted ? '' : vanishBubbleStyle(m);
      const prev = msgs[idx - 1];
      const next = msgs[idx + 1];
      const groupedWithPrev = !isNewDate && !unreadDivider && prev && !prev.deleted_for_everyone_at && prev.sender_id === m.sender_id
        && prev.message_type !== 'CALL_EVENT' && prev.message_type !== 'SYSTEM'
        && (Date.parse(m.created_at) - Date.parse(prev.created_at) < 120000);
      const groupedWithNext = next && !next.deleted_for_everyone_at && next.sender_id === m.sender_id
        && next.message_type !== 'CALL_EVENT' && next.message_type !== 'SYSTEM'
        && (Date.parse(next.created_at) - Date.parse(m.created_at) < 120000);

      const groupMember = isGrp ? findGroupMember(conv, m.sender_id) : null;
      const senderVisible = groupMember ? groupMember.profile_visible !== false : true;
      const senderUser = isGrp && !mine
        ? {
            id: m.sender_id,
            profile_visible: senderVisible,
            full_name: m.sender_name || groupMember?.full_name || 'Member',
            avatar_url: senderVisible ? (m.sender_avatar_url || groupMember?.avatar_url || '') : '',
            allow_online_status: !conv.anonymous_enabled && senderVisible && (groupMember ? groupMember.allow_online_status !== false : false),
            anonymous_enabled: Boolean(conv.anonymous_enabled)
          }
        : conv;
      const senderRoleBadge = isGrp && !conv.anonymous_enabled
        ? groupSenderRoleBadgeHtml(
            m.sender_app_role || groupMember?.app_role || (mine ? initializedProfile?.role : ''),
            groupMember?.role
          )
        : '';
      const senderNameHtml = isGrp && !groupedWithPrev && !isDeleted
        ? (mine
            ? `<span class="msg-sender-name is-mine">${escapeHtml(conv.anonymous_enabled ? 'You' : (initializedProfile?.full_name || m.sender_name || 'You'))}${senderRoleBadge}</span>`
            : `<span class="msg-sender-name">${escapeHtml(conv.anonymous_enabled ? 'Anonymous' : senderUser.full_name)}${conv.anonymous_enabled ? '' : userBadgesHtml(senderUser)}${senderRoleBadge}</span>`)
        : '';

      const attHtml = !isDeleted && Array.isArray(m.attachments) && m.attachments.length
        ? `<div class="msg-attachments${m.attachments.length > 1 ? ' is-carousel' : ''}">${m.attachments.map((att) => renderAttachmentItem(conv.conversation_id, att)).join('')}</div>`
        : '';

      const replyHtml = !isDeleted && m.reply_preview
        ? `<button type="button" class="msg-reply-quote" data-jump-msg="${escapeHtml(m.reply_preview.id)}">
            <strong>${escapeHtml(m.reply_preview.sender_id === myId ? 'You' : (m.reply_preview.sender_name || 'User'))}${!conv.anonymous_enabled && m.reply_preview.sender_id && m.reply_preview.sender_id !== myId ? userBadgesHtml(m.reply_preview.sender_id) : ''}</strong>
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
          ${!mine && !isDeleted ? `<span class="msg-swipe-reply-badge" aria-hidden="true">${MSG_REPLY_SVG}</span>` : ''}
          ${!mine ? `<div class="msg-row-avatar">${groupedWithNext ? '' : userAvatarHtml(senderUser, 'avatar-sm')}</div>` : ''}
          <div class="msg-bubble-col">
            ${senderNameHtml}
            ${replyHtml}
            <div class="msg-bubble-wrap">
              <div class="msg-bubble${isDeleted ? ' is-deleted' : ''}${isActivePinned ? ' is-pinned' : ''}${hasTopMedia ? ' has-top-media' : ''}${isMediaOnly ? ' is-media-only' : ''}${hasAudioOnly ? ' has-audio-only' : ''}${vanishStyle ? ' is-vanishing' : ''}"${vanishStyle ? ` style="${vanishStyle}" title="Vanishing message"` : ''}>
                ${bubbleContent}
              </div>
              ${!isDeleted ? `
                <div class="msg-row-actions">
                  ${canInteractInThread(conv) ? `<button type="button" class="msg-action-mini" data-msg-act="react" data-msg-id="${escapeHtml(m.id)}" aria-label="React" title="React">${MSG_REACT_SVG}</button>
                  <button type="button" class="msg-action-mini" data-msg-act="reply" data-msg-id="${escapeHtml(m.id)}" aria-label="Reply" title="Reply">${MSG_REPLY_SVG}</button>` : ''}
                  <button type="button" class="msg-action-mini" data-msg-act="menu" data-msg-id="${escapeHtml(m.id)}" aria-label="More message actions" title="More options">${MSG_MORE_SVG}</button>
                </div>` : ''}
              ${mine && !isDeleted ? `<span class="msg-swipe-reply-badge" aria-hidden="true">${MSG_REPLY_SVG}</span>` : ''}
            </div>
            ${reactionHtml}
          </div>
        </article>`;
    }).join('');

    const pendingClockState = { lastKey: lastShownClockKey };
    const pendingHtml = pendingList.map((p) => renderPendingRowHtml(p, pendingClockState)).join('');
    vanishRingObserver?.disconnect();
    list.innerHTML = `${welcomeHtml}${html}${pendingHtml}`;
    list.querySelectorAll('.msg-bubble.is-vanishing').forEach((bubble) => {
      positionVanishRing(bubble);
      vanishRingObserver?.observe(bubble);
    });
    list.classList.toggle('is-thread-entering', Boolean(animate && !isEmpty));
    ipon().bindAvatarFallbacks(list);
    ipon().syncPresenceDots(list);
    ipon().fitVerifiedNameLines?.(list);
    hydrateThreadMediaElements(list, conv.conversation_id);
    syncThreadScrollLock();
    scheduleVanishExpiry();
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => syncThreadScrollLock());
    if (conv.conversation_id) {
      const missingAttPaths = [];
      msgs.forEach((m) => {
        if (m.deleted_for_everyone_at) return;
        (m.attachments || []).forEach((att) => {
          if (att?.path && !getCachedSignedUrl(att.path)) missingAttPaths.push(att.path);
        });
      });
      if (missingAttPaths.length) scheduleMissingSignedUrls(conv.conversation_id, missingAttPaths);
    }
  }

  function hydrateThreadMediaElements(container, conversationId) {
    if (!container?.querySelectorAll) return;
    container.querySelectorAll('.msg-att-image img').forEach((img) => {
      const fig = img.closest?.('.msg-att-image');
      if (!fig) return;
      const markReady = () => {
        const curSrc = img.currentSrc || img.getAttribute?.('src') || '';
        if (curSrc) state.loadedMediaUrls.add(curSrc);
        fig.classList?.remove?.('is-img-loading');
        fig.classList?.add?.('is-img-loaded');
      };
      if (img.complete && Number(img.naturalWidth || 0) > 0) {
        markReady();
        return;
      }
      img.addEventListener?.('load', () => {
        const finish = () => {
          if (typeof requestAnimationFrame === 'function') requestAnimationFrame(markReady);
          else markReady();
        };
        if (typeof img.decode === 'function') img.decode().then(finish, finish);
        else finish();
      }, { once: true });
      img.addEventListener?.('error', async () => {
        const tries = Number(img.dataset?.retryCount || 0);
        const imgPath = img.dataset?.imgPath || '';
        const convId = img.dataset?.imgConv || conversationId || '';
        if (!imgPath || !convId || tries >= 2) {
          fig.classList?.remove?.('is-img-loading');
          return;
        }
        if (img.dataset) img.dataset.retryCount = String(tries + 1);
        state.signedUrlCache.delete(imgPath);
        state.signedUrlExpiry?.delete?.(imgPath);
        await ensureSignedViewUrls(convId, [imgPath], { imagePaths: new Set([imgPath]) });
        const freshUrl = getCachedSignedUrl(imgPath);
        if (freshUrl && img.isConnected !== false) {
          const btn = img.closest?.('.msg-img-open-btn');
          if (btn?.dataset) btn.dataset.openImg = freshUrl;
          img.setAttribute?.('src', freshUrl);
        }
      });
    });
    container.querySelectorAll('.msg-video-player video').forEach((video) => {
      const player = video.closest?.('.msg-video-player');
      if (!player) return;
      const markVidReady = () => {
        if (player.dataset) player.dataset.vidState = 'ready';
      };
      if (Number(video.readyState || 0) >= 2) {
        markVidReady();
        return;
      }
      video.addEventListener?.('loadeddata', markVidReady, { once: true });
      video.addEventListener?.('canplay', markVidReady, { once: true });
      video.addEventListener?.('error', async () => {
        const tries = Number(video.dataset?.retryCount || 0);
        const vidPath = player.dataset?.vidPath || '';
        const convId = player.dataset?.vidConv || conversationId || '';
        if (!vidPath || !convId || tries >= 1) return;
        if (video.dataset) video.dataset.retryCount = String(tries + 1);
        state.signedUrlCache.delete(vidPath);
        state.signedUrlExpiry?.delete?.(vidPath);
        await ensureSignedViewUrls(convId, [vidPath]);
        const freshUrl = getCachedSignedUrl(vidPath);
        if (freshUrl && video.isConnected !== false) {
          video.setAttribute?.('src', freshUrl);
          try { video.load?.(); } catch { }
        }
      });
    });
  }

  function renderAttachmentItem(conversationId, att) {
    const url = getCachedSignedUrl(att.path);
    const safeName = escapeHtml(att.name || 'file');
    const sizeText = escapeHtml(formatBytes(att.size));
    if (att.kind === 'image') {
      const isReady = Boolean(url && state.loadedMediaUrls.has(url));
      return `<figure class="msg-att-image${isReady ? ' is-img-loaded' : ' is-img-loading'}">
        ${url
          ? `<button type="button" class="msg-img-open-btn" data-open-img="${escAttr(url)}" data-img-name="${escAttr(att.name || 'image')}" data-img-conv="${escAttr(conversationId)}" data-img-path="${escAttr(att.path)}" aria-label="View original ${safeName}">
              <img src="${escAttr(url)}" alt="${safeName}" decoding="async" fetchpriority="high" data-img-conv="${escAttr(conversationId)}" data-img-path="${escAttr(att.path)}">
            </button>`
          : '<div class="msg-att-loading msg-skel" role="status"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg><span>Loading image…</span></div>'}
      </figure>`;
    }
    if (att.kind === 'video') {
      const vidKey = getVideoMetaKey(att.path, url);
      const cached = vidKey ? videoMetaCache.get(vidKey) : null;
      const hasPoster = Boolean(cached?.poster);
      const boxStyle = formatVideoBoxStyle(cached);
      if (url && vidKey && !cached?.poster && !cached?.failed && !videoPosterInFlight.has(vidKey)) {
        Promise.resolve().then(() => probeAndCaptureVideoMeta(url, vidKey));
      }
      return `<div class="msg-att-media-card">
        ${url ? `<div class="msg-video-player" data-vid-state="${hasPoster ? 'ready' : 'loading'}" data-vid-conv="${escAttr(conversationId)}" data-vid-path="${escAttr(att.path)}" data-vid-name="${escAttr(att.name || 'video')}" data-vid-key="${escAttr(vidKey)}"${boxStyle ? ` style="${escAttr(boxStyle)}"` : ''}>
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

  function setVanishHint(msg = '', isBad = false) {
    const hintEl = document.getElementById('msg-vanish-hint');
    const input = document.getElementById('msg-vanish-custom-value');
    if (hintEl) {
      hintEl.textContent = msg || VANISH_HINT_TEXT;
      hintEl.classList.toggle('is-bad', Boolean(isBad));
    }
    if (input) {
      input.classList.toggle('is-bad', Boolean(isBad));
      input.setAttribute('aria-invalid', isBad ? 'true' : 'false');
    }
  }

  function syncVanishModalControls() {
    const conv = state.activeThread?.conversation;
    const unavailable = Boolean(conv?.vanish_unavailable);
    const disabled = unavailable || state.savingVanish;
    const isCurrentlyOn = Boolean(Number(conv?.vanish_after_seconds) || 0);
    const input = document.getElementById('msg-vanish-custom-value');
    const secBtn = document.getElementById('msg-vanish-unit-sec');
    const minBtn = document.getElementById('msg-vanish-unit-min');
    const confirmBtn = document.getElementById('msg-vanish-confirm');
    const customWrap = document.getElementById('msg-vanish-custom-wrap');
    document.querySelectorAll('#msg-vanish-chips [data-vanish-preset]').forEach((btn) => {
      const sec = Number(btn.dataset.vanishPreset);
      const selected = !state.vanishDraftCustom && sec === state.vanishDraftSeconds;
      btn.setAttribute('aria-checked', selected ? 'true' : 'false');
      btn.disabled = disabled;
      btn.tabIndex = (selected || (state.vanishDraftCustom && sec === VANISH_PRESETS[0])) ? 0 : -1;
    });
    if (customWrap) customWrap.classList.toggle('is-off', disabled);
    if (input) {
      input.max = String(state.vanishCustomUnit === 'minutes' ? 60 : 3600);
      input.classList.toggle('is-active', Boolean(state.vanishDraftCustom));
      input.disabled = disabled;
    }
    if (secBtn) {
      secBtn.setAttribute('aria-pressed', state.vanishCustomUnit === 'seconds' ? 'true' : 'false');
      secBtn.disabled = disabled;
    }
    if (minBtn) {
      minBtn.setAttribute('aria-pressed', state.vanishCustomUnit === 'minutes' ? 'true' : 'false');
      minBtn.disabled = disabled;
    }
    if (confirmBtn) {
      confirmBtn.disabled = disabled;
      confirmBtn.textContent = state.savingVanish ? 'Saving…' : (isCurrentlyOn ? 'Save' : 'Turn on');
    }
  }

  function validateVanishCustomInput(showError = false) {
    const input = document.getElementById('msg-vanish-custom-value');
    if (!input) return state.vanishDraftCustom ? null : state.vanishDraftSeconds;
    const unit = state.vanishCustomUnit === 'minutes' ? 'minutes' : 'seconds';
    const max = unit === 'minutes' ? 60 : 3600;
    input.max = String(max);
    if (!state.vanishDraftCustom) {
      input.setCustomValidity('');
      setVanishHint('', false);
      return state.vanishDraftSeconds;
    }
    const raw = String(input.value || '').trim();
    const value = Number(raw);
    const error = !/^\d+$/.test(raw) || !Number.isInteger(value) || value < 1 || value > max
      ? `Enter a whole number from 1 to ${max} ${unit}.` : '';
    input.setCustomValidity(error);
    if (showError && error) {
      setVanishHint(error, true);
    } else {
      setVanishHint('', false);
    }
    return error ? null : value * (unit === 'minutes' ? 60 : 1);
  }

  function renderVanishModal() {
    const body = document.getElementById('msg-vanish-modal-body');
    const conv = state.activeThread?.conversation;
    if (!body || !conv) return;
    const isGrp = isGroupConv(conv);
    const vanishSeconds = Number(conv.vanish_after_seconds) || 0;
    const unavailable = Boolean(conv.vanish_unavailable);
    const disabled = unavailable || state.savingVanish;
    const clockSvg = '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="13" r="7.5" stroke-dasharray="3 2.6"/><path d="M12 9.5V13l2.4 1.6"/><path d="M9.5 3h5"/></svg>';
    const statusLine = unavailable
      ? '<p class="msg-vanish-unavail" id="msg-vanish-unavail" role="status">Timer unavailable.<button type="button" class="msg-vanish-link" data-vanish-retry>Try again</button></p>'
      : (state.vanishError
          ? `<p class="msg-vanish-unavail" id="msg-vanish-unavail" role="status">${escapeHtml(state.vanishError)}</p>`
          : '');
    body.innerHTML = `
      <form id="msg-vanish-custom-form" novalidate>
        <div class="msg-vanish-modal-head">
          <span class="msg-vanish-tile" aria-hidden="true">${clockSvg}</span>
          <h3 id="msg-vanish-modal-title">Set vanish timer</h3>
          <button type="button" class="dialog-close msg-vanish-close" data-vanish-close aria-label="Close">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M5 5l14 14M19 5L5 19"/></svg>
          </button>
        </div>
        <p class="msg-vanish-explain">Messages vanish this long after ${isGrp ? 'every recipient' : 'the other person'} sees them.</p>
        ${statusLine}
        <span class="msg-vanish-label" id="msg-vanish-dur-label">Vanish after</span>
        <div class="msg-vanish-chips" id="msg-vanish-chips" role="radiogroup" aria-labelledby="msg-vanish-dur-label">
          ${VANISH_PRESETS.map((sec) => {
            const selected = !state.vanishDraftCustom && sec === state.vanishDraftSeconds;
            const tabIdx = (selected || (state.vanishDraftCustom && sec === VANISH_PRESETS[0])) ? 0 : -1;
            return `<button type="button" class="msg-vanish-chip" data-vanish-preset="${sec}" role="radio" aria-checked="${selected ? 'true' : 'false'}" tabindex="${tabIdx}"${disabled ? ' disabled' : ''}>${escapeHtml(formatVanishShort(sec))}</button>`;
          }).join('')}
        </div>
        <div class="msg-vanish-custom${disabled ? ' is-off' : ''}" id="msg-vanish-custom-wrap">
          <label class="msg-vanish-label" for="msg-vanish-custom-value">Custom duration</label>
          <div class="msg-vanish-custom-row">
            <input class="msg-vanish-field${state.vanishDraftCustom ? ' is-active' : ''}" id="msg-vanish-custom-value" type="number" inputmode="numeric" min="1" max="${state.vanishCustomUnit === 'minutes' ? 60 : 3600}" step="1" placeholder="e.g. 90" value="${escAttr(state.vanishCustomValue)}" aria-describedby="msg-vanish-hint"${disabled ? ' disabled' : ''}>
            <div class="msg-vanish-seg" role="group" aria-label="Duration unit">
              <button type="button" id="msg-vanish-unit-sec" data-vanish-unit="seconds" aria-pressed="${state.vanishCustomUnit === 'seconds' ? 'true' : 'false'}"${disabled ? ' disabled' : ''}>Sec</button>
              <button type="button" id="msg-vanish-unit-min" data-vanish-unit="minutes" aria-pressed="${state.vanishCustomUnit === 'minutes' ? 'true' : 'false'}"${disabled ? ' disabled' : ''}>Min</button>
            </div>
          </div>
          <p class="msg-vanish-hint" id="msg-vanish-hint" role="status" aria-live="polite">${VANISH_HINT_TEXT}</p>
        </div>
        <div class="msg-vanish-foot">
          <button type="button" class="msg-vanish-btn-ghost" data-vanish-close>Cancel</button>
          <button type="submit" class="msg-vanish-btn" id="msg-vanish-confirm"${disabled ? ' disabled' : ''}>${state.savingVanish ? 'Saving…' : (vanishSeconds > 0 ? 'Save' : 'Turn on')}</button>
        </div>
      </form>`;
  }

  function openVanishModal() {
    const conv = state.activeThread?.conversation;
    const dlg = document.getElementById('msg-vanish-dialog');
    if (!conv || !dlg) return;
    const current = Number(conv.vanish_after_seconds) || 0;
    state.vanishError = '';
    if (current > 0 && !VANISH_PRESETS.includes(current)) {
      state.vanishDraftSeconds = current;
      state.vanishDraftCustom = true;
      state.vanishCustomUnit = current >= 60 && current % 60 === 0 ? 'minutes' : 'seconds';
      state.vanishCustomValue = String(state.vanishCustomUnit === 'minutes' ? current / 60 : current);
    } else {
      state.vanishDraftSeconds = current > 0 ? current : 300;
      state.vanishDraftCustom = false;
      state.vanishCustomValue = '';
      state.vanishCustomUnit = 'seconds';
    }
    renderVanishModal();
    if (!dlg.open) dlg.showModal();
  }

  function restoreDrawerScrollInstant(scrollTop) {
    if (scrollTop == null) return;
    const bodyEl = document.querySelector?.('#msg-thread-drawer .msg-drawer-body.is-root');
    if (!bodyEl) return;
    const prevBehavior = bodyEl.style ? bodyEl.style.scrollBehavior : '';
    if (bodyEl.style) bodyEl.style.scrollBehavior = 'auto';
    bodyEl.scrollTop = scrollTop;
    if (bodyEl.style) bodyEl.style.scrollBehavior = prevBehavior;
  }

  function closeVanishModal() {
    const dlg = document.getElementById('msg-vanish-dialog');
    if (!dlg?.open) return;
    const bodyEl = document.querySelector?.('#msg-thread-drawer .msg-drawer-body.is-root');
    const savedScrollTop = bodyEl ? bodyEl.scrollTop : null;
    dlg.close();
    restoreDrawerScrollInstant(savedScrollTop);
    document.querySelector?.('[data-vanish-switch]')?.focus?.({ preventScroll: true });
    restoreDrawerScrollInstant(savedScrollTop);
  }

  async function saveVanishSetting(seconds, { closeModalOnSuccess = false } = {}) {
    if (state.savingVanish || !state.activeConvId || !Number.isInteger(seconds) || seconds < 0 || seconds > 3600) return false;
    const conversationId = state.activeConvId;
    state.savingVanish = true;
    state.vanishError = '';
    document.querySelectorAll?.('[data-vanish-switch], [data-vanish-open-modal]').forEach((el) => { el.disabled = true; });
    if (document.getElementById('msg-vanish-dialog')?.open) syncVanishModalControls();
    let ok = false;
    try {
      const next = await ipon().rpc('set_conversation_vanish', {
        p_conversation_id: conversationId,
        p_seconds: seconds || null
      });
      if (state.activeConvId === conversationId && state.activeThread?.conversation) {
        Object.assign(state.activeThread.conversation, next);
        state.vanishCustomValue = '';
        state.vanishDraftCustom = false;
      }
      ok = true;
      if (state.activeConvId === conversationId) {
        await openConversation(conversationId, { markRead: false, silent: true, scrollToBottom: true });
      }
    } catch (error) {
      if (state.activeConvId === conversationId) state.vanishError = ipon().friendlyError(error);
    } finally {
      state.savingVanish = false;
      if (state.activeConvId === conversationId) {
        const bodyBefore = document.querySelector?.('#msg-thread-drawer .msg-drawer-body.is-root');
        const savedScrollTop = bodyBefore ? bodyBefore.scrollTop : null;
        if (ok && closeModalOnSuccess) closeVanishModal();
        renderThreadInfoDrawer();
        restoreDrawerScrollInstant(savedScrollTop);
        if (document.getElementById('msg-vanish-dialog')?.open) {
          renderVanishModal();
        } else {
          document.querySelector?.('[data-vanish-switch]')?.focus?.({ preventScroll: true });
          restoreDrawerScrollInstant(savedScrollTop);
        }
      }
    }
    return ok;
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
    const previousScrollTop = drawer.dataset.conversationId === conv.conversation_id
      ? drawer.querySelector('.msg-drawer-body.is-root')?.scrollTop : null;
    state.threadInfoView = view;
    const media = [];
    const docs = [];
    msgs.forEach((m) => {
      if (m.deleted_for_everyone_at) return;
      (m.attachments || []).forEach((a) => {
        const entry = { att: a, msgId: m.id, createdAt: m.created_at };
        if (a.kind === 'image' || a.kind === 'video') media.push(entry);
        else if (!isVoiceAttachment(a, m)) docs.push(entry);
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
    const leaveIconSvg = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>';
    const isGrp = typeof isGroupConv === 'function' ? isGroupConv(conv) : String(conv?.kind || '').toUpperCase() === 'GROUP';
    const myId = typeof initializedProfile !== 'undefined' ? String(initializedProfile?.id || '') : '';
    const myGroupRole = String(conv.my_role || 'MEMBER').toUpperCase();
    const canManageGroup = isGrp && (myGroupRole === 'OWNER' || myGroupRole === 'ADMIN');
    const members = isGrp && Array.isArray(conv.members) ? conv.members : [];
    const isBlockedByMe = !isGrp && conv.friendship_status === 'BLOCKED_BY_ME';
    const iponApi = typeof ipon === 'function' ? ipon() : null;
    const grpTitle = typeof convDisplayTitle === 'function' ? convDisplayTitle(conv) : String(conv?.title || conv?.full_name || 'Group Chat');
    if (isGrp && state.groupEditAvatarConvId !== conv.conversation_id) {
      state.groupEditAvatarDataUrl = null;
      state.groupEditAvatarClear = false;
      state.groupEditAvatarConvId = conv.conversation_id;
    }
    const grpDraftUrl = isGrp ? state.groupEditAvatarDataUrl : null;
    const grpClearPic = isGrp ? Boolean(state.groupEditAvatarClear) : false;
    const hasEffectiveGrpPic = isGrp && (Boolean(grpDraftUrl) || (!grpClearPic && Boolean(conv.avatar_url)));
    const grpAvHtml = isGrp
      ? groupPicPreviewMarkup({ conv, dataUrl: grpDraftUrl, clear: grpClearPic, title: grpTitle, sizeClass: 'avatar-lg' })
      : '';
    const grpMiniAvHtml = isGrp
      ? groupPicPreviewMarkup({ conv, dataUrl: grpDraftUrl, clear: grpClearPic, title: grpTitle, sizeClass: 'avatar-md' })
      : '';
    const addIconSvg = typeof NEW_GROUP_ICON_SVG !== 'undefined' ? NEW_GROUP_ICON_SVG : '';
    const moreDotsSvg = typeof MSG_MORE_SVG !== 'undefined' ? MSG_MORE_SVG : '';

    const profileSectionHtml = isGrp
      ? `<div class="msg-drawer-profile">
          <div class="msg-drawer-avatar-wrap">
            <span class="msg-drawer-avatar-slot${!grpClearPic && (grpDraftUrl || conv.avatar_url) ? ' is-viewable' : ''}" id="msg-group-drawer-avatar-slot">${grpAvHtml}</span>
            ${canManageGroup ? `<button type="button" class="msg-drawer-avatar-edit-btn" id="msg-group-avatar-quick-btn" title="Change group photo" aria-label="Change group photo">${CAMERA_ICON_SVG}</button>` : ''}
          </div>
          <strong>${escapeHtml(grpTitle)}</strong>
          <small>${members.length || Number(conv.member_count || 2)} ${(members.length || Number(conv.member_count || 2)) === 1 ? 'member' : 'members'}</small>
          ${conv.description ? `<p class="msg-drawer-bio">${escapeHtml(conv.description)}</p>` : ''}
          ${canManageGroup ? '<button type="button" class="msg-drawer-edit-link" id="msg-group-edit-toggle">Edit group photo &amp; details</button>' : ''}
          ${canManageGroup ? `
            <form class="msg-group-edit-form" id="msg-group-edit-form" hidden novalidate>
              <div class="msg-group-avatar-picker is-compact">
                <div class="msg-group-avatar-preview" id="msg-group-edit-pic-preview">${grpMiniAvHtml}</div>
                <div class="msg-group-avatar-copy">
                  <span class="msg-group-avatar-label">Group photo</span>
                  <div class="msg-group-avatar-actions">
                    <button type="button" class="button button-secondary button-sm" id="msg-group-edit-pic-btn">${hasEffectiveGrpPic ? 'Change photo' : 'Upload photo'}</button>
                    <button type="button" class="button button-secondary button-sm is-danger-ghost" id="msg-group-edit-pic-remove"${hasEffectiveGrpPic ? '' : ' hidden'}>Remove</button>
                  </div>
                  <input id="msg-group-edit-pic-input" type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden>
                </div>
              </div>
              <div class="field">
                <label class="sr-only" for="msg-group-edit-title">Group name</label>
                <input id="msg-group-edit-title" type="text" maxlength="80" value="${escAttr(conv.title || '')}" placeholder="Group name (2–80 characters)" autocomplete="off">
                <small class="field-error msg-stable-error" id="msg-group-edit-error" aria-hidden="true"></small>
              </div>
              <div class="field">
                <label class="sr-only" for="msg-group-edit-desc">Description</label>
                <textarea id="msg-group-edit-desc" rows="2" maxlength="240" placeholder="Optional group topic or goal…">${escapeHtml(conv.description || '')}</textarea>
              </div>
              <div class="msg-group-edit-actions">
                <button type="button" class="button button-secondary button-sm" id="msg-group-edit-cancel">Cancel</button>
                <button type="submit" class="button button-primary button-sm" id="msg-group-edit-save" disabled data-dirty-locked="true" title="Make a change before saving.">Save</button>
              </div>
            </form>` : ''}
        </div>`
      : (() => {
          const peerDpUrl = typeof safeDpUrl === 'function'
            ? safeDpUrl(conv.avatar_url)
            : ((typeof conv?.avatar_url === 'string' && /^(?:data:image\/|https:\/\/)/i.test(conv.avatar_url.trim())) ? conv.avatar_url.trim() : '');
          const peerAv = userAvatarHtml(conv, 'avatar-lg', { clickable: false, showPresence: false });
          const peerAvNode = peerDpUrl
            ? `<button type="button" class="msg-dp-preview-trigger msg-drawer-dp-btn" data-view-dp-src="${escAttr(peerDpUrl)}" data-view-dp-name="${escAttr(conv.full_name || 'User')}" aria-label="View profile picture for ${escAttr(conv.full_name || 'User')}" title="View photo">${peerAv}</button>`
            : peerAv;
          return `<div class="msg-drawer-profile">
          ${peerAvNode}
          <strong title="${escAttr(conv.full_name || 'User')}"><span class="verified-name-text">${escapeHtml(conv.full_name || 'User')}</span>${conv.anonymous_enabled ? '' : (iponApi?.verifiedBadgesHtml?.(conv) || '')}</strong>
          ${conv.username ? `<small>@${escapeHtml(conv.username)}</small>` : ''}
          ${conv.bio ? `<p class="msg-drawer-bio">${escapeHtml(conv.bio)}</p>` : ''}
          ${iponApi?.renderSocialAppLinksHtml?.(conv.social_links, { variant: 'drawer' }) || ''}
        </div>`;
        })();

    const actionsGridHtml = isGrp
      ? `<button type="button" class="msg-drawer-action-btn" data-conv-act="${conv.is_pinned ? 'unpin' : 'pin'}">${MSG_PIN_SVG}<span>${conv.is_pinned ? 'Unpin chat' : 'Pin chat'}</span></button>
         <button type="button" class="msg-drawer-action-btn" data-conv-act="${conv.is_muted ? 'unmute' : 'mute'}">${bellMuteSvg}<span>${conv.is_muted ? 'Unmute' : 'Mute'}</span></button>
         <button type="button" class="msg-drawer-action-btn" data-conv-act="${conv.is_archived ? 'unarchive' : 'archive'}">${archiveIconSvg}<span>${conv.is_archived ? 'Unarchive' : 'Archive'}</span></button>
         <button type="button" class="msg-drawer-action-btn" data-conv-act="mark_unread">${mailUnreadIconSvg}<span>Mark unread</span></button>
         ${canManageGroup && !conv.anonymous_enabled ? `<button type="button" class="msg-drawer-action-btn" data-group-add-members="${escapeHtml(conv.conversation_id)}">${addIconSvg}<span>Add members</span></button>` : ''}
         <button type="button" class="msg-drawer-action-btn" data-conv-act="delete_for_me">${trashIconSvg}<span>Clear chat</span></button>
         <button type="button" class="msg-drawer-action-btn is-danger" data-group-leave="${escapeHtml(conv.conversation_id)}">${leaveIconSvg}<span>Leave group</span></button>`
      : `<button type="button" class="msg-drawer-action-btn" data-conv-act="${conv.is_pinned ? 'unpin' : 'pin'}">${MSG_PIN_SVG}<span>${conv.is_pinned ? 'Unpin chat' : 'Pin chat'}</span></button>
         <button type="button" class="msg-drawer-action-btn" data-conv-act="${conv.is_muted ? 'unmute' : 'mute'}">${bellMuteSvg}<span>${conv.is_muted ? 'Unmute' : 'Mute'}</span></button>
         <button type="button" class="msg-drawer-action-btn" data-conv-act="${conv.is_archived ? 'unarchive' : 'archive'}">${archiveIconSvg}<span>${conv.is_archived ? 'Unarchive' : 'Archive'}</span></button>
         <button type="button" class="msg-drawer-action-btn" data-conv-act="mark_unread">${mailUnreadIconSvg}<span>Mark unread</span></button>
         <button type="button" class="msg-drawer-action-btn" data-conv-act="delete_for_me">${trashIconSvg}<span>Delete for me</span></button>
         ${(typeof isSelfUser === 'function' && isSelfUser(conv)) ? '' : `<button type="button" class="msg-drawer-action-btn is-danger" data-social-action="${isBlockedByMe ? 'unblock' : 'block'}" data-target-id="${escapeHtml(conv.id)}">${blockIconSvg}<span>${isBlockedByMe ? 'Unblock user' : 'Block user'}</span></button>`}`;

    const canManageProtection = !conv.protection_unavailable && !state.savingProtection && (!isGrp || canManageGroup);
    const nativePrivacy = typeof supportsNativeScreenshotProtection === 'function'
      ? supportsNativeScreenshotProtection()
      : (typeof window !== 'undefined' && typeof window.IponNativePrivacy?.setScreenshotBlocked === 'function');
    const screenshotEligible = Boolean(conv.screenshot_block_eligible) && !(typeof hasLiveBrowserParticipant === 'function' && hasLiveBrowserParticipant(conv));
    const androidShell = nativePrivacy || (typeof window !== 'undefined' && (window.Capacitor?.getPlatform?.() === 'android'
      || /myIPONApp\/\d+/i.test(window.navigator?.userAgent || '')));
    conv._renderedScreenshotEligible = screenshotEligible;
    const screenshotActive = Boolean(conv.block_screenshots);
    const canToggleScreenshots = canManageProtection && nativePrivacy && (screenshotEligible || Boolean(conv.block_screenshots));
    const screenshotDesc = 'Protect this chat on Android devices';
    const phoneSvg = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="2.5" width="10" height="19" rx="2.4"/><path d="M10.5 18.5h3"/></svg>';
    const forwardBlockSvg = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 5 6 5-6 5v-3.2c-4.2 0-7 1.2-9 4.2.4-4.6 3.2-7.8 9-8.4V5Z"/><path d="M4 4 20 20"/></svg>';
    const screenshotRowHtml = nativePrivacy && screenshotEligible || (nativePrivacy && screenshotActive)
      ? `<div class="msg-privacy-row${canToggleScreenshots ? '' : ' is-disabled'}">
          <span class="msg-privacy-icon">${phoneSvg}</span>
          <div class="msg-privacy-copy"><div class="msg-privacy-titleline"><strong id="msg-privacy-shot-title">Block screenshots</strong><span class="msg-privacy-chip">Android</span></div><small id="msg-privacy-shot-desc">${screenshotDesc}</small></div>
          <div class="msg-privacy-control"><button type="button" class="msg-privacy-switch" role="switch" data-chat-protection="screenshots" aria-checked="${screenshotActive}" aria-labelledby="msg-privacy-shot-title" aria-describedby="msg-privacy-shot-desc"${canToggleScreenshots ? '' : ' disabled'}></button><span>${screenshotActive ? 'On' : 'Off'}</span></div>
        </div>`
      : '';
    const protectionHtml = `<div class="msg-drawer-section msg-privacy-section"><section class="msg-privacy-card" aria-labelledby="msg-privacy-title">
      <div class="msg-privacy-head"><h4 id="msg-privacy-title">Chat privacy</h4></div>
      ${conv.protection_unavailable ? '<div class="msg-privacy-note" role="status"><span>Chat privacy is temporarily unavailable. Messages still work.</span><button type="button" data-chat-protection-retry>Try again</button></div>' : ''}
      ${androidShell && (!nativePrivacy || !screenshotEligible) && !conv.protection_unavailable ? `<div class="msg-privacy-note" role="status"><span>${nativePrivacy ? 'Screenshot protection needs everyone on Android.' : 'Screenshot protection is unavailable in this app session.'}</span><button type="button" data-chat-protection-retry${state.checkingProtection ? ' disabled' : ''}>${state.checkingProtection ? 'Checking…' : 'Check again'}</button></div>` : ''}
      <div class="msg-privacy-list">
        ${screenshotRowHtml}
        ${!isSelfUser(conv) && conv.status === 'ACCEPTED' ? `<div class="msg-privacy-row${canManageProtection ? '' : ' is-disabled'}">
          <span class="msg-privacy-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M4 10c2-4 5-6 8-6s6 2 8 6v7c-2 2-5 3-8 3s-6-1-8-3z"/><path d="M8 12h3m2 0h3m-7 4h6"/></svg></span>
          <div class="msg-privacy-copy"><div class="msg-privacy-titleline"><strong id="msg-privacy-anon-title">Anonymous mode</strong></div><small id="msg-privacy-anon-desc">Hide names and DPs for ${isGrp ? 'everyone in this group' : 'both people'}. Messages sent while on are deleted for ${isGrp ? 'everyone' : 'both'} when turned off.</small></div>
          <div class="msg-privacy-control"><button type="button" class="msg-privacy-switch" role="switch" data-anonymous-toggle aria-checked="${Boolean(conv.anonymous_enabled)}" aria-labelledby="msg-privacy-anon-title" aria-describedby="msg-privacy-anon-desc"${canManageProtection ? '' : ' disabled'}></button><span>${conv.anonymous_enabled ? 'On' : 'Off'}</span></div>
        </div>` : ''}
        ${isGrp ? `<div class="msg-privacy-row${canManageProtection ? '' : ' is-disabled'}">
          <span class="msg-privacy-icon">${phoneSvg}</span>
          <div class="msg-privacy-copy"><div class="msg-privacy-titleline"><strong id="msg-privacy-notices-title">Screenshot notices</strong></div><small id="msg-privacy-notices-desc">Show Android app screenshot notices to everyone in this group</small></div>
          <div class="msg-privacy-control"><button type="button" class="msg-privacy-switch" role="switch" data-chat-protection="screenshot_notices" aria-checked="${Boolean(conv.screenshot_notices_enabled)}" aria-labelledby="msg-privacy-notices-title" aria-describedby="msg-privacy-notices-desc"${canManageProtection ? '' : ' disabled'}></button><span>${conv.screenshot_notices_enabled ? 'On' : 'Off'}</span></div>
        </div>` : ''}
        <div class="msg-privacy-row${canManageProtection ? '' : ' is-disabled'}">
          <span class="msg-privacy-icon">${forwardBlockSvg}</span>
          <div class="msg-privacy-copy"><div class="msg-privacy-titleline"><strong id="msg-privacy-forward-title">Block forwarding</strong></div><small id="msg-privacy-forward-desc">Messages from this chat cannot be forwarded in myIPON</small></div>
          <div class="msg-privacy-control"><button type="button" class="msg-privacy-switch" role="switch" data-chat-protection="forwarding" aria-checked="${Boolean(conv.block_forwarding)}" aria-labelledby="msg-privacy-forward-title" aria-describedby="msg-privacy-forward-desc"${canManageProtection ? '' : ' disabled'}></button><span>${conv.block_forwarding ? 'On' : 'Off'}</span></div>
        </div>
      </div></section></div>`;

    const vanishSeconds = Number(conv.vanish_after_seconds) || 0;
    const isSelfConv = !isGrp && typeof isSelfUser === 'function' && isSelfUser(conv);
    const canManageVanish = !conv.vanish_unavailable && !state.savingVanish && conv.status === 'ACCEPTED'
      && (!isGrp || canManageGroup) && !isSelfConv;
    const vanishHourglassSvg = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6.5 3h11M6.5 21h11"/><path d="M7.5 3c0 4.2 2.6 5.6 4.5 7.5C14 8.6 16.5 7.2 16.5 3"/><path d="M7.5 21c0-4.2 2.6-5.6 4.5-7.5 2 1.9 4.5 3.3 4.5 7.5"/></svg>';
    const vanishClockSvg = '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="13" r="7.5" stroke-dasharray="3 2.6"/><path d="M12 9.5V13l2.4 1.6"/><path d="M9.5 3h5"/></svg>';
    const vanishShortLabel = typeof formatVanishShort === 'function'
      ? formatVanishShort(vanishSeconds)
      : formatVanishDuration(vanishSeconds);
    const vanishRestrictionNote = conv.vanish_unavailable
      ? '<p class="msg-vanish-unavail" role="status">Timer unavailable.<button type="button" class="msg-vanish-link" data-vanish-retry>Try again</button></p>'
      : (isSelfConv
          ? '<p class="msg-vanish-info-note">Unavailable for saved messages.</p>'
          : (conv.status !== 'ACCEPTED'
              ? '<p class="msg-vanish-info-note">Available once this message request is accepted.</p>'
              : (isGrp && !canManageGroup
                  ? '<p class="msg-vanish-info-note">Only group owners and admins can change this timer.</p>'
                  : '')));
    const vanishDialogOpen = typeof document !== 'undefined' && Boolean(document.getElementById('msg-vanish-dialog')?.open);
    const vanishHtml = `<div class="msg-drawer-section msg-vanish-section"><section class="msg-vanish-panel" aria-labelledby="msg-vanish-title">
      <div class="msg-vanish-head">${vanishHourglassSvg}<h4 id="msg-vanish-title">Vanishing messages</h4></div>
      <p class="msg-vanish-note-copy">New messages vanish after ${isGrp ? 'every recipient' : 'the other person'} sees them. The blue border shows the time left.</p>
      ${vanishRestrictionNote}
      <div class="msg-vanish-card">
        <div class="msg-vanish-top">
          <span class="msg-vanish-tile" aria-hidden="true">${vanishClockSvg}</span>
          <div class="msg-vanish-copy">
            <div class="msg-vanish-card-title" id="msg-vanish-card-label">Vanishing messages</div>
            <p class="msg-vanish-status">${vanishSeconds > 0
              ? `On · vanish after <b>${escapeHtml(vanishShortLabel)}</b>${canManageVanish ? '<button type="button" class="msg-vanish-link" data-vanish-open-modal>Change</button>' : ''}`
              : 'Off'}</p>
          </div>
          <button type="button" class="msg-vanish-switch" data-vanish-switch role="switch" aria-checked="${vanishSeconds > 0 ? 'true' : 'false'}" aria-labelledby="msg-vanish-card-label"${canManageVanish ? '' : ' disabled'}></button>
        </div>
      </div>
      ${state.vanishError && !vanishDialogOpen ? `<p class="msg-vanish-unavail" role="status">${escapeHtml(state.vanishError)}</p>` : ''}
    </section></div>`;

    const membersSectionHtml = isGrp && !conv.anonymous_enabled
      ? `<div class="msg-drawer-section">
          <div class="msg-drawer-sec-head">
            <h4>Members (${members.length})</h4>
            ${canManageGroup ? `<button type="button" class="msg-drawer-sec-add" data-group-add-members="${escapeHtml(conv.conversation_id)}">+ Add</button>` : ''}
          </div>
          <ul class="msg-group-members-list">
            ${members.map((m) => {
              const isMe = String(m.id || '') === myId;
              const role = String(m.role || 'MEMBER').toUpperCase();
              const roleBadge = role === 'OWNER'
                ? '<span class="msg-group-role-badge is-owner">Owner</span>'
                : (role === 'ADMIN' ? '<span class="msg-group-role-badge is-admin">Admin</span>' : '');
              return `<li class="msg-group-member-row">
                ${userAvatarHtml(m, 'avatar-sm', { clickable: !isMe, showPresence: !isMe })}
                <div class="msg-group-member-meta">
                  <strong><span>${escapeHtml(m.full_name || 'Member')}</span>${iponApi?.verifiedBadgesHtml?.(m) || ''}${isMe ? ' <em>(You)</em>' : ''}${roleBadge}</strong>
                  ${m.username ? `<small>@${escapeHtml(m.username)}</small>` : `<small>${escapeHtml(m.is_friend ? 'Friend' : 'Group member')}</small>`}
                </div>
                ${!isMe ? `<button type="button" class="msg-conv-more-btn msg-group-member-more" data-group-member-menu="${escapeHtml(m.id)}" aria-label="Member options for ${escapeHtml(m.full_name || 'Member')}" title="Member options">${moreDotsSvg}</button>` : ''}
              </li>`;
            }).join('')}
          </ul>
        </div>`
      : '';

    drawer.innerHTML = `
      <div class="msg-drawer-head">
        <h3>${isGrp ? 'Group Info &amp; Options' : 'Chat Info &amp; Options'}</h3>
        ${closeBtnHtml}
      </div>
      <div class="msg-drawer-body is-root" data-drawer-screen="root">
        <div class="msg-drawer-section is-top">
          ${profileSectionHtml}
          <div class="msg-drawer-actions-block">
            <h4>Chat actions</h4>
            <div class="msg-drawer-actions">
              ${actionsGridHtml}
            </div>
          </div>
        </div>
        ${membersSectionHtml}
        ${protectionHtml}
        ${vanishHtml}
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
    drawer.dataset.conversationId = conv.conversation_id;
    if (previousScrollTop != null) {
      const bodyEl = drawer.querySelector('.msg-drawer-body.is-root');
      if (bodyEl) {
        const prevBehavior = bodyEl.style ? bodyEl.style.scrollBehavior : '';
        if (bodyEl.style) bodyEl.style.scrollBehavior = 'auto';
        bodyEl.scrollTop = previousScrollTop;
        if (bodyEl.style) bodyEl.style.scrollBehavior = prevBehavior;
      }
    }
    iponApi?.bindAvatarFallbacks?.(drawer);
    iponApi?.syncPresenceDots?.(drawer);
    iponApi?.fitVerifiedNameLines?.(drawer);
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
        ? `<div class="msg-cards-grid">${incoming_requests.map((r) => {
          const fcText = formatFriendCountText(r.friends_count);
          const metaParts = [r.username ? `@${r.username}` : `Sent ${formatShortDate(r.created_at)}`];
          if (fcText) metaParts.push(fcText);
          return `
            <article class="msg-person-card">
              <div class="msg-person-head">
                ${userAvatarHtml({ id: r.user_id, full_name: r.full_name, avatar_url: r.avatar_url, profile_visible: r.profile_visible, allow_online_status: false }, 'avatar-md', { showPresence: false })}
                <div>
                  <strong>${escapeHtml(r.full_name)}${r.profile_visible === false ? '' : userBadgesHtml(r.user_id)}</strong>
                  <small>${escapeHtml(metaParts.join(' · '))}</small>
                </div>
              </div>
              ${renderMutualStackHtml(r.user_id, r.mutual_friends, r.mutual_friends_count)}
              <div class="msg-person-actions">
                <button type="button" class="button button-primary button-sm" data-req-decision="ACCEPT" data-req-id="${escapeHtml(r.id)}">Accept</button>
                <button type="button" class="button button-secondary button-sm" data-req-decision="DECLINE" data-req-id="${escapeHtml(r.id)}">Decline</button>
                <button type="button" class="button button-secondary button-sm is-danger" data-social-action="block" data-target-id="${escapeHtml(r.user_id)}">Block</button>
              </div>
            </article>`;
        }).join('')}</div>`
        : '<div class="empty-state"><strong>No incoming friend requests</strong><p>New friend requests appear here with real-time badge updates.</p></div>';
    } else {
      host.innerHTML = sent_requests.length
        ? `<div class="msg-cards-grid">${sent_requests.map((r) => {
          const fcText = formatFriendCountText(r.friends_count);
          const metaParts = [`Sent ${formatShortDate(r.created_at)}`];
          if (fcText) metaParts.push(fcText);
          return `
            <article class="msg-person-card">
              <div class="msg-person-head">
                ${userAvatarHtml({ id: r.user_id, full_name: r.full_name, avatar_url: r.avatar_url, profile_visible: r.profile_visible, allow_online_status: false }, 'avatar-md', { showPresence: false })}
                <div>
                  <strong>${escapeHtml(r.full_name)}${r.profile_visible === false ? '' : userBadgesHtml(r.user_id)}</strong>
                  <small>${escapeHtml(metaParts.join(' · '))}</small>
                </div>
              </div>
              ${renderMutualStackHtml(r.user_id, r.mutual_friends, r.mutual_friends_count)}
              <div class="msg-person-actions">
                <button type="button" class="button button-secondary button-sm" data-cancel-req="${escapeHtml(r.id)}">Cancel request</button>
              </div>
            </article>`;
        }).join('')}</div>`
        : '<div class="empty-state"><strong>No pending sent requests</strong><p>Requests you send remain here until accepted, declined, or cancelled.</p></div>';
    }

    ipon().bindAvatarFallbacks(view);
    ipon().syncPresenceDots(view);
  }

  function renderFriendCardHtml(f) {
    const fcText = formatFriendCountText(f.friends_count);
    const metaParts = [];
    if (f.username) metaParts.push(`@${f.username}`);
    if (fcText) metaParts.push(fcText);
    const friendStatus = formatStatusLine(f);
    const showPresenceDot = !friendStatus && f.profile_visible !== false && f.allow_online_status !== false && !f.is_blocked && f.friendship_status !== 'BLOCKED_BY_ME' && f.friendship_status !== 'BLOCKED_ME';
    return `<article class="msg-person-card" data-friend-card data-search-blob="${escAttr(`${f.full_name} ${f.username || ''}`.toLowerCase())}">
      <div class="msg-person-head">
        ${userAvatarHtml(f, 'avatar-md', { showPresence: showPresenceDot })}
        <div>
          <strong>${escapeHtml(f.full_name)}${userBadgesHtml(f)}</strong>
          ${metaParts.length ? `<small>${escapeHtml(metaParts.join(' · '))}</small>` : ''}
          ${friendStatus ? `<small>${escapeHtml(friendStatus)}</small>` : ''}
        </div>
      </div>
      ${renderMutualStackHtml(f.id, f.mutual_friends, f.mutual_friends_count)}
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
        ipon().rpc('search_social_users', { p_query: q, p_limit: 50 }).catch(() => []),
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
        ${rows.length ? rows.map((n) => {
          const anonymousNotice = (state.conversations || []).some((c) => c.anonymous_enabled && n.link?.includes(`chat=${c.id}`));
          const rawTitle = String(n.title || 'User').trim();
          const cleanTitle = anonymousNotice ? 'Anonymous' : (rawTitle.replace(/^(?:New message from|New reply from|Message request from)\s+/i, '').trim() || rawTitle);
          const peerFromConv = anonymousNotice ? null : (state.conversations || []).find((c) => c.peer && (c.peer.id === n.actor_id || String(c.peer.full_name || '').toLowerCase() === cleanTitle.toLowerCase()))?.peer;
          const avatarUrl = anonymousNotice ? 'assets/anonymous-avatar.svg' : (n.actor_avatar_url || peerFromConv?.avatar_url || ipon().getMemberAvatar?.(n.actor_id || cleanTitle) || null);
          return `
          <button type="button" class="msg-alert-row has-sender-avatar${n.read_at ? '' : ' is-unread'}" data-social-alert-id="${escapeHtml(n.id)}" data-social-link="${escAttr(n.link || '')}" data-social-type="${escAttr(n.type || '')}">
            <span class="msg-alert-avatar" aria-hidden="true">${anonymousNotice ? '<img class="avatar-circle avatar-md" src="assets/anonymous-avatar.svg" alt="">' : (ipon().avatarMarkup ? ipon().avatarMarkup(avatarUrl, cleanTitle, 'avatar-md', n.actor_id || peerFromConv?.id || '') : '')}</span>
            <div class="msg-alert-copy">
              <strong>${escapeHtml(cleanTitle)}</strong>
              <p>${escapeHtml(anonymousNotice ? 'Conversation update' : n.message)}</p>
              <small>${escapeHtml(ipon().dateLabel(n.created_at, { dateStyle: 'medium', timeStyle: 'short' }))}</small>
            </div>
            ${n.read_at ? '' : '<i class="notification-unread" aria-label="Unread"></i>'}
          </button>`;
        }).join('') : '<div class="empty-state"><strong>No messaging notifications yet</strong><p>Friend requests, replies, and message requests will show up here in real time.</p></div>'}
      </div>`;
    ipon().bindAvatarFallbacks?.(view);
  }

  // Profile Quick Action Popover (anchored near clicked DP with automatic edge clamping)
  let activePopoverAnchor = null;

  function normalizeMutualFriends(rawList) {
    if (!Array.isArray(rawList)) return [];
    const seen = new Set();
    const out = [];
    for (const item of rawList) {
      if (!item || typeof item !== 'object') continue;
      const id = String(item.id || item.user_id || '').trim();
      const fullName = String(item.full_name || '').trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push({
        id,
        full_name: fullName || 'Community member',
        username: String(item.username || '').trim(),
        avatar_url: item.avatar_url || null
      });
    }
    return out;
  }

  function cacheMutualFriends(userId, mutualFriends, mutualCount) {
    const key = String(userId || '').trim();
    if (!key) return { count: 0, friends: [] };
    const normalized = normalizeMutualFriends(mutualFriends);
    const existing = mutualFriendsCache.get(key);
    const friends = normalized.length >= (existing?.friends?.length || 0) ? normalized : existing.friends;
    const count = Math.max(Number(mutualCount || 0), friends.length);
    const entry = { count, friends };
    if (count > 0) mutualFriendsCache.set(key, entry);
    else mutualFriendsCache.delete(key);
    return entry;
  }

  function renderMutualStackHtml(userId, mutualFriends, mutualCount, { compact = false } = {}) {
    const { count, friends } = cacheMutualFriends(userId, mutualFriends, mutualCount);
    if (count <= 0) return '';
    const shown = friends.slice(0, 3);
    const slotCount = shown.length || Math.min(3, count);
    const avatarsHtml = shown.length
      ? shown.map((m) => `<span class="msg-mutual-av">${userAvatarHtml({ id: m.id, full_name: m.full_name, avatar_url: m.avatar_url, allow_online_status: false }, 'avatar-sm', { clickable: false, showPresence: false })}</span>`).join('')
      : Array.from({ length: slotCount }, () => '<span class="msg-mutual-av is-placeholder" aria-hidden="true">?</span>').join('');
    const overflowBadge = count > 3 ? `<span class="msg-mutual-more" aria-hidden="true">+${count - 3}</span>` : '';
    const label = compact ? `${count} mutual` : `${count} mutual friend${count === 1 ? '' : 's'}`;
    return `<div class="msg-mutual-wrap${compact ? ' is-compact' : ''}">
      <button type="button" class="msg-mutual-trigger${compact ? ' is-compact' : ''}" data-mutual-trigger="${escapeHtml(userId)}" aria-expanded="false" aria-label="${escapeHtml(`${count} mutual friend${count === 1 ? '' : 's'} — view list`)}">
        <span class="msg-mutual-stack" aria-hidden="true">${avatarsHtml}${overflowBadge}</span>
        <span class="msg-mutual-label">${escapeHtml(label)}</span>
      </button>
    </div>`;
  }

  function renderMutualPopoverContent(pop, userId, count, friends, loading = false) {
    const total = Math.max(Number(count || 0), friends.length);
    const rowsHtml = loading
      ? '<p class="msg-mutual-pop-empty">Loading mutual friends…</p>'
      : (friends.length
        ? `<div class="msg-mutual-pop-list" role="list">
            ${friends.map((m) => `
              <button type="button" class="msg-mutual-pop-item" role="listitem" data-social-user-dp="${escapeHtml(m.id)}">
                ${userAvatarHtml({ id: m.id, full_name: m.full_name, avatar_url: m.avatar_url, allow_online_status: false }, 'avatar-sm', { clickable: false, showPresence: false })}
                <span class="msg-mutual-pop-copy">
                  <strong>${escapeHtml(m.full_name)}${userBadgesHtml(m)}</strong>
                  ${m.username ? `<small>@${escapeHtml(m.username)}</small>` : ''}
                </span>
              </button>`).join('')}
          </div>`
        : '<p class="msg-mutual-pop-empty">Mutual friend details are unavailable right now.</p>');
    const footHtml = !loading && friends.length > 0 && total > friends.length
      ? `<p class="msg-mutual-pop-foot">Showing ${friends.length} of ${total} mutual friends</p>`
      : '';
    pop.innerHTML = `
      <div class="msg-mutual-pop-head">
        <strong>${total} Mutual Friend${total === 1 ? '' : 's'}</strong>
        <button type="button" class="dialog-close msg-mutual-pop-close" data-mutual-close aria-label="Close mutual friends">${MSG_CLOSE_X_SVG}</button>
      </div>
      ${rowsHtml}
      ${footHtml}`;
    ipon().bindAvatarFallbacks?.(pop);
    ipon().syncPresenceDots?.(pop);
  }

  function clearMutualHoverTimer() {
    if (mutualHoverTimer) {
      clearTimeout(mutualHoverTimer);
      mutualHoverTimer = null;
    }
  }

  function closeMutualPopover() {
    clearMutualHoverTimer();
    if (activeMutualAnchor?.setAttribute) activeMutualAnchor.setAttribute('aria-expanded', 'false');
    activeMutualAnchor = null;
    const pop = document.getElementById('msg-mutual-popover');
    if (pop) {
      pop.hidden = true;
      pop.dataset.pinned = '0';
      delete pop.dataset.userId;
    }
  }

  async function openMutualPopover(userId, anchorEl, { pinned = false } = {}) {
    const pop = document.getElementById('msg-mutual-popover');
    const key = String(userId || '').trim();
    if (!pop || !key || !anchorEl) return;
    const cached = mutualFriendsCache.get(key) || { count: 0, friends: [] };
    if (!cached.count && !cached.friends.length) return;
    clearMutualHoverTimer();
    const activeDialog = document.querySelector('#msg-workspace-dialog[open], #msg-forward-dialog[open], #msg-settings-dialog[open], dialog[open]');
    const targetHost = activeDialog || document.body;
    if (pop.parentElement !== targetHost) targetHost.appendChild(pop);
    if (activeMutualAnchor && activeMutualAnchor !== anchorEl) activeMutualAnchor.setAttribute?.('aria-expanded', 'false');
    activeMutualAnchor = anchorEl;
    activeMutualAnchor.setAttribute?.('aria-expanded', 'true');
    pop.dataset.userId = key;
    if (pinned || pop.hidden || pop.dataset.pinned !== '1') {
      pop.dataset.pinned = pinned ? '1' : '0';
    }
    const needsHydration = cached.count > 0 && cached.friends.length === 0;
    renderMutualPopoverContent(pop, key, cached.count, cached.friends, needsHydration);
    pop.hidden = false;
    positionPopoverNearAnchor(pop, anchorEl);

    if (needsHydration) {
      try {
        const profile = await ipon().rpc('get_social_user_profile', { p_target_id: key });
        const updated = cacheMutualFriends(key, profile?.mutual_friends, profile?.mutual_friends_count ?? cached.count);
        if (!pop.hidden && pop.dataset.userId === key) {
          renderMutualPopoverContent(pop, key, updated.count, updated.friends, false);
          positionPopoverNearAnchor(pop, activeMutualAnchor);
        }
      } catch (_) {
        if (!pop.hidden && pop.dataset.userId === key) {
          renderMutualPopoverContent(pop, key, cached.count, [], false);
          positionPopoverNearAnchor(pop, activeMutualAnchor);
        }
      }
    }
  }

  function clearProfileHoverTimers() {
    if (profileHoverTimer) {
      clearTimeout(profileHoverTimer);
      profileHoverTimer = null;
    }
    if (profileLeaveTimer) {
      clearTimeout(profileLeaveTimer);
      profileLeaveTimer = null;
    }
  }

  function normalizeCardAppearance(appearance) {
    if (appearance?.profile_visible === false) {
      return { profile_visible: false, card_theme: 'emerald', cover_url: '', profile_effect: 'none', social_links: {} };
    }
    const theme = ['emerald', 'midnight', 'rose', 'amber', 'ocean', 'mono'].includes(appearance?.card_theme)
      ? appearance.card_theme
      : 'emerald';
    const effectsApi = typeof window !== 'undefined' ? window.IponProfileEffects : null;
    const rawEffect = appearance?.profile_effect ?? appearance?.equipped_profile_effect ?? 'none';
    const effectId = effectsApi?.normalizeEffectId ? effectsApi.normalizeEffectId(rawEffect) : 'none';
    const cover = safeDpUrl(appearance?.cover_url);
    const socialLinks = ipon()?.sanitizeSocialLinks ? ipon().sanitizeSocialLinks(appearance?.social_links) : {};
    return { profile_visible: true, card_theme: theme, cover_url: cover || '', profile_effect: effectId, social_links: socialLinks };
  }

  function cacheProfileAppearance(targetId, appearance) {
    if (!targetId || !appearance || typeof appearance !== 'object') return null;
    const key = String(targetId);
    const prev = profileAppearanceCache.get(key);
    const merged = {
      ...appearance,
      social_links: ('social_links' in appearance) ? appearance.social_links : (prev?.social_links || {})
    };
    const norm = normalizeCardAppearance(merged);
    profileAppearanceCache.set(key, { ...norm, updatedAt: Date.now() });
    if (norm.cover_url && typeof Image === 'function') {
      try {
        const pre = new Image();
        pre.src = norm.cover_url;
      } catch (_) { }
    }
    return norm;
  }

  function getCachedProfileAppearance(targetId, fallbackProfile = null) {
    const key = String(targetId || '');
    if (key && profileAppearanceCache.has(key)) return profileAppearanceCache.get(key);
    if (fallbackProfile && typeof fallbackProfile === 'object') {
      return cacheProfileAppearance(key || fallbackProfile.id, {
        card_theme: fallbackProfile.card_theme,
        cover_url: fallbackProfile.cover_url,
        profile_effect: fallbackProfile.equipped_profile_effect || fallbackProfile.profile_effect,
        social_links: fallbackProfile.social_links
      });
    }
    return null;
  }

  function syncPopoverSocialAppsSlot(pop, socialLinks) {
    const appsSlot = pop?.querySelector?.('.msg-pop-apps-slot');
    if (!appsSlot) return false;
    const clean = ipon()?.sanitizeSocialLinks ? ipon().sanitizeSocialLinks(socialLinks) : {};
    const sig = JSON.stringify(clean);
    if (appsSlot.dataset.appsSig === sig) return false;
    appsSlot.dataset.appsSig = sig;
    const appsHtml = ipon()?.renderSocialAppLinksHtml?.(clean, { variant: 'popover' }) || '';
    appsSlot.innerHTML = appsHtml;
    appsSlot.hidden = !appsHtml;
    return true;
  }

  function applyProfileCardAppearance(pop, targetId, appearance) {
    if (!pop || pop.hidden || pop.dataset.targetId !== String(targetId) || !pop.querySelector('.msg-pop-head')) return;
    const norm = cacheProfileAppearance(targetId, appearance) || normalizeCardAppearance(null);
    if (appearance && typeof appearance === 'object' && 'social_links' in appearance) {
      syncPopoverSocialAppsSlot(pop, norm.social_links);
    }
    const prevTheme = pop.dataset.cardTheme || '';
    const prevEffect = pop.dataset.profileEffect || '';
    const existingBanner = pop.querySelector('.msg-pop-cover');
    const existingImgSrc = existingBanner?.querySelector('img')?.getAttribute('src') || '';
    const hasSameBanner = Boolean(existingBanner) && existingImgSrc === norm.cover_url;
    if (hasSameBanner && prevTheme === norm.card_theme && prevEffect === norm.profile_effect && (norm.profile_effect === 'none' || profileEffectStage)) {
      return;
    }

    pop.dataset.cardTheme = norm.card_theme;
    pop.dataset.profileEffect = norm.profile_effect;
    if (!hasSameBanner) {
      const banner = document.createElement('div');
      banner.className = 'msg-pop-cover';
      if (norm.cover_url) {
        const image = document.createElement('img');
        image.src = norm.cover_url;
        image.alt = '';
        image.addEventListener('error', () => image.remove());
        banner.appendChild(image);
      }
      existingBanner?.remove();
      pop.prepend(banner);
    }

    const effectsApi = typeof window !== 'undefined' ? window.IponProfileEffects : null;
    if (norm.profile_effect !== 'none' && effectsApi?.mountStage) {
      if (profileEffectStage && prevEffect !== norm.profile_effect) {
        profileEffectStage.destroy?.();
        profileEffectStage = null;
      }
      if (!profileEffectStage) {
        profileEffectStage = effectsApi.mountStage(pop, {
          effectId: norm.profile_effect,
          fps: 60,
          maxDpr: 2
        });
      }
      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(() => profileEffectStage?.refreshGeometry?.());
      }
    } else if (profileEffectStage) {
      profileEffectStage.destroy?.();
      profileEffectStage = null;
    }
  }

  async function loadProfileCardAppearance(pop, targetId) {
    try {
      const appearance = await ipon().rpc('get_profile_card_appearance', { p_target_id: targetId });
      if (!appearance || pop.hidden || pop.dataset.targetId !== String(targetId) || !pop.querySelector('.msg-pop-head')) return;
      const norm = cacheProfileAppearance(targetId, appearance);
      const changed = (pop.dataset.cardTheme || '') !== norm.card_theme
        || (pop.dataset.profileEffect || '') !== norm.profile_effect
        || (pop.querySelector('.msg-pop-cover img')?.getAttribute('src') || '') !== norm.cover_url
        || ('social_links' in appearance && (pop.querySelector('.msg-pop-apps-slot')?.dataset.appsSig || '') !== JSON.stringify(norm.social_links || {}));
      applyProfileCardAppearance(pop, targetId, norm);
      if (changed) positionPopoverNearAnchor(pop, activePopoverAnchor);
    } catch (_) { /* Keep the profile usable if appearance is unavailable. */ }
  }

  async function openProfilePopover(targetUserId, anchorEl, { pinned = true } = {}) {
    const pop = document.getElementById('msg-profile-popover');
    if (!pop || !targetUserId) return;
    const isSelfTarget = String(targetUserId) === String(initializedProfile?.id);
    if (isSelfTarget && !anchorEl?.dataset?.socialHoverDp) return;
    clearProfileHoverTimers();
    profileEffectStage?.destroy?.();
    profileEffectStage = null;
    // Keep the popover inside the top-most open modal dialog so Top Layer stacking never obscures it.
    const activeDialog = document.querySelector('#msg-workspace-dialog[open], #msg-forward-dialog[open], #msg-settings-dialog[open], dialog[open]');
    const targetHost = activeDialog || document.body;
    if (pop.parentElement !== targetHost) targetHost.appendChild(pop);
    activePopoverAnchor = anchorEl || null;
    pop.dataset.targetId = String(targetUserId);
    pop.querySelector('.msg-pop-cover')?.remove();
    const cachedAppearance = getCachedProfileAppearance(targetUserId, isSelfTarget ? initializedProfile : null);
    if (cachedAppearance && (isSelfTarget || cachedAppearance.profile_visible !== false)) {
      pop.dataset.cardTheme = cachedAppearance.card_theme;
      pop.dataset.profileEffect = cachedAppearance.profile_effect;
    } else {
      delete pop.dataset.cardTheme;
      delete pop.dataset.profileEffect;
    }
    pop.dataset.pinned = pinned ? '1' : '0';
    pop.hidden = false;

    if (isSelfTarget) {
      const selfUsername = String(initializedProfile?.username || '').trim().replace(/^@+/, '');
      const myFriendsCountText = formatFriendCountText((state.overview?.friends || []).length);
      const selfParts = [];
      if (selfUsername) selfParts.push(`@${selfUsername}`);
      if (myFriendsCountText) selfParts.push(myFriendsCountText);
      const bioText = String(initializedProfile?.bio || '').trim();
      const fromAnnouncement = Boolean(anchorEl?.dataset?.socialHoverDp);
      const selfSocialLinks = (cachedAppearance?.social_links && Object.keys(cachedAppearance.social_links).length)
        ? cachedAppearance.social_links
        : (initializedProfile?.social_links || {});
      const selfSocialAppsHtml = ipon().renderSocialAppLinksHtml?.(selfSocialLinks, { variant: 'popover' }) || '';
      const selfAppsSig = JSON.stringify(ipon().sanitizeSocialLinks ? ipon().sanitizeSocialLinks(selfSocialLinks) : {});
      pop.innerHTML = `
        <button type="button" class="dialog-close msg-pop-close" id="msg-pop-close" aria-label="Close profile popover"><svg viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18"/></svg></button>
        <div class="msg-pop-head">
          ${dpPreviewTriggerHtml(initializedProfile?.avatar_url, initializedProfile?.full_name || 'Your profile', userAvatarHtml(initializedProfile, 'avatar-lg', { clickable: false, showPresence: false }))}
          <div class="msg-pop-title">
            <strong id="msg-pop-name">${escapeHtml(initializedProfile?.full_name || 'Your profile')}${userBadgesHtml(initializedProfile)}</strong>
            <div class="msg-pop-status-row"><span class="msg-rel-badge">You</span>${selfParts.length ? `<small class="msg-pop-status">${escapeHtml(selfParts.join(' · '))}</small>` : ''}</div>
          </div>
        </div>
        ${bioText ? `<p class="msg-pop-bio">${escapeHtml(bioText)}</p>` : ''}
        <div class="msg-pop-apps-slot" data-apps-sig="${escAttr(selfAppsSig)}"${selfSocialAppsHtml ? '' : ' hidden'}>${selfSocialAppsHtml}</div>
        <p class="msg-pop-bio">${fromAnnouncement ? 'Connected social profile for announcements' : 'Message yourself to keep personal notes and files.'}</p>
        <div class="msg-pop-actions">
          <button type="button" class="msg-pop-btn msg-pop-primary-btn" data-social-action="message" data-target-id="${escapeHtml(initializedProfile.id)}">Message yourself</button>
        </div>`;
      ipon().bindAvatarFallbacks(pop);
      ipon().syncPresenceDots(pop);
      ipon().fitVerifiedNameLines?.(pop);
      applyProfileCardAppearance(pop, targetUserId, cachedAppearance);
      positionPopoverNearAnchor(pop, activePopoverAnchor);
      void loadProfileCardAppearance(pop, targetUserId);
      return;
    }

    pop.innerHTML = skeletonHtml('popover');
    positionPopoverNearAnchor(pop, activePopoverAnchor);

    try {
      const [profile, fetchedAppearance] = await Promise.all([
        ipon().rpc('get_social_user_profile', { p_target_id: targetUserId }),
        ipon().rpc('get_profile_card_appearance', { p_target_id: targetUserId }).catch(() => cachedAppearance)
      ]);
      if (pop.hidden || pop.dataset.targetId !== String(targetUserId)) return;
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
      const isProfilePrivate = profile.profile_visible === false || fetchedAppearance?.profile_visible === false;
      const mutualCount = isProfilePrivate ? 0 : Number(profile.mutual_friends_count || 0);
      const mutualHtml = isProfilePrivate ? '' : renderMutualStackHtml(profile.id, profile.mutual_friends, mutualCount);
      const friendCountText = isProfilePrivate ? '' : formatFriendCountText(profile.friends_count);
      const cleanUsername = isProfilePrivate ? '' : String(profile.username || '').trim().replace(/^@+/, '');
      const statusLine = statusLabels[fs] || 'Community member';
      const metaParts = [];
      if (cleanUsername) metaParts.push(`@${cleanUsername}`);
      if (fs !== 'FRIENDS') metaParts.push(statusLine);
      if (friendCountText) metaParts.push(friendCountText);
      if (!mutualHtml && mutualCount > 0) metaParts.push(`${mutualCount} mutual friend${mutualCount === 1 ? '' : 's'}`);
      const statusRowHtml = metaParts.length
        ? `<small class="msg-pop-status">${escapeHtml(metaParts.join(' · '))}</small>`
        : '';
      const bioText = isProfilePrivate ? '' : String(profile.bio || '').trim();
      const peerSocialLinks = !isProfilePrivate && ipon().sanitizeSocialLinks ? ipon().sanitizeSocialLinks(profile.social_links) : {};
      const peerSocialAppsHtml = !isProfilePrivate ? (ipon().renderSocialAppLinksHtml?.(peerSocialLinks, { variant: 'popover' }) || '') : '';
      const peerAppsSig = JSON.stringify(peerSocialLinks);
      const canMessage = Boolean(profile.can_message);
      const popAvatar = userAvatarHtml(profile, 'avatar-lg', { clickable: false, showPresence: false });
      const popAvatarTrigger = dpPreviewTriggerHtml(profile?.avatar_url, profile?.full_name || 'User', popAvatar);
      const renderedPopAvatar = isProfilePrivate ? popAvatar : popAvatarTrigger;
      const visMode = String(profile.profile_visibility || '').toUpperCase();
      const privateNoteText = fs === 'BLOCKED_BY_ME' || fs === 'BLOCKED_ME'
        ? 'Profile details are hidden while messaging is blocked.'
        : visMode === 'NOBODY'
          ? 'This profile is private. Only direct chat connections can view details.'
          : visMode === 'FRIENDS_AND_CONNECTIONS'
            ? 'Only friends and chat connections can view full profile details.'
            : visMode === 'FRIENDS_ONLY'
              ? 'Only friends can view full profile details.'
              : visMode === 'FRIENDS_OF_FRIENDS'
                ? 'Only friends and friends of friends can view full profile details.'
                : 'Full profile details are private.';
      const lockSvg = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>';

      pop.innerHTML = `
        <button type="button" class="dialog-close msg-pop-close" id="msg-pop-close" aria-label="Close profile popover"><svg viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18"/></svg></button>
        <div class="msg-pop-head">
          ${renderedPopAvatar}
          <div class="msg-pop-title">
            <strong id="msg-pop-name">${escapeHtml(profile.full_name)}${userBadgesHtml(profile)}</strong>
            ${statusRowHtml}
          </div>
        </div>
        ${isProfilePrivate ? `<div class="msg-pop-private-note" role="note">${lockSvg}<span>${escapeHtml(privateNoteText)}</span></div>` : ''}
        ${mutualHtml}
        ${bioText ? `<p class="msg-pop-bio">${escapeHtml(bioText)}</p>` : ''}
        <div class="msg-pop-apps-slot" data-apps-sig="${escAttr(peerAppsSig)}"${peerSocialAppsHtml ? '' : ' hidden'}>${peerSocialAppsHtml}</div>
        <div class="msg-pop-actions">
          ${friendAction}
          <div class="msg-pop-secondary-row${canMessage ? '' : ' is-single'}">
            ${canMessage ? `<button type="button" class="msg-pop-btn msg-pop-outline-btn" data-social-action="message" data-target-id="${escapeHtml(profile.id)}">Message</button>` : ''}
            <button type="button" class="msg-pop-btn msg-pop-outline-btn is-danger" data-social-action="${fs === 'BLOCKED_BY_ME' ? 'unblock' : 'block'}" data-target-id="${escapeHtml(profile.id)}">${fs === 'BLOCKED_BY_ME' ? 'Unblock User' : 'Block User'}</button>
          </div>
        </div>`;

      ipon().bindAvatarFallbacks(pop);
      ipon().syncPresenceDots(pop);
      ipon().fitVerifiedNameLines?.(pop);
      if (isProfilePrivate) {
        profileAppearanceCache.delete(String(targetUserId));
        profileEffectStage?.destroy?.();
        profileEffectStage = null;
        pop.querySelector('.msg-pop-cover')?.remove();
        delete pop.dataset.cardTheme;
        delete pop.dataset.profileEffect;
      } else {
        applyProfileCardAppearance(pop, targetUserId, {
          ...(fetchedAppearance || cachedAppearance || {}),
          social_links: peerSocialLinks
        });
      }
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
    const pw = Math.min(popRect.width || (pop.id === 'msg-mutual-popover' ? 280 : 364), vw - pad * 2);
    const ph = popRect.height || (pop.id === 'msg-mutual-popover' ? 220 : 260);
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
    clearProfileHoverTimers();
    closeMutualPopover();
    profileEffectStage?.destroy?.();
    profileEffectStage = null;
    activePopoverAnchor = null;
    const pop = document.getElementById('msg-profile-popover');
    if (pop) {
      pop.hidden = true;
      pop.dataset.pinned = '0';
      delete pop.dataset.targetId;
      delete pop.dataset.cardTheme;
      delete pop.dataset.profileEffect;
    }
  }

  // Composer Context, Emoji, Upload Queue, Voice Note & Sending
  function autoResizeTextarea(el) {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(140, Math.max(40, el.scrollHeight))}px`;
    el.style.overflowY = el.scrollHeight > 140 ? 'auto' : 'hidden';
  }

  function restoreDraftAfterEdit() {
    const inp = document.getElementById('msg-composer-input');
    const restoredDraft = state.activeConvId ? (state.draftsByConv.get(state.activeConvId) || '') : '';
    if (inp) {
      inp.value = restoredDraft;
      autoResizeTextarea(inp);
      syncComposerCharCounter(inp.value.length);
    }
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
      const conv = state.activeThread?.conversation;
      const targetName = conv?.anonymous_enabled ? 'Anonymous' : (state.replyToMsg.sender_name || findGroupMember(conv, state.replyToMsg.sender_id)?.full_name || convDisplayTitle(conv));
      const senderLabel = state.replyToMsg.sender_id === initializedProfile?.id ? 'yourself' : (targetName || 'User');
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
    const activeConv = state.activeThread?.conversation;
    if (activeConv && !canInteractInThread(activeConv)) {
      ipon().toast(isFriendsOnlyLocked(activeConv) ? 'This user only accepts messages and files from friends.' : 'You cannot attach files to this conversation.', 'error');
      return;
    }
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
    const activeConv = state.activeThread?.conversation;
    if (activeConv && !canInteractInThread(activeConv)) {
      ipon().toast(isFriendsOnlyLocked(activeConv) ? 'This user only accepts messages from friends.' : 'You cannot reply to this conversation.', 'error');
      return;
    }
    const input = document.getElementById('msg-composer-input');
    const sendBtn = document.getElementById('msg-send-btn');
    const body = String(input?.value || '').trim();

    if (state.editingMsg) {
      if (!body) {
        ipon().toast('Message cannot be empty.', 'error');
        return;
      }
      if (sendBtn?.disabled) return;
      const convId = state.activeConvId;
      const editingTarget = state.editingMsg;
      const rawBeforeSubmit = input ? input.value : body;
      state.editingMsg = null;
      sendTypingBroadcast(false);
      state.draftsByConv.delete(convId);
      if (input) { input.value = ''; autoResizeTextarea(input); }
      syncComposerCharCounter(0);
      renderContextBar();
      if (sendBtn) { sendBtn.disabled = true; sendBtn.classList.add('is-submitting'); }
      try {
        await ipon().rpc('edit_chat_message', { p_message_id: editingTarget.id, p_body: body });
        state.draftsByConv.delete(convId);
        const liveInput = document.getElementById('msg-composer-input');
        if (liveInput && !state.editingMsg && liveInput.value.trim() === body) {
          liveInput.value = '';
          autoResizeTextarea(liveInput);
          syncComposerCharCounter(0);
        }
        await Promise.all([openConversation(convId, { markRead: false, silent: true }), refreshConversations()]);
      } catch (err) {
        if (state.activeConvId === convId) {
          state.editingMsg = editingTarget;
          renderContextBar();
          const liveInput = document.getElementById('msg-composer-input');
          if (liveInput && !liveInput.value) {
            liveInput.value = rawBeforeSubmit;
            autoResizeTextarea(liveInput);
            syncComposerCharCounter(liveInput.value.length);
          }
        }
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
    const wrapBeforeSend = document.getElementById('msg-scroll-wrap');
    const preserveReplyScroll = Boolean(replyTarget) && (state.threadStickyBottom === false || !isThreadNearBottom(wrapBeforeSend));
    const lockedSendScrollTop = wrapBeforeSend ? wrapBeforeSend.scrollTop : null;

    sendTypingBroadcast(false);
    if (input) { input.value = ''; autoResizeTextarea(input); }
    syncComposerCharCounter(0);
    state.draftsByConv.delete(convId);
    state.replyToMsg = null;
    renderContextBar();
    clearUploadQueue({ keepUrls: true });
    if (input) {
      try { input.focus({ preventScroll: true }); } catch { input.focus(); }
    }

    if (queuedFiles.length <= MAX_ATTACHMENTS_PER_MSG) {
      enqueuePendingMessage({
        conversationId: convId,
        body,
        messageType: queuedFiles.length ? 'MEDIA' : 'TEXT',
        replyToMsg: replyTarget,
        files: queuedFiles,
        preserveScroll: preserveReplyScroll
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
        deferProcess: true,
        preserveScroll: preserveReplyScroll
      });
      if (item) batches.push(item);
    }
    if (convId === state.activeConvId) {
      renderMessagesList();
      requestAnimationFrame(() => {
        const wrap = document.getElementById('msg-scroll-wrap');
        if (!wrap) return;
        if (preserveReplyScroll && typeof lockedSendScrollTop === 'number') wrap.scrollTop = lockedSendScrollTop;
        else wrap.scrollTop = wrap.scrollHeight;
      });
    }
    batches.forEach(queuePendingMessage);
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
      payload: {
        user_id: initializedProfile.id,
        user_name: state.activeThread?.conversation?.anonymous_enabled ? 'Anonymous' : (initializedProfile.full_name || ''),
        avatar_url: state.activeThread?.conversation?.anonymous_enabled ? '' : (initializedProfile.avatar_url || ''),
        typing: next
      }
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
    const activeConv = state.activeThread?.conversation;
    if (activeConv && !canInteractInThread(activeConv)) {
      ipon().toast(isFriendsOnlyLocked(activeConv) ? 'This user only accepts voice messages from friends.' : 'You cannot send voice messages here.', 'error');
      return;
    }
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
      ipon().playUiSound?.('msg-voice-start');
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
    if (!send) ipon().playUiSound?.('msg-voice-cancel');

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

  // Group Chat Modal (Create & Add Members), Forward, Delete, Privacy & Settings Modals
  async function openGroupChatDialog({ mode = 'create', conversationId = null } = {}) {
    if (!isEligible()) return;
    ensureDialogsMounted();
    const dialog = document.getElementById('msg-group-dialog');
    const titleEl = document.getElementById('msg-group-dialog-title');
    const subEl = document.getElementById('msg-group-dialog-sub');
    const body = document.getElementById('msg-group-body');
    if (!dialog || !body) return;

    const isAddMode = mode === 'add_members' && Boolean(conversationId);
    const activeConv = isAddMode ? state.activeThread?.conversation : null;
    const existingIds = new Set(
      isAddMode
        ? (activeConv?.members || []).map((m) => String(m.id || '')).filter(Boolean)
        : [String(initializedProfile?.id || '')]
    );
    const maxAllowed = isAddMode ? Math.max(0, 50 - existingIds.size) : 49;

    if (titleEl) titleEl.textContent = isAddMode ? 'Add Members to Group' : 'New Group Chat';
    if (subEl) {
      subEl.hidden = !isAddMode;
      subEl.textContent = isAddMode
        ? `Add eligible members to "${convDisplayTitle(activeConv)}" (${maxAllowed} spot${maxAllowed === 1 ? '' : 's'} left).`
        : '';
    }

    const selected = new Map(); // userId -> candidate object
    let query = '';
    let allPeople = [];
    let pendingAvatarDataUrl = null;

    body.innerHTML = `
      <form class="msg-group-form" id="msg-group-form" novalidate>
        ${isAddMode ? '' : `
          <div class="msg-group-fields">
            <div class="msg-group-hero-row">
              <div class="msg-group-avatar-picker is-compact-circle">
                <div class="msg-group-avatar-preview-wrap">
                  <div class="msg-group-avatar-preview" id="msg-group-create-pic-preview" role="button" tabindex="0" aria-label="Choose group photo" title="Choose group photo">${groupPicPreviewMarkup({ sizeClass: 'avatar-lg' })}</div>
                  <button type="button" class="msg-group-avatar-plus-badge" id="msg-group-create-pic-btn" aria-label="Choose group photo" title="Choose group photo">+</button>
                  <button type="button" class="msg-group-avatar-remove" id="msg-group-create-pic-remove" aria-label="Remove group photo" title="Remove photo" hidden>&times;</button>
                  <input id="msg-group-create-pic-input" type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden>
                </div>
              </div>
              <div class="field msg-group-name-field">
                <label for="msg-group-title-input">Group name</label>
                <input id="msg-group-title-input" name="title" type="text" maxlength="80" placeholder="e.g. Barkada Boracay Fund" autocomplete="off" required>
                <small class="field-error msg-stable-error" id="msg-group-title-error" role="alert" aria-hidden="true"></small>
              </div>
            </div>
            <div class="field msg-group-topic-field">
              <label for="msg-group-desc-input">Topic <span>(optional)</span></label>
              <div class="msg-group-topic-wrap">
                <input id="msg-group-desc-input" name="description" type="text" maxlength="240" placeholder="What is this group for?" autocomplete="off">
                <small class="field-help msg-bio-counter msg-group-topic-counter" id="msg-group-desc-count">0/240</small>
              </div>
            </div>
          </div>`}
        <div class="msg-group-picker-block">
          <div class="msg-group-picker-head">
            <label for="msg-group-member-search">${isAddMode ? 'Select new members' : 'Select members'}</label>
            <span class="msg-group-picked-count" id="msg-group-picked-count">0 selected</span>
          </div>
          <div class="msg-group-chips" id="msg-group-chips" hidden></div>
          <div class="msg-search-input-wrap msg-group-member-search-wrap">
            <svg class="msg-search-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
            <input id="msg-group-member-search" type="search" placeholder="Search friends or people by name" aria-label="Filter people for group chat" autocomplete="off">
          </div>
          <div class="msg-group-member-list" id="msg-group-member-list" role="listbox" aria-multiselectable="true">
            ${skeletonHtml('person', 4)}
          </div>
          <small class="field-error msg-stable-error" id="msg-group-members-error" role="alert" aria-hidden="true"></small>
        </div>
        <div class="msg-group-form-actions">
          <button type="button" class="button button-secondary" data-msg-group-close>Cancel</button>
          <button type="submit" class="button button-primary" id="msg-group-submit-btn">${isAddMode ? 'Add members' : 'Create group'}</button>
        </div>
      </form>`;

    if (!dialog.open) dialog.showModal();

    const titleInput = document.getElementById('msg-group-title-input');
    const titleErr = document.getElementById('msg-group-title-error');
    const descInput = document.getElementById('msg-group-desc-input');
    const descCount = document.getElementById('msg-group-desc-count');
    const memberSearch = document.getElementById('msg-group-member-search');
    const memberListEl = document.getElementById('msg-group-member-list');
    const chipsEl = document.getElementById('msg-group-chips');
    const pickedCountEl = document.getElementById('msg-group-picked-count');
    const membersErrEl = document.getElementById('msg-group-members-error');
    const submitBtn = document.getElementById('msg-group-submit-btn');
    const form = document.getElementById('msg-group-form');
    const createPicInput = document.getElementById('msg-group-create-pic-input');
    const createPicBtn = document.getElementById('msg-group-create-pic-btn');
    const createPicRemove = document.getElementById('msg-group-create-pic-remove');
    const createPicPreview = document.getElementById('msg-group-create-pic-preview');

    const renderCreateAvatarPreview = () => {
      if (!createPicPreview) return;
      createPicPreview.innerHTML = groupPicPreviewMarkup({
        dataUrl: pendingAvatarDataUrl,
        title: titleInput?.value || '',
        sizeClass: 'avatar-lg'
      });
      ipon().bindAvatarFallbacks?.(createPicPreview);
      if (createPicBtn) {
        const lbl = pendingAvatarDataUrl ? 'Change group photo' : 'Choose group photo';
        createPicBtn.setAttribute('aria-label', lbl);
        createPicBtn.title = lbl;
      }
      if (createPicRemove) createPicRemove.hidden = !pendingAvatarDataUrl;
    };

    const setInlineSlot = (el, msg) => {
      if (!el) return;
      el.textContent = msg || '';
      el.title = msg || '';
      el.classList?.toggle?.('is-visible', Boolean(msg));
      el.setAttribute?.('aria-hidden', msg ? 'false' : 'true');
    };

    const validateTitle = () => {
      if (isAddMode || !titleInput) return true;
      const val = String(titleInput.value || '').trim().replace(/\s+/g, ' ');
      let err = '';
      if (!val) err = 'Enter a group name.';
      else if (val.length < 2) err = 'Group name must be at least 2 characters.';
      else if (val.length > 80) err = 'Group name must be 80 characters or fewer.';
      titleInput.setCustomValidity?.(err);
      titleInput.setAttribute?.('aria-invalid', err ? 'true' : 'false');
      setInlineSlot(titleErr, err);
      return !err;
    };

    const validateMembers = () => {
      let err = '';
      if (!selected.size) {
        err = isAddMode ? 'Select at least 1 member to add.' : 'Select at least 1 other member.';
      } else if (selected.size > maxAllowed) {
        err = `You can select up to ${maxAllowed} member${maxAllowed === 1 ? '' : 's'}.`;
      }
      setInlineSlot(membersErrEl, err);
      return !err;
    };

    const renderPickerState = () => {
      if (pickedCountEl) pickedCountEl.textContent = `${selected.size} selected`;
      if (chipsEl) {
        chipsEl.hidden = selected.size === 0;
        chipsEl.innerHTML = selected.size
          ? [...selected.values()].map((u) => `
              <span class="msg-group-chip">
                <span>${escapeHtml(u.full_name || 'User')}${userBadgesHtml(u)}</span>
                <button type="button" class="msg-group-chip-x" data-group-unpick="${escAttr(u.id)}" aria-label="Remove ${escapeHtml(u.full_name || 'User')}">&times;</button>
              </span>`).join('')
          : '';
      }
      if (!memberListEl) return;
      const cleanQ = query.trim().toLowerCase();
      const filtered = allPeople.filter((u) => {
        if (!cleanQ) return true;
        const blob = `${u.full_name || ''} ${u.username || ''} ${(u.shared_groups || []).join(' ')}`.toLowerCase();
        return blob.includes(cleanQ);
      });
      if (!filtered.length) {
        memberListEl.innerHTML = `<div class="empty-state msg-list-empty"><strong>${cleanQ ? 'No matching people' : 'No eligible people available'}</strong><p>${isAddMode ? 'Everyone available may already be in this group.' : 'Connect with friends or group members to start a group chat.'}</p></div>`;
        return;
      }
      memberListEl.innerHTML = filtered.map((u) => {
        const uid = String(u.id || '');
        const isPicked = selected.has(uid);
        const allowed = u.can_message !== false;
        const subBits = [];
        if (u.username) subBits.push(`@${u.username}`);
        if (u.friendship_status === 'FRIENDS') subBits.push('Friend');
        if (!allowed) subBits.push('Friends only privacy');
        return `<button type="button" class="msg-group-pick-row${isPicked ? ' is-selected' : ''}" data-group-pick="${escAttr(uid)}" role="option" aria-selected="${isPicked ? 'true' : 'false'}"${allowed ? '' : ' disabled'}>
          ${userAvatarHtml(u, 'avatar-sm', { clickable: false, showPresence: false })}
          <span class="msg-group-pick-copy">
            <strong>${escapeHtml(u.full_name || 'User')}${userBadgesHtml(u)}</strong>
            <small>${escapeHtml(subBits.join(' · ') || 'Eligible member')}</small>
          </span>
          <span class="msg-group-pick-check" aria-hidden="true">${isPicked ? '✓' : '+'}</span>
        </button>`;
      }).join('');
      ipon().bindAvatarFallbacks?.(memberListEl);
    };

    const loadCandidates = async () => {
      if (memberListEl) memberListEl.innerHTML = skeletonHtml('person', 4);
      try {
        const [users] = await Promise.all([
          ipon().rpc('search_social_users', { p_query: '', p_limit: 50 }),
          state.overviewLoaded ? Promise.resolve() : refreshOverview({ render: false }).catch(() => { })
        ]);
        const merged = new Map();
            (state.overview?.friends || []).forEach((f) => {
          const fid = String(f?.id || '');
          if (fid && !existingIds.has(fid)) {
            merged.set(fid, { ...f, friendship_status: 'FRIENDS', can_message: true });
          }
        });
        const selfUid = String(initializedProfile?.id || '');
        (Array.isArray(users) ? users : []).forEach((u) => {
          const uid = String(u?.id || '');
          if (uid && uid !== selfUid && !existingIds.has(uid)) {
            const prev = merged.get(uid);
            merged.set(uid, prev ? { ...u, ...prev } : u);
          }
        });
        allPeople = [...merged.values()].sort((a, b) => {
          const af = a.friendship_status === 'FRIENDS' ? 0 : 1;
          const bf = b.friendship_status === 'FRIENDS' ? 0 : 1;
          if (af !== bf) return af - bf;
          return String(a.full_name || '').localeCompare(String(b.full_name || ''));
        });
        renderPickerState();
      } catch (err) {
        if (memberListEl) {
          ipon().showInlineError?.(memberListEl, err, loadCandidates);
          if (!ipon().showInlineError) {
            memberListEl.innerHTML = `<div class="empty-state msg-list-empty"><p>${escapeHtml(ipon().friendlyError(err))}</p></div>`;
          }
        }
      }
    };

    titleInput?.addEventListener('input', () => {
      validateTitle();
      if (!pendingAvatarDataUrl) renderCreateAvatarPreview();
    });
    titleInput?.addEventListener('blur', validateTitle);
    createPicBtn?.addEventListener('click', () => createPicInput?.click());
    createPicPreview?.addEventListener('click', () => {
      if (pendingAvatarDataUrl) ipon().openImageViewer?.(pendingAvatarDataUrl, titleInput?.value || 'Group photo');
      else createPicInput?.click();
    });
    createPicRemove?.addEventListener('click', () => {
      pendingAvatarDataUrl = null;
      if (createPicInput) createPicInput.value = '';
      renderCreateAvatarPreview();
    });
    createPicInput?.addEventListener('change', async () => {
      const file = createPicInput.files?.[0];
      if (!file) return;
      try {
        pendingAvatarDataUrl = await prepareGroupPicDataUrl(file);
        renderCreateAvatarPreview();
      } catch (err) {
        ipon().toast(ipon().friendlyError(err), 'error');
      } finally {
        createPicInput.value = '';
      }
    });
    descInput?.addEventListener('input', () => {
      if (descCount) descCount.textContent = `${String(descInput.value || '').length}/240`;
    });
    memberSearch?.addEventListener('input', () => {
      query = memberSearch.value;
      renderPickerState();
    });
    body.addEventListener('click', (ev) => {
      const pickBtn = ev.target.closest?.('[data-group-pick]');
      if (pickBtn && !pickBtn.disabled) {
        const uid = pickBtn.dataset.groupPick;
        const userObj = allPeople.find((u) => String(u.id) === uid);
        if (!userObj) return;
        if (selected.has(uid)) {
          selected.delete(uid);
        } else {
          if (selected.size >= maxAllowed) {
            ipon().toast(`You can pick up to ${maxAllowed} member${maxAllowed === 1 ? '' : 's'}.`, 'error');
            return;
          }
          selected.set(uid, userObj);
        }
        if (membersErrEl?.classList?.contains?.('is-visible')) validateMembers();
        renderPickerState();
        return;
      }
      const unpickBtn = ev.target.closest?.('[data-group-unpick]');
      if (unpickBtn) {
        selected.delete(unpickBtn.dataset.groupUnpick);
        if (membersErrEl?.classList?.contains?.('is-visible')) validateMembers();
        renderPickerState();
      }
    });

    form?.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const okTitle = validateTitle();
      const okMembers = validateMembers();
      if (!okTitle || !okMembers) {
        if (!okTitle) titleInput?.focus();
        return;
      }
      if (maxAllowed <= 0 && isAddMode) {
        ipon().toast('This group already has the maximum of 50 members.', 'error');
        return;
      }
      const memberIds = [...selected.keys()];
      ipon().setBusy?.(submitBtn, true, isAddMode ? 'Adding…' : 'Creating…');
      if (submitBtn && !ipon().setBusy) submitBtn.disabled = true;
      try {
        if (isAddMode) {
          await ipon().rpc('add_group_chat_members', {
            p_conversation_id: conversationId,
            p_member_ids: memberIds
          });
          dialog.close();
          ipon().toast(`Added ${memberIds.length} ${memberIds.length === 1 ? 'member' : 'members'}.`);
          await Promise.all([
            openConversation(conversationId, { markRead: false, silent: true }),
            refreshConversations()
          ]);
        } else {
          const uploadedAvatarUrl = pendingAvatarDataUrl
            ? await uploadGroupPicIfNeeded(pendingAvatarDataUrl)
            : null;
          const created = await ipon().rpc('create_group_chat', {
            p_title: String(titleInput?.value || '').trim().replace(/\s+/g, ' '),
            p_member_ids: memberIds,
            p_description: String(descInput?.value || '').trim() || null,
            p_avatar_url: uploadedAvatarUrl || null
          });
          dialog.close();
          clearSidebarSearch();
          await refreshConversations();
          switchTab('chats');
          if (created?.id) await openConversation(created.id);
          ipon().toast(`Group "${created?.title || 'Chat'}" created.`);
        }
      } catch (err) {
        ipon().toast(ipon().friendlyError(err), 'error');
      } finally {
        ipon().setBusy?.(submitBtn, false);
        if (submitBtn && !ipon().setBusy) submitBtn.disabled = false;
      }
    });

    await loadCandidates();
    if (!isAddMode) titleInput?.focus();
    else memberSearch?.focus();
  }

  function showGroupMemberMenu(memberId, anchorBtn) {
    if (toggleExistingFloatingMenu('group-member', memberId)) return;
    closeFloatingMenus({ immediate: true });
    const conv = state.activeThread?.conversation;
    if (!conv || !isGroupConv(conv) || conv.anonymous_enabled) return;
    const member = (conv.members || []).find((m) => String(m.id) === String(memberId));
    if (!member) return;
    const myRole = String(conv.my_role || 'MEMBER').toUpperCase();
    const targetRole = String(member.role || 'MEMBER').toUpperCase();
    const canRemove = (myRole === 'OWNER' && targetRole !== 'OWNER') || (myRole === 'ADMIN' && targetRole === 'MEMBER');
    anchorBtn?.setAttribute?.('aria-expanded', 'true');
    const menu = document.createElement('div');
    menu.className = 'msg-floating-menu msg-ctx-menu';
    menu.setAttribute('data-menu-kind', 'group-member');
    menu.setAttribute('data-menu-for', String(memberId));
    menu.innerHTML = `
      <button type="button" data-group-mact="view_profile" data-target-id="${escAttr(member.id)}">View profile</button>
      <button type="button" data-group-mact="message" data-target-id="${escAttr(member.id)}">Message privately</button>
      ${myRole === 'OWNER' && targetRole === 'MEMBER' ? `<button type="button" data-group-mact="make_admin" data-target-id="${escAttr(member.id)}">Make group admin</button>` : ''}
      ${myRole === 'OWNER' && targetRole === 'ADMIN' ? `<button type="button" data-group-mact="remove_admin" data-target-id="${escAttr(member.id)}">Remove admin role</button>` : ''}
      ${myRole === 'OWNER' && targetRole !== 'OWNER' ? `<button type="button" data-group-mact="make_owner" data-target-id="${escAttr(member.id)}">Transfer ownership</button>` : ''}
      ${canRemove ? `<button type="button" class="is-danger" data-group-mact="remove_member" data-target-id="${escAttr(member.id)}">Remove from group</button>` : ''}`;
    document.getElementById('msg-workspace-dialog')?.appendChild(menu);
    placeFloatingMenu(menu, anchorBtn, { preferAbove: false, estWidth: 196, estHeight: 190, align: 'end' });
    revealFloatingMenu(menu);
  }

  async function openForwardDialog(messageObj) {
    if (state.activeThread?.conversation?.block_forwarding || state.activeThread?.conversation?.anonymous_enabled) {
      ipon().toast('Forwarding is disabled in this chat.', 'error');
      return;
    }
    const dialog = document.getElementById('msg-forward-dialog');
    const body = document.getElementById('msg-forward-body');
    if (!dialog || !body) return;
    const items = [];
    const seenDirectUsers = new Set();
    if (initializedProfile?.id) {
      seenDirectUsers.add(initializedProfile.id);
      items.push({
        isGroup: false,
        userId: initializedProfile.id,
        name: initializedProfile.full_name || 'You',
        avatar_url: initializedProfile.avatar_url,
        sub: 'You · Personal notes & saved messages',
        convId: state.conversations.find((c) => !isGroupConv(c) && String(c.peer?.id || '') === String(initializedProfile.id))?.id || null
      });
    }
    state.conversations
      .filter((c) => c.status === 'ACCEPTED' && !c.anonymous_enabled && (isGroupConv(c) || (!c.peer?.is_blocked && c.peer?.can_message !== false && c.peer?.friends_only_locked !== true)))
      .forEach((c) => {
        if (isGroupConv(c)) {
          items.push({
            isGroup: true,
            conv: c,
            userId: c.id,
            name: convDisplayTitle(c),
            sub: `Group · ${Number(c.member_count || 2)} members`,
            convId: c.id
          });
        } else if (c.peer?.id) {
          seenDirectUsers.add(c.peer.id);
          items.push({
            isGroup: false,
            userId: c.peer.id,
            name: c.peer.full_name,
            avatar_url: c.peer.avatar_url,
            sub: c.peer.username ? `@${c.peer.username}` : '',
            convId: c.id
          });
        }
      });
    (state.overview?.friends || []).forEach((f) => {
      if (!seenDirectUsers.has(f.id)) {
        seenDirectUsers.add(f.id);
        items.push({
          isGroup: false,
          userId: f.id,
          name: f.full_name,
          avatar_url: f.avatar_url,
          sub: f.username ? `@${f.username}` : 'Friend',
          convId: null
        });
      }
    });

    body.innerHTML = items.length
      ? `<p class="msg-forward-quote">"${escapeHtml(String(messageObj.body || 'Attachment').slice(0, 140))}"</p>
         <div class="msg-forward-list">${items.map((item) => `
           <button type="button" class="msg-forward-row" data-fwd-user="${escAttr(item.userId)}" data-fwd-conv="${escAttr(item.convId || '')}">
             ${item.isGroup
               ? groupAvatarHtml(item.conv, 'avatar-sm', { clickable: false, showPresence: false })
               : userAvatarHtml({ id: item.userId, full_name: item.name, avatar_url: item.avatar_url, allow_online_status: false }, 'avatar-sm', { clickable: false, showPresence: false })}
             <span class="msg-forward-meta">
               <strong>${escapeHtml(item.name)}${item.isGroup ? '' : userBadgesHtml({ id: item.userId, full_name: item.name })}</strong>
               ${item.sub ? `<small>${escapeHtml(item.sub)}</small>` : ''}
             </span>
             <span class="button button-secondary button-sm">Send</span>
           </button>`).join('')}</div>`
      : '<p class="empty-state">Add friends or open conversations first to forward messages.</p>';
    ipon().bindAvatarFallbacks?.(body);
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
          <label for="msg-set-friend-req">Who can send friend requests</label>
          <select id="msg-set-friend-req" name="allow_friend_requests">
            <option value="EVERYONE"${(priv.allow_friend_requests || 'EVERYONE') === 'EVERYONE' ? ' selected' : ''}>Everyone</option>
            <option value="MUTUAL_GROUPS"${priv.allow_friend_requests === 'MUTUAL_GROUPS' ? ' selected' : ''}>Shared group connections only</option>
            <option value="NOBODY"${priv.allow_friend_requests === 'NOBODY' ? ' selected' : ''}>No one</option>
          </select>
        </div>
        <div class="field">
          <label for="msg-set-msg-req">Who can message you (non-friends)</label>
          <select id="msg-set-msg-req" name="allow_message_requests">
            <option value="FRIENDS_ONLY"${(priv.allow_message_requests || 'FRIENDS_ONLY') === 'FRIENDS_ONLY' ? ' selected' : ''}>Friends only (recommended)</option>
            <option value="EVERYONE"${priv.allow_message_requests === 'EVERYONE' ? ' selected' : ''}>Deliver to Message Requests</option>
          </select>
        </div>
        <div class="field field-wide">
          <label for="msg-set-profile-vis">Who can see your profile</label>
          <select id="msg-set-profile-vis" name="profile_visibility">
            <option value="EVERYONE"${(priv.profile_visibility || 'EVERYONE') === 'EVERYONE' ? ' selected' : ''}>Everyone</option>
            <option value="FRIENDS_OF_FRIENDS"${priv.profile_visibility === 'FRIENDS_OF_FRIENDS' ? ' selected' : ''}>Friends of friends</option>
            <option value="FRIENDS_AND_CONNECTIONS"${priv.profile_visibility === 'FRIENDS_AND_CONNECTIONS' || priv.profile_visibility === 'FRIENDS_ONLY' ? ' selected' : ''}>Friends &amp; connections</option>
            <option value="NOBODY"${priv.profile_visibility === 'NOBODY' ? ' selected' : ''}>No one</option>
          </select>
        </div>
        <label class="msg-switch-row toggle-switch-row field-wide"><span><strong>Show active status</strong><small>Let connections see when you are online</small></span><input type="checkbox" class="toggle-switch-input" name="show_online"${priv.show_online !== false ? ' checked' : ''}></label>
        <label class="msg-switch-row toggle-switch-row field-wide"><span><strong>Show last seen timestamp</strong><small>Share when you were last active (requires active status enabled)</small></span><input type="checkbox" class="toggle-switch-input" name="show_last_seen"${priv.show_last_seen !== false ? ' checked' : ''}></label>
        <label class="msg-switch-row toggle-switch-row field-wide"><span><strong>Send &amp; receive read receipts</strong><small>Turning this off hides Seen indicators on accepted conversations</small></span><input type="checkbox" class="toggle-switch-input" name="read_receipts"${priv.read_receipts !== false ? ' checked' : ''}></label>
        <p class="mfa-message field-wide" id="msg-settings-error" role="alert" hidden></p>
        <div class="form-actions field-wide">
          <button type="submit" class="button button-primary msg-settings-save-btn" id="msg-settings-save" disabled data-dirty-locked="true" title="Make a change before saving.">Save messaging settings</button>
        </div>
      </form>
      <section class="msg-blocked-section">
        <h4><span>Blocked accounts</span><span class="msg-blocked-count">${blocked.length}</span></h4>
        ${blocked.length ? `<div class="msg-blocked-list">${blocked.map((b) => `
          <div class="msg-blocked-row">
            <span><strong>${escapeHtml(b.full_name)}${userBadgesHtml(b)}</strong>${b.username ? ` <small>@${escapeHtml(b.username)}</small>` : ''}</span>
            <button type="button" class="button button-secondary button-sm" data-unblock-user="${escapeHtml(b.id)}">Unblock</button>
          </div>`).join('')}</div>` : `<p class="msg-blocked-empty">${shieldSvg}<span>You have not blocked anyone.</span></p>`}
      </section>`;

    const form = document.getElementById('msg-privacy-form');
    const saveBtn = document.getElementById('msg-settings-save');

    const readPrivacySnapshot = () => JSON.stringify({
      fr: String(form.elements?.allow_friend_requests?.value || 'EVERYONE'),
      mr: String(form.elements?.allow_message_requests?.value || 'FRIENDS_ONLY'),
      pv: String(form.elements?.profile_visibility?.value || 'EVERYONE'),
      on: Boolean(form.elements?.show_online?.checked),
      ls: Boolean(form.elements?.show_last_seen?.checked),
      rr: Boolean(form.elements?.read_receipts?.checked)
    });
    const baselineSnapshot = readPrivacySnapshot();

    const syncPrivacySaveState = () => {
      const dirty = readPrivacySnapshot() !== baselineSnapshot;
      if (saveBtn) {
        if (saveBtn.dataset) {
          if (dirty) delete saveBtn.dataset.dirtyLocked;
          else saveBtn.dataset.dirtyLocked = 'true';
        }
        if (!saveBtn.classList?.contains?.('is-busy')) saveBtn.disabled = !dirty;
        saveBtn.title = !dirty ? 'Make a change before saving.' : '';
      }
      return dirty;
    };

    form?.addEventListener('input', syncPrivacySaveState);
    form?.addEventListener('change', syncPrivacySaveState);
    syncPrivacySaveState();

    form.onsubmit = async (ev) => {
      ev.preventDefault();
      if (!syncPrivacySaveState()) return;
      const errEl = document.getElementById('msg-settings-error');
      if (errEl) {
        errEl.hidden = true;
        errEl.textContent = '';
        delete errEl.dataset.tone;
      }
      const fd = new FormData(form);
      const nextPrivacy = {
        show_online: Boolean(form.elements.show_online.checked),
        show_last_seen: Boolean(form.elements.show_last_seen.checked),
        read_receipts: Boolean(form.elements.read_receipts.checked),
        allow_friend_requests: String(fd.get('allow_friend_requests') || 'EVERYONE'),
        allow_message_requests: String(fd.get('allow_message_requests') || 'FRIENDS_ONLY'),
        profile_visibility: String(fd.get('profile_visibility') || 'EVERYONE')
      };
      ipon().setBusy(saveBtn, true, 'Saving…');
      try {
        const res = await ipon().rpc('update_social_profile_and_privacy', {
          p_chat_privacy: nextPrivacy
        });
        const mergedPrivacy = res?.chat_privacy || nextPrivacy;
        if (state.overview?.me) state.overview.me.chat_privacy = mergedPrivacy;
        if (initializedProfile) initializedProfile.chat_privacy = mergedPrivacy;
        ipon().updateLocalProfile?.({ chat_privacy: mergedPrivacy });
        ipon().setOnlineVisibility?.(nextPrivacy.show_online);
        ipon().toast('Messaging settings saved.');
        await refreshOverview();
        dialog.close();
      } catch (err) {
        if (errEl) {
          errEl.dataset.tone = 'error';
          errEl.textContent = ipon().friendlyError(err);
          errEl.hidden = false;
        }
      } finally {
        ipon().setBusy(saveBtn, false);
        syncPrivacySaveState();
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
    syncNativeScreenshotLock(null);
    disconnectTypingChannel();
    state.activeConvId = null;
    state.activeThread = null;
    state.loadingOlder = false;
    state.olderLoadError = '';
    state.olderAutoArmed = false;
    clearTimeout(vanishUiTimer);
    closeVanishModal();
    state.unreadAnchorConvId = null;
    state.unreadAnchorFirstId = null;
    state.replyToMsg = null;
    state.editingMsg = null;
    state.groupEditAvatarDataUrl = null;
    state.groupEditAvatarClear = false;
    state.groupEditAvatarConvId = null;
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
    if (nextTab !== 'chats' && nextTab !== 'requests') syncNativeScreenshotLock(null);
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
    syncMyThreadPresence();

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
    syncMyThreadPresence();
    if (state.mobileShowThread) {
      ipon().fitVerifiedNameLines?.(view || document);
      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(() => ipon().fitVerifiedNameLines?.(view || document));
      }
    }
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
        await Promise.all([refreshOverview(), refreshConversations()]);
        if (state.activeConvId) await openConversation(state.activeConvId, { markRead: false, silent: true });
        if (state.searchActive || state.chatListQuery.trim()) await runGlobalDiscovery(state.chatListQuery);
      } else if (action === 'remove_friend') {
        const ok = await ipon().confirmAction({ title: 'Remove friend?', message: 'They will no longer appear in your Friends list.', confirmText: 'Remove' });
        if (!ok) return;
        await ipon().rpc('remove_friend', { p_friend_id: targetId });
        ipon().toast('Friend removed.');
        await Promise.all([refreshOverview(), refreshConversations()]);
        if (state.activeConvId) await openConversation(state.activeConvId, { markRead: false, silent: true });
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
          const targetTab = conv.status === 'PENDING_REQUEST' && conv.initiator_id !== initializedProfile?.id ? 'requests' : 'chats';
          const workspaceDlg = document.getElementById('msg-workspace-dialog');
          if (!workspaceDlg?.open) {
            const annViewer = document.getElementById('announcement-viewer');
            if (annViewer?.open) annViewer.close();
            await openWorkspace({ tab: targetTab, conversationId: conv.id });
          } else {
            clearSidebarSearch();
            await refreshConversations();
            switchTab(targetTab);
            await openConversation(conv.id, { previewPeer });
          }
        } finally {
          if (openingChatTargetId === targetId) openingChatTargetId = null;
        }
      }
      void extra;
    } catch (err) {
      ipon().toast(ipon().friendlyError(err), 'error');
    }
  }

  function closeAttachMenu() {
    const menu = document.getElementById('msg-attach-menu');
    const btn = document.getElementById('msg-attach-btn');
    if (menu) menu.hidden = true;
    btn?.setAttribute?.('aria-expanded', 'false');
  }

  function toggleExistingFloatingMenu(kind, key) {
    const existing = Array.from(document.querySelectorAll('.msg-floating-menu') || [])
      .find((node) => !node.classList?.contains?.('is-leaving'));
    if (existing && existing.getAttribute?.('data-menu-kind') === kind && existing.getAttribute?.('data-menu-for') === String(key)) {
      closeFloatingMenus();
      return true;
    }
    return false;
  }

  function clearUnlockedTextSelection({ clearRanges = false } = {}) {
    if (unlockedSelectBubble) {
      unlockedSelectBubble.classList?.remove?.('is-text-selectable');
      unlockedSelectBubble = null;
    }
    if (clearRanges) window.getSelection?.()?.removeAllRanges?.();
  }

  function unlockMessageTextSelection(bubble) {
    if (!bubble) return false;
    const textEl = bubble.querySelector?.('.msg-text');
    if (!textEl) return false;
    clearUnlockedTextSelection();
    bubble.classList?.add?.('is-text-selectable');
    unlockedSelectBubble = bubble;
    try {
      if (typeof document.createRange === 'function' && typeof window.getSelection === 'function') {
        const range = document.createRange();
        range.selectNodeContents(textEl);
        const sel = window.getSelection();
        sel?.removeAllRanges?.();
        sel?.addRange?.(range);
      }
    } catch { }
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      try { navigator.vibrate([10, 35, 10]); } catch { }
    }
    return true;
  }

  function showDoubleTapHeartBurst(bubbleEl) {
    const host = bubbleEl?.closest?.('.msg-bubble-wrap') || bubbleEl;
    if (!host || typeof document.createElement !== 'function') return;
    const pop = document.createElement('span');
    pop.className = 'msg-double-tap-heart';
    pop.setAttribute('aria-hidden', 'true');
    pop.textContent = DEFAULT_DOUBLE_TAP_EMOJI;
    host.appendChild?.(pop);
    setTimeout(() => pop.remove?.(), 580);
  }

  async function toggleMessageReaction(msgId, emoji, { showHeartPop = false, bubbleEl = null } = {}) {
    if (!msgId || !emoji) return;
    if (state.activeThread?.conversation && !canInteractInThread(state.activeThread.conversation)) return;
    const targetMsg = (state.activeThread?.messages || []).find((m) => String(m.id) === String(msgId));
    if (targetMsg?.deleted_for_everyone_at) return;
    const prevReactions = targetMsg ? [...(targetMsg.reactions || [])] : null;
    let added = true;
    if (targetMsg) {
      const myId = initializedProfile?.id;
      const myName = state.activeThread?.conversation?.anonymous_enabled ? 'Anonymous' : (initializedProfile?.full_name || 'You');
      const existingMine = (targetMsg.reactions || []).find((r) => r.user_id === myId);
      const others = (targetMsg.reactions || []).filter((r) => r.user_id !== myId);
      added = existingMine?.emoji !== emoji;
      targetMsg.reactions = added
        ? [...others, { user_id: myId, user_name: myName, emoji }]
        : others;
      patchMessageReactionsDom(targetMsg);
      state.lastThreadFingerprint = computeThreadFingerprint(state.activeThread);
    }
    if (showHeartPop && added && bubbleEl) {
      showDoubleTapHeartBurst(bubbleEl);
      if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        try { navigator.vibrate(10); } catch { }
      }
    }
    try {
      await ipon().rpc('toggle_message_reaction', { p_message_id: msgId, p_emoji: emoji });
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
  }

  function closeFloatingMenus(opts) {
    const immediate = Boolean(opts && opts.immediate === true);
    document.querySelectorAll('#msg-messages-list .msg-row.is-menu-target').forEach((row) => row.classList.remove('is-menu-target'));
    document.querySelectorAll('[data-conv-menu-toggle][aria-expanded="true"], [data-msg-act][aria-expanded="true"], [data-group-member-menu][aria-expanded="true"], [data-vact="menu"][aria-expanded="true"]').forEach((btn) => btn.setAttribute?.('aria-expanded', 'false'));
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
    if (state.activeThread?.conversation && !canInteractInThread(state.activeThread.conversation)) return;
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
    menu.setAttribute('data-menu-kind', 'react');
    menu.setAttribute('data-menu-for', String(msgId));
    menu.setAttribute('data-react-menu-for', String(msgId));
    anchorEl?.setAttribute?.('aria-expanded', 'true');
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
    if (state.activeThread?.conversation && !canInteractInThread(state.activeThread.conversation)) return;
    closeFloatingMenus();
    const wrap = document.getElementById('msg-scroll-wrap');
    const wasNearBottom = isThreadNearBottom(wrap);
    const lockedScrollTop = wrap ? wrap.scrollTop : null;
    if (!wasNearBottom) state.threadStickyBottom = false;
    const wasEditing = Boolean(state.editingMsg);
    state.editingMsg = null;
    if (wasEditing) restoreDraftAfterEdit();
    state.replyToMsg = msgObj;
    renderContextBar();
    const input = document.getElementById('msg-composer-input');
    if (input) {
      try { input.focus({ preventScroll: true }); } catch { input.focus(); }
    }
    if (!wasNearBottom && wrap && typeof lockedScrollTop === 'number') {
      wrap.scrollTop = lockedScrollTop;
      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(() => {
          const liveWrap = document.getElementById('msg-scroll-wrap');
          if (liveWrap && state.threadStickyBottom === false) liveWrap.scrollTop = lockedScrollTop;
        });
      }
    }
  }

  function showMessageContextMenu(msgId, anchorBtn) {
    if (toggleExistingFloatingMenu('msg-ctx', msgId)) return;
    closeFloatingMenus({ immediate: true });
    const msg = (state.activeThread?.messages || []).find((m) => m.id === msgId);
    if (!msg) return;
    const rowEl = anchorBtn?.closest?.('.msg-row');
    if (rowEl) rowEl.classList.add('is-menu-target');
    anchorBtn?.setAttribute?.('aria-expanded', 'true');
    const mine = msg.sender_id === initializedProfile?.id;
    const atts = !msg.deleted_for_everyone_at ? (msg.attachments || []).filter((a) => a?.path) : [];
    const menu = document.createElement('div');
    menu.className = 'msg-floating-menu msg-ctx-menu';
    menu.setAttribute('data-menu-kind', 'msg-ctx');
    menu.setAttribute('data-menu-for', String(msgId));
    const canSendHere = canInteractInThread(state.activeThread?.conversation);
    menu.innerHTML = `
      ${canSendHere ? `<button type="button" data-ctx-do="reply" data-msg-id="${escAttr(msgId)}">Reply</button>` : ''}
      ${atts.length ? `<button type="button" data-ctx-do="download" data-msg-id="${escAttr(msgId)}">${atts.length > 1 ? `Download all (${atts.length})` : 'Download'}</button>` : ''}
      ${msg.body ? `<button type="button" data-ctx-do="copy" data-msg-id="${escAttr(msgId)}">Copy text</button>` : ''}
      ${state.activeThread?.conversation?.block_forwarding || state.activeThread?.conversation?.anonymous_enabled ? '' : `<button type="button" data-ctx-do="forward" data-msg-id="${escAttr(msgId)}">Forward</button>`}
      ${canSendHere && state.activeThread?.conversation?.status === 'ACCEPTED' ? `<button type="button" data-ctx-do="pin" data-msg-id="${escAttr(msgId)}">${msg.pinned_at ? 'Unpin' : 'Pin message'}</button>` : ''}
      ${canSendHere && mine ? `<button type="button" data-ctx-do="edit" data-msg-id="${escAttr(msgId)}">Edit message</button>` : ''}
      <button type="button" data-ctx-do="del_me" data-msg-id="${escAttr(msgId)}">Delete for me</button>
      ${mine ? `<button type="button" class="is-danger" data-ctx-do="del_all" data-msg-id="${escAttr(msgId)}">Unsend for everyone</button>` : ''}`;
    document.getElementById('msg-workspace-dialog')?.appendChild(menu);
    placeFloatingMenu(menu, anchorBtn, { preferAbove: false, estWidth: 184, estHeight: 236, align: 'end' });
    revealFloatingMenu(menu);
  }

  function showConvContextMenu(convId, anchorBtn) {
    if (toggleExistingFloatingMenu('conv', convId)) return;
    closeFloatingMenus({ immediate: true });
    const conv = state.conversations.find((c) => c.id === convId);
    if (!conv) return;
    const isGrp = isGroupConv(conv);
    anchorBtn?.setAttribute?.('aria-expanded', 'true');
    const menu = document.createElement('div');
    menu.className = 'msg-floating-menu msg-ctx-menu';
    menu.setAttribute('data-menu-kind', 'conv');
    menu.setAttribute('data-menu-for', String(convId));
    menu.innerHTML = `
      <button type="button" data-row-conv-act="${conv.is_pinned ? 'unpin' : 'pin'}" data-conv-id="${escAttr(convId)}">${conv.is_pinned ? 'Unpin chat' : 'Pin chat'}</button>
      <button type="button" data-row-conv-act="${conv.is_muted ? 'unmute' : 'mute'}" data-conv-id="${escAttr(convId)}">${conv.is_muted ? 'Unmute notifications' : 'Mute notifications'}</button>
      <button type="button" data-row-conv-act="${conv.is_archived ? 'unarchive' : 'archive'}" data-conv-id="${escAttr(convId)}">${conv.is_archived ? 'Move to Inbox' : 'Archive chat'}</button>
      <button type="button" data-row-conv-act="${conv.unread_count > 0 || conv.marked_unread ? 'mark_read' : 'mark_unread'}" data-conv-id="${escAttr(convId)}">${conv.unread_count > 0 || conv.marked_unread ? 'Mark as read' : 'Mark as unread'}</button>
      <button type="button" class="${isGrp ? '' : 'is-danger'}" data-row-conv-act="delete_for_me" data-conv-id="${escAttr(convId)}">${isGrp ? 'Clear chat history' : 'Delete conversation'}</button>
      ${isGrp ? `<button type="button" class="is-danger" data-row-group-leave="${escAttr(convId)}">Leave group</button>` : ''}`;
    document.getElementById('msg-workspace-dialog')?.appendChild(menu);
    placeFloatingMenu(menu, anchorBtn, { preferAbove: false, estWidth: 196, estHeight: isGrp ? 226 : 190, align: 'end' });
    revealFloatingMenu(menu);
  }

  function bindEvents() {
    if (document.documentElement.dataset.msgEventsBound) return;
    document.documentElement.dataset.msgEventsBound = '1';

    const isSameFloatingMenuTrigger = (target, menu) => {
      const kind = menu?.getAttribute?.('data-menu-kind') || '';
      const key = menu?.getAttribute?.('data-menu-for') || '';
      if (!kind || !key || !target?.closest) return false;
      if (kind === 'conv') return String(target.closest('[data-conv-menu-toggle]')?.dataset?.convMenuToggle || '') === key;
      if (kind === 'msg-ctx') {
        const btn = target.closest('[data-msg-act="menu"]');
        return Boolean(btn && String(btn.dataset?.msgId || '') === key);
      }
      if (kind === 'react') {
        const btn = target.closest('[data-msg-act="react"]');
        return Boolean(btn && String(btn.dataset?.msgId || '') === key);
      }
      if (kind === 'group-member') return String(target.closest('[data-group-member-menu]')?.dataset?.groupMemberMenu || '') === key;
      if (kind === 'video') {
        const btn = target.closest('[data-vact="menu"]');
        return Boolean(btn && btn.closest?.('.msg-video-player') === activeVideoMenuPlayer);
      }
      return false;
    };

    document.addEventListener('pointerdown', (ev) => {
      const openMenu = Array.from(document.querySelectorAll('.msg-floating-menu') || [])
        .find((node) => !node.classList?.contains?.('is-leaving'));
      if (!openMenu) return;
      if (ev.target?.closest?.('.msg-floating-menu')) return;
      if (isSameFloatingMenuTrigger(ev.target, openMenu)) return;
      const wasCtxMenu = openMenu.classList?.contains?.('msg-ctx-menu');
      closeFloatingMenus();
      if (wasCtxMenu && !ev.target?.closest?.('[data-conv-menu-toggle], [data-msg-act], [data-group-member-menu], [data-vact="menu"]')) {
        suppressOutsideMenuClickUntil = Date.now() + 400;
      }
    }, true);

    document.addEventListener('click', (ev) => {
      if (!suppressOutsideMenuClickUntil) return;
      const active = Date.now() <= suppressOutsideMenuClickUntil;
      suppressOutsideMenuClickUntil = 0;
      if (!active) return;
      if (!ev.target?.closest?.('.msg-floating-menu, [data-conv-menu-toggle], [data-msg-act], [data-group-member-menu], [data-vact="menu"]')) {
        ev.preventDefault?.();
        ev.stopPropagation?.();
      }
    }, true);

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

      // Close floating contextual menus & attachment menu on outside click
      if (!ev.target.closest('.msg-floating-menu') && !ev.target.closest('[data-msg-act]') && !ev.target.closest('[data-conv-menu-toggle]') && !ev.target.closest('[data-group-member-menu]') && !ev.target.closest('[data-vact="menu"]')) {
        closeFloatingMenus();
      }
      if (!ev.target.closest?.('#msg-attach-menu, #msg-attach-btn')) {
        closeAttachMenu();
      }
      if (state.showPinnedList && !ev.target.closest?.('#msg-pinned-banner')) {
        state.showPinnedList = false;
        renderPinnedBanner();
      }
      const mutualCloseBtn = ev.target.closest?.('[data-mutual-close]');
      if (mutualCloseBtn) {
        ev.stopPropagation();
        closeMutualPopover();
        return;
      }

      const mutualBtn = ev.target.closest?.('[data-mutual-trigger]');
      if (mutualBtn) {
        ev.stopPropagation();
        const mutualPop = document.getElementById('msg-mutual-popover');
        if (mutualPop && !mutualPop.hidden && mutualPop.dataset.pinned === '1' && activeMutualAnchor === mutualBtn) {
          closeMutualPopover();
        } else {
          await openMutualPopover(mutualBtn.dataset.mutualTrigger, mutualBtn, { pinned: true });
        }
        return;
      }

      const mutualPopEl = document.getElementById('msg-mutual-popover');
      if (mutualPopEl && !mutualPopEl.hidden && !(mutualPopEl.contains?.(ev.target) || ev.target.closest?.('#msg-mutual-popover')) && !ev.target.closest?.('[data-mutual-trigger]')) {
        closeMutualPopover();
      }

      const pop = document.getElementById('msg-profile-popover');
      if (pop && !pop.hidden && !(pop.contains?.(ev.target) || ev.target.closest?.('#msg-profile-popover')) && !ev.target.closest?.('#msg-mutual-popover') && !ev.target.closest('[data-social-user-dp]')) {
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
        const fromMutualPop = Boolean(dpBtn.closest?.('#msg-mutual-popover'));
        const anchorEl = fromMutualPop ? (activeMutualAnchor || dpBtn) : dpBtn;
        closeMutualPopover();
        await openProfilePopover(dpBtn.dataset.socialUserDp, anchorEl);
        return;
      }

      if (ev.target.closest?.('#msg-pop-close')) { closeProfilePopover(); return; }
      if (ev.target.closest?.('#msg-workspace-close')) { document.getElementById('msg-workspace-dialog')?.close(); return; }
      if (ev.target.closest?.('[data-msg-settings-close]')) { document.getElementById('msg-settings-dialog')?.close(); return; }
      if (ev.target.closest?.('[data-msg-forward-close]')) { document.getElementById('msg-forward-dialog')?.close(); return; }
      if (ev.target.closest?.('[data-msg-group-close]')) { document.getElementById('msg-group-dialog')?.close(); return; }
      if (ev.target.closest?.('[data-msg-gdrive-close]') || ev.target?.id === 'msg-gdrive-dialog') { document.getElementById('msg-gdrive-dialog')?.close?.(); return; }
      if (ev.target.closest?.('#msg-gdrive-browse-local')) {
        document.getElementById('msg-gdrive-dialog')?.close?.();
        document.getElementById('msg-drive-input')?.click();
        return;
      }
      if (ev.target.closest?.('#msg-privacy-btn')) { await openPrivacySettingsModal(); return; }
      if (ev.target.closest?.('#msg-alerts-btn')) { switchTab('notifications'); return; }
      if (ev.target.closest?.('#msg-empty-find-btn') || ev.target.closest?.('[data-goto-discover]')) { activateSidebarSearch(true); return; }
      if (ev.target.closest?.('#msg-new-group-btn') || ev.target.closest?.('#msg-empty-group-btn') || ev.target.closest?.('#msg-inline-create-group')) {
        await openGroupChatDialog({ mode: 'create' });
        return;
      }
      const addGroupMembersBtn = ev.target.closest?.('[data-group-add-members]');
      if (addGroupMembersBtn) {
        await openGroupChatDialog({ mode: 'add_members', conversationId: addGroupMembersBtn.dataset.groupAddMembers || state.activeConvId });
        return;
      }
      if (ev.target.closest?.('[data-open-group-info]') && state.activeConvId) {
        state.showThreadInfo = true;
        state.threadInfoView = 'root';
        renderThreadInfoDrawer();
        if (isAndroidNativeShell()) {
          await refreshActiveConversationProtection();
          renderThreadInfoDrawer();
        }
        return;
      }
      if (ev.target.closest?.('#msg-group-edit-toggle')) {
        const editForm = document.getElementById('msg-group-edit-form');
        if (editForm) {
          editForm.hidden = !editForm.hidden;
          if (!editForm.hidden) document.getElementById('msg-group-edit-title')?.focus();
        }
        return;
      }
      if (ev.target.closest?.('#msg-group-avatar-quick-btn')) {
        const editForm = document.getElementById('msg-group-edit-form');
        if (editForm) editForm.hidden = false;
        document.getElementById('msg-group-edit-pic-input')?.click();
        return;
      }
      const dpViewBtn = ev.target.closest?.('[data-view-dp-src]');
      if (dpViewBtn) {
        const dpSrc = safeDpUrl(dpViewBtn.dataset.viewDpSrc);
        const ownerPop = dpViewBtn.closest?.('#msg-profile-popover');
        if (ownerPop) {
          ownerPop.dataset.pinned = '1';
          clearProfileHoverTimers();
        }
        if (dpSrc) openDpViewer(dpSrc, dpViewBtn.dataset.viewDpName || 'Display picture');
        return;
      }
      if (ev.target.closest?.('#msg-group-drawer-avatar-slot.is-viewable')) {
        const conv = state.activeThread?.conversation;
        const viewSrc = !state.groupEditAvatarClear ? safeDpUrl(state.groupEditAvatarDataUrl || conv?.avatar_url) : '';
        if (viewSrc) openDpViewer(viewSrc, convDisplayTitle(conv));
        return;
      }
      if (ev.target.closest?.('#msg-group-edit-pic-btn')) {
        document.getElementById('msg-group-edit-pic-input')?.click();
        return;
      }
      if (ev.target.closest?.('#msg-group-edit-pic-remove')) {
        const conv = state.activeThread?.conversation;
        const hadSaved = Boolean(conv?.avatar_url);
        state.groupEditAvatarDataUrl = null;
        state.groupEditAvatarClear = hadSaved;
        syncGroupEditAvatarUi();
        if (hadSaved) ipon().toast('Photo cleared from preview. Click Save to apply.');
        return;
      }
      if (ev.target.closest?.('#msg-group-edit-cancel')) {
        const editForm = document.getElementById('msg-group-edit-form');
        const conv = state.activeThread?.conversation;
        const titleInput = document.getElementById('msg-group-edit-title');
        const descInput = document.getElementById('msg-group-edit-desc');
        if (titleInput && conv) titleInput.value = conv.title || '';
        if (descInput && conv) descInput.value = conv.description || '';
        state.groupEditAvatarDataUrl = null;
        state.groupEditAvatarClear = false;
        syncGroupEditAvatarUi();
        if (editForm) editForm.hidden = true;
        return;
      }
      const leaveGroupBtn = ev.target.closest?.('[data-group-leave], [data-row-group-leave]');
      if (leaveGroupBtn) {
        closeFloatingMenus();
        const targetConvId = leaveGroupBtn.dataset.groupLeave || leaveGroupBtn.dataset.rowGroupLeave || state.activeConvId;
        if (!targetConvId) return;
        const convMeta = state.conversations.find((c) => c.id === targetConvId) || state.activeThread?.conversation;
        const ok = await ipon().confirmAction({
          title: `Leave "${convDisplayTitle(convMeta)}"?`,
          message: 'You will stop receiving messages from this group chat unless an admin adds you back. If you are the owner, ownership transfers to another member automatically.',
          confirmText: 'Leave group',
          danger: true
        });
        if (!ok) return;
        try {
          await ipon().rpc('remove_group_chat_member', { p_conversation_id: targetConvId, p_target_user_id: null });
          if (state.activeConvId === targetConvId) clearActiveThreadSelection();
          state.mobileShowThread = false;
          syncMobilePaneState();
          await refreshConversations();
          ipon().toast('You left the group chat.');
        } catch (err) {
          ipon().toast(ipon().friendlyError(err), 'error');
        }
        return;
      }
      const memberMenuBtn = ev.target.closest?.('[data-group-member-menu]');
      if (memberMenuBtn) {
        ev.stopPropagation();
        showGroupMemberMenu(memberMenuBtn.dataset.groupMemberMenu, memberMenuBtn);
        return;
      }
      const groupMactBtn = ev.target.closest?.('[data-group-mact]');
      if (groupMactBtn) {
        closeFloatingMenus();
        const op = groupMactBtn.dataset.groupMact;
        const targetId = groupMactBtn.dataset.targetId;
        const conv = state.activeThread?.conversation;
        if (!targetId) return;
        if (op === 'view_profile') {
          await openProfilePopover(targetId, groupMactBtn);
          return;
        }
        if (op === 'message') {
          await handleSocialAction('message', targetId);
          return;
        }
        if (!conv || !isGroupConv(conv)) return;
        const memberObj = (conv.members || []).find((m) => String(m.id) === String(targetId));
        const memberName = memberObj?.full_name || 'this member';
        try {
          if (op === 'make_admin' || op === 'remove_admin') {
            const nextRole = op === 'make_admin' ? 'ADMIN' : 'MEMBER';
            await ipon().rpc('update_group_chat_member_role', {
              p_conversation_id: conv.conversation_id,
              p_target_user_id: targetId,
              p_role: nextRole
            });
            ipon().toast(nextRole === 'ADMIN' ? `${memberName} is now a group admin.` : `Removed admin role from ${memberName}.`);
          } else if (op === 'make_owner') {
            const ok = await ipon().confirmAction({
              title: `Transfer ownership to ${memberName}?`,
              message: 'They will become the group owner and you will stay in the group as a group admin.',
              confirmText: 'Transfer ownership'
            });
            if (!ok) return;
            await ipon().rpc('update_group_chat_member_role', {
              p_conversation_id: conv.conversation_id,
              p_target_user_id: targetId,
              p_role: 'OWNER'
            });
            ipon().toast(`${memberName} is now the group owner.`);
          } else if (op === 'remove_member') {
            const ok = await ipon().confirmAction({
              title: `Remove ${memberName}?`,
              message: 'They will be removed from this group chat immediately.',
              confirmText: 'Remove',
              danger: true
            });
            if (!ok) return;
            await ipon().rpc('remove_group_chat_member', {
              p_conversation_id: conv.conversation_id,
              p_target_user_id: targetId
            });
            ipon().toast(`${memberName} was removed from the group.`);
          }
          await Promise.all([
            openConversation(conv.conversation_id, { markRead: false, silent: true }),
            refreshConversations()
          ]);
        } catch (err) {
          ipon().toast(ipon().friendlyError(err), 'error');
        }
        return;
      }
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

      const CONV_ACT_TOAST = {
        pin: 'Chat pinned.',
        unpin: 'Chat unpinned.',
        mute: 'Chat muted.',
        unmute: 'Chat unmuted.',
        archive: 'Chat archived.',
        unarchive: 'Chat unarchived.',
        mark_unread: 'Marked as unread.',
        delete_for_me: 'Chat cleared.'
      };
      const snapshotConvFlags = (row) => (row ? {
        is_pinned: Boolean(row.is_pinned),
        is_muted: Boolean(row.is_muted),
        is_archived: Boolean(row.is_archived),
        marked_unread: Boolean(row.marked_unread)
      } : null);
      const applyConvFlagMutation = (target, actName, revertSnap = null) => {
        if (!target) return;
        if (revertSnap) {
          Object.assign(target, revertSnap);
          return;
        }
        if (actName === 'pin') target.is_pinned = true;
        else if (actName === 'unpin') target.is_pinned = false;
        else if (actName === 'mute') target.is_muted = true;
        else if (actName === 'unmute') target.is_muted = false;
        else if (actName === 'archive') { target.is_archived = true; target.is_pinned = false; }
        else if (actName === 'unarchive') target.is_archived = false;
        else if (actName === 'mark_unread') target.marked_unread = true;
      };
      const runConvMemberAction = async (cId, act, triggerBtn) => {
        if (!cId || !act) return;
        const listRow = state.conversations.find((c) => c.id === cId) || null;
        const activeConv = state.activeThread?.conversation?.conversation_id === cId ? state.activeThread.conversation : null;
        const rowSnap = snapshotConvFlags(listRow);
        const activeSnap = snapshotConvFlags(activeConv);
        if (act !== 'delete_for_me') {
          applyConvFlagMutation(listRow, act);
          applyConvFlagMutation(activeConv, act);
          renderConversationList();
          if (state.showThreadInfo && state.activeConvId === cId) renderThreadInfoDrawer();
        }
        if (triggerBtn) {
          triggerBtn.disabled = true;
          triggerBtn.setAttribute?.('aria-busy', 'true');
        }
        try {
          await ipon().rpc('update_conversation_member_state', { p_conversation_id: cId, p_action: act });
          if (CONV_ACT_TOAST[act]) ipon().toast(CONV_ACT_TOAST[act]);
          if (act === 'delete_for_me') {
            if (state.activeConvId === cId) clearActiveThreadSelection();
            await refreshConversations();
          } else {
            await Promise.all([
              state.activeConvId === cId ? openConversation(cId, { markRead: false, silent: true }) : Promise.resolve(),
              refreshConversations()
            ]);
          }
        } catch (err) {
          if (rowSnap) applyConvFlagMutation(listRow, act, rowSnap);
          if (activeSnap) applyConvFlagMutation(activeConv, act, activeSnap);
          renderConversationList();
          if (state.showThreadInfo && state.activeConvId === cId) renderThreadInfoDrawer();
          ipon().toast(ipon().friendlyError(err), 'error');
        } finally {
          if (triggerBtn) {
            triggerBtn.disabled = false;
            triggerBtn.removeAttribute?.('aria-busy');
          }
        }
      };

      const rowConvAct = ev.target.closest?.('[data-row-conv-act]');
      if (rowConvAct) {
        closeFloatingMenus();
        const act = rowConvAct.dataset.rowConvAct;
        const cId = rowConvAct.dataset.convId;
        if (act === 'delete_for_me') {
          const ok = await ipon().confirmAction({ title: 'Delete conversation from your inbox?', message: 'This removes the chat history for you only.', confirmText: 'Delete' });
          if (!ok) return;
        }
        await runConvMemberAction(cId, act, rowConvAct);
        return;
      }

      const convActBtn = ev.target.closest?.('[data-conv-act]');
      if (convActBtn && state.activeConvId) {
        const act = convActBtn.dataset.convAct;
        if (act === 'delete_for_me') {
          const ok = await ipon().confirmAction({ title: 'Delete conversation for you?', message: 'Messages will be cleared from your own inbox view.', confirmText: 'Delete' });
          if (!ok) return;
        }
        await runConvMemberAction(state.activeConvId, act, convActBtn);
        return;
      }

      const vanishDlg = document.getElementById('msg-vanish-dialog');
      if (vanishDlg?.open && ev.target === vanishDlg) {
        closeVanishModal();
        return;
      }
      if (ev.target.closest?.('[data-vanish-close]')) {
        closeVanishModal();
        return;
      }
      if (ev.target.closest?.('[data-vanish-open-modal]') && state.activeConvId) {
        openVanishModal();
        return;
      }
      const vanishSwitch = ev.target.closest?.('[data-vanish-switch]');
      if (vanishSwitch && state.activeConvId && !state.savingVanish) {
        const current = Number(state.activeThread?.conversation?.vanish_after_seconds) || 0;
        if (current > 0) await saveVanishSetting(0);
        else openVanishModal();
        return;
      }
      const vanishPresetBtn = ev.target.closest?.('[data-vanish-preset]');
      if (vanishPresetBtn && state.activeConvId) {
        state.vanishDraftSeconds = Number(vanishPresetBtn.dataset.vanishPreset);
        state.vanishDraftCustom = false;
        state.vanishCustomValue = '';
        const input = document.getElementById('msg-vanish-custom-value');
        if (input) { input.value = ''; input.setCustomValidity(''); }
        setVanishHint('', false);
        syncVanishModalControls();
        return;
      }
      const vanishUnitBtn = ev.target.closest?.('[data-vanish-unit]');
      if (vanishUnitBtn) {
        state.vanishCustomUnit = vanishUnitBtn.dataset.vanishUnit === 'minutes' ? 'minutes' : 'seconds';
        syncVanishModalControls();
        if (state.vanishDraftCustom) validateVanishCustomInput(true);
        else setVanishHint('', false);
        return;
      }
      const vanishRetry = ev.target.closest?.('[data-vanish-retry]');
      if (vanishRetry && state.activeConvId) {
        vanishRetry.disabled = true;
        await openConversation(state.activeConvId, { markRead: false, silent: true });
        renderThreadInfoDrawer();
        if (document.getElementById('msg-vanish-dialog')?.open) renderVanishModal();
        return;
      }

      const protectionRetry = ev.target.closest?.('[data-chat-protection-retry]');
      if (protectionRetry && state.activeConvId && !state.checkingProtection) {
        const convId = state.activeConvId;
        const conv = state.activeThread?.conversation;
        if (!conv) return;
        state.checkingProtection = true;
        renderThreadInfoDrawer();
        try {
          await ipon().probeNativeScreenshotProtection?.();
          const platform = await ipon().reportClientPlatform?.({ force: true });
          if (platform !== 'android_app' || !supportsNativeScreenshotProtection()) {
            throw new Error('Screenshot blocking is unavailable in this app session. Reopen the latest Android app.');
          }
          const peerIds = isGroupConv(conv) ? (conv.members || []).map((member) => member.user_id || member.id) : [conv.id];
          const peerReplied = await ipon().refreshPeerClientPlatforms?.(peerIds);
          const protection = await ipon().rpc('get_conversation_protection', { p_conversation_id: convId });
          if (state.activeConvId !== convId) return;
          Object.assign(conv, protection);
          conv.protection_unavailable = false;
          syncNativeScreenshotLock(conv);
          if (!protection?.screenshot_block_eligible || hasLiveBrowserParticipant(conv)) {
            ipon().toast(peerReplied
              ? 'Screenshot blocking needs everyone to use the Android app.'
              : 'The other app did not respond. Open myIPON on both Android devices and try again.', 'error');
          }
        } catch (error) {
          ipon().toast(ipon().friendlyError(error), 'error');
        } finally {
          state.checkingProtection = false;
          if (state.activeConvId === convId) renderThreadInfoDrawer();
        }
        return;
      }

      const anonymousBtn = ev.target.closest?.('[data-anonymous-toggle]');
      if (anonymousBtn && state.activeConvId && !state.savingProtection) {
        const convId = state.activeConvId;
        const conv = state.activeThread?.conversation;
        if (!conv || conv.protection_unavailable || isSelfUser(conv)
          || (isGroupConv(conv) && !['OWNER', 'ADMIN'].includes(String(conv.my_role || '').toUpperCase()))) return;
        const enabled = !conv.anonymous_enabled;
        if (!enabled) {
          const accepted = await ipon().confirmAction({
            title: 'End anonymous mode?',
            message: isGroupConv(conv)
              ? 'All messages and attachments sent while anonymous mode was on will be deleted for everyone in this group.'
              : 'All messages and attachments sent while anonymous mode was on will be deleted for both people.',
            confirmText: 'End and delete'
          });
          if (!accepted) return;
        }
        state.savingProtection = true;
        anonymousBtn.disabled = true;
        try {
          await ipon().rpc('set_anonymous_chat', { p_conversation_id: convId, p_enabled: enabled });
          if (!enabled) {
            state.pendingByConv.delete(convId);
            state.draftsByConv.delete(convId);
          }
          state.threadSearchSenderId = '';
          await Promise.all([
            openConversation(convId, { markRead: false, silent: true }),
            refreshConversations(),
            refreshSocialNotifications()
          ]);
        } catch (error) {
          ipon().toast(ipon().friendlyError(error), 'error');
        } finally {
          state.savingProtection = false;
          if (state.activeConvId === convId) renderThreadInfoDrawer();
        }
        return;
      }

      const protectionBtn = ev.target.closest?.('[data-chat-protection]');
      if (protectionBtn && state.activeConvId && !state.savingProtection) {
        const setting = protectionBtn.dataset.chatProtection;
        const convId = state.activeConvId;
        const conv = state.activeThread?.conversation;
        if (!conv || conv.protection_unavailable) return;
        if (setting === 'screenshots') {
          if (!supportsNativeScreenshotProtection()) return;
          const nextEnabled = !conv.block_screenshots;
          if (nextEnabled && (!conv.screenshot_block_eligible || hasLiveBrowserParticipant(conv))) {
            ipon().toast(
              isGroupConv(conv)
                ? 'Block screenshots requires all members in this chat to use the mobile app.'
                : 'Block screenshots requires both people in this chat to use the mobile app.',
              'error'
            );
            return;
          }
        }
        state.savingProtection = true;
        document.querySelectorAll('[data-chat-protection]').forEach((button) => { button.disabled = true; });
        try {
          const next = await ipon().rpc('set_conversation_protection', {
            p_conversation_id: convId, p_setting: setting,
            p_enabled: !conv[setting === 'screenshots' ? 'block_screenshots' : setting === 'screenshot_notices' ? 'screenshot_notices_enabled' : 'block_forwarding']
          });
          Object.assign(conv, next);
          if (state.activeConvId === convId) syncNativeScreenshotLock(conv);
          if (setting === 'screenshots') {
            Promise.all([
              openConversation(convId, { markRead: false, silent: true, scrollToBottom: true }),
              refreshConversations()
            ]).catch(() => { });
          }
        } catch (err) {
          ipon().toast(ipon().friendlyError(err), 'error');
        } finally {
          state.savingProtection = false;
          renderThreadInfoDrawer();
          if (state.activeConvId === convId) document.querySelector(`[data-chat-protection="${setting}"]`)?.focus({ preventScroll: true });
        }
        return;
      }

      const themeBtn = ev.target.closest?.('[data-conv-theme]');
      if (themeBtn && state.activeConvId) {
        const nextTheme = themeBtn.dataset.convTheme || 'paper';
        const conv = state.activeThread?.conversation;
        const prevTheme = conv?.chat_theme || 'paper';
        if (conv) conv.chat_theme = nextTheme;
        applyThreadTheme(conv?.anonymous_enabled ? 'anonymous' : nextTheme);
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
        if (state.showThreadInfo && isAndroidNativeShell()) {
          await refreshActiveConversationProtection();
          renderThreadInfoDrawer();
        }
        return;
      }

      if (ev.target.closest?.('#msg-load-older-btn')) {
        await loadOlderMessages();
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
          const reqConv = state.conversations.find((c) => c.id === state.activeConvId) || state.activeThread?.conversation;
          const reqPeerId = reqConv?.peer?.id || (reqConv && !isGroupConv(reqConv) ? reqConv.id : null);
          await ipon().rpc('respond_message_request', { p_conversation_id: state.activeConvId, p_decision: dec });
          if (reqPeerId) profileAppearanceCache.delete(String(reqPeerId));
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
          if (fReqBtn.dataset.reqDecision === 'ACCEPT') profileAppearanceCache.clear();
          ipon().toast(fReqBtn.dataset.reqDecision === 'ACCEPT' ? 'Friend request accepted!' : 'Friend request declined.');
          closeProfilePopover();
          await Promise.all([refreshOverview(), refreshConversations()]);
          if (state.activeConvId) await openConversation(state.activeConvId, { markRead: false, silent: true });
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
          await Promise.all([refreshOverview(), refreshConversations()]);
          if (state.activeConvId) await openConversation(state.activeConvId, { markRead: false, silent: true });
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
        await toggleMessageReaction(reactPill.dataset.reactMsg, reactPill.dataset.reactEmoji);
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
          if (inp) { inp.value = msgObj.body || ''; autoResizeTextarea(inp); syncComposerCharCounter(inp.value.length); inp.focus(); }
        } else if (op === 'forward') {
          await openForwardDialog(msgObj);
        } else if (op === 'pin') {
          await ipon().rpc('pin_chat_message', { p_message_id: mId }).catch((e) => ipon().toast(ipon().friendlyError(e), 'error'));
          state.activePinnedId = null;
          await openConversation(state.activeConvId, { markRead: false, silent: true });
        } else if (op === 'del_me' || op === 'del_all') {
          if (op === 'del_all') {
            const unsendMsg = isGroupConv(state.activeThread?.conversation)
              ? 'This removes the message and its attachments for everyone in this group chat.'
              : 'This removes the message and its attachments for both participants.';
            const ok = await ipon().confirmAction({ title: 'Unsend for everyone?', message: unsendMsg, confirmText: 'Unsend', danger: true });
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
        if (item && item.status === 'failed') {
          item.status = 'queued';
          item.errorText = '';
          renderMessagesList();
          queuePendingMessage(item);
        }
        return;
      }
      const deletePendingBtn = ev.target.closest?.('[data-pending-delete]');
      if (deletePendingBtn && state.activeConvId) {
        removePendingItem(state.activeConvId, deletePendingBtn.dataset.pendingDelete, { revokeUrls: true, cleanupRemote: true });
        return;
      }
      if (ev.target.closest?.('#msg-cancel-context')) {
        const wasEditing = Boolean(state.editingMsg);
        state.replyToMsg = null;
        state.editingMsg = null;
        if (wasEditing) restoreDraftAfterEdit();
        renderContextBar();
        return;
      }
      const attachTrigger = ev.target.closest?.('#msg-attach-btn');
      if (attachTrigger) {
        if (state.activeThread?.conversation && !canInteractInThread(state.activeThread.conversation)) return;
        closeFloatingMenus();
        const emojiPopEl = document.getElementById('msg-emoji-popover');
        if (emojiPopEl) emojiPopEl.hidden = true;
        const menuEl = document.getElementById('msg-attach-menu');
        if (menuEl) {
          const nextOpen = menuEl.hidden;
          menuEl.hidden = !nextOpen;
          attachTrigger.setAttribute?.('aria-expanded', String(nextOpen));
          if (nextOpen) menuEl.querySelector?.('[data-attach-source]')?.focus?.();
        }
        return;
      }
      const attachOptBtn = ev.target.closest?.('[data-attach-source]');
      if (attachOptBtn) {
        if (state.activeThread?.conversation && !canInteractInThread(state.activeThread.conversation)) {
          closeAttachMenu();
          return;
        }
        const source = attachOptBtn.dataset.attachSource || 'files';
        closeAttachMenu();
        if (typeof window !== 'undefined' && typeof window.IponNativePicker?.setSource === 'function') {
          try { window.IponNativePicker.setSource(source); } catch { }
          const inputId = source === 'gallery'
            ? 'msg-gallery-input'
            : source === 'gdrive'
              ? 'msg-drive-input'
              : 'msg-file-input';
          document.getElementById(inputId)?.click();
          return;
        }
        if (source === 'gdrive') {
          openWebGoogleDriveDialog();
          return;
        }
        const inputId = source === 'gallery' ? 'msg-gallery-input' : 'msg-file-input';
        document.getElementById(inputId)?.click();
        return;
      }
      const remQ = ev.target.closest?.('[data-remove-queue]');
      if (remQ) {
        const idx = Number(remQ.dataset.removeQueue);
        if (state.uploadQueue[idx]?.previewUrl) try { URL.revokeObjectURL(state.uploadQueue[idx].previewUrl); } catch { }
        state.uploadQueue.splice(idx, 1);
        renderUploadQueue();
        return;
      }

      if (ev.target.closest?.('#msg-emoji-btn')) {
        closeAttachMenu();
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
        const galleryHost = imgBtn.closest?.('.msg-bubble, .msg-drawer-media-grid, .msg-upload-queue');
        const groupBtns = galleryHost
          ? Array.from(galleryHost.querySelectorAll?.('[data-open-img]') || []).filter((b) => b.dataset?.openImg)
          : [];
        const gallery = groupBtns.length > 1
          ? groupBtns.map((btn) => {
              const bPath = btn.dataset.imgPath || '';
              const bConv = btn.dataset.imgConv || dlConv;
              const bName = btn.dataset.imgName || 'Image';
              return {
                src: btn.dataset.openImg,
                title: bName,
                subtitle: '',
                downloadName: bName,
                onDownload: bPath && bConv ? () => downloadOriginalAttachment(bConv, bPath, bName) : null
              };
            })
          : null;
        const startIndex = gallery ? Math.max(0, groupBtns.indexOf(imgBtn)) : 0;
        ipon().openImageViewer(imgBtn.dataset.openImg, imgName, '', imgName, {
          onDownload: dlPath && dlConv ? () => downloadOriginalAttachment(dlConv, dlPath, imgName) : null,
          ...(gallery ? { gallery, index: startIndex } : {})
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

    document.addEventListener('submit', async (ev) => {
      if (ev.target?.id === 'msg-vanish-custom-form') {
        ev.preventDefault();
        const seconds = state.vanishDraftCustom
          ? validateVanishCustomInput(true)
          : state.vanishDraftSeconds;
        if (seconds === null) { document.getElementById('msg-vanish-custom-value')?.focus(); return; }
        await saveVanishSetting(seconds, { closeModalOnSuccess: true });
        return;
      }
      if (ev.target?.id === 'msg-composer-form') {
        submitComposer(ev);
        return;
      }
      if (ev.target?.id === 'msg-group-edit-form' && state.activeConvId) {
        ev.preventDefault();
        const titleInput = document.getElementById('msg-group-edit-title');
        const descInput = document.getElementById('msg-group-edit-desc');
        const errEl = document.getElementById('msg-group-edit-error');
        const saveBtn = document.getElementById('msg-group-edit-save');
        const nextTitle = String(titleInput?.value || '').trim().replace(/\s+/g, ' ');
        const nextDesc = String(descInput?.value || '').trim();
        let err = '';
        if (nextTitle.length < 2) err = 'Group name must be at least 2 characters.';
        else if (nextTitle.length > 80) err = 'Group name must be 80 characters or fewer.';
        if (errEl) {
          errEl.textContent = err;
          errEl.title = err;
          errEl.classList?.toggle?.('is-visible', Boolean(err));
          errEl.setAttribute?.('aria-hidden', err ? 'false' : 'true');
        }
        titleInput?.setAttribute?.('aria-invalid', err ? 'true' : 'false');
        if (err) { titleInput?.focus(); return; }
        ipon().setBusy?.(saveBtn, true, 'Saving…');
        try {
          const uploadedAvatarUrl = !state.groupEditAvatarClear && state.groupEditAvatarDataUrl
            ? await uploadGroupPicIfNeeded(state.groupEditAvatarDataUrl)
            : null;
          await ipon().rpc('update_group_chat_info', {
            p_conversation_id: state.activeConvId,
            p_title: nextTitle,
            p_description: nextDesc,
            p_avatar_url: uploadedAvatarUrl || null,
            p_clear_avatar: Boolean(state.groupEditAvatarClear && !uploadedAvatarUrl)
          });
          state.groupEditAvatarDataUrl = null;
          state.groupEditAvatarClear = false;
          ipon().toast('Group info updated.');
          await Promise.all([
            openConversation(state.activeConvId, { markRead: false, silent: true }),
            refreshConversations()
          ]);
        } catch (error) {
          ipon().toast(ipon().friendlyError(error), 'error');
        } finally {
          ipon().setBusy?.(saveBtn, false);
          syncGroupEditDirtyState();
        }
      }
    });

    document.addEventListener('input', (ev) => {
      if (ev.target?.id === 'msg-vanish-custom-value') {
        const cleaned = String(ev.target.value || '').replace(/[^0-9]/g, '');
        if (cleaned !== ev.target.value) ev.target.value = cleaned;
        state.vanishCustomValue = cleaned;
        state.vanishDraftCustom = cleaned !== '';
        state.vanishError = '';
        syncVanishModalControls();
        validateVanishCustomInput(Boolean(cleaned));
        return;
      }
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
        if (state.activeConvId && !state.editingMsg) state.draftsByConv.set(state.activeConvId, ev.target.value);
        sendTypingBroadcast(Boolean(ev.target.value.trim()));
      } else if (ev.target?.id === 'msg-group-edit-title') {
        const val = String(ev.target.value || '').trim().replace(/\s+/g, ' ');
        const err = !val ? 'Enter a group name.' : (val.length < 2 ? 'Group name must be at least 2 characters.' : '');
        const errEl = document.getElementById('msg-group-edit-error');
        if (errEl) {
          errEl.textContent = err;
          errEl.title = err;
          errEl.classList?.toggle?.('is-visible', Boolean(err));
          errEl.setAttribute?.('aria-hidden', err ? 'false' : 'true');
        }
        ev.target.setAttribute?.('aria-invalid', err ? 'true' : 'false');
        syncGroupEditDirtyState();
      } else if (ev.target?.id === 'msg-group-edit-desc') {
        syncGroupEditDirtyState();
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

    document.addEventListener('focusin', (ev) => {
      if (ev.target?.id === 'msg-composer-input' && shouldAutoScrollOnComposer()) scrollActiveThreadToBottom();
    });

    document.addEventListener('focusout', (ev) => {
      if (ev.target?.id === 'msg-vanish-custom-value') validateVanishCustomInput(true);
      if (ev.target?.id === 'msg-composer-input') {
        sendTypingBroadcast(false);
      }
    });

    document.addEventListener('invalid', (ev) => {
      if (ev.target?.id === 'msg-vanish-custom-value') validateVanishCustomInput(true);
    }, true);

    document.addEventListener('change', async (ev) => {
      if (ev.target?.id === 'msg-vanish-custom-unit') {
        state.vanishCustomUnit = ev.target.value === 'minutes' ? 'minutes' : 'seconds';
        syncVanishModalControls();
        validateVanishCustomInput(Boolean(document.getElementById('msg-vanish-custom-value')?.value));
        return;
      }
      if (ev.target?.id === 'msg-file-input' || ev.target?.id === 'msg-gallery-input' || ev.target?.id === 'msg-drive-input') {
        queuePickedFiles(ev.target.files);
        ev.target.value = '';
      } else if (ev.target?.id === 'msg-group-edit-pic-input') {
        const input = ev.target;
        const file = input.files?.[0];
        input.value = '';
        if (!file) return;
        try {
          const dataUrl = await prepareGroupPicDataUrl(file);
          state.groupEditAvatarDataUrl = dataUrl;
          state.groupEditAvatarClear = false;
          state.groupEditAvatarConvId = state.activeConvId;
          syncGroupEditAvatarUi();
        } catch (error) {
          ipon().toast(ipon().friendlyError(error), 'error');
        }
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
      if (ev.target?.closest?.('#msg-vanish-chips') && ['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(ev.key)) {
        ev.preventDefault();
        const curIdx = VANISH_PRESETS.indexOf(state.vanishDraftSeconds);
        const dir = (ev.key === 'ArrowRight' || ev.key === 'ArrowDown') ? 1 : -1;
        state.vanishDraftSeconds = VANISH_PRESETS[(Math.max(curIdx, 0) + dir + VANISH_PRESETS.length) % VANISH_PRESETS.length];
        state.vanishDraftCustom = false;
        state.vanishCustomValue = '';
        const input = document.getElementById('msg-vanish-custom-value');
        if (input) { input.value = ''; input.setCustomValidity(''); }
        setVanishHint('', false);
        syncVanishModalControls();
        document.querySelector('#msg-vanish-chips [aria-checked="true"]')?.focus();
        return;
      }
      if (ev.target?.id === 'msg-vanish-custom-value' && ['e', 'E', '+', '-', '.'].includes(ev.key)) {
        ev.preventDefault();
        return;
      }
      if (ev.key === 'Escape') {
        const vanishDlg = document.getElementById('msg-vanish-dialog');
        if (vanishDlg?.open) {
          ev.preventDefault();
          closeVanishModal();
          return;
        }
        const dpDlg = document.getElementById('ipon-dp-viewer');
        if (dpDlg?.open) {
          ev.preventDefault();
          dpDlg.close();
          return;
        }
        if (ev.target?.id === 'msg-list-search' && (state.searchActive || state.chatListQuery.trim())) {
          ev.preventDefault();
          clearSidebarSearch();
          return;
        }
        closeProfilePopover();
        closeFloatingMenus();
        closeAttachMenu();
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

    document.addEventListener('mouseover', (ev) => {
      if (ev.target?.closest?.('#msg-profile-popover')) {
        if (profileLeaveTimer) {
          clearTimeout(profileLeaveTimer);
          profileLeaveTimer = null;
        }
      }
      const hoverDp = ev.target?.closest?.('[data-social-hover-dp]');
      if (hoverDp) {
        if (profileLeaveTimer) {
          clearTimeout(profileLeaveTimer);
          profileLeaveTimer = null;
        }
        const targetId = String(hoverDp.dataset.socialHoverDp || '').trim();
        const profPop = document.getElementById('msg-profile-popover');
        if (targetId && !(profPop && !profPop.hidden && activePopoverAnchor === hoverDp && profPop.dataset.targetId === targetId)) {
          if (profileHoverTimer) clearTimeout(profileHoverTimer);
          profileHoverTimer = setTimeout(() => {
            profileHoverTimer = null;
            void openProfilePopover(targetId, hoverDp, { pinned: false });
          }, 110);
        }
      }
      if (ev.target?.closest?.('#msg-mutual-popover')) {
        clearMutualHoverTimer();
        return;
      }
      const trigger = ev.target?.closest?.('[data-mutual-trigger]');
      if (!trigger) return;
      clearMutualHoverTimer();
      const mutualPop = document.getElementById('msg-mutual-popover');
      if (mutualPop && !mutualPop.hidden && activeMutualAnchor === trigger) return;
      void openMutualPopover(trigger.dataset.mutualTrigger, trigger, { pinned: false });
    });

    document.addEventListener('mouseout', (ev) => {
      const fromProfileHover = ev.target?.closest?.('[data-social-hover-dp], #msg-profile-popover, #msg-mutual-popover');
      if (fromProfileHover && !ev.relatedTarget?.closest?.('[data-social-hover-dp], #msg-profile-popover, #msg-mutual-popover')) {
        if (profileHoverTimer) {
          clearTimeout(profileHoverTimer);
          profileHoverTimer = null;
        }
        const profPop = document.getElementById('msg-profile-popover');
        if (profPop && !profPop.hidden && profPop.dataset.pinned !== '1') {
          if (profileLeaveTimer) clearTimeout(profileLeaveTimer);
          profileLeaveTimer = setTimeout(() => {
            profileLeaveTimer = null;
            if (document.getElementById('ipon-dp-viewer')?.open) return;
            const cur = document.getElementById('msg-profile-popover');
            if (cur && cur.dataset.pinned !== '1') closeProfilePopover();
          }, 200);
        }
      }
      const fromMutual = ev.target?.closest?.('[data-mutual-trigger], #msg-mutual-popover');
      if (!fromMutual) return;
      if (ev.relatedTarget?.closest?.('[data-mutual-trigger], #msg-mutual-popover')) return;
      const mutualPop = document.getElementById('msg-mutual-popover');
      if (!mutualPop || mutualPop.hidden || mutualPop.dataset.pinned === '1') return;
      clearMutualHoverTimer();
      mutualHoverTimer = setTimeout(() => {
        const currentPop = document.getElementById('msg-mutual-popover');
        if (currentPop && currentPop.dataset.pinned !== '1') closeMutualPopover();
      }, 160);
    });

    document.addEventListener('scroll', (ev) => {
      const mutualPop = document.getElementById('msg-mutual-popover');
      if (mutualPop && !mutualPop.hidden && !ev.target?.closest?.('#msg-mutual-popover')) {
        closeMutualPopover();
      }
    }, true);

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
      return { msgId, anchor, bubble };
    };
    const resolveDoubleTapTarget = (target) => {
      const bubble = target?.closest?.('#msg-messages-list .msg-bubble:not(.is-deleted)');
      if (!bubble || bubble.classList?.contains?.('is-text-selectable')) return null;
      if (target?.closest?.(HOLD_EXCLUDE_SEL)) return null;
      if (target?.closest?.('.msg-img-open-btn, .msg-att-doc-btn, .msg-video-center-play, video, button')) return null;
      if (state.activeThread?.conversation && !canInteractInThread(state.activeThread.conversation)) return null;
      const row = bubble.closest?.('[data-msg-id]');
      if (!row || row.classList?.contains?.('is-pending') || row.classList?.contains?.('is-failed')) return null;
      const msgId = row.dataset?.msgId;
      if (!msgId) return null;
      return { msgId, bubble };
    };
    let tapCandidate = null;
    const SWIPE_REPLY_THRESHOLD = 44;
    let swipeState = null;
    const clearSwipeVisuals = (row) => {
      if (!row) return;
      row.classList?.remove?.('is-swiping', 'is-swipe-ready');
      row.style?.removeProperty?.('--swipe-x');
      row.style?.removeProperty?.('--swipe-progress');
    };
    const resolveSwipeTarget = (target, pointerType) => {
      const row = target?.closest?.('#msg-messages-list .msg-row[data-msg-id]');
      if (!row || row.classList?.contains?.('is-pending')) return null;
      if (row.querySelector?.('.msg-bubble.is-deleted')) return null;
      if (state.activeThread?.conversation && !canInteractInThread(state.activeThread.conversation)) return null;
      const mediaSurface = target?.closest?.('.msg-img-open-btn, .msg-att-video, .msg-video-center-play, .msg-att-doc-btn');
      if (target?.closest?.('button, a, input, textarea, select, [role="button"], .msg-video-controls, .msg-voice-play-btn') && !mediaSurface) return null;
      if (pointerType === 'mouse' && target?.closest?.('.msg-text, .msg-reply-quote, .msg-sender-name')) return null;
      const msgId = row.dataset?.msgId;
      if (!msgId) return null;
      const msgObj = (state.activeThread?.messages || []).find((m) => String(m.id) === String(msgId));
      if (!msgObj) return null;
      const carousel = target?.closest?.('.msg-attachments.is-carousel') || null;
      return { row, msgId, msgObj, carousel };
    };
    const snapCarouselAfterDrag = (carousel, velocityX = 0) => {
      if (!carousel) return;
      carousel.classList?.remove?.('is-dragging');
      const cards = Array.from(carousel.children || []);
      if (!cards.length || typeof carousel.scrollTo !== 'function') return;
      const curLeft = Number(carousel.scrollLeft || 0);
      const maxScroll = Math.max(0, Number(carousel.scrollWidth || 0) - Number(carousel.clientWidth || 0));
      if (maxScroll <= 0) return;
      const offsets = cards.map((el) => Math.min(maxScroll, Math.max(0, Number(el.offsetLeft || 0))));
      let bestIdx = 0;
      let bestDist = Infinity;
      offsets.forEach((off, idx) => {
        const dist = Math.abs(off - curLeft);
        if (dist < bestDist) { bestDist = dist; bestIdx = idx; }
      });
      if (velocityX < -0.35 && bestIdx < offsets.length - 1 && offsets[bestIdx] <= curLeft + 12) {
        bestIdx += 1;
      } else if (velocityX > 0.35 && bestIdx > 0 && offsets[bestIdx] >= curLeft - 12) {
        bestIdx -= 1;
      }
      carousel.scrollTo({ left: offsets[bestIdx], behavior: 'smooth' });
    };
    const advanceSwipe = (clientX, clientY, pointerType) => {
      if (!swipeState || swipeState.cancelledVertical) return;
      const curX = clientX || 0;
      const curY = clientY || 0;
      const nowTs = Date.now();
      const dt = Math.max(1, nowTs - (swipeState.lastTs || nowTs));
      if (curX !== swipeState.lastX) {
        swipeState.velocityX = (curX - swipeState.lastX) / dt;
        swipeState.lastX = curX;
        swipeState.lastTs = nowTs;
      }
      const dx = curX - swipeState.startX;
      const dy = curY - swipeState.startY;
      if (!swipeState.mode) {
        if (Math.abs(dy) > 10 && Math.abs(dy) >= Math.abs(dx)) {
          swipeState.cancelledVertical = true;
          clearSwipeVisuals(swipeState.row);
          return;
        }
        if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy) * 1.15) {
          if (!swipeState.carousel) {
            if (dx <= 8) return;
            swipeState.mode = 'reply';
            swipeState.lockedHorizontal = true;
            swipeState.movedFar = true;
            swipeState.replyOriginX = swipeState.startX;
            cancelLongPress();
            if (pointerType !== 'mouse') window.getSelection?.()?.removeAllRanges?.();
            swipeState.row.classList?.add?.('is-swiping');
          } else if (dx > 0 && swipeState.startScrollLeft <= 2) {
            swipeState.mode = 'reply';
            swipeState.lockedHorizontal = true;
            swipeState.movedFar = true;
            swipeState.replyOriginX = swipeState.startX;
            cancelLongPress();
            if (pointerType !== 'mouse') window.getSelection?.()?.removeAllRanges?.();
            swipeState.row.classList?.add?.('is-swiping');
          } else {
            swipeState.mode = 'carousel-scroll';
            swipeState.movedFar = true;
            cancelLongPress();
            if (pointerType !== 'mouse') window.getSelection?.()?.removeAllRanges?.();
            swipeState.carousel.classList?.add?.('is-dragging');
          }
        }
      }
      if (swipeState.mode === 'carousel-scroll' && swipeState.carousel) {
        const rawScroll = swipeState.startScrollLeft - dx;
        if (rawScroll < -10) {
          swipeState.carousel.scrollLeft = 0;
          swipeState.carousel.classList?.remove?.('is-dragging');
          swipeState.mode = 'reply';
          swipeState.lockedHorizontal = true;
          swipeState.replyOriginX = swipeState.startX + swipeState.startScrollLeft;
          swipeState.row.classList?.add?.('is-swiping');
        } else {
          const hasDims = Number(swipeState.carousel.scrollWidth || 0) > 0 && Number(swipeState.carousel.clientWidth || 0) > 0;
          const maxScroll = hasDims
            ? Math.max(0, Number(swipeState.carousel.scrollWidth) - Number(swipeState.carousel.clientWidth))
            : Math.max(0, rawScroll);
          swipeState.carousel.scrollLeft = Math.max(0, Math.min(maxScroll, rawScroll));
          return;
        }
      }
      if (swipeState.mode === 'reply' && swipeState.lockedHorizontal) {
        const replyDx = curX - (swipeState.replyOriginX ?? swipeState.startX);
        const clampedRaw = Math.max(0, replyDx);
        const visualX = clampedRaw <= SWIPE_REPLY_THRESHOLD
          ? clampedRaw
          : SWIPE_REPLY_THRESHOLD + Math.min(24, (clampedRaw - SWIPE_REPLY_THRESHOLD) * 0.38);
        const progress = Math.min(1, clampedRaw / SWIPE_REPLY_THRESHOLD);
        const isReady = clampedRaw >= SWIPE_REPLY_THRESHOLD;
        swipeState.ready = isReady;
        swipeState.row.style?.setProperty?.('--swipe-x', `${visualX.toFixed(1)}px`);
        swipeState.row.style?.setProperty?.('--swipe-progress', progress.toFixed(2));
        swipeState.row.classList?.toggle?.('is-swipe-ready', isReady);
        if (isReady && !swipeState.vibrated) {
          swipeState.vibrated = true;
          if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
            try { navigator.vibrate(12); } catch { }
          }
        }
      }
    };
    const resetSwipe = ({ triggerReply = false } = {}) => {
      const active = swipeState;
      swipeState = null;
      if (!active) return;
      if (active.mode === 'carousel-scroll' && active.carousel) {
        snapCarouselAfterDrag(active.carousel, active.velocityX);
      } else {
        active.carousel?.classList?.remove?.('is-dragging');
      }
      clearSwipeVisuals(active.row);
      if (active.movedFar) {
        suppressBubbleClickId = active.msgId;
        clearSuppressedClickSoon(active.msgId);
      }
      if (active.mode === 'reply' && active.lockedHorizontal && active.ready && triggerReply && active.msgObj) {
        startReplyToMessage(active.msgObj);
      }
    };

    document.addEventListener('pointerdown', (ev) => {
      if (ev.pointerType === 'mouse' && typeof ev.button === 'number' && ev.button !== 0) return;
      if (unlockedSelectBubble && !unlockedSelectBubble.contains?.(ev.target)) {
        clearUnlockedTextSelection();
      }
      if (unlockedSelectBubble && unlockedSelectBubble.contains?.(ev.target)) {
        cancelLongPress();
        tapCandidate = null;
        return;
      }
      resetSwipe({ triggerReply: false });
      const dtTarget = resolveDoubleTapTarget(ev.target);
      tapCandidate = dtTarget
        ? { ...dtTarget, x: ev.clientX || 0, y: ev.clientY || 0, at: Date.now() }
        : null;
      const swipeTarget = resolveSwipeTarget(ev.target, ev.pointerType);
      const isMouseScrollbar = Boolean(
        swipeTarget?.carousel
        && ev.pointerType === 'mouse'
        && ev.target === swipeTarget.carousel
        && Number(swipeTarget.carousel.clientHeight || 0) > 0
        && Number(ev.offsetY || 0) >= Number(swipeTarget.carousel.clientHeight)
      );
      if (swipeTarget && !isMouseScrollbar) {
        const sx = ev.clientX || 0;
        const sy = ev.clientY || 0;
        swipeState = {
          ...swipeTarget,
          pointerId: ev.pointerId,
          startX: sx,
          startY: sy,
          lastX: sx,
          lastTs: Date.now(),
          velocityX: 0,
          replyOriginX: null,
          startScrollLeft: swipeTarget.carousel ? Math.round(swipeTarget.carousel.scrollLeft || 0) : 0,
          mode: null,
          lockedHorizontal: false,
          cancelledVertical: false,
          ready: false,
          movedFar: false,
          vibrated: false
        };
      }
      const target = resolveHoldTarget(ev.target);
      if (!target) {
        cancelLongPress();
        return;
      }
      cancelLongPress();
      suppressBubbleClickId = null;
      pressStart = { x: ev.clientX || 0, y: ev.clientY || 0 };
      pressTimer = setTimeout(() => {
        pressTimer = null;
        pressStart = null;
        tapCandidate = null;
        lastBubbleTap = null;
        const now = Date.now();
        const textEl = target.bubble?.querySelector?.('.msg-text') || null;
        const isDoubleTextHold = Boolean(
          textEl
          && lastTextHold
          && String(lastTextHold.msgId) === String(target.msgId)
          && (now - lastTextHold.at) <= DOUBLE_HOLD_TEXT_WINDOW_MS
        );
        pressHoldTriggeredId = target.msgId;
        suppressBubbleClickId = target.msgId;
        recentHoldMsgId = target.msgId;
        recentHoldAt = now;
        if (isDoubleTextHold) {
          lastTextHold = null;
          closeFloatingMenus({ immediate: true });
          unlockMessageTextSelection(target.bubble);
          return;
        }
        clearUnlockedTextSelection({ clearRanges: true });
        lastTextHold = textEl ? { msgId: target.msgId, at: now } : null;
        showReactionFloatingMenu(target.msgId, target.anchor, { toggle: false });
      }, MSG_HOLD_DELAY_MS);
    });
    document.addEventListener('touchmove', (ev) => {
      if (!swipeState || swipeState.cancelledVertical || !swipeState.carousel || !ev.cancelable) return;
      const touch = ev.touches?.[0];
      if (!touch) return;
      if (swipeState.mode === 'reply' || swipeState.mode === 'carousel-scroll') {
        ev.preventDefault();
        return;
      }
      const dx = Math.abs((touch.clientX || 0) - swipeState.startX);
      const dy = Math.abs((touch.clientY || 0) - swipeState.startY);
      if (dx > 2 && dx >= dy) ev.preventDefault();
    }, { passive: false });
    document.addEventListener('pointermove', (ev) => {
      if (pressStart && Math.hypot((ev.clientX || 0) - pressStart.x, (ev.clientY || 0) - pressStart.y) > 10) {
        cancelLongPress();
      }
      if (tapCandidate && Math.hypot((ev.clientX || 0) - tapCandidate.x, (ev.clientY || 0) - tapCandidate.y) > 12) {
        tapCandidate = null;
      }
      if (!swipeState || swipeState.cancelledVertical) return;
      if (swipeState.pointerId !== undefined && ev.pointerId !== undefined && ev.pointerId !== swipeState.pointerId) return;
      advanceSwipe(ev.clientX, ev.clientY, ev.pointerType);
    });
    document.addEventListener('pointerup', (ev) => {
      const held = Boolean(pressHoldTriggeredId);
      const swiped = Boolean(swipeState?.movedFar);
      const cand = tapCandidate;
      tapCandidate = null;
      cancelLongPress();
      resetSwipe({ triggerReply: true });
      if (cand && !held && !swiped && (Date.now() - cand.at) < 280) {
        const now = Date.now();
        const cx = ev?.clientX ?? cand.x;
        const cy = ev?.clientY ?? cand.y;
        if (
          lastBubbleTap
          && String(lastBubbleTap.msgId) === String(cand.msgId)
          && (now - lastBubbleTap.at) <= DOUBLE_TAP_WINDOW_MS
          && Math.hypot(cx - lastBubbleTap.x, cy - lastBubbleTap.y) <= 40
        ) {
          lastBubbleTap = null;
          window.getSelection?.()?.removeAllRanges?.();
          closeFloatingMenus();
          suppressBubbleClickId = cand.msgId;
          clearSuppressedClickSoon(cand.msgId);
          void toggleMessageReaction(cand.msgId, DEFAULT_DOUBLE_TAP_EMOJI, { showHeartPop: true, bubbleEl: cand.bubble });
        } else {
          lastBubbleTap = { msgId: cand.msgId, at: now, x: cx, y: cy };
        }
      }
    });
    document.addEventListener('pointercancel', () => {
      tapCandidate = null;
      cancelLongPress();
      resetSwipe({ triggerReply: false });
    });
    document.addEventListener('dblclick', (ev) => {
      const bubble = ev.target?.closest?.('#msg-messages-list .msg-bubble:not(.is-deleted):not(.is-text-selectable)');
      if (bubble && !ev.target?.closest?.(HOLD_EXCLUDE_SEL)) {
        window.getSelection?.()?.removeAllRanges?.();
      }
    });
    document.addEventListener('dragstart', (ev) => {
      if (ev.target?.closest?.('#msg-messages-list .msg-bubble img, #msg-messages-list .msg-bubble video')) {
        ev.preventDefault?.();
      }
    });

    document.addEventListener('contextmenu', (ev) => {
      const target = resolveHoldTarget(ev.target);
      if (!target) return;
      if (target.bubble?.classList?.contains?.('is-text-selectable') || window.getSelection?.()?.toString()?.trim()) return;
      ev.preventDefault?.();
      cancelLongPress();
      if (recentHoldMsgId === target.msgId && Date.now() - recentHoldAt < 900) return;
      suppressBubbleClickId = target.msgId;
      clearSuppressedClickSoon(target.msgId);
      showReactionFloatingMenu(target.msgId, target.anchor, { toggle: false });
    });

    window.addEventListener('myipon:screen-captured', async () => {
      const activeConv = state.activeThread?.conversation;
      if (!supportsNativeScreenshotProtection() || !isThreadActivelyVisible({ ignoreFocus: true }) || state.loadingThread || activeConv?.conversation_id !== state.activeConvId || activeConv?.protection_unavailable || (activeConv?.block_screenshots && isScreenshotBlockEffective(activeConv)) || (isGroupConv(activeConv) && !activeConv.screenshot_notices_enabled)) return;
      const convId = state.activeConvId;
      try {
        const recordedId = await ipon().rpc('record_conversation_screenshot', { p_conversation_id: convId });
        if (recordedId && state.activeConvId === convId) await openConversation(convId, { markRead: false, silent: true, scrollToBottom: true });
      } catch (err) {
        ipon().toast(ipon().friendlyError(err), 'error');
      }
    });

    window.addEventListener('resize', () => {
      closeProfilePopover();
      closeFloatingMenus({ immediate: true });
      closeAttachMenu();
      syncThreadScrollLock();
      if (document.activeElement?.id === 'msg-composer-input' && shouldAutoScrollOnComposer()) scrollActiveThreadToBottom();
      const wrap = document.getElementById('msg-scroll-wrap');
      if (wrap && Number(wrap.clientHeight || 0) > 0) state.lastScrollWrapHeight = Number(wrap.clientHeight);
    });
    window.visualViewport?.addEventListener?.('resize', () => {
      syncThreadScrollLock();
      if (document.activeElement?.id === 'msg-composer-input' && shouldAutoScrollOnComposer()) scrollActiveThreadToBottom();
      const wrap = document.getElementById('msg-scroll-wrap');
      if (wrap && Number(wrap.clientHeight || 0) > 0) state.lastScrollWrapHeight = Number(wrap.clientHeight);
    });
  }

  async function openWorkspace({ tab = null, subTab = null, conversationId = null, messageId = null } = {}) {
    if (!isEligible()) return;
    ensureDialogsMounted();
    const dialog = document.getElementById('msg-workspace-dialog');
    if (!dialog) return;
    if (subTab && ['all', 'incoming', 'sent'].includes(subTab)) {
      state.friendsSubTab = subTab;
    }
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
    const mode = String(sp.get('messages') || '').toLowerCase();
    const sub = String(sp.get('sub') || '').toLowerCase();
    const type = String(itemOrLink?.type || '').toUpperCase();

    if (type === 'SOCIAL_FRIEND_REQUEST' || mode === 'friend_requests' || (mode === 'friends' && sub === 'incoming')) {
      state.friendsSubTab = 'incoming';
      await openWorkspace({ tab: 'friends', subTab: 'incoming' });
    } else if (type === 'SOCIAL_FRIEND_ACCEPTED' || mode === 'friends') {
      const nextSub = sub === 'sent' ? 'sent' : 'all';
      state.friendsSubTab = nextSub;
      await openWorkspace({ tab: 'friends', subTab: nextSub });
    } else if (type === 'SOCIAL_MESSAGE_REQUEST' || mode === 'message_requests' || mode === 'requests') {
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
      refreshTimer = null;
      if (isRefreshingRealtime) {
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
      if (!refreshTimer) refreshTimer = setTimeout(flushRefresh, 240);
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
        if (isInsert && !fromPeer && cId && sendTailByConv.has(cId)) return;
        if (isInsert && fromPeer && cId) {
          const bucket = state.typingPeers.get(cId);
          if (bucket instanceof Map) {
            const senderEntry = bucket.get(String(row.sender_id || ''));
            if (senderEntry?.timer) clearTimeout(senderEntry.timer);
            bucket.delete(String(row.sender_id || ''));
            if (!bucket.size) state.typingPeers.delete(cId);
            updateTypingIndicators({ listChanged: true });
          } else if (bucket) {
            if (bucket?.timer) clearTimeout(bucket.timer);
            state.typingPeers.delete(cId);
            updateTypingIndicators({ listChanged: true });
          }
          const threadActiveHere = isForActive && isThreadActivelyVisible();
          if (!threadActiveHere) {
            ipon().rpc('mark_messages_delivered', { p_conversation_id: cId }).catch(() => { });
          }
          ipon().playUiSound?.('msg-receive');
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
        if (inActive && !msgItem) scheduleRefresh({ convs: false, thread: true, markRead: false });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversations' }, (payload) => {
        const row = payload?.new || payload?.old || {};
        const cId = row.id;
        const curConv = state.activeThread?.conversation;
        const metaOrStatusChanged = Boolean(
          cId &&
          cId === state.activeConvId &&
          curConv && (
            (row.status && curConv.status && row.status !== curConv.status) ||
            (row.block_screenshots !== undefined && row.block_screenshots !== curConv.block_screenshots) ||
            (row.screenshot_notices_enabled !== undefined && row.screenshot_notices_enabled !== curConv.screenshot_notices_enabled) ||
            (row.block_forwarding !== undefined && row.block_forwarding !== curConv.block_forwarding) ||
            (row.vanish_after_seconds !== undefined && row.vanish_after_seconds !== curConv.vanish_after_seconds) ||
            (row.anonymous_session_id !== undefined && Boolean(row.anonymous_session_id) !== Boolean(curConv.anonymous_enabled)) ||
            (isGroupConv(curConv) && (
              (row.title && row.title !== curConv.title) ||
              (row.description !== undefined && row.description !== curConv.description) ||
              (!curConv.anonymous_enabled && row.avatar_url !== undefined && row.avatar_url !== curConv.avatar_url)
            ))
          )
        );
        const hasNewerConvMessage = Boolean(cId && activeThreadLagsBehindTimestamp(cId, row.last_message_at));
        if (cId && cId === state.activeConvId && curConv && row.block_screenshots !== undefined && row.block_screenshots !== curConv.block_screenshots) {
          curConv.block_screenshots = Boolean(row.block_screenshots);
          syncNativeScreenshotLock(curConv);
          if (state.showThreadInfo) renderThreadInfoDrawer();
        }
        if (cId && sendTailByConv.has(cId) && !metaOrStatusChanged) return;
        if (metaOrStatusChanged && curConv?.id && !isGroupConv(curConv)) {
          profileAppearanceCache.delete(String(curConv.id));
        }
        const markVisibleIncoming = Boolean(hasNewerConvMessage && isThreadActivelyVisible({ ignoreFocus: true }) && document.visibilityState !== 'hidden');
        scheduleRefresh({
          convs: true,
          thread: metaOrStatusChanged || hasNewerConvMessage,
          markRead: markVisibleIncoming,
          forceMarkRead: markVisibleIncoming
        });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversation_participants', filter: `user_id=eq.${profile.id}` }, (payload) => {
        const row = payload?.new || payload?.old || {};
        const cId = row.conversation_id;
        // If current user was removed from active group chat, close the active thread cleanly
        if (payload?.eventType === 'DELETE' && cId && cId === state.activeConvId) {
          clearActiveThreadSelection();
          state.mobileShowThread = false;
          syncMobilePaneState();
        }
        // Skip self-triggered last_read_at / marked_unread echoes immediately after mark_conversation_read.
        if (cId && (Date.now() - (state.recentMarkReadAt.get(cId) || 0) < 2500)) return;
        const curConv = state.activeThread?.conversation;
        const metaChanged = Boolean(
          cId &&
          cId === state.activeConvId &&
          curConv && (
            (row.role && isGroupConv(curConv) && row.role !== curConv.my_role) ||
            (row.chat_theme && (
              row.chat_theme !== curConv.chat_theme ||
              Boolean(row.is_pinned) !== Boolean(curConv.is_pinned) ||
              Boolean(row.is_muted) !== Boolean(curConv.is_muted) ||
              Boolean(row.is_archived) !== Boolean(curConv.is_archived)
            ))
          )
        );
        if (cId && sendTailByConv.has(cId) && !metaChanged) return;
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
    cacheProfileAppearance(profile.id, {
      card_theme: profile.card_theme,
      cover_url: profile.cover_url,
      profile_effect: profile.equipped_profile_effect
    });
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
      if (document.getElementById('msg-workspace-dialog')?.open) {
        refreshConversations().catch(() => { });
      }
      if (document.visibilityState === 'visible' && isThreadActivelyVisible({ ignoreFocus: true })) {
        openConversation(state.activeConvId, { markRead: true, silent: true }).catch(() => { });
      }
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        sendTypingBroadcast(false);
        syncMyThreadPresence();
      } else if (document.visibilityState === 'visible') {
        syncForegroundReceipts();
        syncMyThreadPresence();
      }
    };
    const onWindowBlur = () => {
      isWindowFocused = false;
      sendTypingBroadcast(false);
      syncMyThreadPresence();
    };
    const onWindowFocus = () => {
      isWindowFocused = true;
      if (document.visibilityState === 'visible') {
        syncForegroundReceipts();
      }
      syncMyThreadPresence();
    };
    const onPresenceChange = (ev) => {
      const detail = ev?.detail || {};
      const at = detail.at || new Date().toISOString();
      const leftIds = Array.isArray(detail.leftIds) ? detail.leftIds : [];
      leftIds.forEach((uid) => {
        const idStr = String(uid);
        recordLastSeen(idStr, at);
        state.convoPresencePeers.forEach((peers) => { peers.delete(idStr); });
        const conv = state.conversations.find((c) => !isGroupConv(c) && String(c.peer?.id || '') === idStr);
        if (conv?.peer && conv.peer.last_seen_at) conv.peer.last_seen_at = at;
        if (state.activeThread?.conversation && !isGroupConv(state.activeThread.conversation) && String(state.activeThread.conversation.id || '') === idStr) {
          if (state.activeThread.conversation.last_seen_at) state.activeThread.conversation.last_seen_at = at;
        }
        const friend = (state.overview?.friends || []).find((f) => String(f.id || '') === idStr);
        if (friend && friend.last_seen_at) friend.last_seen_at = at;
        const discoverUser = (state.discoverUsers || []).find((u) => String(u.id || '') === idStr);
        if (discoverUser && discoverUser.last_seen_at) discoverUser.last_seen_at = at;
      });
      syncActiveThreadPresenceUi(state.activeThread?.conversation);
      const activeConv = state.activeThread?.conversation;
      syncNativeScreenshotLock(activeConv);
      if (state.showThreadInfo && activeConv && supportsNativeScreenshotProtection()) {
        const nextEligible = Boolean(activeConv.screenshot_block_eligible) && !hasLiveBrowserParticipant(activeConv);
        const editForm = document.getElementById('msg-group-edit-form');
        if (nextEligible !== activeConv._renderedScreenshotEligible && (!editForm || editForm.hidden)) {
          renderThreadInfoDrawer();
        }
        const nowMs = Date.now();
        if (!activeConv._lastProtectionRefreshAt || nowMs - activeConv._lastProtectionRefreshAt > 4000) {
          activeConv._lastProtectionRefreshAt = nowMs;
          refreshActiveConversationProtection();
        }
      }
      if (leftIds.length) syncThreadPresenceRipple();
      if (state.tab === 'friends' && state.friendsSubTab === 'all' && document.getElementById('msg-workspace-dialog')?.open) {
        renderFriendsView();
      }
      if (state.tab === 'chats' && (state.searchActive || state.chatListQuery.trim()) && document.getElementById('msg-workspace-dialog')?.open) {
        renderConversationList();
      }
    };
    pingLastSeen();
    if (!lastSeenTimer) {
      lastSeenTimer = setInterval(pingLastSeen, 60000);
      document.addEventListener('visibilitychange', onVisibilityChange);
      if (typeof window.addEventListener === 'function') {
        window.addEventListener('focus', onWindowFocus);
        window.addEventListener('blur', onWindowBlur);
        window.addEventListener('ipon:presence-change', onPresenceChange);
        window.addEventListener('ipon:profile-updated', (ev) => {
          const updated = ev?.detail;
          if (!updated || typeof updated !== 'object') return;
          if (initializedProfile && String(updated.id || '') === String(initializedProfile.id || '')) {
            initializedProfile = { ...initializedProfile, ...updated };
          }
          if (state.overview?.me && String(updated.id || '') === String(state.overview.me.id || '')) {
            if ('username' in updated) state.overview.me.username = updated.username;
            if ('bio' in updated) state.overview.me.bio = updated.bio;
          }
          const uid = updated.id || initializedProfile?.id;
          if (uid) {
            const norm = cacheProfileAppearance(uid, {
              card_theme: updated.card_theme,
              cover_url: updated.cover_url,
              profile_effect: updated.equipped_profile_effect || updated.profile_effect,
              ...('social_links' in updated ? { social_links: updated.social_links } : {})
            });
            const openPop = document.getElementById('msg-profile-popover');
            if (openPop && !openPop.hidden && openPop.dataset.targetId === String(uid) && norm && 'social_links' in updated) {
              syncPopoverSocialAppsSlot(openPop, norm.social_links);
            }
            const activeConv = state.activeThread?.conversation;
            if (activeConv && !isGroupConv(activeConv) && String(activeConv.id) === String(uid) && 'social_links' in updated) {
              activeConv.social_links = norm?.social_links || {};
              if (state.drawerOpen) renderThreadInfoDrawer();
              if (!state.activeThread?.messages?.length) renderMessagesList();
            }
          }
        });
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
    const mutualPop = document.getElementById('msg-mutual-popover');
    if (mutualPop && !mutualPop.hidden) {
      closeMutualPopover();
      dismissed = true;
    }
    const pop = document.getElementById('msg-profile-popover');
    if (pop && !pop.hidden) {
      closeProfilePopover();
      dismissed = true;
    }
    const attachMenu = document.getElementById('msg-attach-menu');
    if (attachMenu && !attachMenu.hidden) {
      closeAttachMenu();
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

  function openWebGoogleDriveDialog() {
    if (state.activeThread?.conversation && !canInteractInThread(state.activeThread.conversation)) return;
    const dialog = document.getElementById('msg-gdrive-dialog');
    if (!dialog) {
      document.getElementById('msg-drive-input')?.click();
      return;
    }
    if (typeof dialog.showModal === 'function' && !dialog.open) {
      dialog.showModal();
    } else {
      dialog.open = true;
    }
    document.getElementById('msg-gdrive-open-web')?.focus?.();
  }

  function handleBackNavigation() {
    const gdriveDlg = document.getElementById('msg-gdrive-dialog');
    if (gdriveDlg?.open) {
      gdriveDlg.close();
      return true;
    }
    const groupDlg = document.getElementById('msg-group-dialog');
    if (groupDlg?.open) {
      groupDlg.close();
      return true;
    }
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

  window.addEventListener('ipon:badges-updated', () => {
    try { renderConversationList(); } catch { }
    try { renderFriendsView(); } catch { }
    try { renderActiveThread?.(); } catch { }
  });

  async function openDirectMessage(targetId, { draft = '' } = {}) {
    if (!targetId) return false;
    if (!initializedProfile && ipon().profile) {
      await init(ipon().profile);
    }
    if (!isEligible()) return false;
    await handleSocialAction('message', targetId);
    if (draft) {
      const input = document.getElementById('msg-composer-input');
      if (input && !input.value.trim()) {
        input.value = draft;
        try { autoResizeTextarea(input); } catch { }
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.focus();
      }
    }
    return true;
  }

  async function refreshWorkspace() {
    if (!isEligible()) return false;
    await Promise.all([refreshConversations(), refreshOverview(), refreshSocialNotifications()]);
    if (document.getElementById('msg-workspace-dialog')?.open) {
      syncTabUi();
      syncMobilePaneState();
      if (state.tab === 'friends') renderFriendsView();
      else if (state.tab === 'notifications') renderAlertsView();
      else renderConversationList();
    }
    return true;
  }

  window.IponMessages = {
    init,
    openWorkspace,
    refreshWorkspace,
    openFromNotification,
    openDirectMessage,
    openProfilePopover,
    dismissTransientMenus,
    handleBackNavigation,
    formatBytes,
    detectAttachmentKind
  };
})();
