import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../js/messages.js', import.meta.url), 'utf8');

test('people directory ranks online users first, then latest visible offline activity', () => {
  const start = source.indexOf('  function personIsOnline(');
  const end = source.indexOf('  function formatStatusLine(', start);
  assert.ok(start >= 0 && end > start);
  const online = new Set(['online-z', 'online-a']);
  const liveLastSeenMap = new Map([['recent', '2026-11-20T12:00:00Z']]);
  const { sortPeopleByPresence, visibleLastSeenAt } = runInNewContext(
    `${source.slice(start, end)} ({ sortPeopleByPresence, visibleLastSeenAt })`,
    { isSelfUser: (user) => user?.is_self === true, ipon: () => ({ isUserOnline: (id) => online.has(id) }), liveLastSeenMap }
  );
  const people = [
    { id: 'unknown', full_name: 'Unknown' },
    { id: 'old', full_name: 'Old', last_seen_at: '2026-11-17T10:00:00Z' },
    { id: 'online-z', full_name: 'Zoe' },
    { id: 'recent', full_name: 'Recent', last_seen_at: '2026-11-19T10:00:00Z' },
    { id: 'private', full_name: 'Private', allow_online_status: false, last_seen_at: '2026-11-21T10:00:00Z' },
    { id: 'online-a', full_name: 'Amy' },
    { id: 'self', full_name: 'Me', is_self: true },
  ];
  assert.deepEqual(Array.from(sortPeopleByPresence(people), (person) => person.id),
    ['self', 'online-a', 'online-z', 'recent', 'old', 'private', 'unknown']);
  assert.equal(people[0].id, 'unknown');
  assert.equal(visibleLastSeenAt(people[3]), '2026-11-20T12:00:00Z');
  assert.equal(visibleLastSeenAt(people[4]), '');
});

test('people rows show last online on a separate line without exposing self activity and omit online dot when offline', () => {
  const start = source.indexOf('  function renderSearchPersonRowHtml(');
  const end = source.indexOf('  function renderInlineSearchResults(', start);
  assert.ok(start >= 0 && end > start);
  const avatarOpts = new Map();
  const render = runInNewContext(`${source.slice(start, end)} renderSearchPersonRowHtml`, {
    isSelfUser: (user) => user.is_self === true,
    formatFriendCountText: () => '',
    userAvatarHtml: (user, _size, opts = {}) => {
      avatarOpts.set(user.id, opts);
      return opts.showPresence === false ? '<span>Avatar</span>' : '<span>Avatar<i class="presence-dot is-online"></i></span>';
    },
    userBadgesHtml: () => '',
    personIsOnline: (user) => user.id === 'online',
    formatStatusLine: (user) => user.id === 'online' ? 'Active now' : 'Offline since 10:30 AM',
    escapeHtml: (value) => String(value),
  });
  const offlineHtml = render({ id: 'offline', full_name: 'Offline user', shared_groups: ['Secret Savings Group'] });
  const onlineHtml = render({ id: 'online', full_name: 'Online user', shared_groups: ['Ipon namin ni pretty'] });
  const selfHtml = render({ id: 'self', full_name: 'Me', is_self: true });
  assert.match(offlineHtml, /msg-search-person-presence[^>]*>Offline since 10:30 AM/);
  assert.doesNotMatch(offlineHtml, /presence-dot|Secret Savings Group/);
  assert.equal(avatarOpts.get('offline')?.showPresence, false);
  assert.doesNotMatch(onlineHtml, /msg-search-person-presence|Active now|Ipon namin ni pretty/);
  assert.equal(avatarOpts.get('online')?.showPresence, true);
  assert.doesNotMatch(selfHtml, /msg-search-person-presence/);
  assert.equal(avatarOpts.get('self')?.showPresence, true);
  assert.match(source, /state\.tab === 'chats' && \(state\.searchActive \|\| state\.chatListQuery\.trim\(\)\)[\s\S]*?renderConversationList\(\)/);
});
