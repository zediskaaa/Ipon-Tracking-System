import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const rootDir = process.cwd();
const migrationsDir = path.join(rootDir, 'database', 'migrations');
const functionsDir = path.join(rootDir, 'supabase', 'functions');
const cachePath = path.join(rootDir, 'supabase', '.temp', 'deployed-functions.json');
const DEFAULT_PROJECT_REF = process.env.SUPABASE_PROJECT_REF || 'woslmwokhhyszkgevnli';
const NO_VERIFY_JWT_FUNCTIONS = new Set(['manage-account']);

const args = process.argv.slice(2);
const syncMode = args.includes('--sync');
const watchMode = args.includes('--watch');
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
  return jsonStart === -1 ? null : JSON.parse(raw.slice(jsonStart));
}

function fetchAppliedVersions() {
  try {
    const out = runSupabase(
      ['db', 'query', remoteFlag, '--read-only', 'select version from public.schema_migrations order by version;'],
      { capture: true }
    );
    return new Set((parseJsonPayload(out)?.rows || []).map((row) => String(row.version)));
  } catch (err) {
    if (!applyMode) throw err;
    return null;
  }
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
  let applied = fetchAppliedVersions();
  if (applied === null && applyMode) {
    console.log('Initializing migration ledger...');
    runSupabase(['db', 'query', remoteFlag, '--yes', '--file', path.join(migrationsDir, '0000_create_migration_ledger.sql')]);
    applied = fetchAppliedVersions() || new Set();
  }

  const pending = listMigrationFiles().filter((item) => !applied.has(item.version) && (!fromFlag || item.version >= fromFlag));
  console.log(`Target: ${remoteFlag} | Applied ledger entries: ${applied.size} | Pending files: ${pending.length}`);
  for (const item of pending) console.log(`  PENDING ${item.file}`);

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

function runOnce() {
  if (applyMode || !deployFunctions) syncMigrations();
  if (deployFunctions) syncFunctions();
}

if (watchMode) {
  let running = false;
  let queued = false;
  let timer = null;

  const triggerSync = async () => {
    if (running) { queued = true; return; }
    running = true;
    try {
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
