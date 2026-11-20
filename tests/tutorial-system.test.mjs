import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = process.cwd();
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

const APP_PAGES = [
  'dashboard.html', 'account.html', 'audit.html', 'budget.html',
  'contributions.html', 'expenses.html', 'members.html', 'reports.html',
  'requests.html', 'savings.html', 'settings.html', 'user.html', 'withdrawals.html'
];

function createTutorialVm({ pageFile = 'dashboard.html', pageName = 'dashboard', workspaceMode = 'GROUP', role = 'ADMIN' } = {}) {
  const storage = new Map([
    ['ipon_workspace_mode', workspaceMode],
    ['ipon_active_role', role],
    ['ipon_active_user_id', 'user-test-1']
  ]);
  const session = new Map();
  const docListeners = new Map();
  const winListeners = new Map();

  function makeEl(tag = 'div', attrs = {}) {
    const el = {
      tagName: tag.toUpperCase(),
      id: attrs.id || '',
      className: attrs.className || '',
      dataset: { ...(attrs.dataset || {}) },
      attributes: {},
      style: {},
      hidden: false,
      open: false,
      value: '',
      scrollTop: 0,
      textContent: '',
      _innerHTML: '',
      children: [],
      listeners: new Map(),
      get innerHTML() { return this._innerHTML; },
      set innerHTML(val) { this._innerHTML = String(val); },
      setAttribute(k, v) {
        this.attributes[k] = String(v);
        if (k === 'id') this.id = String(v);
        if (k === 'open') this.open = true;
      },
      getAttribute(k) { return this.attributes[k] ?? null; },
      addEventListener(type, fn) {
        if (!this.listeners.has(type)) this.listeners.set(type, []);
        this.listeners.get(type).push(fn);
      },
      dispatch(type, event = {}) {
        const list = this.listeners.get(type) || [];
        list.forEach((fn) => fn(event));
      },
      appendChild(child) {
        this.children.push(child);
        return child;
      },
      remove() {
        const idx = body.children.indexOf(this);
        if (idx >= 0) body.children.splice(idx, 1);
      },
      contains(node) {
        return node === this || this.children.includes(node);
      },
      showModal() { this.open = true; },
      close() { this.open = false; },
      focus() { },
      scrollIntoView() { },
      getBoundingClientRect() {
        return { top: 120, left: 80, width: 220, height: 48 };
      },
      querySelector(sel) {
        if (sel === '#ipon-tutorial-body') return tutorialBody;
        if (sel === '#ipon-tutorial-progress-text') return progressText;
        if (sel === '#ipon-tutorial-progress-bar') return progressBar;
        if (sel === '#ipon-tutorial-search') return searchInput;
        if (sel.startsWith('#ipon-tut-step-card-')) return makeEl('article');
        return null;
      },
      closest() { return null; }
    };
    return el;
  }

  const tutorialBody = makeEl('div', { id: 'ipon-tutorial-body' });
  const progressText = makeEl('span', { id: 'ipon-tutorial-progress-text' });
  const progressBar = makeEl('i', { id: 'ipon-tutorial-progress-bar' });
  const searchInput = makeEl('input', { id: 'ipon-tutorial-search' });
  const sampleTarget = makeEl('button', { id: 'dashboard-record-entry' });

  const body = makeEl('body', { dataset: { page: pageName } });
  const toasts = [];
  const navigations = [];

  const doc = {
    readyState: 'complete',
    documentElement: { dataset: { workspaceMode } },
    body,
    createElement(tag) { return makeEl(tag); },
    getElementById(id) {
      if (id === 'dashboard-record-entry') return sampleTarget;
      return null;
    },
    querySelectorAll(sel) {
      if (sel === 'dialog[open]') return body.children.filter((c) => c.tagName === 'DIALOG' && c.open);
      if (sel === '#dashboard-record-entry' || sel === '.summary-hero' || sel === '#record-form') return [sampleTarget];
      return [];
    },
    addEventListener(type, fn) {
      if (!docListeners.has(type)) docListeners.set(type, []);
      docListeners.get(type).push(fn);
    },
    removeEventListener(type, fn) {
      const list = docListeners.get(type) || [];
      const idx = list.indexOf(fn);
      if (idx >= 0) list.splice(idx, 1);
    }
  };

  const win = {
    innerWidth: 1280,
    innerHeight: 800,
    document: doc,
    location: {
      pathname: `/${pageFile}`,
      get href() { return `https://my-ipon.vercel.app/${pageFile}`; },
      set href(next) { navigations.push(String(next)); }
    },
    localStorage: {
      getItem: (k) => (storage.has(k) ? storage.get(k) : null),
      setItem: (k, v) => storage.set(k, String(v)),
      removeItem: (k) => storage.delete(k)
    },
    sessionStorage: {
      getItem: (k) => (session.has(k) ? session.get(k) : null),
      setItem: (k, v) => session.set(k, String(v)),
      removeItem: (k) => session.delete(k)
    },
    Ipon: {
      getCurrentUserId: () => 'user-test-1',
      toast: (msg) => toasts.push(msg)
    },
    getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }),
    addEventListener(type, fn) {
      if (!winListeners.has(type)) winListeners.set(type, []);
      winListeners.get(type).push(fn);
    },
    removeEventListener(type, fn) {
      const list = winListeners.get(type) || [];
      const idx = list.indexOf(fn);
      if (idx >= 0) list.splice(idx, 1);
    },
    setTimeout: (fn) => { fn(); return 1; },
    clearTimeout: () => { }
  };

  const sandbox = {
    window: win,
    document: doc,
    location: win.location,
    localStorage: win.localStorage,
    sessionStorage: win.sessionStorage,
    setTimeout: win.setTimeout,
    clearTimeout: win.clearTimeout,
    console
  };
  vm.createContext(sandbox);
  vm.runInContext(read('js/tutorial.js'), sandbox, { filename: 'js/tutorial.js' });

  return { win, doc, body, tutorialBody, progressText, progressBar, toasts, navigations, storage, session };
}

test('all authenticated pages load tutorial stylesheet/script and expose entry buttons cleanly', () => {
  for (const page of APP_PAGES) {
    const html = read(page);
    assert.match(html, /css\/tutorial\.css\?v=/, `${page} must load css/tutorial.css`);
    assert.match(html, /js\/tutorial\.js\?v=/, `${page} must load js/tutorial.js`);
  }

  const dashHtml = read('dashboard.html');
  assert.doesNotMatch(dashHtml, /id="dashboard-tutorial-btn"/, 'Dashboard group bar must not show a redundant Tutorial button');
  assert.match(dashHtml, /id="no-group-tutorial-btn"[^>]*data-tutorial-open/);
  assert.doesNotMatch(dashHtml, /class="sidebar-tutorial-btn"/, 'Top/sidebar navbar must not crowd the myIPON brand with a tutorial button');

  const accountHtml = read('account.html');
  assert.match(accountHtml, /Interactive tutorial &amp; user guide[\s\S]*?data-tutorial-open/);

  const coreJs = read('js/core.js');
  assert.doesNotMatch(coreJs, /class="sidebar-tutorial-btn"/, 'mountShell must keep Tutorial inside My Account instead of the mobile top navbar');
  assert.match(coreJs, /account-tutorial-row[\s\S]*?account-tutorial-btn[\s\S]*?data-tutorial-open/);
  assert.match(coreJs, /openTutorial:\s*\(\.\.\.args\) => window\.IponTutorial\?\.open\?\.\(\.\.\.args\)/);

  const swJs = read('sw.js');
  assert.match(swJs, /'css\/tutorial\.css'/);
  assert.match(swJs, /'js\/tutorial\.js'/);
});

test('every tutorial targets real existing pages and real DOM IDs in the system', () => {
  const { win } = createTutorialVm();
  const tutorials = win.IponTutorial.getTutorials();
  const categories = win.IponTutorial.getCategories();

  assert.ok(tutorials.length >= 16, 'Expected a comprehensive tutorial library covering all major features');
  assert.equal(categories.length, 6, 'Expected 6 organized tutorial categories');

  const pageCache = new Map();
  const getPageHtml = (file) => {
    if (!pageCache.has(file)) {
      const fullPath = path.join(root, file);
      assert.ok(fs.existsSync(fullPath), `Tutorial target page must exist: ${file}`);
      pageCache.set(file, read(file));
    }
    return pageCache.get(file);
  };

  for (const tut of tutorials) {
    assert.ok(tut.id && tut.title && tut.summary && tut.steps.length >= 4, `Tutorial ${tut.id} must have complete steps`);
    const targetHtml = getPageHtml(tut.tryPage);
    if (tut.trySelector) {
      const idMatches = [...tut.trySelector.matchAll(/#([a-zA-Z0-9_-]+)/g)].map((m) => m[1]);
      for (const id of idMatches) {
        assert.ok(
          targetHtml.includes(`id="${id}"`),
          `Tutorial "${tut.id}" trySelector references missing id="#${id}" in ${tut.tryPage}`
        );
      }
    }
    for (const step of tut.steps) {
      assert.ok(step.title && step.body, `Every step in "${tut.id}" must have a title and explanation`);
      if (step.page) {
        const stepHtml = getPageHtml(step.page);
        if (step.selector) {
          const stepIds = [...step.selector.matchAll(/#([a-zA-Z0-9_-]+)/g)].map((m) => m[1]);
          const foundAny = stepIds.length === 0 || stepIds.some((id) => stepHtml.includes(`id="${id}"`));
          assert.ok(
            foundAny,
            `Tutorial "${tut.id}" step "${step.title}" references missing IDs (${stepIds.join(', ')}) in ${step.page}`
          );
        }
      }
    }
  }
});

test('tutorial UI supports library search, category filtering, step navigation, completion progress, and live spotlight', () => {
  const { win, body, tutorialBody, progressText, navigations, session } = createTutorialVm();

  // Open library
  win.Ipon.openTutorial();
  const dialog = body.children.find((c) => c.id === 'ipon-tutorial-dialog');
  assert.ok(dialog && dialog.open, 'Tutorial dialog must open');
  assert.match(tutorialBody.innerHTML, /Welcome &amp; Introduction to myIPON/);
  assert.match(tutorialBody.innerHTML, /How to Record a Savings Addition/);
  assert.equal(progressText.textContent, '0 / 16 completed');

  // Filter by search with zero matches -> empty state
  dialog.dispatch('input', { target: { closest: (sel) => (sel === '#ipon-tutorial-search' ? { value: 'nonexistent_xyz_feature' } : null) } });
  assert.match(tutorialBody.innerHTML, /No matching tutorials found/);
  assert.match(tutorialBody.innerHTML, /Reset search &amp; filters/);

  // Reset search and filter via compact mobile category dropdown
  dialog.dispatch('input', { target: { closest: (sel) => (sel === '#ipon-tutorial-search' ? { value: '' } : null) } });
  dialog.dispatch('change', { target: { closest: (sel) => (sel === '#ipon-tutorial-cat-select' ? { value: 'budget-reports' } : null) } });
  assert.match(tutorialBody.innerHTML, /How to Plan Your 50\/30\/20 Budget/);
  assert.doesNotMatch(tutorialBody.innerHTML, /Welcome &amp; Introduction to myIPON/);

  // Open a specific tutorial detail view and step through to completion
  win.IponTutorial.open('record-addition', 0);
  assert.match(tutorialBody.innerHTML, /Step 1 of 5/);
  assert.match(tutorialBody.innerHTML, /Back to library/);
  assert.match(tutorialBody.innerHTML, /class="tutorial-step-nav-pair"/);

  // Mark complete and confirm persistence
  win.IponTutorial.setTutorialCompleted('record-addition', true);
  win.IponTutorial.open('record-addition', 4);
  assert.match(tutorialBody.innerHTML, /You completed/);
  assert.equal(progressText.textContent, '1 / 16 completed');
  assert.ok(win.IponTutorial.getProgress().completed.includes('record-addition'));

  // Interactive spotlight on current page (dashboard.html)
  const shown = win.IponTutorial.showSpotlight('dashboard-overview', 0);
  assert.equal(shown, true, 'Spotlight should attach to visible target on current page');
  assert.ok(body.children.some((c) => c.className === 'tutorial-spotlight-ring'), 'Spotlight ring should render');
  assert.ok(body.children.some((c) => c.className === 'tutorial-coachmark'), 'Spotlight coachmark should render');
  win.IponTutorial.clearSpotlight();
  assert.equal(body.children.some((c) => c.className === 'tutorial-spotlight-ring'), false, 'Spotlight ring should clear');

  // Try It Now across pages writes handoff and navigates cleanly
  dialog.dispatch('click', {
    target: {
      closest: (sel) => (sel === '[data-tut-try]' ? { dataset: { tutTry: 'budget-planner' } } : null)
    }
  });
  assert.deepEqual(navigations, ['budget.html']);
  assert.match(session.get('myipon_tutorial_handoff_v1') || '', /"tutorialId":"budget-planner"/);
});

test('tutorial stylesheet maintains circular close button, visible account button, compact spacing, responsive dropdown/buttons, dark-mode tokens, and reduced-motion guards', () => {
  const css = read('css/tutorial.css');
  assert.match(css, /\.account-support \.account-tutorial-btn\s*\{[^}]*background:\s*#0f3d2e;[^}]*color:\s*#ffffff;/s);
  assert.match(css, /\.account-tutorial-meta\s*\{[^}]*flex:\s*1 1 auto;/s);
  assert.match(css, /@media \(max-width: 620px\)[\s\S]*?\.account-tutorial-meta\s*\{[^}]*flex:\s*0 0 auto;/s);
  assert.match(css, /\.tutorial-dialog \.tutorial-close-btn\s*\{[^}]*aspect-ratio:\s*1 \/ 1;[^}]*border-radius:\s*50%;/s);
  assert.match(css, /\.tutorial-coachmark-close\s*\{[^}]*aspect-ratio:\s*1 \/ 1;[^}]*border-radius:\s*50%;/s);
  assert.match(css, /\.tutorial-coachmark-toggle\s*\{[^}]*aspect-ratio:\s*1 \/ 1;[^}]*border-radius:\s*50%;/s);
  assert.match(css, /\.tutorial-coachmark\.is-collapsed \.tutorial-coachmark-body\s*\{\s*display:\s*none;\s*\}/);
  assert.match(css, /@media \(max-width: 768px\)[\s\S]*?\.tutorial-cat-select-wrap\s*\{\s*display:\s*block;\s*\}[\s\S]*?\.tutorial-cat-pills\s*\{\s*display:\s*none;\s*\}/);
  assert.match(css, /\.tutorial-step-nav-pair\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);/s);
  assert.match(css, /html\[data-theme="dark"\] \.tutorial-dialog/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});

test('spotlight auto-places coachmark without overlapping target across all 4 sides, handles clean URLs & role/workspace guards, and docks with collapse toggle for large targets', () => {
  const js = read('js/tutorial.js');
  assert.match(js, /spaceBelow >= cardH \+ gap \+ edge[\s\S]*?spaceAbove >= cardH \+ gap \+ edge[\s\S]*?spaceRight >= cardW \+ gap \+ edge[\s\S]*?spaceLeft >= cardW \+ gap \+ edge/);
  assert.match(js, /data-spot-collapse/);
  assert.match(js, /classList\?\.toggle\?\.\('is-docked', placement === 'docked'\)/);
  assert.match(js, /classList\?\.toggle\?\.\('is-collapsed'\)/);
  assert.match(js, /const maxAttempts = 18;/);
  assert.match(js, /navigateSpotlightStep\(/);
  assert.match(js, /data-spot-finish/);
  assert.match(js, /function normalizePageFile\(/);
  assert.match(js, /function canAccessPage\(/);
  assert.match(js, /el\.closest\?\.\('\[hidden\]'\)/);
  assert.match(js, /selector:\s*'\.announcement-panel, #announcement-heading'/);
  assert.match(js, /const canHighlight = Boolean\(step\.selector\) && !blockedBySolo && !blockedByRole && \(!samePage \|\| Boolean\(findVisibleTarget\(step\.selector\)\)\);/);

  // Runtime: clean URL (/dashboard) & MEMBER role must hide Go & highlight on adminOnly workspace-settings
  const { win, tutorialBody } = createTutorialVm({ pageFile: 'dashboard', pageName: 'dashboard', workspaceMode: 'GROUP', role: 'MEMBER' });
  win.IponTutorial.open('workspace-settings', 0);
  assert.doesNotMatch(tutorialBody.innerHTML, /Go &(?:amp;)? highlight|Try it now/);
  assert.match(tutorialBody.innerHTML, /Admin screen/);

  // Runtime: ADMIN role on clean URL (/dashboard) sees Go & highlight on workspace-settings
  const adminVm = createTutorialVm({ pageFile: 'dashboard', pageName: 'dashboard', workspaceMode: 'GROUP', role: 'ADMIN' });
  adminVm.win.IponTutorial.open('workspace-settings', 0);
  assert.match(adminVm.tutorialBody.innerHTML, /Go &(?:amp;)? highlight/);
});
