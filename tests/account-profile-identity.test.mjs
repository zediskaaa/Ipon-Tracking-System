import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = process.cwd();
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

test('My Account profile form validates username availability and bio live for all roles including Super Admin', async () => {
  const coreJs = read('js/core.js');
  const noop = () => {};
  const els = new Map();
  const makeEl = (tag = 'div', props = {}) => {
    const attrs = new Map();
    const classes = new Set();
    const listeners = new Map();
    const el = {
      tagName: String(tag).toUpperCase(),
      type: props.type || '',
      name: props.name || '',
      id: props.id || '',
      value: props.value || '',
      textContent: props.textContent || '',
      innerHTML: '',
      title: '',
      hidden: Boolean(props.hidden),
      disabled: Boolean(props.disabled),
      required: Boolean(props.required),
      readOnly: Boolean(props.readOnly),
      dataset: {},
      style: { setProperty: noop, removeProperty: noop },
      classList: {
        add: (...c) => c.forEach((x) => classes.add(x)),
        remove: (...c) => c.forEach((x) => classes.delete(x)),
        toggle: (c, f) => (f === undefined ? (classes.has(c) ? classes.delete(c) : classes.add(c)) : (f ? classes.add(c) : classes.delete(c))),
        contains: (c) => classes.has(c)
      },
      setAttribute: (k, v) => attrs.set(k, String(v)),
      getAttribute: (k) => attrs.get(k) ?? null,
      removeAttribute: (k) => attrs.delete(k),
      toggleAttribute: (k, force) => {
        if (force === undefined) { if (attrs.has(k)) attrs.delete(k); else attrs.set(k, ''); }
        else if (force) attrs.set(k, '');
        else attrs.delete(k);
      },
      hasAttribute: (k) => attrs.has(k),
      setCustomValidity(m) { this._validity = String(m || ''); },
      checkValidity() { return !this._validity; },
      focus: noop,
      select: noop,
      showModal() { this.open = true; },
      close() { this.open = false; },
      matches: () => false,
      closest: () => null,
      querySelector: () => null,
      querySelectorAll: () => [],
      insertAdjacentElement(_pos, node) { return node; },
      addEventListener(ev, fn) {
        if (!listeners.has(ev)) listeners.set(ev, []);
        listeners.get(ev).push(fn);
      },
      removeEventListener: noop,
      async _emit(ev, evObj = {}) {
        const event = { target: el, preventDefault: noop, submitter: saveBtn, ...evObj };
        for (const fn of (listeners.get(ev) || [])) await fn(event);
      }
    };
    el.elements = new Proxy([], {
      get(target, prop) {
        if (prop in target) return target[prop];
        if (typeof prop === 'string' && !Number.isInteger(Number(prop))) {
          target[prop] = makeEl('input');
          target.push(target[prop]);
          return target[prop];
        }
        return target[prop];
      }
    });
    if (props.id) els.set(props.id, el);
    return el;
  };
  const getEl = (id) => {
    if (!els.has(id)) makeEl(id.includes('dialog') ? 'dialog' : 'div', { id });
    return els.get(id);
  };

  const firstName = makeEl('input', { id: 'quick-first-name', name: 'first_name', value: 'Zedrick' });
  const middleName = makeEl('input', { id: 'quick-middle-name', name: 'middle_name', value: '' });
  const lastName = makeEl('input', { id: 'quick-last-name', name: 'last_name', value: '' });
  const usernameInput = makeEl('input', { id: 'quick-username', name: 'username', value: '' });
  const usernameHelp = makeEl('small', { id: 'quick-username-help', textContent: '3–24 lowercase letters, numbers, or underscores.' });
  const usernameError = makeEl('small', { id: 'quick-username-error', hidden: true });
  const bioInput = makeEl('textarea', { id: 'quick-bio', name: 'bio', value: '' });
  const bioCounter = makeEl('small', { id: 'quick-bio-count', textContent: '0 / 58 characters' });
  const bioError = makeEl('small', { id: 'quick-bio-error', hidden: true });
  const contactInput = makeEl('input', { id: 'quick-contact', name: 'contact_number', value: '09171234567' });
  const saveBtn = makeEl('button', { id: 'quick-profile-save', type: 'submit', textContent: 'Save changes' });

  const attachErrorEl = (input, errEl) => {
    errEl.classList.add('field-error');
    input.closest = (sel) => (String(sel || '').includes('.field')
      ? { querySelector: (q) => (q === '.field-error' ? errEl : (String(q || '').includes('label') ? makeEl('label') : null)), appendChild: (n) => n, append: noop }
      : null);
  };
  attachErrorEl(usernameInput, usernameError);
  attachErrorEl(bioInput, bioError);

  const profileForm = makeEl('form', { id: 'quick-profile-form' });
  profileForm.elements = Object.assign(
    [firstName, middleName, lastName, usernameInput, bioInput, contactInput],
    { first_name: firstName, middle_name: middleName, last_name: lastName, username: usernameInput, bio: bioInput, contact_number: contactInput }
  );
  profileForm.querySelector = (sel) => (sel === '[type="submit"]' ? saveBtn : null);
  profileForm.querySelectorAll = (sel) => (sel.includes('first_name') ? [firstName, middleName, lastName] : []);

  const appLoader = makeEl('div', { id: 'app-loader' });
  const superAdmin = {
    id: '99999999-9999-4999-8999-999999999999',
    role: 'SUPER_ADMIN',
    status: 'ACTIVE',
    first_name: 'Zedrick',
    middle_name: null,
    last_name: null,
    full_name: 'Zedrick',
    contact_number: '09171234567',
    username: null,
    bio: null,
    email: 'owner@myipon.example',
    notifications_enabled: true,
    social_links: {}
  };
  const rpcCalls = [];
  const toasts = [];
  let rejectTakenNext = true;

  const clientMock = {
    rpc: async (name, args) => {
      rpcCalls.push({ name, args });
      if (name === 'check_username_available') {
        return { data: String(args?.p_username || '').toLowerCase() !== 'taken_handle', error: null };
      }
      if (name === 'update_own_social_identity') {
        if (args?.p_username === 'taken_handle' && rejectTakenNext) {
          return { data: null, error: { code: '23505', message: 'That username is already taken.' } };
        }
        superAdmin.username = args?.p_username ?? null;
        superAdmin.bio = args?.p_bio ?? null;
        return { data: { username: superAdmin.username, bio: superAdmin.bio }, error: null };
      }
      if (name === 'update_own_profile') {
        return { data: null, error: null };
      }
      if (name === 'get_profile_card_appearance') {
        return { data: { card_theme: 'emerald', cover_url: null, profile_effect: 'none' }, error: null };
      }
      return { data: null, error: null };
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({ data: { ...superAdmin }, error: null })
        })
      })
    }),
    storage: null,
    channel: () => ({ on() { return this; }, subscribe: () => ({}) }),
    getChannels: () => [],
    removeChannel: noop
  };

  const ctx = {
    window: null,
    FormData: class {
      constructor(form) { this._form = form; }
      get(k) { return this._form?.elements?.[k]?.value ?? ''; }
    },
    CustomEvent: class CustomEvent { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } },
    Event: class Event { constructor(type) { this.type = type; } },
    document: {
      hidden: false,
      getElementById: (id) => (id === 'app-loader' ? appLoader : getEl(id)),
      querySelector: () => null,
      querySelectorAll: () => [],
      createElement: (t) => makeEl(t),
      addEventListener: noop,
      removeEventListener: noop,
      body: Object.assign(makeEl('body'), { dataset: {} }),
      documentElement: makeEl('html')
    },
    location: { href: 'http://localhost/super-admin.html', pathname: '/super-admin.html', origin: 'http://localhost', search: '', replace: noop },
    localStorage: { getItem: () => null, setItem: noop, removeItem: noop },
    sessionStorage: { getItem: () => null, setItem: noop, removeItem: noop },
    navigator: {},
    supabase: { createClient: () => clientMock },
    matchMedia: () => ({ matches: false, addEventListener: noop, removeEventListener: noop }),
    requestAnimationFrame: noop,
    cancelAnimationFrame: noop,
    dispatchEvent: noop,
    addEventListener: noop,
    removeEventListener: noop,
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    URL, URLSearchParams, Map, Set, Object, Array, String, Number, Boolean, Math, Date, JSON, Promise, RegExp, Error,
    setTimeout, clearTimeout, console
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  ctx.window.IPON_CONFIG = { supabaseUrl: 'https://woslmwokhhyszkgevnli.supabase.co', supabaseAnonKey: 'test' };

  const patchedCore = coreJs.replace(
    '  window.Ipon = {',
    `  window.__testMountAccount = async (profile) => {
    currentProfile = profile;
    ensureClient();
    bindAccountDialog();
    await loadAccountDialog();
  };
  window.__testToasts = [];
  window.Ipon = {`
  ).replace(
    '  function toast(message, tone = \'success\') {',
    '  function toast(message, tone = \'success\') { toastsPush(message, tone);'
  );
  ctx.toastsPush = (m, t) => toasts.push({ m, t });

  vm.runInNewContext(patchedCore, ctx, { filename: 'js/core.js', timeout: 5000 });
  await ctx.window.__testMountAccount({ ...superAdmin });

  assert.equal(saveBtn.disabled, true, 'Profile Save button starts disabled until a field changes');

  usernameInput.value = 'ab';
  await usernameInput._emit('input');
  await profileForm._emit('input');
  assert.equal(usernameError.hidden, false);
  assert.match(usernameError.textContent, /3–24 lowercase/);
  assert.equal(usernameHelp.hidden, true);
  assert.equal(saveBtn.disabled, true);

  usernameInput.value = 'taken_handle';
  await usernameInput._emit('input');
  await profileForm._emit('input');
  await profileForm._emit('submit');
  assert.equal(usernameError.hidden, false);
  assert.equal(usernameError.textContent, 'That username is already taken.');
  assert.equal(saveBtn.disabled, true);

  bioInput.value = 'A'.repeat(59);
  await bioInput._emit('input');
  await profileForm._emit('input');
  assert.equal(bioCounter.textContent, '59 / 58 characters');
  assert.equal(bioError.hidden, false);
  assert.match(bioError.textContent, /58 characters/);
  assert.equal(saveBtn.disabled, true);

  usernameInput.value = 'zedrick_owner';
  await usernameInput._emit('input');
  bioInput.value = 'Building My Ipon Group';
  await bioInput._emit('input');
  await profileForm._emit('input');
  assert.equal(bioCounter.textContent, '22 / 58 characters');
  assert.equal(saveBtn.disabled, false);

  await profileForm._emit('submit');
  const socialSave = rpcCalls.find((c) => c.name === 'update_own_social_identity' && c.args.p_username === 'zedrick_owner');
  assert.ok(socialSave, 'Expected update_own_social_identity RPC call');
  assert.equal(socialSave.args.p_bio, 'Building My Ipon Group');
  assert.equal(ctx.window.Ipon.profile.username, 'zedrick_owner');
  assert.equal(ctx.window.Ipon.profile.bio, 'Building My Ipon Group');
  assert.ok(toasts.some((x) => x.m === 'Profile updated.'));
});
