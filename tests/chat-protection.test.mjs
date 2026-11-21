import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (file) => fs.readFileSync(file, 'utf8');

test('conversation privacy is shared, role guarded, and forwarding is rejected at the database', () => {
  const sql = read('database/migrations/20261121_143_conversation_capture_and_forwarding.sql');
  const schema = read('database/schema.sql');
  for (const source of [sql, schema]) {
    assert.match(source, /block_screenshots boolean not null default false/);
    assert.match(source, /block_forwarding boolean not null default false/);
    assert.match(source, /public\.is_conversation_member\(v_conv\.id, v_uid\)/);
    assert.match(source, /role in \('OWNER', 'ADMIN'\)/);
    assert.match(source, /source\.id = new\.forwarded_from_id and c\.block_forwarding/);
    assert.match(source, /' took a screenshot\.', 'SYSTEM'/);
    assert.match(source, /notify pgrst, 'reload schema'/);
  }
});

test('Android capture callback and secure flag are scoped to the active chat', () => {
  const activity = read('android/app/src/main/java/com/myipon/app/MainActivity.java');
  const manifest = read('android/app/src/main/AndroidManifest.xml');
  const chat = read('js/messages.js');
  assert.match(manifest, /android\.permission\.DETECT_SCREEN_CAPTURE/);
  assert.match(activity, /Build\.VERSION\.SDK_INT >= 34[\s\S]*registerScreenCaptureCallback/);
  assert.match(activity, /unregisterScreenCaptureCallback\(screenCaptureCallback\)/);
  assert.match(activity, /WindowManager\.LayoutParams\.FLAG_SECURE/);
  assert.match(chat, /record_conversation_screenshot/);
  assert.match(chat, /data-chat-protection="screenshots"/);
  assert.match(chat, /data-chat-protection="forwarding"/);
  assert.match(chat, /state\.activeThread\?\.conversation\?\.block_forwarding/);
  assert.match(chat, /error\?\.code === 'PGRST202'[\s\S]*return null/);
  assert.match(chat, /data\.conversation\.protection_unavailable = !protection/);
  assert.match(chat, /!conv\.protection_unavailable && !state\.savingProtection && \(!isGrp \|\| canManageGroup\)/);
  assert.match(chat, /role="switch" data-chat-protection="screenshots" aria-checked=/);
  assert.match(chat, /role="switch" data-chat-protection="forwarding" aria-checked=/);
  assert.match(chat, /data-chat-protection-retry/);
  assert.match(chat, /<div class="msg-privacy-head"><h4 id="msg-privacy-title">Chat privacy<\/h4><\/div>/);
  assert.match(chat, /previousScrollTop[\s\S]*drawer\.dataset\.conversationId = conv\.conversation_id;[\s\S]*\.scrollTop = previousScrollTop/);
  assert.match(chat, /data-chat-protection="\$\{setting\}"\]`\)\?\.focus\(\{ preventScroll: true \}\)/);
  assert.match(chat, /state\.savingProtection = true;[\s\S]*set_conversation_protection[\s\S]*finally \{[\s\S]*state\.savingProtection = false/);
  const css = read('css/app.css');
  assert.match(css, /\.msg-privacy-card \{/);
  assert.match(css, /html\[data-theme="dark"\] \.msg-privacy-card \{/);
  assert.match(css, /\.msg-privacy-switch:focus-visible/);
});

test('migration 146 requires all participants to use the mobile app for Block screenshots and tracks client platform', () => {
  const sql = read('database/migrations/20261121_146_screenshot_protection_app_requirement.sql');
  const schema = read('database/schema.sql');
  for (const source of [sql, schema]) {
    assert.match(source, /last_client_platform text not null default 'browser'/);
    assert.match(source, /check \(last_client_platform in \('browser', 'android_app'\)\)/);
    assert.match(source, /create or replace function public\.conversation_supports_screenshot_block\(/);
    assert.match(source, /create or replace function public\.report_client_platform\(/);
    assert.match(source, /if v_platform = 'browser' then[\s\S]*set block_screenshots = false/);
    assert.match(source, /'screenshot_block_eligible', v_eligible/);
    assert.match(source, /if coalesce\(p_enabled, false\) and not public\.conversation_supports_screenshot_block\(v_conv\.id\) then/);
    assert.match(source, /Block screenshots requires both people in this chat to use the mobile app\./);
    assert.match(source, /Block screenshots requires all members in this chat to use the mobile app\./);
  }
  const core = read('js/core.js');
  assert.match(core, /function supportsNativeScreenshotProtection\(\)/);
  assert.match(core, /function getClientPlatform\(\)/);
  assert.match(core, /function reportClientPlatform\(/);
  assert.match(core, /function hasLiveBrowserSession\(/);
  assert.match(core, /client_platform: getClientPlatform\(\)/);
  assert.match(core, /supportsNativeScreenshotProtection, probeNativeScreenshotProtection, getClientPlatform, reportClientPlatform, refreshPeerClientPlatforms, hasLiveBrowserSession/);
  const nativeSupport = core.match(/function supportsNativeScreenshotProtection\(\)\s*\{[\s\S]*?\n  \}/)?.[0];
  const platform = core.match(/function getClientPlatform\(\)\s*\{[\s\S]*?\n  \}/)?.[0];
  assert.ok(nativeSupport && platform);
  const platformFor = (window) => new Function('window', `let nativeScreenshotProbeOk = false; ${nativeSupport}; ${platform}; return getClientPlatform();`)(window);
  assert.equal(platformFor({}), 'browser');
  assert.equal(platformFor({ Capacitor: { getPlatform: () => 'web', Plugins: { BackgroundNotifications: { setScreenshotBlocked() {} } } } }), 'browser');
  assert.equal(platformFor({ Capacitor: { getPlatform: () => 'android', Plugins: { BackgroundNotifications: { setScreenshotBlocked() {} } } } }), 'android_app');
  assert.equal(platformFor({ IponNativePrivacy: { setScreenshotBlocked() {} } }), 'android_app');
  assert.match(core, /const \{ error \} = await client\.rpc\('report_client_platform'/);
  assert.match(core, /if \(error\) throw error;/);
});

test('Block screenshots appears only when all chat members use the Android app', () => {
  const src = read('js/messages.js').replace(/\r\n/g, '\n');
  const isVoiceMatch = src.match(/function isVoiceAttachment\(att, msg = null\)\s*\{[\s\S]*?\n  \}/);
  const badgeMatch = src.match(/function formatBadgeLabel\(att\)\s*\{[\s\S]*?\n  \}/);
  const drawerMatch = src.match(/function renderThreadInfoDrawer\(\)\s*\{[\s\S]*?\n  \}/);
  const hasLiveMatch = src.match(/function hasLiveBrowserParticipant\(conv\)\s*\{[\s\S]*?\n  \}/);
  const supportsMatch = src.match(/function supportsNativeScreenshotProtection\(\)\s*\{[\s\S]*?\n  \}/);
  assert.ok(isVoiceMatch && badgeMatch && drawerMatch && hasLiveMatch && supportsMatch, 'Expected drawer & screenshot helpers');

  const bodyEl = { scrollTop: 0 };
  const drawerEl = {
    hidden: true,
    dataset: {},
    _html: '',
    get innerHTML() { return this._html; },
    set innerHTML(value) { this._html = value; },
    querySelector(selector) {
      return selector === '.msg-drawer-body.is-root' ? bodyEl : null;
    }
  };
  let mockWin = {};
  let browserPeers = new Set();
  const state = {
    showThreadInfo: true,
    threadInfoView: 'root',
    activeConvId: 'c1',
    savingProtection: false,
    signedUrlCache: new Map(),
    activeThread: {
      conversation: {
        conversation_id: 'c1',
        id: 'u2',
        kind: 'DIRECT',
        status: 'ACCEPTED',
        full_name: 'Friend',
        chat_theme: 'paper',
        block_screenshots: false,
        block_forwarding: false,
        screenshot_block_eligible: false
      },
      messages: []
    }
  };

  const buildRunner = () => new Function(
    'window', 'state', 'document', 'ipon', 'isGroupConv', 'initializedProfile',
    'escapeHtml', 'escAttr', 'formatBytes', 'formatShortDate', 'userAvatarHtml', 'groupAvatarHtml',
    'groupPicPreviewMarkup', 'renderRoleBadges', 'formatVanishDuration', 'isSelfUser', 'CAMERA_ICON_SVG',
    'MSG_CLOSE_X_SVG', 'MSG_PIN_SVG', 'BACK_ARROW_ICON_SVG', 'VIDEO_PLAY_SVG', 'VIDEO_POSTER_FALLBACK', 'IMAGE_EXT_RE',
    `${supportsMatch[0]}; ${hasLiveMatch[0]}; ${isVoiceMatch[0]}; ${badgeMatch[0]}; ${drawerMatch[0]}; return renderThreadInfoDrawer;`
  )(
    mockWin,
    state,
    { getElementById: (id) => (id === 'msg-thread-drawer' ? drawerEl : null) },
    () => ({ hasLiveBrowserSession: (uid) => browserPeers.has(String(uid)) }),
    (c) => c?.kind === 'GROUP',
    { id: 'u1' },
    (s) => String(s ?? ''),
    (s) => String(s ?? ''),
    (b) => `${b} B`,
    () => 'Nov 21',
    () => '<div>avatar</div>',
    () => '<div>group</div>',
    () => '<div>preview</div>',
    () => '',
    (seconds) => (seconds ? `${seconds} seconds` : 'Off'),
    () => false,
    '', '', '', '', '', '', /\.(png|jpe?g|gif|webp)$/i
  );

  // 1. Browser user (no IponNativePrivacy bridge) -> Block screenshots does NOT appear at all
  mockWin = {};
  buildRunner()();
  assert.doesNotMatch(drawerEl.innerHTML, /Block screenshots/);
  assert.doesNotMatch(drawerEl.innerHTML, /data-chat-protection="screenshots"/);
  assert.match(drawerEl.innerHTML, /Block forwarding/);
  assert.match(drawerEl.innerHTML, /data-chat-protection="forwarding"/);

  // 2. Mobile app user + peer on browser -> option is absent for both users
  mockWin = { IponNativePrivacy: { setScreenshotBlocked() {} } };
  state.activeThread.conversation.screenshot_block_eligible = false;
  buildRunner()();
  assert.doesNotMatch(drawerEl.innerHTML, /Block screenshots|data-chat-protection="screenshots"/);
  assert.match(drawerEl.innerHTML, /Screenshot protection needs everyone on Android\.[\s\S]*?data-chat-protection-retry>Check again<\/button>/);

  // 3. A live browser tab hides the option even if the last stored platform is Android
  state.activeThread.conversation.screenshot_block_eligible = true;
  browserPeers = new Set(['u2']);
  buildRunner()();
  assert.doesNotMatch(drawerEl.innerHTML, /Block screenshots|data-chat-protection="screenshots"/);

  // 4. Both users on mobile app (no live browser session) -> switch enabled
  browserPeers = new Set();
  state.activeThread.conversation.screenshot_block_eligible = true;
  buildRunner()();
  assert.match(drawerEl.innerHTML, /Protect this chat on Android devices/);
  assert.match(drawerEl.innerHTML, /data-chat-protection="screenshots" aria-checked="false" aria-labelledby="msg-privacy-shot-title" aria-describedby="msg-privacy-shot-desc"><\/button>/);
  assert.doesNotMatch(drawerEl.innerHTML, /Screenshot protection needs everyone on Android/);

  // 5. A browser member hides group screenshot blocking; notice opt-in remains available
  state.activeThread.conversation = {
    conversation_id: 'g1',
    id: 'g1',
    kind: 'GROUP',
    my_role: 'OWNER',
    status: 'ACCEPTED',
    title: 'Team',
    chat_theme: 'paper',
    block_screenshots: false,
    block_forwarding: false,
    screenshot_block_eligible: false,
    members: [{ user_id: 'u1', full_name: 'Me' }, { user_id: 'u2', full_name: 'Peer' }]
  };
  buildRunner()();
  assert.doesNotMatch(drawerEl.innerHTML, /Block screenshots|data-chat-protection="screenshots"/);
  assert.match(drawerEl.innerHTML, /data-chat-protection="screenshot_notices" aria-checked="false"[^>]*><\/button>/);
  state.activeThread.conversation.screenshot_block_eligible = true;
  buildRunner()();
  assert.match(drawerEl.innerHTML, /data-chat-protection="screenshots" aria-checked="false"[^>]*><\/button>/);
  state.activeThread.conversation.my_role = 'MEMBER';
  buildRunner()();
  assert.match(drawerEl.innerHTML, /data-chat-protection="screenshot_notices" aria-checked="false"[^>]* disabled>/);

  // 6. Android shell without a privacy method never offers a nonfunctional switch.
  mockWin = { Capacitor: { getPlatform: () => 'android', isNativePlatform: () => true, Plugins: {} } };
  state.activeThread.conversation.screenshot_block_eligible = true;
  state.activeThread.conversation.my_role = 'OWNER';
  buildRunner()();
  assert.doesNotMatch(drawerEl.innerHTML, /Block screenshots|data-chat-protection="screenshots"/);
  assert.match(drawerEl.innerHTML, /Screenshot protection is unavailable in this app session\.[\s\S]*?data-chat-protection-retry>Check again<\/button>/);
  mockWin = { navigator: { userAgent: 'myIPONApp/20' } };
  buildRunner()();
  assert.doesNotMatch(drawerEl.innerHTML, /Block screenshots|data-chat-protection="screenshots"/);
  assert.match(drawerEl.innerHTML, /data-chat-protection-retry>Check again<\/button>/);

  // 7. The Capacitor privacy method works when WebView omits the JavaScript interface.
  mockWin.Capacitor = { getPlatform: () => 'android', Plugins: { BackgroundNotifications: { setScreenshotBlocked() {} } } };
  buildRunner()();
  assert.match(drawerEl.innerHTML, /data-chat-protection="screenshots" aria-checked="false" aria-labelledby="msg-privacy-shot-title" aria-describedby="msg-privacy-shot-desc"><\/button>/);
});

test('platform reports retry after a Supabase RPC error response', async () => {
  const core = read('js/core.js').replace(/\r\n/g, '\n');
  const reportSource = core.match(/  function reportClientPlatform\(\{ force = false \} = \{\}\) \{[\s\S]*?\n  \}/)?.[0];
  assert.ok(reportSource);
  let calls = 0;
  const report = new Function(
    'getClientPlatform', 'getClient', 'currentProfile', 'configured',
    `let clientPlatformReportPromise = null; let lastReportedClientPlatform = ''; let lastReportedClientPlatformAt = 0; ${reportSource}; return reportClientPlatform;`
  )(
    () => 'android_app',
    () => ({ rpc: async () => ({ error: ++calls === 1 ? new Error('Temporary failure') : null }) }),
    { id: 'user-1' },
    true
  );
  assert.equal(await report(), null);
  assert.equal(await report(), 'android_app');
  assert.equal(calls, 2, 'a failed platform report must not be cached for a minute');
});

test('Check again requests a fresh platform report from the other connected app', async () => {
  const core = read('js/core.js').replace(/\r\n/g, '\n');
  const requestSource = core.match(/  function refreshPeerClientPlatforms\(userIds\) \{[\s\S]*?\n  \}/)?.[0];
  assert.ok(requestSource);
  assert.match(core, /event: 'platform-check'[\s\S]*?await reportClientPlatform\(\{ force: true \}\)[\s\S]*?event: 'platform-check-response'/);
  const pendingPlatformRefreshes = new Map();
  let sent = null;
  const refresh = new Function('currentProfile', 'presenceChannel', 'pendingPlatformRefreshes', 'setTimeout', 'clearTimeout', `${requestSource}; return refreshPeerClientPlatforms;`)(
    { id: 'u1' },
    { send: async (message) => { sent = message; return 'ok'; } },
    pendingPlatformRefreshes,
    setTimeout, clearTimeout
  );
  const waiting = refresh(['u1', 'u2']);
  assert.equal(sent.event, 'platform-check');
  assert.deepEqual(sent.payload.target_ids, ['u2']);
  const request = pendingPlatformRefreshes.get(sent.payload.request_id);
  request.targets.delete('u2');
  request.finish(true);
  assert.equal(await waiting, true);
  assert.equal(pendingPlatformRefreshes.size, 0);
});

test('Android can verify and use screenshot blocking when the generated plugin proxy is missing', async () => {
  const core = read('js/core.js').replace(/\r\n/g, '\n');
  const chat = read('js/messages.js').replace(/\r\n/g, '\n');
  const supportSource = core.match(/  function supportsNativeScreenshotProtection\(\) \{[\s\S]*?\n  \}/)?.[0];
  const probeSource = core.match(/  function probeNativeScreenshotProtection\(\) \{[\s\S]*?\n  \}/)?.[0];
  const platformSource = core.match(/  function getClientPlatform\(\) \{[\s\S]*?\n  \}/)?.[0];
  const lockSource = chat.match(/  function syncNativeScreenshotLock\(conv = state\.activeThread\?\.conversation\) \{[\s\S]*?\n  \}/)?.[0];
  assert.ok(supportSource && probeSource && platformSource && lockSource);
  const calls = [];
  const window = { Capacitor: {
    getPlatform: () => 'android',
    nativePromise: async (plugin, method, options) => { calls.push({ plugin, method, options }); }
  } };
  const native = new Function('window', `let nativeScreenshotProbeOk = false; let nativeScreenshotProbePromise = null; ${supportSource}; ${probeSource}; ${platformSource}; return { supportsNativeScreenshotProtection, probeNativeScreenshotProtection, getClientPlatform };`)(window);
  assert.equal(native.getClientPlatform(), 'browser');
  assert.equal(await native.probeNativeScreenshotProtection(), true);
  assert.equal(native.getClientPlatform(), 'android_app');
  const lock = new Function('window', 'state', 'document', 'isScreenshotBlockEffective', 'isGroupConv', 'supportsNativeScreenshotProtection', `${lockSource}; return syncNativeScreenshotLock;`)(
    window, { activeConvId: 'c1' }, { getElementById: () => ({ open: true }) },
    () => true, () => false, native.supportsNativeScreenshotProtection
  );
  lock({ block_screenshots: true, conversation_id: 'c1' });
  lock(null);
  assert.deepEqual(calls.filter((call) => call.method === 'setScreenshotBlocked').map((call) => call.options.blocked), [false, true, false]);
});

test('browser presence changes notify the chat even when the same user stays online', () => {
  const core = read('js/core.js').replace(/\r\n/g, '\n');
  const syncSource = core.match(/      const handleSync = \(\) => \{[\s\S]*?\n      \};/)?.[0];
  assert.ok(syncSource);
  const onlineUserIds = new Set(['u1', 'u2']);
  const onlineClientPlatforms = new Map([['u1', new Set(['android_app'])], ['u2', new Set(['android_app'])]]);
  let peerPlatform = 'browser';
  let events = 0;
  const handleSync = new Function(
    'onlineUserIds', 'onlineClientPlatforms', 'presenceChannel', 'presenceShowOnline', 'document', 'profile',
    'syncPresencePlatforms', 'hasLiveBrowserSession', 'syncPresenceDots', 'broadcastLocalPresence', 'emitPresenceChange',
    `${syncSource}; return handleSync;`
  )(
    onlineUserIds, onlineClientPlatforms,
    { presenceState: () => ({ u1: [{ user_id: 'u1' }], u2: [{ user_id: 'u2' }] }) },
    true, { visibilityState: 'visible' }, { id: 'u1' },
    () => { onlineClientPlatforms.set('u2', new Set([peerPlatform])); },
    (uid) => onlineClientPlatforms.get(uid)?.has('browser') || false,
    () => {}, () => {}, () => { events += 1; }
  );
  handleSync();
  assert.equal(events, 1, 'opening the browser must update the Android switch');
  peerPlatform = 'android_app';
  handleSync();
  assert.equal(events, 2, 'returning to the app must update the switch');
});

test('leaving a protected chat clears the Capacitor screenshot lock', () => {
  const src = read('js/messages.js').replace(/\r\n/g, '\n');
  const lockSource = src.match(/  function syncNativeScreenshotLock\(conv = state\.activeThread\?\.conversation\) \{[\s\S]*?\n  \}/)?.[0];
  assert.ok(lockSource);
  assert.match(src, /function clearActiveThreadSelection\(\) \{\s*syncNativeScreenshotLock\(null\)/);
  const blocked = [];
  const lock = new Function('window', 'state', 'document', 'isScreenshotBlockEffective', 'isGroupConv', 'supportsNativeScreenshotProtection', `${lockSource}; return syncNativeScreenshotLock;`)(
    { Capacitor: { Plugins: { BackgroundNotifications: {
      setScreenshotBlocked: ({ blocked: value }) => { blocked.push(value); return Promise.resolve(); },
      setScreenshotMonitoring: () => Promise.resolve()
    } } } },
    { activeConvId: 'c1', activeThread: { conversation: { block_screenshots: true } } },
    { getElementById: () => ({ open: true }) },
    () => true, () => false, () => true
  );
  lock({ block_screenshots: true, conversation_id: 'c1' });
  lock(null);
  assert.deepEqual(blocked, [true, false]);
});

test('group screenshot notices require admin opt-in and keep direct chat notices available', () => {
  const migration = read('database/migrations/20261121_150_group_screenshot_notices.sql');
  const schema = read('database/schema.sql');
  for (const sql of [migration, schema]) {
    assert.match(sql, /screenshot_notices_enabled boolean not null default false/);
    assert.match(sql, /'screenshot_notices_enabled', v_conv\.screenshot_notices_enabled/);
    assert.match(sql, /p_setting = 'screenshot_notices'[\s\S]*v_conv\.kind <> 'GROUP'/);
    assert.match(sql, /v_conv\.kind = 'GROUP' and not v_conv\.screenshot_notices_enabled then\s+return null/);
    assert.match(sql, /coalesce\(nullif\(trim\(v_name\), ''\), 'A member'\) \|\| ' took a screenshot\.'/);
  }
  const activity = read('android/app/src/main/java/com/myipon/app/MainActivity.java');
  const manifest = read('android/app/src/main/AndroidManifest.xml');
  assert.match(activity, /if \(!screenshotMonitoringEnabled \|\| screenshotObserver != null\) return;/);
  assert.match(activity, /screenCaptureCallback = this::dispatchScreenCaptured/);
  assert.match(activity, /lastScreenshotEventAtMs > 0 && now - lastScreenshotEventAtMs < 1500L/);
  assert.match(activity, /SystemClock\.uptimeMillis\(\) - lastWindowFocusAtMs > 15000L/);
  assert.match(activity, /checked < 5 && images\.moveToNext\(\)/);
  assert.match(activity, /registerContentObserver\(MediaStore\.Images\.Media\.EXTERNAL_CONTENT_URI, true, screenshotObserver\)/);
  assert.match(activity, /unregisterContentObserver\(screenshotObserver\)/);
  const plugin = read('android/app/src/main/java/com/myipon/app/BackgroundNotificationsPlugin.java');
  assert.match(plugin, /public void setScreenshotBlocked\(PluginCall call\)/);
  assert.match(plugin, /public void setScreenshotMonitoring\(PluginCall call\)/);
  assert.match(manifest, /android\.permission\.READ_MEDIA_IMAGES/);
  const chat = read('js/messages.js');
  assert.match(chat, /setScreenshotMonitoring\(\{ enabled: monitoring \}\)/);
  assert.match(chat, /isThreadActivelyVisible\(\{ ignoreFocus: true \}\)/);
  assert.match(chat, /activeConv\?\.conversation_id !== state\.activeConvId/);
  assert.match(chat, /isGroupConv\(activeConv\) && !activeConv\.screenshot_notices_enabled/);
  assert.match(chat, /<strong>\$\{escapeHtml\(screenshotName\)\}<\/strong> took a screenshot/);
});

test('native screenshot events survive transient Android focus and visibility changes', () => {
  const source = read('js/messages.js').replace(/\r\n/g, '\n');
  const visibility = source.match(/function isThreadActivelyVisible\(\{ ignoreFocus = false \} = \{\}\)\s*\{[\s\S]*?\n  \}/)?.[0];
  assert.ok(visibility);
  const state = { activeConvId: 'c1', mobileShowThread: true, showThreadInfo: false, searchActive: false, tab: 'chats' };
  const workspace = { open: true };
  const document = {
    visibilityState: 'hidden',
    hasFocus: () => false,
    getElementById: (id) => id === 'msg-workspace-dialog' ? workspace : null,
    querySelector: () => null
  };
  const window = { matchMedia: () => ({ matches: true }), innerWidth: 400 };
  const isVisible = new Function('document', 'window', 'state', 'isWindowFocused', `${visibility}; return isThreadActivelyVisible;`)(document, window, state, false);
  assert.equal(isVisible(), false);
  assert.equal(isVisible({ ignoreFocus: true }), true);
  workspace.open = false;
  assert.equal(isVisible({ ignoreFocus: true }), false);
});

test('screenshot system notices use compact vertical spacing and show "You took a screenshot" for the actor without a trailing period', () => {
  const css = read('css/app.css');
  const chat = read('js/messages.js').replace(/\r\n/g, '\n');

  assert.match(css, /\.msg-system-event\s*\{\s*margin:\s*3px 0;\s*\}/);
  assert.match(css, /\.msg-system-event \+ \.msg-system-event\s*\{\s*margin-top:\s*-4px;\s*\}/);
  assert.match(chat, /const isMySystemActor = screenshotNotice && Boolean\(myId && String\(m\.sender_id \|\| ''\) === String\(myId\)\);/);
  assert.match(chat, /<strong>\$\{escapeHtml\(screenshotName\)\}<\/strong> took a screenshot`/);
  assert.match(chat, /<strong>\$\{escapeHtml\(screenshotName\)\}<\/strong> \$\{screenshotBlockAction\}`/);

  const convRowSrc = chat.match(/function renderConversationRowHtml\(conv\)\s*\{[\s\S]*?\n  \}/)?.[0];
  assert.ok(convRowSrc, 'renderConversationRowHtml must exist');
  const renderConvRow = new Function(
    'state', 'initializedProfile', 'isGroupConv', 'getTypingEntries', 'escapeHtml',
    'convAvatarHtml', 'convDisplayTitle', 'userBadgesHtml', 'formatShortDate', 'formatUnreadCount',
    `${convRowSrc}; return renderConversationRowHtml;`
  )(
    { activeConvId: null },
    { id: 'u-me' },
    () => false,
    () => [],
    (s) => String(s ?? ''),
    () => '<div>av</div>',
    () => 'Frank',
    () => '',
    () => '12:23 PM',
    (n) => String(n)
  );

  const myShotRow = renderConvRow({
    id: 'c1',
    kind: 'DIRECT',
    last_message_type: 'SYSTEM',
    last_message_sender_id: 'u-me',
    last_message_preview: 'Zedrick De Monteverde took a screenshot.',
    last_message_at: '2026-11-21T04:23:00Z',
    unread_count: 0
  });
  assert.match(myShotRow, /You took a screenshot</);
  assert.doesNotMatch(myShotRow, /You took a screenshot\./);
  assert.doesNotMatch(myShotRow, /Zedrick De Monteverde took a screenshot/);

  const myBlockOnRow = renderConvRow({
    id: 'c1',
    kind: 'DIRECT',
    last_message_type: 'SYSTEM',
    last_message_sender_id: 'u-me',
    last_message_preview: 'Zedrick De Monteverde turned on screenshot blocking',
    last_message_at: '2026-11-21T04:24:00Z',
    unread_count: 0
  });
  assert.match(myBlockOnRow, /You turned on screenshot blocking</);

  const peerBlockOnRow = renderConvRow({
    id: 'c1',
    kind: 'DIRECT',
    last_message_type: 'SYSTEM',
    last_message_sender_id: 'u-peer',
    last_message_preview: 'Frank Lawrenze Ulog Talipan turned on screenshot blocking',
    last_message_at: '2026-11-21T04:24:00Z',
    unread_count: 0
  });
  assert.match(peerBlockOnRow, /Frank Lawrenze Ulog Talipan turned on screenshot blocking</);

  const peerShotRow = renderConvRow({
    id: 'c1',
    kind: 'DIRECT',
    last_message_type: 'SYSTEM',
    last_message_sender_id: 'u-peer',
    last_message_preview: 'Frank Lawrenze Ulog Talipan took a screenshot.',
    last_message_at: '2026-11-21T03:30:00Z',
    unread_count: 0
  });
  assert.match(peerShotRow, /Frank Lawrenze Ulog Talipan took a screenshot</);
  assert.doesNotMatch(peerShotRow, /Frank Lawrenze Ulog Talipan took a screenshot\./);
});

test('migration 152 logs screenshot blocking toggles, keeps blocking persistent, and syncs lagging active threads from previews', () => {
  const mig152 = read('database/migrations/20261121_152_screenshot_block_notices_and_persistence.sql');
  const schema = read('database/schema.sql');
  const chat = read('js/messages.js').replace(/\r\n/g, '\n');

  for (const source of [mig152, schema]) {
    assert.match(source, /'screenshot_block_enabled'/);
    assert.match(source, /'screenshot_block_disabled'/);
    assert.match(source, /turned on screenshot blocking/);
    assert.match(source, /turned off screenshot blocking/);
  }
  const reportFn = mig152.match(/create or replace function public\.report_client_platform[\s\S]*?\$\$;/);
  assert.ok(reportFn);
  assert.doesNotMatch(reportFn[0], /set block_screenshots = false/, 'reporting platform must never auto-disable block_screenshots');

  const lagSrc = chat.match(/function activeThreadLagsBehindTimestamp\(convId, incomingIso\)\s*\{[\s\S]*?\n  \}/)?.[0];
  assert.ok(lagSrc, 'activeThreadLagsBehindTimestamp must exist');
  const sendTailByConv = new Map();
  const state = {
    activeConvId: 'c1',
    loadingThread: false,
    activeThread: {
      conversation: { conversation_id: 'c1' },
      messages: [{ id: 'm1', created_at: '2026-11-21T04:00:00Z' }]
    }
  };
  const lags = new Function('state', 'sendTailByConv', `${lagSrc}; return activeThreadLagsBehindTimestamp;`)(state, sendTailByConv);
  assert.equal(lags('c1', '2026-11-21T04:00:00Z'), false);
  assert.equal(lags('c1', '2026-11-21T04:01:00Z'), true, 'newer sidebar preview timestamp must trigger active thread catch-up');
  sendTailByConv.set('c1', Promise.resolve());
  assert.equal(lags('c1', '2026-11-21T04:02:00Z'), false, 'do not interrupt active local send burst');
});
