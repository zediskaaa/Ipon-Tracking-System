import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../js/messages.js', import.meta.url), 'utf8');

test('people directory sorts self first and remaining people alphabetically without presence or last-seen ranking', () => {
  const start = source.indexOf('  function sortPeopleDirectory(');
  const end = source.indexOf('  function formatStatusLine(', start);
  assert.ok(start >= 0 && end > start);
  const { sortPeopleDirectory } = runInNewContext(
    `${source.slice(start, end)} ({ sortPeopleDirectory })`,
    { isSelfUser: (user) => user?.is_self === true }
  );
  const people = [
    { id: 'zoe', full_name: 'Zoe Cruz' },
    { id: 'amy', full_name: 'Amy Santos' },
    { id: 'self', full_name: 'Me', is_self: true },
    { id: 'ben', full_name: 'Ben Reyes' },
  ];
  assert.deepEqual(Array.from(sortPeopleDirectory(people), (person) => person.id),
    ['self', 'amy', 'ben', 'zoe']);
  assert.equal(people[0].id, 'zoe', 'original array must not be mutated');
});

test('people rows omit Online/Last Seen text and presence dots while keeping messaging and blocked status clean', () => {
  const start = source.indexOf('  function renderSearchPersonRowHtml(');
  const end = source.indexOf('  function renderInlineSearchResults(', start);
  assert.ok(start >= 0 && end > start);
  const render = runInNewContext(`${source.slice(start, end)} renderSearchPersonRowHtml`, {
    isSelfUser: (user) => user.is_self === true,
    formatFriendCountText: () => '',
    userAvatarHtml: () => '<span>Avatar</span>',
    userBadgesHtml: () => '',
    formatStatusLine: (user) => (user.is_blocked ? 'Messaging restricted' : ''),
    escapeHtml: (value) => String(value),
  });
  const normalHtml = render({ id: 'normal', full_name: 'Normal User', shared_groups: ['Secret Savings Group'], can_message: true });
  const lockedHtml = render({ id: 'locked', full_name: 'Friends Only User', can_message: false, profile_visible: false });
  const blockedHtml = render({ id: 'blocked', full_name: 'Blocked User', is_blocked: true, can_message: false });
  const selfHtml = render({ id: 'self', full_name: 'Me', is_self: true });

  assert.match(normalHtml, /msg-search-person-sub[^>]*>Tap to message/);
  assert.match(normalHtml, /data-social-action="message"/);
  assert.doesNotMatch(normalHtml, /presence-dot|msg-search-person-presence|Active now|Offline since|Secret Savings Group/);
  assert.doesNotMatch(lockedHtml, /Tap to message|msg-search-person-sub|data-social-action="message"/);
  assert.match(lockedHtml, /class="msg-search-person-main" data-social-user-dp="locked"/);
  assert.match(lockedHtml, /class="msg-row-chip-btn is-icon" data-social-action="add_friend" data-target-id="locked" aria-label="Add friend" title="Add friend"/);
  assert.doesNotMatch(lockedHtml, />Add friend<\/button>/);
  assert.match(blockedHtml, /msg-search-person-sub[^>]*>Messaging restricted/);
  assert.doesNotMatch(selfHtml, /presence-dot|msg-search-person-presence/);
});
