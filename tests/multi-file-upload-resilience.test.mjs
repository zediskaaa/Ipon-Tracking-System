import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

test('queuePickedFiles sequentially detaches picked files into in-memory Files before clearing input.value', async () => {
  const messagesJs = read('js/messages.js');
  const listeners = new Map();
  const uploadQueueEl = { dataset: {}, hidden: true, innerHTML: '', scrollWidth: 0, scrollLeft: 0 };
  const docStub = {
    documentElement: { dataset: {} },
    body: { insertAdjacentHTML: () => { } },
    getElementById: (id) => (id === 'msg-upload-queue' ? uploadQueueEl : null),
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: (ev, fn) => {
      if (!listeners.has(ev)) listeners.set(ev, []);
      listeners.get(ev).push(fn);
    },
    removeEventListener: () => { }
  };
  const winStub = {
    Ipon: {
      escapeHtml: (s) => String(s ?? ''),
      friendlyError: (e) => String(e?.message || e),
      toast: () => { },
      rpc: async () => [],
      client: null
    },
    addEventListener: () => { },
    removeEventListener: () => { },
    location: { search: '', href: 'https://example.test/dashboard.html' }
  };
  winStub.window = winStub;

  const patched = messagesJs.replace(
    'window.IponMessages = {',
    'window.IponMessages = { __setConv(c) { state.activeConvId = c.conversation_id; state.activeThread = { conversation: c, messages: [], pinned_messages: [] }; }, __getQueue() { return state.uploadQueue; },'
  );
  const HostURL = URL;
  vm.runInNewContext(patched, {
    window: winStub,
    document: docStub,
    location: winStub.location,
    Map,
    Set,
    File,
    Blob,
    Uint8Array,
    URLSearchParams,
    URL: class extends HostURL {
      static createObjectURL() { return 'blob:preview'; }
      static revokeObjectURL() { }
    },
    navigator: {},
    requestAnimationFrame: (fn) => fn(),
    setTimeout,
    clearTimeout,
    setInterval: () => 0,
    clearInterval: () => { }
  });

  winStub.IponMessages.__setConv({
    conversation_id: 'c-multi',
    id: 'u2',
    full_name: 'Alice',
    kind: 'DIRECT',
    status: 'ACCEPTED',
    is_blocked: false
  });

  const timeline = [];
  const inputTarget = { id: 'msg-gallery-input', value: 'C:\\fakepath\\2254.png', files: null };
  const makeMockContentFile = (name, type, bytes) => ({
    name,
    type,
    size: bytes.length,
    lastModified: 1795413259000,
    async arrayBuffer() {
      timeline.push(`start:${name}:val=${inputTarget.value ? 'set' : 'cleared'}`);
      await new Promise((resolve) => setTimeout(resolve, 15));
      timeline.push(`end:${name}:val=${inputTarget.value ? 'set' : 'cleared'}`);
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    }
  });

  const raw0 = makeMockContentFile('2254.png', 'image/png', new Uint8Array([137, 80, 78, 71, 1, 2, 3, 4]));
  const raw1 = makeMockContentFile('2253.png', 'image/png', new Uint8Array([137, 80, 78, 71, 5, 6, 7, 8, 9]));
  inputTarget.files = [raw0, raw1];

  for (const fn of listeners.get('change') || []) {
    await fn({ target: inputTarget });
  }

  assert.equal(inputTarget.value, '', 'input.value is reset after detachment completes');
  assert.deepEqual(
    timeline,
    [
      'start:2254.png:val=set',
      'end:2254.png:val=set',
      'start:2253.png:val=set',
      'end:2253.png:val=set'
    ],
    'files detach strictly sequentially while input.value is still intact'
  );

  const queued = winStub.IponMessages.__getQueue();
  assert.equal(queued.length, 2);
  assert.notEqual(queued[0].file, raw0);
  assert.notEqual(queued[1].file, raw1);
  assert.equal(queued[0].file._iponDetached, true);
  assert.equal(queued[1].file._iponDetached, true);
  assert.equal(queued[0].file.size, 8);
  assert.equal(queued[1].file.size, 9);
});

test('uploadFileRawWithProgress retries XHR network errors, falls back to fetch PUT, normalizes Content-Type, and fails fast on 403', async () => {
  const messagesJs = read('js/messages.js').replace(/\r\n/g, '\n');
  const blockMatch = messagesJs.match(/  const MAX_CHAT_DETACH_BYTES = [\s\S]*?\n  async function downloadOriginalAttachment/);
  assert.ok(blockMatch, 'uploadFileRawWithProgress block exists');
  const uploadBlock = blockMatch[0].replace(/\n  async function downloadOriginalAttachment$/, '');

  const buildUploader = ({ xhrPlan, fetchImpl }) => {
    const sentHeaders = [];
    const sentBodies = [];
    let xhrCalls = 0;

    class MockXHR {
      constructor() {
        this.upload = {};
        this.headers = {};
        this.timeout = 0;
        this.status = 0;
      }
      open(method, url) {
        this.method = method;
        this.url = url;
      }
      setRequestHeader(k, v) {
        this.headers[k] = v;
      }
      send(body) {
        xhrCalls += 1;
        sentHeaders.push({ via: 'xhr', attempt: xhrCalls, headers: { ...this.headers } });
        sentBodies.push(body);
        const outcome = xhrPlan.shift() || { ok: true };
        queueMicrotask(() => {
          if (outcome.networkError) {
            this.onerror?.();
          } else if (outcome.timeout) {
            this.ontimeout?.();
          } else if (outcome.status) {
            this.status = outcome.status;
            this.onload?.();
          } else {
            this.upload.onprogress?.({ lengthComputable: true, loaded: 5, total: 10 });
            this.status = 200;
            this.onload?.();
          }
        });
      }
    }

    const fn = new Function(
      'MAX_ATTACHMENT_BYTES', 'ipon', 'XMLHttpRequest', 'fetch', 'File', 'Blob', 'setTimeout',
      `${uploadBlock}\nreturn uploadFileRawWithProgress;`
    )(
      52428800,
      () => ({}),
      MockXHR,
      fetchImpl,
      File,
      Blob,
      (cb) => { cb(); return 0; }
    );
    return { upload: fn, sentHeaders, sentBodies, getXhrCalls: () => xhrCalls };
  };

  // 1. Mixed-case MIME + first XHR network error -> second XHR succeeds with lowercased Content-Type and detached body
  const h1 = buildUploader({
    xhrPlan: [{ networkError: true }, { ok: true }],
    fetchImpl: async () => { throw new Error('fetch should not be called when XHR retry succeeds'); }
  });
  const rawFile1 = {
    name: '2254.png',
    type: 'IMAGE/PNG ',
    size: 4,
    lastModified: 1000,
    async arrayBuffer() { return new Uint8Array([1, 2, 3, 4]).buffer; }
  };
  const progress1 = [];
  const entry1 = { file: rawFile1 };
  await h1.upload(entry1, { signedUrl: 'https://r2.example/put-0', type: 'IMAGE/PNG ' }, (pct) => progress1.push(pct));
  assert.equal(h1.getXhrCalls(), 2);
  assert.equal(h1.sentHeaders[0].headers['Content-Type'], 'image/png');
  assert.equal(h1.sentBodies[0]._iponDetached, true);
  assert.equal(progress1.at(-1), 100);

  // 2. Both XHR attempts hit network error -> automatically falls back to fetch PUT and succeeds
  const fetchCalls = [];
  const h2 = buildUploader({
    xhrPlan: [{ networkError: true }, { networkError: true }],
    fetchImpl: async (url, opts) => {
      fetchCalls.push({ url, opts });
      return { ok: true, status: 200 };
    }
  });
  const entry2 = { file: new File([new Uint8Array([9, 8, 7])], '2253.webp', { type: 'image/webp' }) };
  const progress2 = [];
  await h2.upload(entry2, { signedUrl: 'https://r2.example/put-1', type: 'image/webp' }, (pct) => progress2.push(pct));
  assert.equal(h2.getXhrCalls(), 2);
  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].opts.method, 'PUT');
  assert.equal(fetchCalls[0].opts.headers['Content-Type'], 'image/webp');
  assert.equal(progress2.at(-1), 100);

  // 3. Non-retryable 403 fails fast without retrying or falling back to fetch
  let fetchCalledOn403 = false;
  const h3 = buildUploader({
    xhrPlan: [{ status: 403 }],
    fetchImpl: async () => { fetchCalledOn403 = true; return { ok: true, status: 200 }; }
  });
  const entry3 = { file: new File([new Uint8Array([1])], 'bad.png', { type: 'image/png' }) };
  await assert.rejects(
    () => h3.upload(entry3, { signedUrl: 'https://r2.example/put-403', type: 'image/png' }, () => { }),
    /Upload failed \(403\)\./
  );
  assert.equal(h3.getXhrCalls(), 1);
  assert.equal(fetchCalledOn403, false);
});

test('Shared core.js uploader, MainActivity.java picker intents, and manage-account signed Content-Type stay aligned', () => {
  const coreJs = read('js/core.js');
  const mainActivity = read('android/app/src/main/java/com/myipon/app/MainActivity.java');
  const manageAccount = read('supabase/functions/manage-account/index.ts');

  assert.match(coreJs, /async function detachPickedFile\(file,/);
  assert.match(coreJs, /window\.Ipon = \{[\s\S]*?detachPickedFile,/);
  assert.match(coreJs, /async function uploadAuthorizedFile\(client, bucket, upload, file\)[\s\S]*?normalizeUploadContentType\(upload\?\.type \|\| file\?\.type \|\| ''\)/);
  assert.match(coreJs, /detachPickedFile\(file, \{ maxBytes: MAX_DETACH_FILE_BYTES \}\)/);

  assert.match(mainActivity, /Intent\.FLAG_GRANT_READ_URI_PERMISSION/);
  assert.match(mainActivity, /final java\.util\.ArrayList<Uri> picked = new java\.util\.ArrayList<>/);

  // Every R2 upload action returns the exact normalized rawType signed in signR2Object
  assert.match(manageAccount, /signR2Object\(ANNOUNCEMENTS_BUCKET, path, 'PUT', rawType\)[\s\S]*?type: rawType/);
  assert.match(manageAccount, /signR2Object\(RECORD_COMMENTS_BUCKET, path, 'PUT', rawType\)[\s\S]*?type: rawType/);
  assert.match(manageAccount, /signR2Object\(CHAT_ATTACHMENTS_BUCKET, path, 'PUT', rawType\)[\s\S]*?type: rawType,/);
});
