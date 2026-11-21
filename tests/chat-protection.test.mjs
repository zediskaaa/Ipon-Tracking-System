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
  assert.match(core, /supportsNativeScreenshotProtection, getClientPlatform, reportClientPlatform, hasLiveBrowserSession/);
  const nativeSupport = core.match(/function supportsNativeScreenshotProtection\(\)\s*\{[\s\S]*?\n  \}/)?.[0];
  const platform = core.match(/function getClientPlatform\(\)\s*\{[\s\S]*?\n  \}/)?.[0];
  assert.ok(nativeSupport && platform);
  const platformFor = (window) => new Function('window', `${nativeSupport}; ${platform}; return getClientPlatform();`)(window);
  assert.equal(platformFor({}), 'browser');
  assert.equal(platformFor({ Capacitor: { Plugins: { BackgroundNotifications: { setScreenshotBlocked() {} } } } }), 'browser');
  assert.equal(platformFor({ Capacitor: { PluginHeaders: [{ name: 'BackgroundNotifications', methods: [{ name: 'setScreenshotBlocked' }] }] } }), 'android_app');
});

test('Block screenshots is hidden in browsers and disabled in the mobile app when the peer uses a browser', () => {
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

  // 2. Mobile app user + peer on browser -> shown but disabled with clear explanation
  mockWin = { IponNativePrivacy: { setScreenshotBlocked() {} } };
  state.activeThread.conversation.screenshot_block_eligible = false;
  buildRunner()();
  assert.match(drawerEl.innerHTML, /Block screenshots/);
  assert.match(drawerEl.innerHTML, /Requires both people to use the mobile app/);
  assert.match(drawerEl.innerHTML, /data-chat-protection-retry>Check again<\/button>/);
  assert.match(drawerEl.innerHTML, /data-chat-protection="screenshots" aria-checked="false"[^>]* disabled>/);

  // 3. Mobile app user + peer has active browser tab in live presence -> still disabled even if DB says eligible
  state.activeThread.conversation.screenshot_block_eligible = true;
  browserPeers = new Set(['u2']);
  buildRunner()();
  assert.match(drawerEl.innerHTML, /Requires both people to use the mobile app/);
  assert.match(drawerEl.innerHTML, /data-chat-protection="screenshots" aria-checked="false"[^>]* disabled>/);

  // 4. Both users on mobile app (no live browser session) -> switch enabled
  browserPeers = new Set();
  state.activeThread.conversation.screenshot_block_eligible = true;
  buildRunner()();
  assert.match(drawerEl.innerHTML, /Protect this chat on Android devices/);
  assert.match(drawerEl.innerHTML, /data-chat-protection="screenshots" aria-checked="false" aria-labelledby="msg-privacy-shot-title" aria-describedby="msg-privacy-shot-desc"><\/button>/);

  // 5. Group chat on mobile app with a browser member -> group-specific copy & disabled switch
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
  assert.match(drawerEl.innerHTML, /Requires all members to use the mobile app/);
  assert.match(drawerEl.innerHTML, /data-chat-protection="screenshots" aria-checked="false"[^>]* disabled>/);
  assert.match(drawerEl.innerHTML, /data-chat-protection="screenshot_notices" aria-checked="false"[^>]*><\/button>/);
  state.activeThread.conversation.my_role = 'MEMBER';
  buildRunner()();
  assert.match(drawerEl.innerHTML, /data-chat-protection="screenshot_notices" aria-checked="false"[^>]* disabled>/);

  // 6. Android shell with an outdated privacy bridge explains why the switch is unavailable.
  mockWin = { Capacitor: { isNativePlatform: () => true, Plugins: {} } };
  state.activeThread.conversation.screenshot_block_eligible = true;
  state.activeThread.conversation.my_role = 'OWNER';
  buildRunner()();
  assert.match(drawerEl.innerHTML, /Update the Android app to enable screenshot blocking/);
  assert.match(drawerEl.innerHTML, /data-chat-protection="screenshots" aria-checked="false"[^>]* disabled>/);
  mockWin = { navigator: { userAgent: 'myIPONApp/20' } };
  buildRunner()();
  assert.match(drawerEl.innerHTML, /Update the Android app to enable screenshot blocking/);

  // 7. The Capacitor privacy method works when WebView omits the JavaScript interface.
  mockWin.Capacitor = { PluginHeaders: [{ name: 'BackgroundNotifications', methods: [{ name: 'setScreenshotBlocked' }] }], Plugins: { BackgroundNotifications: { setScreenshotBlocked() {} } } };
  buildRunner()();
  assert.match(drawerEl.innerHTML, /data-chat-protection="screenshots" aria-checked="false" aria-labelledby="msg-privacy-shot-title" aria-describedby="msg-privacy-shot-desc"><\/button>/);
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
  assert.match(activity, /Build\.VERSION\.SDK_INT >= 34 \|\| !screenshotMonitoringEnabled/);
  assert.match(activity, /registerContentObserver\(MediaStore\.Images\.Media\.EXTERNAL_CONTENT_URI, true, screenshotObserver\)/);
  assert.match(activity, /unregisterContentObserver\(screenshotObserver\)/);
  const plugin = read('android/app/src/main/java/com/myipon/app/BackgroundNotificationsPlugin.java');
  assert.match(plugin, /public void setScreenshotBlocked\(PluginCall call\)/);
  assert.match(plugin, /public void setScreenshotMonitoring\(PluginCall call\)/);
  assert.match(manifest, /android\.permission\.READ_MEDIA_IMAGES/);
  const chat = read('js/messages.js');
  assert.match(chat, /setScreenshotMonitoring\?\.\(\{ enabled: monitoring \}\)/);
  assert.match(chat, /isThreadActivelyVisible\(\{ ignoreFocus: true \}\)/);
  assert.match(chat, /activeConv\?\.conversation_id !== state\.activeConvId/);
  assert.match(chat, /isGroupConv\(activeConv\) && !activeConv\.screenshot_notices_enabled/);
  assert.match(chat, /<strong>\$\{escapeHtml\(screenshotName\)\}<\/strong> took a screenshot/);
});
