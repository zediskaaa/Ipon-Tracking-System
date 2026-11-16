import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const rootDir = process.cwd();
const migrationsDir = path.join(rootDir, 'database', 'migrations');
const functionsDir = path.join(rootDir, 'supabase', 'functions');
const cachePath = path.join(rootDir, 'supabase', '.temp', 'deployed-functions.json');
const DEFAULT_PROJECT_REF = process.env.SUPABASE_PROJECT_REF || 'woslmwokhhyszkgevnli';
const NO_VERIFY_JWT_FUNCTIONS = new Set(['manage-account', 'send-push']);

const args = process.argv.slice(2);
const syncMode = args.includes('--sync');
const watchMode = args.includes('--watch');
const syncFeedMode = args.includes('--sync-feed');
const applyMode = syncMode || args.includes('--apply');
const deployFunctions = syncMode || args.includes('--deploy-functions');
const onlyChangedFunctions = (syncMode || args.includes('--if-changed')) && !args.includes('--force');
const fromFlag = args.find((arg) => arg.startsWith('--from='))?.slice('--from='.length)
  || (args.includes('--from') ? args[args.indexOf('--from') + 1] : '');
const remoteOverride = args.find((arg) => arg.startsWith('--remote='))?.slice('--remote='.length) || '';

function resolveRemoteFlag() {
  if (remoteOverride) return `--remote=${remoteOverride}`;
  const tempRefPath = path.join(rootDir, 'supabase', '.temp', 'project-ref');
  if (fs.existsSync(tempRefPath) && !process.env.CI) return '--remote';
  return `--remote=${DEFAULT_PROJECT_REF}`;
}

const remoteFlag = resolveRemoteFlag();

function runSupabase(cliArgs, { capture = false } = {}) {
  const isWin = process.platform === 'win32';
  const fullArgs = ['--yes', 'supabase', ...cliArgs];
  const result = isWin
    ? spawnSync(
        `npx ${fullArgs.map((arg) => (/[\s"]/.test(arg) ? `"${arg.replace(/"/g, '\\"')}"` : arg)).join(' ')}`,
        { cwd: rootDir, shell: true, encoding: 'utf8', stdio: capture ? 'pipe' : 'inherit' }
      )
    : spawnSync('npx', fullArgs, { cwd: rootDir, encoding: 'utf8', stdio: capture ? 'pipe' : 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const details = capture ? (result.stderr || result.stdout || '').trim() : '';
    throw new Error(`supabase ${cliArgs[0]} failed (exit ${result.status})${details ? `: ${details}` : ''}`);
  }
  return capture ? result.stdout : '';
}

function parseJsonPayload(raw) {
  const jsonStart = raw.indexOf('{');
  if (jsonStart === -1) {
    throw new Error('Supabase CLI output did not contain a JSON payload.');
  }
  return JSON.parse(raw.slice(jsonStart));
}

function parseQueryRows(raw) {
  const payload = parseJsonPayload(raw);
  if (!payload || !Array.isArray(payload.rows)) {
    throw new Error('Supabase query output is missing the expected rows array.');
  }
  return payload.rows;
}

function fetchSchemaState() {
  const out = runSupabase(
    ['db', 'query', remoteFlag, '--read-only', "select to_regclass('public.schema_migrations')::text as ledger_table, to_regclass('public.profiles')::text as profiles_table;"],
    { capture: true }
  );
  const [row] = parseQueryRows(out);
  if (!row) {
    throw new Error('Unable to inspect remote schema state.');
  }
  return {
    hasLedger: Boolean(row.ledger_table),
    hasProfiles: Boolean(row.profiles_table)
  };
}

function fetchAppliedVersions() {
  const out = runSupabase(
    ['db', 'query', remoteFlag, '--read-only', 'select version from public.schema_migrations order by version;'],
    { capture: true }
  );
  return new Set(parseQueryRows(out).map((row) => String(row.version)));
}

function listMigrationFiles() {
  return fs
    .readdirSync(migrationsDir)
    .filter((file) => /^20\d{6}_\d{3}_.+\.sql$/.test(file))
    .sort()
    .map((file) => ({ file, version: file.split('_').slice(0, 2).join('_'), fullPath: path.join(migrationsDir, file) }));
}

function listFunctionNames() {
  if (!fs.existsSync(functionsDir)) return [];
  return fs
    .readdirSync(functionsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.') && !entry.name.startsWith('_'))
    .map((entry) => entry.name)
    .sort();
}

function hashDirectory(dir) {
  const hash = crypto.createHash('sha256');
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(current, entry.name);
      const rel = path.relative(dir, full).replace(/\\/g, '/');
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) hash.update(`${rel}\0`).update(fs.readFileSync(full)).update('\0');
    }
  };
  walk(dir);
  return hash.digest('hex');
}

function loadFunctionCache() {
  try { return JSON.parse(fs.readFileSync(cachePath, 'utf8')); } catch { return {}; }
}

function saveFunctionCache(data) {
  fs.mkdirSync(path.dirname(cachePath), { recursive: true });
  fs.writeFileSync(cachePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function syncMigrations() {
  const { hasLedger, hasProfiles } = fetchSchemaState();
  if (!hasLedger && hasProfiles) {
    throw new Error('Refusing to initialize public.schema_migrations on an existing database that already has public.profiles. Restore or backfill schema_migrations first.');
  }

  let applied;
  if (!hasLedger && !hasProfiles) {
    if (applyMode) {
      console.log('Initializing migration ledger on fresh database...');
      runSupabase(['db', 'query', remoteFlag, '--yes', '--file', path.join(migrationsDir, '0000_create_migration_ledger.sql')]);
      applied = fetchAppliedVersions();
    } else {
      applied = new Set();
    }
  } else {
    applied = fetchAppliedVersions();
    if (hasProfiles && applied.size === 0) {
      throw new Error('Refusing to run migrations: public.profiles exists but public.schema_migrations is empty.');
    }
  }

  const pending = listMigrationFiles().filter((item) => !applied.has(item.version) && (!fromFlag || item.version >= fromFlag));
  const sortedApplied = [...applied].sort();
  const maxApplied = sortedApplied[sortedApplied.length - 1] || '';
  const blockedLegacy = pending.filter((item) => maxApplied && item.version < maxApplied && item.version <= '20261116_094');

  console.log(`Target: ${remoteFlag} | Applied ledger entries: ${applied.size} | Pending files: ${pending.length}`);
  for (const item of pending) console.log(`  PENDING ${item.file}`);

  if (blockedLegacy.length > 0 && applyMode) {
    throw new Error(
      `Refusing to replay historical migration(s) (${blockedLegacy.map((item) => item.file).join(', ')}) behind already-applied version ${maxApplied}.`
    );
  }

  if (applyMode) {
    for (const item of pending) {
      console.log(`Applying ${item.file}...`);
      runSupabase(['db', 'query', remoteFlag, '--yes', '--file', item.fullPath]);
    }
    console.log(pending.length ? 'All pending migrations applied.' : 'Database is already up to date.');
  } else if (!deployFunctions && pending.length > 0) {
    console.log('\nDry run only. Run `npm run db:migrate` to apply pending SQL migrations, or `npm run supabase:sync` to sync DB and changed Edge Functions.');
  }
}

function syncFunctions() {
  const names = listFunctionNames();
  const cache = loadFunctionCache();
  let deployedCount = 0;

  for (const name of names) {
    const hash = hashDirectory(path.join(functionsDir, name));
    if (onlyChangedFunctions && cache[name] === hash) {
      console.log(`Edge Function ${name}: up to date.`);
      continue;
    }
    console.log(`Deploying Edge Function: ${name}...`);
    const deployArgs = ['functions', 'deploy', name, remoteFlag, '--use-api', '--yes'];
    if (NO_VERIFY_JWT_FUNCTIONS.has(name)) deployArgs.push('--no-verify-jwt');
    runSupabase(deployArgs);
    cache[name] = hash;
    saveFunctionCache(cache);
    deployedCount += 1;
  }

  if (names.length === 0) console.log('No Edge Functions found.');
  else if (deployedCount === 0) console.log('All Edge Functions are already up to date.');
}

function syncReleaseCommitsFeed() {
  try {
    const res = spawnSync('git', ['log', '-n', '45', '--format=%cI\t%B---IPON_COMMIT_END---'], {
      cwd: rootDir,
      encoding: 'utf8'
    });
    if (res.status !== 0 || !res.stdout) return;
    const commits = res.stdout
      .split('---IPON_COMMIT_END---')
      .map((block) => block.trim())
      .filter(Boolean)
      .map((block) => {
        const tabIdx = block.indexOf('\t');
        if (tabIdx === -1) return null;
        return {
          date: block.slice(0, tabIdx).trim(),
          message: block.slice(tabIdx + 1).trim()
        };
      })
      .filter((entry) => entry && entry.date && entry.message);
    if (commits.length) {
      fs.writeFileSync(path.join(rootDir, 'js', 'release-commits.json'), `${JSON.stringify(commits, null, 2)}\n`, 'utf8');
    }
  } catch { }
}

function runOnce() {
  if (syncFeedMode) {
    syncReleaseCommitsFeed();
    if (!applyMode && !deployFunctions && !args.includes('--status')) return;
  }
  try {
    if (applyMode || !deployFunctions) syncMigrations();
    if (deployFunctions) syncFunctions();
  } catch (err) {
    if (syncMode && /ENOTFOUND|ECONNREFUSED|EAI_AGAIN|ETIMEDOUT|network|socket hang up|fetch failed/i.test(String(err?.message || ''))) {
      console.warn('[supabase:sync] Remote offline or unreachable; skipping auto-sync.');
      return;
    }
    throw err;
  }
}

if (watchMode) {
  let running = false;
  let queued = false;
  let timer = null;

  const triggerSync = async () => {
    if (running) { queued = true; return; }
    running = true;
    try {
      if (syncFeedMode) syncReleaseCommitsFeed();
      syncMigrations();
      syncFunctions();
    } catch (err) {
      console.error('[supabase:watch] Sync failed:', err.message);
    } finally {
      running = false;
      if (queued) { queued = false; triggerSync(); }
    }
  };

  console.log(`Watching ${path.relative(rootDir, migrationsDir)} and ${path.relative(rootDir, functionsDir)}...`);
  triggerSync();
  for (const dir of [migrationsDir, functionsDir]) {
    if (!fs.existsSync(dir)) continue;
    fs.watch(dir, { recursive: true }, () => {
      clearTimeout(timer);
      timer = setTimeout(triggerSync, 1500);
    });
  }
} else {
  runOnce();
}
