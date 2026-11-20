import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = (file) => fs.readFileSync(file, 'utf8');

test('migration 147 restricts Super Admin announcement reactor identities strictly to breadspanish231@gmail.com', () => {
  const sql = read('database/migrations/20261121_147_restrict_super_admin_announcement_reactors.sql');
  const schema = read('database/schema.sql');
  const css = read('css/app.css');
  const core = read('js/core.js');

  for (const source of [sql, schema]) {
    assert.match(source, /create or replace function public\.can_view_super_admin_announcement_reactors\(/);
    assert.match(source, /'breadspanish231@gmail\.com'/);
    assert.match(source, /create or replace function public\.is_super_admin_announcement\(/);
    assert.match(source, /create or replace function public\.get_announcement_reaction_summaries\(/);
    assert.match(source, /if public\.is_super_admin_announcement\(p_announcement_id\)[\s\S]*and not public\.can_view_super_admin_announcement_reactors\(v_uid\)/);
    assert.match(source, /Only the creator account can view who reacted to this announcement\./);
    assert.match(source, /announcement_reactions_select on public\.announcement_reactions/);
    assert.match(source, /announcement_reactions\.user_id = auth\.uid\(\)[\s\S]*public\.can_view_super_admin_announcement_reactors\(auth\.uid\(\)\)/);
  }

  const sql148 = read('database/migrations/20261121_148_grant_announcement_reactor_helper_for_rls.sql');
  assert.match(sql148, /coalesce\(p_user_id, auth\.uid\(\)\) = auth\.uid\(\)/);
  assert.match(sql148, /grant execute on function public\.can_view_super_admin_announcement_reactors\(uuid\) to authenticated;/);

  assert.match(css, /\.announcement-reactions-pill\.is-readonly\{cursor:default\}/);
  assert.match(css, /html\[data-theme="dark"\] \.announcement-reactions-pill\.is-readonly:hover/);
  assert.match(core, /get_announcement_reaction_summaries/);
  assert.match(core, /if \(!profile\.email && session\?\.user\?\.email\) profile\.email = session\.user\.email;/);
  assert.match(core, /class="announcement-reactions-pill is-readonly"/);
});

test('only breadspanish231@gmail.com can inspect Super Admin announcement reactors while others see counts only', () => {
  const core = read('js/core.js');
  const winStub = {
    IPON_CONFIG: { supabaseUrl: 'https://example.supabase.co', supabaseAnonKey: 'anon' },
    location: { origin: 'https://my-ipon.vercel.app', protocol: 'https:', hostname: 'my-ipon.vercel.app', pathname: '/dashboard.html', search: '', hash: '', href: 'https://my-ipon.vercel.app/dashboard.html' },
    addEventListener: () => { },
    removeEventListener: () => { },
    matchMedia: () => ({ matches: false, addEventListener: () => { } })
  };
  winStub.window = winStub;
  vm.runInNewContext(core, {
    window: winStub,
    document: {
      documentElement: { dataset: {}, style: { setProperty: () => { } } },
      body: { dataset: {}, appendChild: () => { }, insertAdjacentHTML: () => { }, classList: { contains: () => false, add: () => { }, remove: () => { }, toggle: () => { } } },
      head: { appendChild: () => { }, insertAdjacentHTML: () => { } },
      createElement: () => ({ id: '', className: '', hidden: false, style: {}, dataset: {}, setAttribute: () => { }, appendChild: () => { }, addEventListener: () => { }, classList: { add: () => { }, remove: () => { }, toggle: () => { }, contains: () => false } }),
      getElementById: () => null,
      querySelector: () => null,
      querySelectorAll: () => [],
      addEventListener: () => { },
      visibilityState: 'visible'
    },
    location: winStub.location,
    navigator: { userAgent: 'Mozilla/5.0' },
    localStorage: { getItem: () => null, setItem: () => { }, removeItem: () => { } },
    sessionStorage: { getItem: () => null, setItem: () => { }, removeItem: () => { } },
    URL,
    URLSearchParams,
    Map,
    Set,
    CustomEvent: class CustomEvent { constructor(t, o) { this.type = t; this.detail = o?.detail; } },
    setTimeout,
    clearTimeout,
    setInterval: () => 0,
    clearInterval: () => { }
  });

  const canView = winStub.Ipon.canViewAnnouncementReactors;
  assert.equal(typeof canView, 'function');

  const releaseAnn = { id: 'a1', group_id: null, author_role: 'SUPER_ADMIN', announcement_type: 'RELEASE' };
  const generalPlatformAnn = { id: 'a2', group_id: null, author_role: 'SUPER_ADMIN', announcement_type: 'GENERAL' };
  const groupAnn = { id: 'a3', group_id: 'grp-1', author_role: 'ADMIN', announcement_type: 'GENERAL' };

  const creatorProfile = { id: 'u-creator', email: 'breadspanish231@gmail.com', role: 'ADMIN' };
  const creatorMixedCase = { id: 'u-creator', email: '  BreadSpanish231@Gmail.com ', role: 'ADMIN' };
  const superAdminProfile = { id: 'u-sa', email: 'zediskaaa@gmail.com', role: 'SUPER_ADMIN' };
  const memberProfile = { id: 'u-mem', email: 'member@example.com', role: 'MEMBER' };
  const otherAdminProfile = { id: 'u-adm', email: 'admin@example.com', role: 'ADMIN' };

  assert.equal(canView(releaseAnn, creatorProfile), true);
  assert.equal(canView(releaseAnn, creatorMixedCase), true);
  assert.equal(canView(generalPlatformAnn, creatorProfile), true);

  assert.equal(canView(releaseAnn, superAdminProfile), false);
  assert.equal(canView(releaseAnn, memberProfile), false);
  assert.equal(canView(releaseAnn, otherAdminProfile), false);
  assert.equal(canView(generalPlatformAnn, memberProfile), false);

  // Group announcements still allow group members to see who in their group reacted
  assert.equal(canView(groupAnn, memberProfile), true);
  assert.equal(canView(groupAnn, otherAdminProfile), true);
  assert.equal(canView(groupAnn, creatorProfile), true);
});
