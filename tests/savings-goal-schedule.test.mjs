import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = process.cwd();
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

function loadIponCore() {
  const coreJs = read('js/core.js');
  const storage = new Map();
  const sandbox = {
    console,
    Date,
    Math,
    Number,
    String,
    Boolean,
    Array,
    Object,
    Map,
    Set,
    RegExp,
    JSON,
    Promise,
    Error,
    URL,
    URLSearchParams,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    navigator: { userAgent: 'node-test', onLine: true },
    location: {
      href: 'https://my-ipon.vercel.app/dashboard.html',
      origin: 'https://my-ipon.vercel.app',
      pathname: '/dashboard.html',
      search: '',
      hash: ''
    },
    history: { replaceState() {}, pushState() {} },
    localStorage: {
      getItem: (k) => (storage.has(k) ? storage.get(k) : null),
      setItem: (k, v) => storage.set(k, String(v)),
      removeItem: (k) => storage.delete(k)
    },
    sessionStorage: {
      getItem: () => null,
      setItem() {},
      removeItem() {}
    },
    document: {
      readyState: 'complete',
      documentElement: { setAttribute() {}, getAttribute: () => null, dataset: {} },
      body: { dataset: { page: 'dashboard' }, classList: { add() {}, remove() {}, toggle() {}, contains: (c) => c === 'security-page' }, insertAdjacentHTML() {}, appendChild() {} },
      querySelector: () => null,
      querySelectorAll: () => [],
      getElementById: () => null,
      addEventListener() {},
      createElement: () => ({ style: {}, setAttribute() {}, appendChild() {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false } })
    },
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {},
    CustomEvent: class CustomEvent { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } }
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  vm.runInNewContext(coreJs, sandbox, { filename: 'js/core.js' });
  return sandbox.window.Ipon;
}

test('computeGoalScheduleSuggestions computes daily, weekly, and monthly suggested deposits accurately', () => {
  const Ipon = loadIponCore();
  assert.equal(typeof Ipon.computeGoalScheduleSuggestions, 'function');

  // 7,000 remaining over 14 days = 500/day, 3,500/week, 7,000/month
  const res = Ipon.computeGoalScheduleSuggestions({
    targetAmount: 10000,
    currentSavings: 3000,
    targetDate: '2026-12-04',
    todayIso: '2026-11-20',
    memberCount: 5
  });
  assert.equal(res.remaining, 7000);
  assert.equal(res.effectiveDays, 14);
  assert.equal(res.hasFutureDate, true);
  assert.equal(res.estimatedHorizon, false);
  assert.equal(res.daily.amount, 500);
  assert.equal(res.daily.perMember, 100);
  assert.equal(res.weekly.amount, 3500);
  assert.equal(res.weekly.perMember, 700);
  assert.equal(res.monthly.amount, 7000);

  // Without target date: falls back to 30-day preview
  const noDate = Ipon.computeGoalScheduleSuggestions({
    targetAmount: 3000,
    currentSavings: 0,
    targetDate: '',
    todayIso: '2026-11-20'
  });
  assert.equal(noDate.hasFutureDate, false);
  assert.equal(noDate.estimatedHorizon, true);
  assert.equal(noDate.effectiveDays, 30);
  assert.equal(noDate.daily.amount, 100);

  // Target already reached
  const met = Ipon.computeGoalScheduleSuggestions({
    targetAmount: 5000,
    currentSavings: 6000,
    targetDate: '2026-12-30',
    todayIso: '2026-11-20'
  });
  assert.equal(met.remaining, 0);
  assert.equal(met.daily.amount, 0);
  assert.equal(met.weekly.amount, 0);
  assert.equal(met.monthly.amount, 0);
});

test('computeGoalScheduleStatus stacks unpaid missed periods (carry-over) and deducts overpayments from next deposit', () => {
  const Ipon = loadIponCore();
  assert.equal(typeof Ipon.computeGoalScheduleStatus, 'function');

  const weeklyGoal = {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    title: 'Emergency Fund',
    status: 'ACTIVE',
    target_amount: 5000,
    saving_frequency: 'WEEKLY',
    scheduled_amount: 500,
    schedule_start_date: '2026-11-01',
    schedule_baseline_amount: 1000
  };

  // Week 1 unpaid (pre-existing baseline 1000 does NOT count as Week 1 payment)
  const week1Unpaid = Ipon.computeGoalScheduleStatus(weeklyGoal, { trackedSavings: 1000, todayIso: '2026-11-01' });
  assert.equal(week1Unpaid.enabled, true);
  assert.equal(week1Unpaid.elapsedPeriods, 1);
  assert.equal(week1Unpaid.isUnpaid, true);
  assert.equal(week1Unpaid.status, 'DUE_NOW');
  assert.equal(week1Unpaid.dueNow, 500);
  assert.equal(week1Unpaid.carryOver, 0);
  assert.equal(week1Unpaid.nextAutoFillAmount, 500);

  // Missed Week 1, now Week 2 -> unpaid 500 carries over onto Week 2 = 1,000 autofill
  const week2Missed = Ipon.computeGoalScheduleStatus(weeklyGoal, { trackedSavings: 1000, todayIso: '2026-11-08' });
  assert.equal(week2Missed.elapsedPeriods, 2);
  assert.equal(week2Missed.isUnpaid, true);
  assert.equal(week2Missed.status, 'OVERDUE_CARRYOVER');
  assert.equal(week2Missed.dueNow, 1000);
  assert.equal(week2Missed.carryOver, 500);
  assert.equal(week2Missed.nextAutoFillAmount, 1000);
  assert.match(week2Missed.autofillHint, /carry-over/i);

  // Partial payment (200 in Week 1) -> Week 2 due = 800 (300 carry-over + 500 current)
  const week2Partial = Ipon.computeGoalScheduleStatus(weeklyGoal, { trackedSavings: 1200, todayIso: '2026-11-08' });
  assert.equal(week2Partial.dueNow, 800);
  assert.equal(week2Partial.carryOver, 300);
  assert.equal(week2Partial.nextAutoFillAmount, 800);

  // Overpaid in Week 1 (paid 700 instead of 500 -> +200 excess) -> Next deposit reduced to 300!
  const week1Overpaid = Ipon.computeGoalScheduleStatus(weeklyGoal, { trackedSavings: 1700, todayIso: '2026-11-03' });
  assert.equal(week1Overpaid.isUnpaid, false);
  assert.equal(week1Overpaid.status, 'AHEAD_CREDIT');
  assert.equal(week1Overpaid.dueNow, 0);
  assert.equal(week1Overpaid.credit, 200);
  assert.equal(week1Overpaid.periodsAhead, 0);
  assert.equal(week1Overpaid.nextPeriodDue, 300);
  assert.equal(week1Overpaid.nextAutoFillAmount, 300);
  assert.equal(week1Overpaid.nextDueDate, '2026-11-08');
  assert.match(week1Overpaid.autofillHint, /deducted/i);

  // When Week 2 actually starts after paying 700 in Week 1 -> dueNow is exactly 300!
  const week2AfterOverpay = Ipon.computeGoalScheduleStatus(weeklyGoal, { trackedSavings: 1700, todayIso: '2026-11-08' });
  assert.equal(week2AfterOverpay.isUnpaid, true);
  assert.equal(week2AfterOverpay.status, 'DUE_NOW');
  assert.equal(week2AfterOverpay.dueNow, 300);
  assert.equal(week2AfterOverpay.carryOver, 0);
  assert.equal(week2AfterOverpay.nextAutoFillAmount, 300);

  // Multi-period advance overpayment (paid 1,200 in Week 1 on 500/week -> +700 credit = 1 full week ahead + 200 toward Week 3!)
  const multiAhead = Ipon.computeGoalScheduleStatus(weeklyGoal, { trackedSavings: 2200, todayIso: '2026-11-02' });
  assert.equal(multiAhead.isUnpaid, false);
  assert.equal(multiAhead.credit, 700);
  assert.equal(multiAhead.periodsAhead, 1);
  assert.equal(multiAhead.remainderCredit, 200);
  assert.equal(multiAhead.nextPeriodDue, 300);
  assert.equal(multiAhead.nextAutoFillAmount, 300);
  assert.equal(multiAhead.nextDueDate, '2026-11-15');

  // On Week 2 (2026-11-08), still covered ahead -> NOT unpaid!
  const multiAheadWeek2 = Ipon.computeGoalScheduleStatus(weeklyGoal, { trackedSavings: 2200, todayIso: '2026-11-08' });
  assert.equal(multiAheadWeek2.isUnpaid, false);
  assert.equal(multiAheadWeek2.status, 'AHEAD_CREDIT');
  assert.equal(multiAheadWeek2.credit, 200);
  assert.equal(multiAheadWeek2.nextAutoFillAmount, 300);

  // On Week 3 (2026-11-15), 200 excess is subtracted -> dueNow = 300!
  const multiAheadWeek3 = Ipon.computeGoalScheduleStatus(weeklyGoal, { trackedSavings: 2200, todayIso: '2026-11-15' });
  assert.equal(multiAheadWeek3.isUnpaid, true);
  assert.equal(multiAheadWeek3.dueNow, 300);
  assert.equal(multiAheadWeek3.nextAutoFillAmount, 300);

  // Target-cap clamping: only 180 remaining to target -> never asks for 500
  const nearTarget = Ipon.computeGoalScheduleStatus(weeklyGoal, { trackedSavings: 4820, todayIso: '2026-12-20' });
  assert.equal(nearTarget.remainingToTarget, 180);
  assert.equal(nearTarget.dueNow, 180);
  assert.equal(nearTarget.nextAutoFillAmount, 180);

  // Reached target -> zero due, zero autofill
  const reached = Ipon.computeGoalScheduleStatus(weeklyGoal, { trackedSavings: 5000, todayIso: '2026-12-20' });
  assert.equal(reached.isReached, true);
  assert.equal(reached.isUnpaid, false);
  assert.equal(reached.dueNow, 0);
  assert.equal(reached.nextAutoFillAmount, 0);
  assert.equal(reached.status, 'REACHED');
});

test('computeGoalScheduleStatus handles daily schedules and month-end monthly clamping accurately', () => {
  const Ipon = loadIponCore();

  const dailyGoal = {
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    title: 'Daily Jar',
    status: 'ACTIVE',
    target_amount: 1000,
    saving_frequency: 'DAILY',
    scheduled_amount: 100,
    schedule_start_date: '2026-11-18',
    schedule_baseline_amount: 0
  };
  // 3 days elapsed (18, 19, 20) with 0 paid -> 300 due (200 carry-over)
  const day3 = Ipon.computeGoalScheduleStatus(dailyGoal, { trackedSavings: 0, todayIso: '2026-11-20' });
  assert.equal(day3.elapsedPeriods, 3);
  assert.equal(day3.dueNow, 300);
  assert.equal(day3.carryOver, 200);
  assert.equal(day3.nextAutoFillAmount, 300);

  const monthlyGoal = {
    id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    title: 'Year-End Fund',
    status: 'ACTIVE',
    target_amount: 12000,
    saving_frequency: 'MONTHLY',
    scheduled_amount: 1000,
    schedule_start_date: '2026-01-31',
    schedule_baseline_amount: 0
  };
  // Feb 27 is still Month 1; Feb 28 (month-end clamp of day 31) starts Month 2
  const feb27 = Ipon.computeGoalScheduleStatus(monthlyGoal, { trackedSavings: 1000, todayIso: '2026-02-27' });
  assert.equal(feb27.elapsedPeriods, 1);
  assert.equal(feb27.isUnpaid, false);
  assert.equal(feb27.nextDueDate, '2026-02-28');

  const feb28 = Ipon.computeGoalScheduleStatus(monthlyGoal, { trackedSavings: 1000, todayIso: '2026-02-28' });
  assert.equal(feb28.elapsedPeriods, 2);
  assert.equal(feb28.isUnpaid, true);
  assert.equal(feb28.dueNow, 1000);
});

test('pickActiveScheduledGoal and GOAL_REMINDER notification routing work for admin and member roles', () => {
  const Ipon = loadIponCore();
  const goalA = {
    id: '11111111-1111-4111-8111-111111111111',
    title: 'Flexible Goal',
    status: 'ACTIVE',
    target_amount: 5000,
    saving_frequency: 'NONE',
    scheduled_amount: null
  };
  const goalB = {
    id: '22222222-2222-4222-8222-222222222222',
    title: 'Weekly Fund',
    status: 'ACTIVE',
    target_amount: 5000,
    saving_frequency: 'WEEKLY',
    scheduled_amount: 500,
    schedule_start_date: '2026-11-10',
    schedule_baseline_amount: 0
  };
  const picked = Ipon.pickActiveScheduledGoal([goalA, goalB], { trackedSavings: 0, todayIso: '2026-11-20' });
  assert.ok(picked);
  assert.equal(picked.goal.id, goalB.id);
  assert.equal(picked.status.dueNow, 1000);

  const adminTarget = Ipon.resolveNotificationTarget({
    type: 'GOAL_REMINDER',
    link: `dashboard.html?record_goal=${goalB.id}`,
    dedupe_key: `GOAL_REMINDER:${goalB.id}:2026-11-10:W2`
  }, 'ADMIN');
  assert.equal(adminTarget, `dashboard.html?record_goal=${goalB.id}`);

  const memberTarget = Ipon.resolveNotificationTarget({
    type: 'GOAL_REMINDER',
    link: `dashboard.html?record_goal=${goalB.id}`,
    dedupe_key: `GOAL_REMINDER:${goalB.id}:2026-11-10:W2`
  }, 'MEMBER');
  assert.equal(memberTarget, `user.html?goal_due=${goalB.id}`);
});

test('migration 141, schema.sql, and UI files satisfy savings goal schedule & autofill contracts', () => {
  const mig = read('database/migrations/20261120_141_savings_goal_schedules_and_reminders.sql');
  const schema = read('database/schema.sql');
  const savingsHtml = read('savings.html');
  const savingsJs = read('js/savings.js');
  const dashboardHtml = read('dashboard.html');
  const dashboardJs = read('js/dashboard.js');
  const contribHtml = read('contributions.html');
  const recordsJs = read('js/records.js');
  const userHtml = read('user.html');
  const userJs = read('js/user.js');
  const css = read('css/app.css');

  for (const sql of [mig, schema]) {
    assert.match(sql, /add column if not exists saving_frequency text not null default 'NONE'/i);
    assert.match(sql, /add column if not exists scheduled_amount numeric\(14,2\)/i);
    assert.match(sql, /add column if not exists schedule_start_date date/i);
    assert.match(sql, /add column if not exists schedule_baseline_amount numeric\(14,2\) not null default 0/i);
    assert.match(sql, /drop function if exists public\.save_savings_goal\(uuid, text, numeric, date, public\.goal_status, text\)/i);
    assert.match(sql, /p_saving_frequency text default 'NONE'/i);
    assert.match(sql, /p_scheduled_amount numeric default null/i);
    assert.match(sql, /p_schedule_start_date date default null/i);
    assert.match(sql, /'GOAL_REMINDER'/);
    assert.match(sql, /'20261120_141', 'savings_goal_schedules_and_reminders'/);
  }

  assert.match(savingsHtml, /id="goal-duration-count"/);
  assert.match(savingsHtml, /id="goal-duration-unit"/);
  assert.match(savingsHtml, /id="goal-saving-frequency"/);
  assert.match(savingsHtml, /data-suggest-freq="DAILY"/);
  assert.match(savingsHtml, /data-suggest-freq="WEEKLY"/);
  assert.match(savingsHtml, /data-suggest-freq="MONTHLY"/);
  assert.match(savingsHtml, /id="goal-scheduled-amount"[^>]*max="999999999999\.99"/);
  assert.match(savingsHtml, /id="calc-preset-field" hidden/);
  assert.doesNotMatch(savingsHtml, /id="calc-target"[^>]*value=/);
  assert.doesNotMatch(savingsHtml, /id="calc-current"[^>]*value=/);
  assert.doesNotMatch(savingsHtml, /id="calc-members"[^>]*value=/);
  assert.doesNotMatch(dashboardHtml, /id="group-default-amount"[^>]*value="100"/);
  assert.match(savingsHtml, /id="calc-start-workspace"/);
  assert.match(savingsJs, /Ipon\.renderGroupRequiredCard\(list, \{[\s\S]*?hasGroup: false/);
  assert.match(savingsJs, /async function activateSoloGoalFromCalculator\(/);
  assert.match(savingsJs, /if \(calcPresetField\) calcPresetField\.hidden = !hasOptions;/);
  assert.doesNotMatch(savingsJs, /(?:targetCheck|schedCheck)\.ok\b/);
  assert.match(dashboardJs, /function readPreWorkspaceCalculatorPlan\(/);
  assert.match(savingsJs, /computeGoalScheduleSuggestions/);

  // Ensure parseMoneyAmount returns { valid: true, value: 8000 } for normal peso input
  const Ipon = loadIponCore();
  const parsed = Ipon.parseMoneyAmount('8000', { min: 0.01, required: true, label: 'Target amount' });
  assert.equal(parsed.valid, true);
  assert.equal(parsed.value, 8000);
  assert.match(savingsJs, /computeGoalScheduleStatus/);
  assert.match(savingsJs, /p_saving_frequency/);
  assert.match(savingsJs, /sync_my_due_reminders/);

  assert.match(dashboardHtml, /id="no-group-create-goal-btn"/);
  assert.match(dashboardHtml, /id="dashboard-create-goal-dialog"/);
  assert.match(dashboardHtml, /id="dashboard-goal-schedule"/);
  assert.match(dashboardHtml, /id="quick-goal-autofill-hint"/);
  assert.match(dashboardJs, /function openDashboardCreateGoalDialog\(/);
  assert.match(dashboardJs, /computeGoalScheduleStatus/);
  assert.match(dashboardJs, /pickActiveScheduledGoal/);
  assert.match(dashboardJs, /params\.get\('record_goal'\)/);

  assert.match(contribHtml, /id="record-goal-autofill-hint"/);
  assert.match(recordsJs, /pickActiveScheduledGoal/);
  assert.match(recordsJs, /params\.get\('goal_due'\)/);

  assert.match(userHtml, /id="user-goal-autofill-hint"/);
  assert.match(userJs, /pickActiveScheduledGoal/);
  assert.match(userJs, /params\.get\('goal_due'\)/);

  assert.match(savingsHtml, /class="calc-remaining-summary"/);
  assert.match(savingsHtml, /class="calc-results-grid calc-pace-grid"/);
  assert.match(savingsHtml, /<button class="calc-kpi is-selectable" type="button" data-calc-pace="DAILY"/);
  assert.match(savingsHtml, /<button class="calc-kpi is-selectable" type="button" data-calc-pace="WEEKLY"/);
  assert.match(savingsHtml, /<button class="calc-kpi is-selectable" type="button" data-calc-pace="MONTHLY"/);
  assert.match(savingsHtml, /data-group-only="1">\s*<label for="calc-members"/);
  assert.match(savingsJs, /const isSolo = state\.profile\.workspace_mode === 'SOLO';/);
  assert.match(savingsJs, /dailySub\.textContent = 'Your deposit \/ day';/);
  assert.doesNotMatch(savingsJs, /Group total \/ day/);
  assert.match(savingsHtml, /id="calc-create-goal"[^>]*disabled/);
  assert.match(savingsJs, /function getCalcGoalReadiness\(/);
  assert.match(savingsJs, /async function saveGoalFromCalculator\(/);
  assert.match(savingsJs, /function validateWholeNumberField\(/);
  assert.match(savingsJs, /guardWholeNumberInput\(calcMembers, \{ min: 1, max: 500/);
  assert.match(savingsJs, /function validateCalculatorForm\(/);
  assert.match(css, /\.calc-remaining-summary\s*\{/);
  assert.match(css, /\.calc-pace-radio\s*\{/);
  assert.match(css, /\.goal-suggestion-grid\s*\{/);
  assert.match(css, /\.goal-schedule-strip\.is-overdue\s*\{/);
  assert.match(css, /\.goal-autofill-hint\.is-ahead\s*\{/);
  assert.match(css, /html\[data-theme="dark"\] \.goal-suggest-card\.is-selected\s*\{/);
  assert.match(css, /html\[data-theme="dark"\] \.calc-kpi\.is-selectable\.is-chosen\s*\{/);
});
