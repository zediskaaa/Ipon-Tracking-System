import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const rootDir = process.cwd();
const migrationsDir = path.join(rootDir, 'database', 'migrations');
const DEFAULT_PROJECT_REF = process.env.SUPABASE_PROJECT_REF || 'woslmwokhhyszkgevnli';

const args = process.argv.slice(2);
const applyMode = args.includes('--apply');
const deployFunctions = args.includes('--deploy-functions');
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
  if (jsonStart === -1) return null;
  return JSON.parse(raw.slice(jsonStart));
}

function fetchAppliedVersions() {
  try {
    const out = runSupabase(
      ['db', 'query', remoteFlag, '--read-only', 'select version from public.schema_migrations order by version;'],
      { capture: true }
    );
    const parsed = parseJsonPayload(out);
    return new Set((parsed?.rows || []).map((row) => String(row.version)));
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
    .map((file) => {
      const version = file.split('_').slice(0, 2).join('_');
      return { file, version, fullPath: path.join(migrationsDir, file) };
    });
}

let applied = fetchAppliedVersions();
if (applied === null && applyMode) {
  console.log('Initializing migration ledger...');
  runSupabase(['db', 'query', remoteFlag, '--yes', '--file', path.join(migrationsDir, '0000_create_migration_ledger.sql')]);
  applied = fetchAppliedVersions() || new Set();
}

const allMigrations = listMigrationFiles();
const pending = allMigrations.filter((item) => !applied.has(item.version) && (!fromFlag || item.version >= fromFlag));

console.log(`Target: ${remoteFlag} | Applied ledger entries: ${applied.size} | Pending files: ${pending.length}`);
for (const item of pending) {
  console.log(`  PENDING ${item.file}`);
}

if (applyMode) {
  for (const item of pending) {
    console.log(`Applying ${item.file}...`);
    runSupabase(['db', 'query', remoteFlag, '--yes', '--file', item.fullPath]);
  }
  console.log(pending.length ? 'All pending migrations applied.' : 'Database is already up to date.');
} else if (!deployFunctions && pending.length > 0) {
  console.log('\nDry run only. Run `npm run db:migrate` to apply pending SQL migrations, or `npm run supabase:deploy` to apply migrations and deploy Edge Functions.');
}

if (deployFunctions) {
  console.log('Deploying Edge Function: manage-account...');
  runSupabase(['functions', 'deploy', 'manage-account', remoteFlag, '--no-verify-jwt', '--use-api', '--yes']);
}
