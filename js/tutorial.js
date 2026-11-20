(() => {
  'use strict';

  const STORAGE_PREFIX = 'myipon_tutorial_progress_v1_';
  const HANDOFF_KEY = 'myipon_tutorial_handoff_v1';

  const ICONS = {
    book: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 4.5A2.5 2.5 0 0 1 4.5 2H11a3 3 0 0 1 3 3v16.5a2 2 0 0 0-2-2H4.5A2.5 2.5 0 0 1 2 17V4.5Z"/><path d="M22 4.5A2.5 2.5 0 0 0 19.5 2H13a3 3 0 0 0-3 3v16.5a2 2 0 0 1 2-2h7.5A2.5 2.5 0 0 0 22 17V4.5Z"/></svg>',
    spark: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 9.8 9.8 3 12l6.8 2.2L12 21l2.2-6.8L21 12l-6.8-2.2L12 3Z"/></svg>',
    grid: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>',
    compass: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="m16.2 7.8-2.1 6.3-6.3 2.1 2.1-6.3 6.3-2.1Z"/></svg>',
    plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/></svg>',
    minus: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M8 12h8"/></svg>',
    receipt: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3v18l2.5-1.5L10 21l2-1.5L14 21l2.5-1.5L19 21V3l-2.5 1.5L14 3l-2 1.5L10 3 7.5 4.5 5 3Z"/><path d="M8.5 8.5h7M8.5 12h7M8.5 15.5h4.5"/></svg>',
    goal: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m19 21-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>',
    history: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/></svg>',
    edit: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
    check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>',
    pie: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21.2 15.9A10 10 0 1 1 8.1 2.8"/><path d="M22 12A10 10 0 0 0 12 2v10Z"/></svg>',
    chart: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20V10m6 10V4m6 16v-7m5 7H2"/></svg>',
    users: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
    sliders: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.26.6.85 1 1.51 1H21a2 2 0 0 1 0 4h-.09c-.66 0-1.25.4-1.51 1Z"/></svg>',
    chat: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>',
    shield: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="m9 12 2 2 4-4"/></svg>',
    close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>',
    back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>',
    search: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>'
  };

  const CATEGORIES = [
    { id: 'getting-started', label: 'Getting Started', subtitle: 'Start your first workspace and learn the layout' },
    { id: 'managing-savings', label: 'Managing Savings', subtitle: 'Record additions, deductions, expenses, and goals' },
    { id: 'records-reviews', label: 'Transactions & Reviews', subtitle: 'Filter history, edit or void records, and approve requests' },
    { id: 'budget-reports', label: 'Budget & Reports', subtitle: 'Plan 50/30/20 budgets, reconcile wallets, and export data' },
    { id: 'group-collaboration', label: 'Group & Messaging', subtitle: 'Members, invites, permissions, settings, and chat' },
    { id: 'account-security', label: 'Account & Security', subtitle: 'Profile, dark mode, alerts, and account safety' }
  ];

  const TUTORIALS = [
    {
      id: 'intro-to-myipon',
      category: 'getting-started',
      icon: 'spark',
      tone: 'gold',
      title: 'Welcome & Introduction to myIPON',
      summary: 'Learn what myIPON does, the difference between Solo and Group savings, and how to create or join your first workspace.',
      duration: '2 min',
      scope: 'All users',
      keywords: ['start', 'welcome', 'solo', 'group', 'join code', 'create workspace', 'beginner', 'new'],
      tryPage: 'dashboard.html',
      tryLabel: 'Go to Dashboard',
      trySelector: '#dashboard-no-group-card:not([hidden]), #dashboard-create-group',
      visual: {
        bar: 'Welcome to myIPON',
        rows: [
          '<div class="tv-row"><span class="tv-title">Choose how you save</span><span class="tv-pill is-gold">SOLO</span><span class="tv-pill is-soft">GROUP</span></div>',
          '<div class="tv-chips"><span class="tv-pill">Start solo savings</span><span class="tv-pill is-soft">+ Create savings group</span><span class="tv-pill is-soft">Join with code</span></div>',
          '<div class="tv-meta">myIPON tracks real-world cash, GCash, Maya, and bank savings — it does not hold or transfer money.</div>'
        ]
      },
      steps: [
        {
          title: 'Understand what myIPON tracks',
          body: 'myIPON is a transparent ledger and budget planner for real-world savings. Whenever you put money into cash on hand, GCash, Maya, or a bank account, you record it here so everyone (or just you) always knows the exact balance.',
          uiRefs: ['Ledger tracker only — no money is moved automatically'],
          tip: 'Think of myIPON as a smart, tamper-resistant digital notebook with automatic totals, receipts, goals, and reminders.'
        },
        {
          title: 'Choose Solo savings or Group savings',
          body: 'If you are saving by yourself, pick Solo savings (marked with a gold SOLO badge). It requires zero invitations and hides group-only screens like Members, Expenses, and Requests. If you are pooling funds with family, friends, or classmates, pick Group savings (marked with GROUP + your role badge).',
          uiRefs: ['Badge: SOLO', 'Badge: GROUP + ADMIN / MEMBER'],
          selector: '#dashboard-group-bar',
          page: 'dashboard.html'
        },
        {
          title: 'Create your first workspace or join with a code',
          body: 'On the Welcome card (or by clicking New workspace at the top of the Dashboard), select Start solo savings, Create savings group, or Join with code. Enter a workspace name (at least 2 characters), set your monthly target or contribution amount, and save.',
          uiRefs: ['Button: Start solo savings', 'Button: Create savings group', 'Button: Join with code'],
          selector: '#no-group-solo-btn, #dashboard-create-group',
          page: 'dashboard.html',
          warn: 'If a group admin gave you an invite link or 6-character code, choose Join with code instead of creating a separate group.'
        },
        {
          title: 'Confirm your workspace is ready',
          body: 'Once created or joined, your workspace name and badges appear at the top of the Dashboard, and your Tracked savings card unlocks so you can start logging entries or setting savings goals right away.',
          result: 'Your active workspace is live, synced across devices, and ready for your first savings record.'
        }
      ]
    },
    {
      id: 'dashboard-overview',
      category: 'getting-started',
      icon: 'grid',
      tone: 'emerald',
      title: 'Understanding Your Dashboard & Savings Overview',
      summary: 'Read your Tracked savings balance, wallet breakdown, monthly progress counters, target goal bar, and interactive calendar.',
      duration: '3 min',
      scope: 'Solo & Group',
      keywords: ['dashboard', 'tracked savings', 'calendar', 'wallet', 'cash', 'gcash', 'breakdown', 'pending', 'overview'],
      tryPage: 'dashboard.html',
      tryLabel: 'Inspect Dashboard',
      trySelector: '.summary-hero',
      visual: {
        bar: 'Dashboard Summary',
        rows: [
          '<div class="tv-row"><div><div class="tv-meta">Tracked savings</div><div class="tv-big">₱24,500.00</div></div><span class="tv-pill">+ Record entry</span></div>',
          '<div class="tv-chips"><span class="tv-pill is-soft">Cash on hand</span><span class="tv-pill is-blue">E-wallets &amp; bank</span><span class="tv-pill is-gold">Target progress</span></div>',
          '<div class="tv-bar"><span style="width:68%;background:#145c41"></span></div>'
        ]
      },
      steps: [
        {
          title: 'Check your Tracked savings total',
          body: 'The large amount at the top of the Dashboard shows your real confirmed savings: Confirmed Additions minus Confirmed Deductions minus Confirmed Expenses. Pending entries are never counted here until confirmed.',
          uiRefs: ['Section: Tracked savings', 'Info tip button: i'],
          selector: '.summary-hero',
          page: 'dashboard.html'
        },
        {
          title: 'Read the Cash vs. E-wallets strip',
          body: 'Right below your total, myIPON automatically splits your balance into Cash on hand and E-wallets & bank (GCash, Maya, Bank transfer). Click Reconcile anytime to verify those numbers against your real wallet.',
          uiRefs: ['Cash on hand', 'E-wallets & bank', 'Link: Reconcile'],
          selector: '#dashboard-wallet-strip:not([hidden]), .summary-hero',
          page: 'dashboard.html'
        },
        {
          title: 'Review the 4 Breakdown Tiles & Monthly Progress',
          body: 'Below the hero total, the four summary tiles break down confirmed Additions, confirmed Deductions, Expenses, and Pending (for review) amounts. Beneath them, Monthly progress shows Members, Collected this month, Paid, and Unpaid or partial counts.',
          uiRefs: ['Summary breakdown tiles', 'Button: Remind unpaid (Admin/Treasurer)'],
          selector: '.summary-breakdown',
          page: 'dashboard.html'
        },
        {
          title: 'Track your active Target Goal on the Dashboard',
          body: 'When your workspace has at least one active Savings Goal, a blue GOAL badge appears beside your workspace name and a Target Progress bar appears above the calendar. Use the Target goal dropdown to switch which goal is shown (or pick General savings).',
          uiRefs: ['Badge: GOAL', 'Dropdown: Target goal'],
          selector: '#calendar-goal-select, #mobile-calendar-goal-select',
          page: 'dashboard.html'
        },
        {
          title: 'Explore the Savings Calendar',
          body: 'Each day cell displays contributor avatars and daily activity badges. Use the left/right arrows or tap the month heading to Jump to a month. Click any day on the calendar to open the Day Detail modal and inspect or record activity for that exact date.',
          uiRefs: ['Calendar day cells', 'Button: Jump to a month'],
          selector: '.calendar-card',
          page: 'dashboard.html',
          result: 'You can see your full monthly savings pattern at a glance and open any day with one click.'
        }
      ]
    },
    {
      id: 'navigation-workspaces',
      category: 'getting-started',
      icon: 'compass',
      tone: 'blue',
      title: 'Navigating the System & Switching Workspaces',
      summary: 'Master the 5 main tabs, workspace badges, multi-workspace switcher, and where Settings and Audit Log live.',
      duration: '2 min',
      scope: 'All users',
      keywords: ['navigation', 'menu', 'tabs', 'switch group', 'switch workspace', 'badges', 'solo', 'group', 'goal'],
      tryPage: 'dashboard.html',
      tryLabel: 'Explore Navigation',
      trySelector: '.app-nav',
      visual: {
        bar: 'Workspace Header & Navigation',
        rows: [
          '<div class="tv-row"><span class="tv-title">Family Fund</span><span class="tv-pill is-soft">GROUP</span><span class="tv-pill">ADMIN</span><span class="tv-pill is-blue">GOAL</span></div>',
          '<div class="tv-chips"><span class="tv-pill is-soft">Dashboard</span><span class="tv-pill is-soft">Records</span><span class="tv-pill is-soft">Budget</span><span class="tv-pill is-soft">Members</span><span class="tv-pill is-soft">Reports</span></div>'
        ]
      },
      steps: [
        {
          title: 'Use the 5 main navigation sections',
          body: 'On desktop (left sidebar) and mobile (bottom floating dock), myIPON organizes everything into 5 core tabs: Dashboard (calendar & overview), Records (or My savings for Members), Budget (50/30/20 planner), Members (Group workspaces only), and Reports (charts, reconciliation & exports).',
          uiRefs: ['Navigation: Dashboard · Records · Budget · Members · Reports'],
          selector: '.app-nav',
          page: 'dashboard.html'
        },
        {
          title: 'Read your workspace badges at a glance',
          body: 'Next to your workspace name, badges tell you your active mode immediately: SOLO (personal tracker), GROUP paired with ADMIN / TREASURER / MEMBER (shared workspace + your role), and GOAL whenever at least one active savings goal is running.',
          uiRefs: ['SOLO', 'GROUP', 'ADMIN / MEMBER', 'GOAL'],
          selector: '#dashboard-group-bar',
          page: 'dashboard.html'
        },
        {
          title: 'Switch between multiple workspaces anytime',
          body: 'If you own a Solo tracker and also belong to one or more Savings Groups, click your workspace name (or the dropdown chevron beside it) to switch instantly. Every screen, balance, and goal list reloads cleanly for the chosen workspace.',
          uiRefs: ['Workspace switcher chevron'],
          selector: '#dashboard-group-bar .group-bar-identity',
          page: 'dashboard.html',
          tip: 'You can create as many workspaces as you need — for example, one personal Solo emergency fund plus a shared Family Travel group.'
        },
        {
          title: 'Find Messages, Notifications, Settings & Audit Log',
          body: 'Messages (chat icon) and Notifications (bell icon) stay pinned in your top bar. Tap your profile card to open My Account, where Workspace Settings and Dark Mode live. Administrators can open the Audit Log from Reports or Dashboard Manage.',
          uiRefs: ['Chat icon: Messages', 'Bell icon: Notifications', 'Profile card: My account'],
          selector: '[data-account-open]',
          page: 'dashboard.html',
          result: 'Every screen in myIPON is always 1–2 taps away on both desktop and phone.'
        }
      ]
    },
    {
      id: 'record-addition',
      category: 'managing-savings',
      icon: 'plus',
      tone: 'emerald',
      title: 'How to Record a Savings Addition',
      summary: 'Step-by-step guide to logging deposits from the Dashboard Quick Record modal, the Additions page, or Member My Savings.',
      duration: '3 min',
      scope: 'Solo & Group',
      keywords: ['addition', 'deposit', 'contribution', 'save money', 'record entry', 'receipt', 'carry over', 'excess'],
      tryPage: 'contributions.html',
      tryLabel: 'Try on Additions',
      trySelector: '#record-form',
      visual: {
        bar: 'Record Addition Form',
        rows: [
          '<div class="tv-row"><span class="tv-title">Addition</span><span class="tv-pill is-soft">For month</span><span class="tv-pill is-blue">GCash / Cash</span></div>',
          '<div class="tv-row"><span class="tv-meta">Amount (₱0.01 – ₱999,999,999,999.99)</span><span class="tv-pill">Save addition</span></div>',
          '<div class="tv-meta">Optional receipt screenshot + automatic carry-over for advance payments</div>'
        ]
      },
      steps: [
        {
          title: 'Open the Addition form (2 easy ways)',
          body: 'For the fastest entry, click + Record entry on the Dashboard and stay on the Addition tab. If you want to attach a receipt screenshot or carry excess payment forward to future months, open Records → Additions (or My savings → Submit contribution if you are a Group Member).',
          uiRefs: ['Dashboard: + Record entry', 'Records → Additions', 'Member: Submit contribution'],
          selector: '#dashboard-record-entry, #record-form',
          page: 'contributions.html'
        },
        {
          title: 'Confirm the Member and For month',
          body: 'In Solo mode or Member view, your name is selected automatically. Group Admins/Treasurers choose which member paid. Next, verify For month — this links the payment to the right monthly contribution period.',
          uiRefs: ['Field: Member', 'Field: For month'],
          selector: '#contribution-month',
          page: 'contributions.html',
          warn: 'For month cannot be set to a future month, and Date added cannot be after today.'
        },
        {
          title: 'Enter the Date added and Amount',
          body: 'Choose the actual date the money was saved and type the exact peso amount (digits and up to 2 decimal places, starting from ₱0.01). Avoid letters or currency symbols.',
          uiRefs: ['Field: Date added', 'Field: Amount'],
          selector: '#amount',
          page: 'contributions.html'
        },
        {
          title: 'Select Payment method & add optional Reference or Notes',
          body: 'Pick the wallet where the money went (Cash, GCash, Maya, Bank transfer, etc.) so Wallet Reconciliation stays accurate. If it was a digital transfer, enter the Reference number and any helpful Notes.',
          uiRefs: ['Picker: Payment method', 'Field: Reference (optional)', 'Field: Notes (optional)'],
          selector: '[data-pm-picker]',
          page: 'contributions.html',
          tip: 'Paying more than this month’s required share? Check "Apply excess payment automatically to upcoming unpaid months" on the Additions page so the leftover pays forward automatically.'
        },
        {
          title: 'Attach a Receipt screenshot (optional) & Save',
          body: 'Click Browse inside Receipt screenshot to upload a photo or e-wallet screenshot (images are automatically compressed for fast loading). Review your entries, then click Save addition (or Submit for review).',
          uiRefs: ['Upload: Receipt screenshot', 'Button: Save addition'],
          selector: '#record-form button[type="submit"]',
          page: 'contributions.html',
          result: 'Solo owners and Admins see Tracked savings and the calendar update immediately as CONFIRMED. Group Member submissions appear as PENDING until an Admin or Treasurer confirms them (unless granted Trusted Instant permission).'
        }
      ]
    },
    {
      id: 'record-deduction',
      category: 'managing-savings',
      icon: 'minus',
      tone: 'gold',
      title: 'How to Record a Savings Deduction (Withdrawal)',
      summary: 'Log cash-outs, payouts, or personal withdrawals with a required category, wallet source, and clear reason.',
      duration: '2 min',
      scope: 'Solo & Admin/Treasurer',
      keywords: ['deduction', 'withdrawal', 'withdraw', 'cash out', 'payout', 'take out', 'emergency'],
      tryPage: 'withdrawals.html',
      tryLabel: 'Try on Deductions',
      trySelector: '#record-form',
      visual: {
        bar: 'Record Deduction',
        rows: [
          '<div class="tv-row"><span class="tv-title">Deduction</span><span class="tv-pill is-gold">Emergency / Payout</span></div>',
          '<div class="tv-meta">Requires Person responsible, Date, Amount, Category, Paid from wallet, and Reason</div>'
        ]
      },
      steps: [
        {
          title: 'Open Deductions',
          body: 'Click + Record entry on the Dashboard and switch to the Deduction tab, or navigate to Records → Deductions. Use Deductions whenever money leaves the savings fund for payouts, member cash-outs, or personal withdrawals.',
          uiRefs: ['Dashboard: + Record entry → Deduction', 'Records → Deductions'],
          selector: '#record-form',
          page: 'withdrawals.html',
          tip: 'In Group workspaces, keep shared operational costs (like supplies or delivery fees) under Expenses instead of Deductions so Reports stay crystal clear.'
        },
        {
          title: 'Pick the Person responsible & Date',
          body: 'Select the member receiving or handling the funds (auto-filled in Solo mode). If that member saved a payout account (like GCash or Bank details), myIPON displays their payout destination right below the picker for convenience.',
          uiRefs: ['Field: Person responsible', 'Field: Date'],
          selector: '#responsible',
          page: 'withdrawals.html'
        },
        {
          title: 'Enter Amount, Category, and Paid from wallet',
          body: 'Type the withdrawal amount, choose or type a Category (such as Emergency use or Member payout), and select Paid from wallet (Cash, GCash, Maya, Bank transfer) so the matching wallet balance decreases accurately.',
          uiRefs: ['Field: Amount', 'Field: Category', 'Picker: Paid from wallet'],
          selector: '#category',
          page: 'withdrawals.html',
          warn: 'Picking the wrong wallet source will create a mismatch when you reconcile Cash vs. E-wallets in Reports.'
        },
        {
          title: 'Write the Reason / description & Save',
          body: 'Explain why the money was taken out in Reason / description (required so every deduction remains auditable), add optional Reference or Notes, and click Save deduction.',
          uiRefs: ['Field: Reason / description (required)', 'Button: Save deduction'],
          selector: '#record-form button[type="submit"]',
          page: 'withdrawals.html',
          result: 'Once confirmed, the deduction immediately subtracts from Tracked savings, updates the wallet balance, and appears in Deduction history and the Savings Calendar.'
        }
      ]
    },
    {
      id: 'record-expense',
      category: 'managing-savings',
      icon: 'receipt',
      tone: 'gold',
      title: 'How to Record a Group Expense',
      summary: 'Track shared group spending separately from withdrawals, complete with category presets and receipt proof.',
      duration: '2 min',
      scope: 'Group Only',
      keywords: ['expense', 'spending', 'supplies', 'receipt', 'group cost', 'paid from wallet'],
      tryPage: 'expenses.html',
      tryLabel: 'Open Group Expenses',
      trySelector: '#record-form',
      groupOnly: true,
      visual: {
        bar: 'Group Expenses Ledger',
        rows: [
          '<div class="tv-row"><span class="tv-title">Shared Expense</span><span class="tv-pill is-soft">GROUP ONLY</span></div>',
          '<div class="tv-meta">Keeps event fees, supplies, and group costs separate from member payouts</div>'
        ]
      },
      steps: [
        {
          title: 'Know when to use Group Expenses vs. Budget',
          body: 'The Expenses tab under Records is designed specifically for Group workspaces to track shared costs (supplies, event fees, deliveries). In Solo mode, Expenses is intentionally hidden because personal spending is tracked on the Budget page.',
          uiRefs: ['Records → Expenses (Group workspaces)', 'Dashboard: + Record entry → Expense'],
          tip: 'Only Group Administrators, Treasurers, or members granted Expense permission can submit expenses.'
        },
        {
          title: 'Fill out Person responsible, Date, Amount, and Category',
          body: 'Choose who handled the purchase, enter the Date and Amount, and select or type a Category (e.g., Supplies, Food, Transport).',
          uiRefs: ['Field: Person responsible', 'Field: Amount', 'Field: Category'],
          selector: '#amount',
          page: 'expenses.html'
        },
        {
          title: 'Select Paid from wallet, Description, and Receipt',
          body: 'Pick which wallet paid for the expense, write a clear Description of what was purchased, and attach an optional Receipt screenshot so every member can inspect proof.',
          uiRefs: ['Picker: Paid from wallet', 'Field: Description', 'Upload: Receipt screenshot'],
          selector: '#description',
          page: 'expenses.html'
        },
        {
          title: 'Save and verify impact',
          body: 'Click Save expense. Confirmed expenses automatically deduct from Tracked savings and appear in the Dashboard Expenses tile, Expense history, and Reports.',
          uiRefs: ['Button: Save expense'],
          selector: '#record-form button[type="submit"]',
          page: 'expenses.html',
          result: 'Your group expense is recorded transparently with optional receipt proof and separated cleanly from member payouts.'
        }
      ]
    },
    {
      id: 'savings-goals',
      category: 'managing-savings',
      icon: 'goal',
      tone: 'blue',
      title: 'How to Add, Update & Plan Savings Goals',
      summary: 'Create targets, track completion percentages, use the What-if Goal Calculator, and manage finished or binned goals.',
      duration: '3 min',
      scope: 'Solo & Group',
      keywords: ['goal', 'target', 'calculator', 'what-if', 'plan', 'mark done', 'edit goal', 'recycle bin', 'progress'],
      tryPage: 'savings.html',
      tryLabel: 'Open Savings Goals',
      trySelector: '#add-goal',
      visual: {
        bar: 'Savings Goals & What-If Calculator',
        rows: [
          '<div class="tv-row"><span class="tv-title">Emergency Fund</span><span class="tv-pill is-blue">GOAL</span></div>',
          '<div class="tv-bar"><span style="width:74%;background:#3C86A8"></span></div>',
          '<div class="tv-row"><span class="tv-meta">₱37,000 / ₱50,000</span><span class="tv-pill is-soft">74% reached</span></div>'
        ]
      },
      steps: [
        {
          title: 'Open Records → Goals',
          body: 'Go to Records in the navigation bar and click the Goals tab. At the top you will see four summary cards: Tracked savings, Active goals, Combined targets, and Nearest target date.',
          uiRefs: ['Records → Goals tab'],
          selector: '.savings-goals-panel',
          page: 'savings.html',
          tip: 'Goals guide your progress against Tracked savings — they never lock, reserve, or move your real money, and active goals never auto-expire while you keep saving.'
        },
        {
          title: 'Create a new Savings Goal',
          body: 'Click + Add goal. Fill in Goal title (2–150 characters), Target amount (₱0.01+), optional Target date, Status (keep ACTIVE for ongoing goals), and optional Notes, then click Save goal.',
          uiRefs: ['Button: + Add goal', 'Fields: Goal title · Target amount · Target date · Status'],
          selector: '#add-goal',
          page: 'savings.html'
        },
        {
          title: 'Update, complete, or archive an existing goal',
          body: 'On any goal card, click Edit goal to change its title, target amount, target date, or status. When you hit your target, click Mark done. To remove a goal safely, click Move to bin — binned goals stay recoverable in the Recycle bin for 30 days.',
          uiRefs: ['Button: Edit goal', 'Button: Mark done', 'Button: Move to bin', 'Button: Recycle bin'],
          selector: '#goal-list',
          page: 'savings.html',
          warn: 'Remember to only click "Finish & reset batch" when your entire savings cycle/season is done, because it resets active ledgers to ₱0 and moves the finished batch to the 30-day Bin.'
        },
        {
          title: 'Simulate targets with the Goal Calculator (What-if planner)',
          body: 'On the right side (or below on mobile), enter a Target amount, click Sync to pull your live Tracked savings, set a Target date, and set Split among members. myIPON instantly calculates the exact Per day, Per week, and Per month pace needed.',
          uiRefs: ['Section: Goal calculator', 'Button: Sync', 'Button: Save plan', 'Button: Create goal from plan'],
          selector: '.goal-calc-panel',
          page: 'savings.html',
          result: 'You can save multiple what-if plans without touching real funds, or click Create goal from plan to promote a plan into a real goal — activating the blue GOAL badge and Dashboard progress bar.'
        }
      ]
    },
    {
      id: 'view-history',
      category: 'records-reviews',
      icon: 'history',
      tone: 'emerald',
      title: 'How to View, Filter & Monitor Transaction History',
      summary: 'Use member spotlight charts, payment-method/status filters, receipt previews, and mobile detail sheets to inspect every entry.',
      duration: '2 min',
      scope: 'Solo & Group',
      keywords: ['history', 'transactions', 'filter', 'member spotlight', 'chart', 'receipt', 'status', 'pagination'],
      tryPage: 'contributions.html',
      tryLabel: 'Open Record History',
      trySelector: '#record-member-filter',
      visual: {
        bar: 'Transaction History & Member Spotlight',
        rows: [
          '<div class="tv-row"><span class="tv-title">Filter by member</span><span class="tv-pill is-soft">All methods</span><span class="tv-pill is-soft">CONFIRMED</span></div>',
          '<div class="tv-chips"><span class="tv-pill is-soft">Additions</span><span class="tv-pill is-gold">Pending</span><span class="tv-pill is-blue">Receipt preview</span></div>'
        ]
      },
      steps: [
        {
          title: 'Pick the record tab you want to inspect',
          body: 'Under Records, switch between Additions, Deductions, Expenses (Group only), Goals, and Requests (Group only). Group Members can also open My savings to view their personal contribution statement and export or print it.',
          uiRefs: ['Tabs: Additions · Deductions · Expenses · Goals · Requests'],
          selector: '.record-tabs',
          page: 'contributions.html'
        },
        {
          title: 'Use Filter by member to open the Member Spotlight',
          body: 'In Group workspaces, select any member in Filter by member. A spotlight card appears showing their photo, Total additions, Total deductions, Total expenses, Net standing, and a Monthly financial activity chart, while filtering the tables below to that member.',
          uiRefs: ['Dropdown: Filter by member', 'Button: View all members'],
          selector: '#record-member-filter',
          page: 'contributions.html'
        },
        {
          title: 'Filter by Month, Payment Method, and Approval Status',
          body: 'On Additions, change the Contribution status month picker to see who is Paid, Partial, Exempt, or Unpaid. In the history table below, combine All methods (Cash, GCash, Maya, Bank) and All statuses (PENDING, CONFIRMED, REJECTED, VOIDED) to narrow down exact records.',
          uiRefs: ['Dropdown: All methods', 'Dropdown: All statuses', 'Pager: Previous / Next'],
          selector: '#record-status-filter',
          page: 'contributions.html'
        },
        {
          title: 'Inspect Receipts, Discussion threads, and Mobile Details',
          body: 'Click Receipt on any entry to view the full-resolution proof photo. On mobile screens, tap View details on any compact row to open the full detail sheet with all fields and available actions.',
          uiRefs: ['Button: Receipt', 'Mobile: View details ↗'],
          selector: '#contribution-entries-body',
          page: 'contributions.html',
          result: 'Every payment, withdrawal, expense, and receipt is searchable and verifiable in seconds.'
        }
      ]
    },
    {
      id: 'edit-void-records',
      category: 'records-reviews',
      icon: 'edit',
      tone: 'gold',
      title: 'How to Edit, Void, or Request Changes to a Record',
      summary: 'Learn the audit-safe way to correct mistakes on pending entries, void confirmed transactions, or submit calendar edit requests.',
      duration: '3 min',
      scope: 'Solo & Group',
      keywords: ['edit', 'delete', 'void', 'reject', 'mistake', 'wrong amount', 'change request', 'fix transaction'],
      tryPage: 'contributions.html',
      tryLabel: 'Open Addition History',
      trySelector: '#contribution-entries-body',
      visual: {
        bar: 'Audit-Safe Record Actions',
        rows: [
          '<div class="tv-row"><span class="tv-title">PENDING row</span><span class="tv-pill is-soft">Edit</span><span class="tv-pill">Confirm</span><span class="tv-pill is-gold">Reject</span></div>',
          '<div class="tv-row"><span class="tv-title">CONFIRMED row</span><span class="tv-pill is-gold">Void with reason</span></div>'
        ]
      },
      steps: [
        {
          title: 'Understand why confirmed records are Voided instead of deleted',
          body: 'To keep your savings ledger completely trustworthy, myIPON never silently erases confirmed financial records. Instead, fixing a confirmed mistake voids it with a recorded reason so the balance updates accurately while preserving an honest audit trail.',
          uiRefs: ['Status badges: PENDING · CONFIRMED · REJECTED · VOIDED'],
          tip: 'Need to change the amount on a confirmed entry? Void the incorrect entry with a clear reason, then record the corrected entry.'
        },
        {
          title: 'Edit or Reject a PENDING entry',
          body: 'While a submission is still PENDING in Additions, Deductions, or Expenses, open the row’s Actions column (or tap View details on mobile). Click Edit to update its details before confirmation, or click Reject and enter a review note to decline it.',
          uiRefs: ['Actions: Edit · Confirm · Reject'],
          selector: '#contribution-entries-body',
          page: 'contributions.html'
        },
        {
          title: 'Void a CONFIRMED entry',
          body: 'Find the confirmed transaction in Addition history, Deduction history, or Expense history and click Void. Enter a clear reason explaining why it is being reversed (for example, "Duplicate entry" or "Wrong amount entered"), review the confirmation step, and confirm.',
          uiRefs: ['Action: Void', 'Required: Reason note'],
          selector: '#contribution-entries-body',
          page: 'contributions.html',
          warn: 'Voiding cannot be undone — double-check the date, member, and amount in the confirmation summary before proceeding.'
        },
        {
          title: 'Propose a Calendar Change Request (Group Members)',
          body: 'If you are a Group Member with edit-request access, opening a day on the Dashboard calendar and editing an entry submits a Change Request (showing old amount/method → proposed amount/method) to your Admin instead of overwriting the ledger directly.',
          uiRefs: ['Dashboard Calendar → Day Detail → Request edit'],
          selector: '.calendar-card',
          page: 'dashboard.html',
          result: 'Voided entries immediately restore Tracked savings and wallet totals while staying transparently logged in history and the Audit Log.'
        }
      ]
    },
    {
      id: 'review-requests',
      category: 'records-reviews',
      icon: 'check',
      tone: 'emerald',
      title: 'How to Review Pending Requests & Bulk Confirm',
      summary: 'Approve or reject member submissions and calendar change requests from one unified queue, or confirm multiple deposits at once.',
      duration: '3 min',
      scope: 'Group Admin / Treasurer',
      keywords: ['requests', 'pending', 'approve', 'confirm', 'reject', 'bulk confirm', 'review queue'],
      tryPage: 'requests.html',
      tryLabel: 'Open Requests Queue',
      trySelector: '#requests-main-panel',
      groupOnly: true,
      visual: {
        bar: 'Unified Requests Queue',
        rows: [
          '<div class="tv-chips"><span class="tv-pill is-gold">Pending review</span><span class="tv-pill is-soft">Change</span><span class="tv-pill">Addition</span><span class="tv-pill is-soft">Deduction</span></div>',
          '<div class="tv-meta">Filter by search, status, member, payment method, or date range</div>'
        ]
      },
      steps: [
        {
          title: 'Open Records → Requests',
          body: 'Navigate to Records and click the Requests tab. The 4 KPI cards at the top summarize Pending review, Change requests, Addition requests, and Deduction requests — clicking any KPI card filters the list immediately.',
          uiRefs: ['Records → Requests', 'Clickable KPI cards'],
          selector: '.requests-kpi-grid',
          page: 'requests.html'
        },
        {
          title: 'Filter by category, search, status, or date range',
          body: 'Use the category pills (All, Change, Addition, Deduction, Expense) alongside the Search box, Status filter, Member / Requester dropdown, Method filter, and From / To dates to find specific requests fast.',
          uiRefs: ['Category pills: All · Change · Addition · Deduction · Expense'],
          selector: '#req-type-pills',
          page: 'requests.html'
        },
        {
          title: 'Inspect proof & Approve or Reject',
          body: 'Check the member’s submitted amount, payment method, notes, and attached receipt photo (if any). Click Confirm / Approve to apply it to Tracked savings, or Reject and provide a short reason so the member receives an instant notification explaining why.',
          uiRefs: ['Actions: Receipt · Confirm / Approve · Reject'],
          selector: '#requests-main-panel',
          page: 'requests.html'
        },
        {
          title: 'Save time with Bulk Confirm for multiple additions',
          body: 'When many members pay on payday, go to Additions (or Dashboard Pending Review), check Select all pending (or pick individual rows), and click Confirm selected. All chosen deposits confirm together in one step.',
          uiRefs: ['Additions: Select all pending → Confirm selected'],
          selector: '#bulk-confirm-bar:not([hidden]), #contribution-entries-body',
          page: 'contributions.html',
          result: 'Confirmed deposits immediately update Tracked savings, member payment statuses, and notify each member automatically.'
        }
      ]
    },
    {
      id: 'budget-planner',
      category: 'budget-reports',
      icon: 'pie',
      tone: 'blue',
      title: 'How to Plan Your 50/30/20 Budget & Track Expenses',
      summary: 'Allocate Needs, Wants, and Savings from your live IPON balance, itemize spending plans, and sync Solo expenses straight to savings.',
      duration: '3 min',
      scope: 'Solo & Group',
      keywords: ['budget', '50/30/20', 'needs', 'wants', 'savings', 'customize split', 'budget expense', 'deduct from savings'],
      tryPage: 'budget.html',
      tryLabel: 'Open Budget Planner',
      trySelector: '#budget-quick-expense-btn',
      visual: {
        bar: 'Live Budget Allocation (50 / 30 / 20)',
        rows: [
          '<div class="tv-bar"><span style="width:50%;background:#1F8A66"></span><span style="width:30%;background:#C99A3B"></span><span style="width:20%;background:#3C86A8"></span></div>',
          '<div class="tv-chips"><span class="tv-pill">Needs 50%</span><span class="tv-pill is-gold">Wants 30%</span><span class="tv-pill is-blue">Savings 20%</span></div>',
          '<div class="tv-meta">Solo mode syncs deducted budget expenses directly with live Tracked savings</div>'
        ]
      },
      steps: [
        {
          title: 'Open the Budget tab',
          body: 'Click Budget in the main navigation bar. The dark emerald hero card automatically pulls your live remaining IPON balance and calculates your Needs (50%), Wants (30%), and Savings (20%) allocations.',
          uiRefs: ['Navigation: Budget', 'Hero: Live remaining IPON savings'],
          selector: '.budget-hero',
          page: 'budget.html'
        },
        {
          title: 'Customize your percentage split (optional)',
          body: 'Want a 60/20/20 or 70/20/10 split instead? Click Customize % split at the top right, adjust Needs, Wants, and Savings so they total exactly 100%, and save.',
          uiRefs: ['Button: Customize % split'],
          selector: '#budget-edit-split-btn',
          page: 'budget.html',
          warn: 'All three percentages must add up to 100% before saving.'
        },
        {
          title: 'Add itemized budget items inside each category',
          body: 'Under the Needs, Wants, and Savings category cards, click + Add item to create custom line items (like Rent, Groceries, Internet, or Leisure) with planned amounts so you can see planned vs. actual spending.',
          uiRefs: ['Category cards: Needs · Wants · Savings', 'Button: + Add item'],
          selector: '#budget-categories-grid',
          page: 'budget.html'
        },
        {
          title: 'Record a budget expense (and understand Solo vs. Group sync)',
          body: 'Click + Record expense (top right) or + Add expense (in Tracked budget expenses). Choose the category, item, date, amount, and optional note. In Solo mode, keeping "Deduct from savings" turned on automatically deducts that expense from your live Tracked savings. In Group mode, member budgets stay as personal planning trackers and never touch shared group funds.',
          uiRefs: ['Button: + Record expense', 'Toggle: Deduct from savings (Solo)'],
          selector: '#budget-quick-expense-btn',
          page: 'budget.html',
          tip: 'You can search, filter by category, edit, or delete any budget expense right inside the Tracked budget expenses table below.'
        },
        {
          title: 'Monitor Remaining budget totals',
          body: 'Watch the three summary cards — Total allocated, Total budget spent, and Remaining budget — update in real time as you log expenses.',
          uiRefs: ['Summary cards: Allocated · Spent · Remaining'],
          selector: '.budget-stats-grid',
          page: 'budget.html',
          result: 'Your budget stays synced with your savings balance and warns you clearly if spending approaches or exceeds your allocation.'
        }
      ]
    },
    {
      id: 'reports-reconciliation',
      category: 'budget-reports',
      icon: 'chart',
      tone: 'emerald',
      title: 'How to Use Reports, Wallet Reconciliation & Exports',
      summary: 'Verify real cash vs. e-wallet balances, check monthly charts and unpaid members, export CSV/PDF reports, and inspect the Audit Log.',
      duration: '3 min',
      scope: 'Solo & Group',
      keywords: ['reports', 'reconcile', 'wallet', 'variance', 'csv', 'pdf', 'print', 'remind unpaid', 'audit log', 'archive'],
      tryPage: 'reports.html',
      tryLabel: 'Open Reports',
      trySelector: '#wallet-reconciliation',
      visual: {
        bar: 'Reports & Wallet Reconciliation',
        rows: [
          '<div class="tv-row"><span class="tv-title">Expected vs. Actual count</span><span class="tv-pill is-soft">Variance ₱0.00</span></div>',
          '<div class="tv-chips"><span class="tv-pill is-soft">Export CSV</span><span class="tv-pill">Print / Save PDF</span><span class="tv-pill is-blue">Audit log</span></div>'
        ]
      },
      steps: [
        {
          title: 'Reconcile Cash on hand vs. E-wallets & bank',
          body: 'Open Reports and look at Wallet reconciliation. myIPON shows Expected balance for each channel (Cash, GCash, Maya, Bank transfer). Count your actual money and type it into the Actual count column — the Variance column immediately shows ₱0.00 if everything matches, or highlights any shortage/overage.',
          uiRefs: ['Section: Wallet reconciliation', 'Input: Actual count', 'Button: Clear counts'],
          selector: '#wallet-reconciliation',
          page: 'reports.html',
          tip: 'Reconciling once a week catches forgotten cash withdrawals or mistyped payment methods early.'
        },
        {
          title: 'Review Monthly movement chart & summary table',
          body: 'Scroll to Monthly movement and pick a Year to compare confirmed Additions, Deductions, Expenses, and Net change across all 12 months. Pending entries are excluded so totals stay exact.',
          uiRefs: ['Dropdown: Year', 'Chart: Monthly movement', 'Table: Monthly summary'],
          selector: '#report-year',
          page: 'reports.html'
        },
        {
          title: 'Check Member completion & Remind unpaid members',
          body: 'In Member completion report, select any Contribution month and optionally filter by PAID, UNPAID, PARTIALLY PAID, OVERPAID, or EXEMPT. Group Admins and Treasurers can click Remind unpaid to send an in-app and device alert to every member with an outstanding balance.',
          uiRefs: ['Filter: Contribution month', 'Button: Remind unpaid'],
          selector: '#member-report-month',
          page: 'reports.html'
        },
        {
          title: 'Export CSV, Print / Save PDF, Audit Log & Annual Archive',
          body: 'Use Export summary CSV or Export transactions CSV at the top of Reports to download spreadsheets, click Print / Save PDF for printable statements, open Audit log (Admins) to inspect before/after diffs of every system change, or archive 1+ year ledgers safely in Annual data roll-up & archive.',
          uiRefs: ['Export summary CSV', 'Export transactions CSV', 'Print / Save PDF', 'Audit log'],
          selector: '#export-csv',
          page: 'reports.html',
          result: 'You have complete financial transparency, printable records, and exact cash/e-wallet verification.'
        }
      ]
    },
    {
      id: 'members-invites-permissions',
      category: 'group-collaboration',
      icon: 'users',
      tone: 'emerald',
      title: 'How to Manage Members, Invites & Permissions',
      summary: 'Invite teammates by link, QR code, or email, approve join requests, configure member permissions, and manage the 30-day Bin.',
      duration: '3 min',
      scope: 'Group Admin',
      keywords: ['members', 'invite', 'qr code', 'join request', 'permissions', 'trusted', 'restricted', 'exempt', 'bin'],
      tryPage: 'members.html',
      tryLabel: 'Open Members',
      trySelector: '#add-member',
      groupOnly: true,
      visual: {
        bar: 'Member Directory & Permissions',
        rows: [
          '<div class="tv-row"><span class="tv-title">Quick permission presets</span><span class="tv-pill is-soft">Standard</span><span class="tv-pill">Trusted</span><span class="tv-pill is-gold">Restricted</span></div>',
          '<div class="tv-meta">Members activate officially once they sign in — historical records are never lost.</div>'
        ]
      },
      steps: [
        {
          title: 'Invite people with a code, link, QR, or email',
          body: 'From the Dashboard, click Manage → Invite members (or open Settings → Account access). Copy your shareable invite link/code or show the QR code. When someone requests to join, review and approve them under Pending join requests.',
          uiRefs: ['Dashboard: Manage → Invite', 'Settings → Account access → Pending join requests'],
          selector: '#dashboard-manage-group, #add-member',
          page: 'members.html'
        },
        {
          title: 'Add a member directly from the Member directory',
          body: 'On the Members page, click Add member. Enter First name, optional Middle name, Last name (use normal capitalization — ALL CAPS or numbers are rejected), Mobile number (09XXXXXXXXX or +639XXXXXXXXX), Date registered, Monthly contribution amount, Email, and Temporary password, then click Save member.',
          uiRefs: ['Button: Add member', 'Phone format: 09XXXXXXXXX or +639XXXXXXXXX'],
          selector: '#add-member',
          page: 'members.html',
          warn: 'A new member stays "Pending login" until they sign in for the first time — only official active members count toward active monthly totals.'
        },
        {
          title: 'Configure Member permissions with 1-click presets',
          body: 'Scroll down to Member permissions and click Edit beside a member. Choose a Quick preset — Standard (submissions require admin confirmation), Trusted (Instant) (entries confirm immediately), or Restricted — or customize individual toggles, then click Save permissions.',
          uiRefs: ['Panel: Member permissions', 'Presets: Standard · Trusted (Instant) · Restricted'],
          selector: '#member-permissions-panel',
          page: 'members.html'
        },
        {
          title: 'Deactivate, exempt, or recover members from the Bin',
          body: 'Deactivating a member stops future monthly obligations while keeping all past financial records intact. Members with zero contributions can be moved to the Bin (recoverable for 1 month via See bin). To excuse an active member for one month, mark them Exempt on Additions → Contribution status.',
          uiRefs: ['Button: See bin', 'Contribution status: Exempt toggle'],
          selector: '#see-bin',
          page: 'members.html',
          result: 'Your member roster stays accurate, permissions stay safe, and no historical contribution data is ever lost.'
        }
      ]
    },
    {
      id: 'workspace-settings',
      category: 'group-collaboration',
      icon: 'sliders',
      tone: 'gold',
      title: 'How to Configure Settings, Payment QR & Yearly Cycles',
      summary: 'Set monthly contribution defaults, upload your group payment QR code, delegate a Treasurer, or reset a finished savings cycle.',
      duration: '3 min',
      scope: 'Group Admin & All Users',
      keywords: ['settings', 'qr code', 'gcash', 'contribution default', 'deadline', 'treasurer', 'cycle', 'finish batch', 'reset'],
      tryPage: 'settings.html',
      tryLabel: 'Open Settings',
      trySelector: '#contribution-setting-form',
      visual: {
        bar: 'Workspace Settings & Cycles',
        rows: [
          '<div class="tv-chips"><span class="tv-pill is-soft">Monthly schedule</span><span class="tv-pill is-blue">Payment QR</span><span class="tv-pill is-gold">Yearly cycle reset</span></div>',
          '<div class="tv-meta">Upload your GCash/Maya/Bank QR so members always know where to send deposits.</div>'
        ]
      },
      steps: [
        {
          title: 'Open Settings from My Account or Dashboard Manage',
          body: 'Click your profile card in the sidebar to open My account, then choose Workspace settings (or click Manage → Settings on the Dashboard).',
          uiRefs: ['My account → Settings', 'Dashboard → Manage'],
          selector: '.settings-layout',
          page: 'settings.html'
        },
        {
          title: 'Set monthly Contribution defaults & deadlines',
          body: 'In Contribution default, pick the Effective month, Default amount (prefilled for new members), and Monthly deadline day (1–28 so every month has that date). Click Save schedule, then Generate periods when starting new months.',
          uiRefs: ['Panel: Contribution default', 'Buttons: Save schedule · Generate periods'],
          selector: '#contribution-setting-form',
          page: 'settings.html'
        },
        {
          title: 'Upload your Group payment QR & details',
          body: 'In Group payment QR & details, click Upload QR to attach a clear screenshot of your group’s GCash, Maya, or bank QR code. Fill in Payment channel, Account name, Account / mobile no., and optional Payment instructions, then click Save payment details.',
          uiRefs: ['Button: Upload QR', 'Button: Save payment details'],
          selector: '.payment-qr-settings-panel',
          page: 'settings.html',
          tip: 'Once saved, every member immediately sees a tap-to-zoom QR card on their My savings page so nobody sends money to the wrong account.'
        },
        {
          title: 'Toggle Contributor access, create a Treasurer, or Finish a cycle',
          body: 'Turn on "Include me as a contributor" if you are an Admin who also pays monthly shares. Need help reviewing deposits? Use Create treasurer account to delegate recording and approvals safely. When a full savings season is settled, use Savings cycle window → Finish batch & reset savings to archive the batch into the 30-day Bin and start fresh at ₱0.',
          uiRefs: ['Toggle: Include me as a contributor', 'Panel: Create treasurer account', 'Button: Finish batch & reset savings'],
          selector: '.settings-cycle-panel',
          page: 'settings.html',
          result: 'Your workspace schedule, payment instructions, team delegation, and yearly batches are organized cleanly.'
        }
      ]
    },
    {
      id: 'messages-announcements',
      category: 'group-collaboration',
      icon: 'chat',
      tone: 'blue',
      title: 'How to Use Messages, Group Chats & Announcements',
      summary: 'Chat directly with connections or workspace groups, send voice notes or files, read pinned announcements, and manage alerts.',
      duration: '2 min',
      scope: 'All users',
      keywords: ['messages', 'chat', 'group chat', 'voice note', 'reply', 'announcements', 'notifications', 'alerts'],
      tryPage: 'dashboard.html',
      tryLabel: 'Highlight Messages',
      trySelector: '[data-messages-open]',
      visual: {
        bar: 'Messages, Announcements & Alerts',
        rows: [
          '<div class="tv-row"><span class="tv-title">Workspace Chat &amp; DMs</span><span class="tv-pill">Voice · Files · Reply</span></div>',
          '<div class="tv-meta">Unread counters float cleanly in coral-red pills (capped at 99+)</div>'
        ]
      },
      steps: [
        {
          title: 'Open Messages & Connections',
          body: 'Click the speech-bubble Messages button in the top bar (or sidebar on mobile). Inside, switch between your direct conversations, workspace Group Chats, and People directory to connect with other members.',
          uiRefs: ['Button: Messages (chat icon)'],
          selector: '[data-messages-open]',
          page: 'dashboard.html'
        },
        {
          title: 'Reply, send voice notes, or share attachments',
          body: 'Type a message, swipe right on any message bubble to reply directly to it, tap the microphone button to record a voice note, or click the attachment button to share photos from your Gallery, File Manager, or Google Drive.',
          uiRefs: ['Gesture: Swipe right to reply', 'Actions: Voice note · Attachments · Shared files'],
          tip: 'Shared documents and media are neatly indexed inside the chat info drawer (voice notes are kept separate from shared files).'
        },
        {
          title: 'Read & react to Announcements on the Dashboard',
          body: 'The right-hand rail of the Dashboard displays pinned platform updates and group announcements (including images or videos). Tap any announcement to read it in full or add a reaction. Admins can post new group announcements right from the panel.',
          uiRefs: ['Dashboard right rail: Announcements'],
          selector: '.announcements-panel, .announcement-rail, aside[aria-label*="Announcement" i]',
          page: 'dashboard.html'
        },
        {
          title: 'Use the Notifications bell for instant jump links',
          body: 'Click the bell icon to inspect unread alerts. Clicking any notification opens the exact record, request, or announcement it refers to and marks it read. On Android, keep myIPON in your Recent Apps so real-time alerts arrive promptly.',
          uiRefs: ['Button: Notifications (bell icon)'],
          selector: '[data-notifications-open]',
          page: 'dashboard.html',
          result: 'Your team stays aligned with real-time chat, clear announcements, and actionable notifications.'
        }
      ]
    },
    {
      id: 'account-profile-security',
      category: 'account-security',
      icon: 'shield',
      tone: 'emerald',
      title: 'How to Customize Your Profile, Dark Mode & Security',
      summary: 'Edit your profile photo, cover, username, payout details, dark theme, profile effects, and security or bug-report tools.',
      duration: '2 min',
      scope: 'All users',
      keywords: ['account', 'profile', 'avatar', 'cover', 'username', 'dark mode', 'theme', 'password', 'bug report', 'feature request', 'sign out'],
      tryPage: 'dashboard.html',
      tryLabel: 'Highlight My Account',
      trySelector: '[data-account-open]',
      visual: {
        bar: 'My Account & Preferences',
        rows: [
          '<div class="tv-chips"><span class="tv-pill">Profile &amp; Cover</span><span class="tv-pill is-soft">Dark mode</span><span class="tv-pill is-gold">Payout details</span></div>',
          '<div class="tv-meta">Also includes Profile Effects, Connected Apps, Feature Requests, and Bug Reports</div>'
        ]
      },
      steps: [
        {
          title: 'Open My Account from your profile card',
          body: 'Click your profile avatar/name card at the bottom of the sidebar (or top-right on mobile) to open My Account from any page.',
          uiRefs: ['Profile card: My account'],
          selector: '[data-account-open]',
          page: 'dashboard.html'
        },
        {
          title: 'Update your photo, cover, username, bio & payout details',
          body: 'Tap your profile picture to upload a crisp DP, click Change cover to crop a 3:1 cover banner, set a unique @username handle (3–24 lowercase letters, numbers, or underscores), write a short bio, verify your Mobile number (09XXXXXXXXX or +639XXXXXXXXX), and optionally save your Payout account so Admins know where to send withdrawals.',
          uiRefs: ['Upload: Profile picture & Cover', 'Fields: Name · @username · Bio · Mobile · Payout'],
          tip: 'Click Save changes after editing your profile details so updates sync immediately across chats and member lists.'
        },
        {
          title: 'Switch between Warm Paper Light & Forest Dark mode',
          body: 'Open Settings → Appearance (or the Preferences section inside My Account) and toggle Dark mode on or off. Your chosen theme persists automatically across every screen and device reload.',
          uiRefs: ['Settings → Appearance → Dark mode toggle'],
          selector: '#settings-theme-dark',
          page: 'settings.html'
        },
        {
          title: 'Explore Profile Effects, Connected Apps, Feedback & Sign Out',
          body: 'Inside My Account, you can equip awarded Profile effects, add clickable social links via Connected apps, submit a Request a feature idea, or Report a bug with up to 5 screenshots. When using a shared device, sign out cleanly from Settings → Account session → Sign out.',
          uiRefs: ['Browse effects', 'Connect apps', 'Request a feature', 'Report a bug', 'Sign out'],
          result: 'Your account looks personal, matches your preferred light/dark theme, and stays secure.'
        }
      ]
    }
  ];

  let dialogEl = null;
  let bodyEl = null;
  let progressTextEl = null;
  let progressBarEl = null;
  let activeCategory = 'all';
  let searchQuery = '';
  let activeTutorialId = null;
  let activeStepIndex = 0;

  let spotlightState = null;
  let spotlightRingEl = null;
  let spotlightCardEl = null;
  let spotlightResizeHandler = null;
  let spotlightKeyHandler = null;

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function currentUserKey() {
    try {
      const uid = window.Ipon?.getCurrentUserId?.()
        || sessionStorage.getItem('ipon_active_user_id')
        || localStorage.getItem('ipon_active_user_id')
        || 'guest';
      return `${STORAGE_PREFIX}${uid}`;
    } catch {
      return `${STORAGE_PREFIX}guest`;
    }
  }

  function readProgress() {
    const empty = { completed: [], steps: {} };
    try {
      const raw = localStorage.getItem(currentUserKey());
      if (!raw) return empty;
      const parsed = JSON.parse(raw);
      return {
        completed: Array.isArray(parsed?.completed) ? [...new Set(parsed.completed)] : [],
        steps: parsed?.steps && typeof parsed.steps === 'object' ? parsed.steps : {}
      };
    } catch {
      return empty;
    }
  }

  function writeProgress(progress) {
    try {
      localStorage.setItem(currentUserKey(), JSON.stringify(progress));
    } catch { /* ignore storage quota */ }
  }

  function markStepVisited(tutorialId, stepIndex) {
    const prog = readProgress();
    const list = Array.isArray(prog.steps[tutorialId]) ? new Set(prog.steps[tutorialId]) : new Set();
    list.add(stepIndex);
    prog.steps[tutorialId] = [...list].sort((a, b) => a - b);
    writeProgress(prog);
    return prog;
  }

  function setTutorialCompleted(tutorialId, done = true) {
    const prog = readProgress();
    const set = new Set(prog.completed);
    if (done) {
      set.add(tutorialId);
      const tut = TUTORIALS.find((t) => t.id === tutorialId);
      if (tut) {
        prog.steps[tutorialId] = tut.steps.map((_, idx) => idx);
      }
    } else {
      set.delete(tutorialId);
    }
    prog.completed = [...set];
    writeProgress(prog);
    return prog;
  }

  function getWorkspaceContext() {
    const domMode = document.documentElement?.dataset?.workspaceMode;
    let savedMode = '';
    let savedRole = '';
    try {
      savedMode = sessionStorage.getItem('ipon_workspace_mode') || localStorage.getItem('ipon_workspace_mode') || '';
      savedRole = sessionStorage.getItem('ipon_active_role') || localStorage.getItem('ipon_active_role') || '';
    } catch { /* ignore */ }
    const mode = (domMode || savedMode || 'GROUP').toUpperCase() === 'SOLO' ? 'SOLO' : 'GROUP';
    const role = (savedRole || 'ADMIN').toUpperCase();
    const page = document.body?.dataset?.page || '';
    return { mode, role, page };
  }

  function currentPageFile() {
    const file = (location.pathname.split('/').pop() || 'dashboard.html').toLowerCase();
    return file || 'dashboard.html';
  }

  function findTutorial(id) {
    return TUTORIALS.find((t) => t.id === id) || null;
  }

  function getCategoryLabel(catId) {
    return CATEGORIES.find((c) => c.id === catId)?.label || 'Guide';
  }

  function filterTutorials(query, category) {
    const q = String(query || '').trim().toLowerCase();
    return TUTORIALS.filter((t) => {
      if (category && category !== 'all' && t.category !== category) return false;
      if (!q) return true;
      const haystack = [
        t.title,
        t.summary,
        t.scope,
        getCategoryLabel(t.category),
        ...(t.keywords || []),
        ...t.steps.map((s) => `${s.title} ${s.body} ${(s.uiRefs || []).join(' ')}`)
      ].join(' ').toLowerCase();
      return haystack.includes(q);
    });
  }

  function getRecommendedTutorialId() {
    const { mode, role, page } = getWorkspaceContext();
    const prog = readProgress();
    const noGroupCard = document.getElementById('dashboard-no-group-card');
    if (noGroupCard && !noGroupCard.hidden && !prog.completed.includes('intro-to-myipon')) {
      return 'intro-to-myipon';
    }
    const pageHints = {
      budget: 'budget-planner',
      savings: 'savings-goals',
      contributions: 'record-addition',
      withdrawals: 'record-deduction',
      expenses: 'record-expense',
      requests: 'review-requests',
      members: 'members-invites-permissions',
      reports: 'reports-reconciliation',
      settings: 'workspace-settings',
      user: 'record-addition'
    };
    if (pageHints[page] && !prog.completed.includes(pageHints[page])) {
      return pageHints[page];
    }
    const firstUnfinished = TUTORIALS.find((t) => {
      if (mode === 'SOLO' && t.groupOnly) return false;
      if (role === 'MEMBER' && t.id === 'members-invites-permissions') return false;
      return !prog.completed.includes(t.id);
    });
    return firstUnfinished?.id || 'intro-to-myipon';
  }

  function updateHeaderProgress() {
    if (!progressTextEl || !progressBarEl) return;
    const prog = readProgress();
    const done = prog.completed.filter((id) => TUTORIALS.some((t) => t.id === id)).length;
    const total = TUTORIALS.length;
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    progressTextEl.textContent = `${done} / ${total} completed`;
    progressBarEl.style.width = `${pct}%`;
  }

  function ensureDialog() {
    if (dialogEl && document.body.contains(dialogEl)) return dialogEl;
    dialogEl = document.createElement('dialog');
    dialogEl.className = 'tutorial-dialog';
    dialogEl.id = 'ipon-tutorial-dialog';
    dialogEl.setAttribute('aria-labelledby', 'ipon-tutorial-title');
    dialogEl.innerHTML = `
      <div class="tutorial-shell">
        <header class="tutorial-header">
          <div class="tutorial-header-left">
            <span class="tutorial-header-emblem" aria-hidden="true">${ICONS.book}</span>
            <div class="tutorial-header-copy">
              <span class="tutorial-eyebrow">Interactive Learning Center</span>
              <h2 id="ipon-tutorial-title">How to use myIPON</h2>
            </div>
          </div>
          <div class="tutorial-header-right">
            <span class="tutorial-overall-pill" title="Your completed tutorials">
              <span id="ipon-tutorial-progress-text">0 / ${TUTORIALS.length} completed</span>
              <span class="tutorial-overall-bar" aria-hidden="true"><i id="ipon-tutorial-progress-bar" style="width:0%"></i></span>
            </span>
            <button class="tutorial-close-btn" type="button" data-tutorial-close aria-label="Close tutorial center">
              ${ICONS.close}
            </button>
          </div>
        </header>
        <div class="tutorial-body" id="ipon-tutorial-body"></div>
      </div>
    `;
    document.body.appendChild(dialogEl);
    bodyEl = dialogEl.querySelector('#ipon-tutorial-body');
    progressTextEl = dialogEl.querySelector('#ipon-tutorial-progress-text');
    progressBarEl = dialogEl.querySelector('#ipon-tutorial-progress-bar');

    dialogEl.addEventListener('click', (event) => {
      if (event.target === dialogEl) {
        dialogEl.close();
        return;
      }
      const closeBtn = event.target.closest('[data-tutorial-close]');
      if (closeBtn) {
        dialogEl.close();
        return;
      }
      const catBtn = event.target.closest('[data-tut-cat]');
      if (catBtn) {
        activeCategory = catBtn.dataset.tutCat || 'all';
        renderLibrary();
        return;
      }
      const clearSearchBtn = event.target.closest('[data-tut-clear-search]');
      if (clearSearchBtn) {
        searchQuery = '';
        activeCategory = 'all';
        renderLibrary();
        bodyEl?.querySelector('#ipon-tutorial-search')?.focus();
        return;
      }
      const openCard = event.target.closest('[data-tut-open]');
      if (openCard) {
        openTutorialDetail(openCard.dataset.tutOpen, 0);
        return;
      }
      const backBtn = event.target.closest('[data-tut-back]');
      if (backBtn) {
        activeTutorialId = null;
        renderLibrary();
        return;
      }
      const stepDot = event.target.closest('[data-tut-step]');
      if (stepDot) {
        const idx = Number(stepDot.dataset.tutStep);
        if (Number.isFinite(idx)) selectStep(idx, { scrollCard: true });
        return;
      }
      const stepHead = event.target.closest('[data-tut-step-card]');
      if (stepHead && !event.target.closest('button')) {
        const idx = Number(stepHead.dataset.tutStepCard);
        if (Number.isFinite(idx)) selectStep(idx, { scrollCard: false });
        return;
      }
      const prevStepBtn = event.target.closest('[data-tut-prev-step]');
      if (prevStepBtn) {
        selectStep(Math.max(0, activeStepIndex - 1), { scrollCard: true });
        return;
      }
      const nextStepBtn = event.target.closest('[data-tut-next-step]');
      if (nextStepBtn) {
        const tut = findTutorial(activeTutorialId);
        if (!tut) return;
        if (activeStepIndex < tut.steps.length - 1) {
          selectStep(activeStepIndex + 1, { scrollCard: true });
        } else {
          setTutorialCompleted(tut.id, true);
          renderDetail(tut, { scrollCard: false });
        }
        return;
      }
      const toggleDoneBtn = event.target.closest('[data-tut-toggle-done]');
      if (toggleDoneBtn) {
        const tut = findTutorial(activeTutorialId);
        if (!tut) return;
        const prog = readProgress();
        const isDone = prog.completed.includes(tut.id);
        setTutorialCompleted(tut.id, !isDone);
        renderDetail(tut, { scrollCard: false });
        return;
      }
      const tryBtn = event.target.closest('[data-tut-try]');
      if (tryBtn) {
        const tutId = tryBtn.dataset.tutTry || activeTutorialId;
        const stepIdx = tryBtn.dataset.tutTryStep !== undefined ? Number(tryBtn.dataset.tutTryStep) : -1;
        launchTryItNow(tutId, Number.isFinite(stepIdx) ? stepIdx : -1);
      }
    });

    dialogEl.addEventListener('input', (event) => {
      const searchInput = event.target.closest('#ipon-tutorial-search');
      if (searchInput) {
        searchQuery = searchInput.value;
        renderLibrary({ preserveSearchFocus: true });
      }
    });

    return dialogEl;
  }

  function renderLibrary({ preserveSearchFocus = false } = {}) {
    if (!bodyEl) return;
    updateHeaderProgress();
    const prog = readProgress();
    const ctx = getWorkspaceContext();
    const allSearchMatches = filterTutorials(searchQuery, 'all');
    const visible = filterTutorials(searchQuery, activeCategory);
    const recId = getRecommendedTutorialId();
    const recTut = findTutorial(recId);

    const catCounts = new Map();
    catCounts.set('all', allSearchMatches.length);
    CATEGORIES.forEach((cat) => {
      catCounts.set(cat.id, allSearchMatches.filter((t) => t.category === cat.id).length);
    });

    const contextText = ctx.mode === 'SOLO'
      ? 'Solo Savings workspace'
      : `Group workspace · ${ctx.role}`;

    const groupedHtml = visible.length
      ? CATEGORIES.map((cat) => {
        const items = visible.filter((t) => t.category === cat.id);
        if (!items.length) return '';
        return `
          <section class="tutorial-section-group" aria-label="${escapeHtml(cat.label)}">
            <div class="tutorial-section-head">
              <h3>${escapeHtml(cat.label)}</h3>
              <span>${escapeHtml(cat.subtitle)}</span>
            </div>
            <div class="tutorial-card-grid">
              ${items.map((t) => {
                const isDone = prog.completed.includes(t.id);
                const visitedCount = Array.isArray(prog.steps[t.id]) ? prog.steps[t.id].length : 0;
                const statusClass = isDone ? 'is-done' : (visitedCount > 0 ? 'is-in-progress' : 'is-new');
                const statusLabel = isDone
                  ? '✓ Completed'
                  : (visitedCount > 0 ? `${visitedCount}/${t.steps.length} steps` : `${t.steps.length} steps`);
                const iconTone = t.tone === 'gold' ? ' is-gold' : (t.tone === 'blue' ? ' is-blue' : '');
                return `
                  <button class="tutorial-card${isDone ? ' is-completed' : ''}" type="button" data-tut-open="${escapeHtml(t.id)}">
                    <div class="tutorial-card-top">
                      <span class="tutorial-card-icon${iconTone}" aria-hidden="true">${ICONS[t.icon] || ICONS.book}</span>
                      <span class="tutorial-card-status ${statusClass}">${escapeHtml(statusLabel)}</span>
                    </div>
                    <h4>${escapeHtml(t.title)}</h4>
                    <p>${escapeHtml(t.summary)}</p>
                    <div class="tutorial-card-foot">
                      <span class="tutorial-card-meta">
                        <span class="tutorial-scope-tag">${escapeHtml(t.scope)}</span>
                        <span>${escapeHtml(t.duration)}</span>
                      </span>
                      <span class="tutorial-card-cta">Start guide →</span>
                    </div>
                  </button>
                `;
              }).join('')}
            </div>
          </section>
        `;
      }).join('')
      : `
        <div class="empty-state">
          <h3>No matching tutorials found</h3>
          <p>Try a simpler keyword like "addition", "goal", "budget", "void", or "QR code".</p>
          <button class="button button-secondary" type="button" data-tut-clear-search style="margin-top:12px;">Reset search &amp; filters</button>
        </div>
      `;

    const quickstartHtml = !searchQuery && activeCategory === 'all' && recTut
      ? `
        <div class="tutorial-quickstart-strip">
          <div class="tutorial-quickstart-copy">
            <strong>Recommended next guide: ${escapeHtml(recTut.title)}</strong>
            <small>${escapeHtml(recTut.summary)}</small>
          </div>
          <button class="button button-primary button-sm" type="button" data-tut-open="${escapeHtml(recTut.id)}">Open guide →</button>
        </div>
      `
      : '';

    const selectionStart = preserveSearchFocus ? bodyEl.querySelector('#ipon-tutorial-search')?.selectionStart : null;
    bodyEl.innerHTML = `
      <div class="tutorial-library-controls">
        <div class="tutorial-search-row">
          <div class="tutorial-search-wrap">
            <span class="tutorial-search-icon" aria-hidden="true">${ICONS.search}</span>
            <input id="ipon-tutorial-search" class="tutorial-search-input" type="search" value="${escapeHtml(searchQuery)}" placeholder="Search tutorials (e.g., record addition, budget, void, QR code, goal)…" aria-label="Search tutorials" autocomplete="off">
            <button class="tutorial-search-clear" type="button" data-tut-clear-search aria-label="Clear search"${searchQuery ? '' : ' hidden'}>${ICONS.close}</button>
          </div>
          <span class="tutorial-context-pill" title="Current active workspace">
            <i class="tutorial-context-dot" aria-hidden="true"></i>
            <span>${escapeHtml(contextText)}</span>
          </span>
        </div>
        <div class="tutorial-cat-pills" role="tablist" aria-label="Filter tutorials by category">
          <button class="tutorial-cat-pill${activeCategory === 'all' ? ' is-active' : ''}" type="button" role="tab" aria-selected="${activeCategory === 'all'}" data-tut-cat="all">All guides <b>${catCounts.get('all') || 0}</b></button>
          ${CATEGORIES.map((cat) => `
            <button class="tutorial-cat-pill${activeCategory === cat.id ? ' is-active' : ''}" type="button" role="tab" aria-selected="${activeCategory === cat.id}" data-tut-cat="${escapeHtml(cat.id)}">${escapeHtml(cat.label)} <b>${catCounts.get(cat.id) || 0}</b></button>
          `).join('')}
        </div>
      </div>
      ${quickstartHtml}
      ${groupedHtml}
    `;

    if (preserveSearchFocus) {
      const input = bodyEl.querySelector('#ipon-tutorial-search');
      if (input) {
        input.focus();
        if (typeof selectionStart === 'number') {
          try { input.setSelectionRange(selectionStart, selectionStart); } catch { /* ignore */ }
        }
      }
    } else {
      bodyEl.scrollTop = 0;
    }
  }

  function openTutorialDetail(tutorialId, stepIndex = 0) {
    const tut = findTutorial(tutorialId);
    if (!tut) {
      renderLibrary();
      return;
    }
    activeTutorialId = tut.id;
    activeStepIndex = Math.max(0, Math.min(stepIndex, tut.steps.length - 1));
    markStepVisited(tut.id, activeStepIndex);
    renderDetail(tut, { scrollCard: false });
    if (bodyEl) bodyEl.scrollTop = 0;
  }

  function selectStep(stepIndex, { scrollCard = false } = {}) {
    const tut = findTutorial(activeTutorialId);
    if (!tut) return;
    activeStepIndex = Math.max(0, Math.min(stepIndex, tut.steps.length - 1));
    markStepVisited(tut.id, activeStepIndex);
    renderDetail(tut, { scrollCard });
  }

  function renderDetail(tut, { scrollCard = false } = {}) {
    if (!bodyEl || !tut) return;
    updateHeaderProgress();
    const prog = readProgress();
    const isDone = prog.completed.includes(tut.id);
    const visited = new Set(Array.isArray(prog.steps[tut.id]) ? prog.steps[tut.id] : [activeStepIndex]);
    const totalSteps = tut.steps.length;
    const stepPct = Math.round(((activeStepIndex + 1) / totalSteps) * 100);

    const tutIndex = TUTORIALS.findIndex((t) => t.id === tut.id);
    const prevTut = tutIndex > 0 ? TUTORIALS[tutIndex - 1] : null;
    const nextTut = tutIndex >= 0 && tutIndex < TUTORIALS.length - 1 ? TUTORIALS[tutIndex + 1] : null;
    const { mode } = getWorkspaceContext();
    const soloNotice = mode === 'SOLO' && tut.groupOnly
      ? '<div class="tutorial-callout is-warn" style="margin-bottom:14px;"><span><strong>Group workspace feature:</strong> You are currently in a Solo Savings workspace. Create or switch to a Group workspace to use this feature live.</span></div>'
      : '';

    const isLastStep = activeStepIndex === totalSteps - 1;

    bodyEl.innerHTML = `
      <div class="tutorial-detail-top">
        <button class="tutorial-back-btn" type="button" data-tut-back>
          ${ICONS.back}
          <span>Back to tutorial library</span>
        </button>
        <div class="tutorial-detail-actions">
          <button class="button button-secondary button-sm" type="button" data-tut-toggle-done>
            ${isDone ? '✓ Completed (undo)' : 'Mark as complete'}
          </button>
          <button class="button button-primary button-sm" type="button" data-tut-try="${escapeHtml(tut.id)}">
            ${escapeHtml(tut.tryLabel || 'Try it now')} →
          </button>
        </div>
      </div>

      ${soloNotice}

      <section class="tutorial-hero-card">
        <div class="tutorial-hero-copy">
          <div class="tutorial-hero-badges">
            <span class="tutorial-hero-badge">${escapeHtml(getCategoryLabel(tut.category))}</span>
            <span class="tutorial-hero-badge is-gold">${escapeHtml(tut.scope)} · ${escapeHtml(tut.duration)}</span>
            ${isDone ? '<span class="tutorial-hero-badge is-done">✓ Completed</span>' : ''}
          </div>
          <h3>${escapeHtml(tut.title)}</h3>
          <p>${escapeHtml(tut.summary)}</p>
          <div class="tutorial-hero-cta-row">
            <button class="button button-primary" type="button" data-tut-try="${escapeHtml(tut.id)}">Try it now →</button>
            <button class="button button-secondary" type="button" data-tut-step="${activeStepIndex}">Step ${activeStepIndex + 1} of ${totalSteps}</button>
          </div>
        </div>
        <div class="tutorial-visual-frame" aria-hidden="true">
          <div class="tutorial-visual-bar">
            <span>${escapeHtml(tut.visual?.bar || 'Interface preview')}</span>
            <span class="tutorial-visual-dots"><i></i><i></i><i></i></span>
          </div>
          <div class="tutorial-visual-body">
            ${(tut.visual?.rows || []).join('')}
          </div>
        </div>
      </section>

      <div class="tutorial-progress-strip" aria-label="Step progress">
        <span class="tutorial-progress-copy">Step ${activeStepIndex + 1} of ${totalSteps}</span>
        <div class="tutorial-step-bar-track" aria-hidden="true">
          <div class="tutorial-step-bar-fill" style="width:${stepPct}%"></div>
        </div>
        <div class="tutorial-step-jump-pills">
          ${tut.steps.map((s, idx) => {
            const cls = idx === activeStepIndex ? ' is-current' : (visited.has(idx) ? ' is-visited' : '');
            return `<button class="tutorial-step-dot${cls}" type="button" data-tut-step="${idx}" aria-label="Jump to step ${idx + 1}: ${escapeHtml(s.title)}">${idx + 1}</button>`;
          }).join('')}
        </div>
      </div>

      <div class="tutorial-steps-list">
        ${tut.steps.map((step, idx) => {
          const isActive = idx === activeStepIndex;
          const isVisited = visited.has(idx);
          const canHighlight = Boolean(step.selector);
          const samePage = !step.page || step.page.toLowerCase() === currentPageFile();
          return `
            <article class="tutorial-step-card${isActive ? ' is-active' : ''}${isVisited ? ' is-visited' : ''}" id="ipon-tut-step-card-${idx}">
              <div class="tutorial-step-head" data-tut-step-card="${idx}">
                <span class="tutorial-step-num" aria-hidden="true">${isVisited && !isActive ? '✓' : (idx + 1)}</span>
                <div class="tutorial-step-main">
                  <h4>${escapeHtml(step.title)}</h4>
                  <p>${escapeHtml(step.body)}</p>
                  ${Array.isArray(step.uiRefs) && step.uiRefs.length ? `
                    <div class="tutorial-step-tags">
                      ${step.uiRefs.map((ref) => `<span class="tutorial-ui-ref">${escapeHtml(ref)}</span>`).join('')}
                    </div>
                  ` : ''}
                  ${(step.tip || step.warn || step.result) ? `
                    <div class="tutorial-callouts">
                      ${step.tip ? `<div class="tutorial-callout is-tip"><span><strong>Tip:</strong> ${escapeHtml(step.tip)}</span></div>` : ''}
                      ${step.warn ? `<div class="tutorial-callout is-warn"><span><strong>Avoid this mistake:</strong> ${escapeHtml(step.warn)}</span></div>` : ''}
                      ${step.result ? `<div class="tutorial-callout is-result"><span><strong>Expected result:</strong> ${escapeHtml(step.result)}</span></div>` : ''}
                    </div>
                  ` : ''}
                  ${isActive ? `
                    <div class="tutorial-step-inline-actions">
                      <div class="tutorial-nav-group">
                        <button class="button button-secondary button-sm" type="button" data-tut-prev-step${idx === 0 ? ' disabled' : ''}>← Previous step</button>
                        <button class="button button-primary button-sm" type="button" data-tut-next-step>${isLastStep ? (isDone ? '✓ Tutorial completed' : 'Finish tutorial ✓') : 'Next step →'}</button>
                      </div>
                      ${canHighlight ? `<button class="button button-secondary button-sm" type="button" data-tut-try="${escapeHtml(tut.id)}" data-tut-try-step="${idx}">${samePage ? 'Highlight on screen' : 'Go & highlight →'}</button>` : ''}
                    </div>
                  ` : ''}
                </div>
              </div>
            </article>
          `;
        }).join('')}
      </div>

      ${isDone ? `
        <div class="tutorial-complete-banner" role="status">
          <div>
            <strong>✓ You completed "${escapeHtml(tut.title)}"</strong>
            <p>Ready to put it into practice, or jump into the next guide below?</p>
          </div>
          <button class="button button-primary button-sm" type="button" data-tut-try="${escapeHtml(tut.id)}">${escapeHtml(tut.tryLabel || 'Try it now')} →</button>
        </div>
      ` : ''}

      <footer class="tutorial-detail-footer">
        <div class="tutorial-nav-group">
          <button class="button button-secondary" type="button" data-tut-back>← All tutorials</button>
        </div>
        <div class="tutorial-nav-group">
          ${prevTut ? `<button class="button button-secondary" type="button" data-tut-open="${escapeHtml(prevTut.id)}">← Previous: ${escapeHtml(prevTut.title.length > 26 ? `${prevTut.title.slice(0, 24)}…` : prevTut.title)}</button>` : ''}
          ${nextTut ? `<button class="button button-primary" type="button" data-tut-open="${escapeHtml(nextTut.id)}">Next: ${escapeHtml(nextTut.title.length > 26 ? `${nextTut.title.slice(0, 24)}…` : nextTut.title)} →</button>` : ''}
        </div>
      </footer>
    `;

    if (scrollCard) {
      const card = bodyEl.querySelector(`#ipon-tut-step-card-${activeStepIndex}`);
      card?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
    }
  }

  /* Interactive Live Spotlight Engine */
  function findVisibleTarget(selectorList) {
    if (!selectorList) return null;
    const selectors = String(selectorList).split(',').map((s) => s.trim()).filter(Boolean);
    for (const sel of selectors) {
      let candidates = [];
      try {
        candidates = [...document.querySelectorAll(sel)];
      } catch {
        continue;
      }
      for (const el of candidates) {
        if (!el || el.hidden) continue;
        const style = window.getComputedStyle ? window.getComputedStyle(el) : null;
        if (style && (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0)) continue;
        const rect = el.getBoundingClientRect?.();
        if (rect && rect.width > 0 && rect.height > 0) return el;
      }
    }
    return null;
  }

  function clearSpotlight() {
    if (spotlightRingEl) {
      spotlightRingEl.remove();
      spotlightRingEl = null;
    }
    if (spotlightCardEl) {
      spotlightCardEl.remove();
      spotlightCardEl = null;
    }
    if (spotlightResizeHandler) {
      window.removeEventListener('resize', spotlightResizeHandler);
      window.removeEventListener('scroll', spotlightResizeHandler, true);
      spotlightResizeHandler = null;
    }
    if (spotlightKeyHandler) {
      document.removeEventListener('keydown', spotlightKeyHandler);
      spotlightKeyHandler = null;
    }
    spotlightState = null;
  }

  function positionSpotlight(targetEl) {
    if (!targetEl || !spotlightRingEl || !spotlightCardEl) return;
    const rect = targetEl.getBoundingClientRect();
    const pad = 6;
    const top = Math.max(4, rect.top - pad);
    const left = Math.max(4, rect.left - pad);
    const width = Math.min(window.innerWidth - left - 4, rect.width + pad * 2);
    const height = Math.max(24, rect.height + pad * 2);

    spotlightRingEl.style.top = `${top}px`;
    spotlightRingEl.style.left = `${left}px`;
    spotlightRingEl.style.width = `${width}px`;
    spotlightRingEl.style.height = `${height}px`;

    const cardRect = spotlightCardEl.getBoundingClientRect();
    const cardW = cardRect.width || 340;
    const cardH = cardRect.height || 170;
    const spaceBelow = window.innerHeight - (top + height);
    let cardTop = spaceBelow >= cardH + 18 ? (top + height + 12) : Math.max(12, top - cardH - 12);
    if (cardTop + cardH > window.innerHeight - 12) {
      cardTop = Math.max(12, window.innerHeight - cardH - 12);
    }
    let cardLeft = Math.min(Math.max(12, left), window.innerWidth - cardW - 12);
    spotlightCardEl.style.top = `${cardTop}px`;
    spotlightCardEl.style.left = `${cardLeft}px`;
  }

  function showSpotlight(tutorialId, stepIndex = -1) {
    clearSpotlight();
    const tut = findTutorial(tutorialId);
    if (!tut) return false;
    const page = currentPageFile();
    const pageSteps = tut.steps
      .map((step, idx) => ({ step, idx }))
      .filter(({ step }) => Boolean(step.selector) && (!step.page || step.page.toLowerCase() === page));

    let chosenIndex = -1;
    let targetEl = null;

    if (stepIndex >= 0 && tut.steps[stepIndex]?.selector) {
      targetEl = findVisibleTarget(tut.steps[stepIndex].selector);
      if (targetEl) chosenIndex = stepIndex;
    }
    if (!targetEl && pageSteps.length) {
      for (const entry of pageSteps) {
        const el = findVisibleTarget(entry.step.selector);
        if (el) {
          targetEl = el;
          chosenIndex = entry.idx;
          break;
        }
      }
    }
    if (!targetEl && tut.trySelector) {
      targetEl = findVisibleTarget(tut.trySelector);
      chosenIndex = Math.max(0, stepIndex);
    }
    if (!targetEl) {
      const { mode } = getWorkspaceContext();
      if (mode === 'SOLO' && tut.groupOnly) {
        window.Ipon?.toast?.('Switch to or create a Group workspace to try this feature live.');
      } else {
        window.Ipon?.toast?.('Feature area opened. Follow the steps in the Tutorial guide anytime.');
      }
      return false;
    }

    spotlightState = { tutorialId: tut.id, stepIndex: chosenIndex, pageSteps };
    targetEl.scrollIntoView?.({ behavior: 'smooth', block: 'center', inline: 'nearest' });

    spotlightRingEl = document.createElement('div');
    spotlightRingEl.className = 'tutorial-spotlight-ring';
    spotlightRingEl.setAttribute('aria-hidden', 'true');

    const stepObj = tut.steps[chosenIndex] || tut.steps[0];
    const currentPos = pageSteps.findIndex((p) => p.idx === chosenIndex);
    const hasPrevStop = currentPos > 0;
    const hasNextStop = currentPos >= 0 && currentPos < pageSteps.length - 1;

    spotlightCardEl = document.createElement('aside');
    spotlightCardEl.className = 'tutorial-coachmark';
    spotlightCardEl.setAttribute('role', 'dialog');
    spotlightCardEl.setAttribute('aria-label', `Guided highlight: ${stepObj.title}`);
    spotlightCardEl.innerHTML = `
      <div class="tutorial-coachmark-head">
        <span class="tutorial-coachmark-eyebrow">Step ${chosenIndex + 1} of ${tut.steps.length} · ${escapeHtml(tut.title)}</span>
        <button class="tutorial-coachmark-close" type="button" data-spot-close aria-label="Close spotlight">${ICONS.close}</button>
      </div>
      <h4>${escapeHtml(stepObj.title)}</h4>
      <p>${escapeHtml(stepObj.body)}</p>
      <div class="tutorial-coachmark-actions">
        <button class="tutorial-coachmark-btn" type="button" data-spot-guide>Back to guide</button>
        <div style="display:flex;gap:6px;">
          ${hasPrevStop ? '<button class="tutorial-coachmark-btn" type="button" data-spot-prev>← Prev</button>' : ''}
          ${hasNextStop ? '<button class="tutorial-coachmark-btn is-gold" type="button" data-spot-next>Next highlight →</button>' : '<button class="tutorial-coachmark-btn is-gold" type="button" data-spot-close>Got it ✓</button>'}
        </div>
      </div>
    `;

    document.body.appendChild(spotlightRingEl);
    document.body.appendChild(spotlightCardEl);

    spotlightCardEl.addEventListener('click', (event) => {
      if (event.target.closest('[data-spot-close]')) {
        clearSpotlight();
        return;
      }
      if (event.target.closest('[data-spot-guide]')) {
        const savedId = spotlightState?.tutorialId;
        const savedStep = spotlightState?.stepIndex ?? 0;
        clearSpotlight();
        open(savedId, savedStep);
        return;
      }
      if (event.target.closest('[data-spot-prev]') && spotlightState) {
        const idx = spotlightState.pageSteps.findIndex((p) => p.idx === spotlightState.stepIndex);
        if (idx > 0) showSpotlight(spotlightState.tutorialId, spotlightState.pageSteps[idx - 1].idx);
        return;
      }
      if (event.target.closest('[data-spot-next]') && spotlightState) {
        const idx = spotlightState.pageSteps.findIndex((p) => p.idx === spotlightState.stepIndex);
        if (idx >= 0 && idx < spotlightState.pageSteps.length - 1) {
          showSpotlight(spotlightState.tutorialId, spotlightState.pageSteps[idx + 1].idx);
        }
      }
    });

    spotlightResizeHandler = () => {
      if (!document.body.contains(targetEl)) {
        clearSpotlight();
        return;
      }
      positionSpotlight(targetEl);
    };
    window.addEventListener('resize', spotlightResizeHandler);
    window.addEventListener('scroll', spotlightResizeHandler, true);

    spotlightKeyHandler = (event) => {
      if (event.key === 'Escape') clearSpotlight();
    };
    document.addEventListener('keydown', spotlightKeyHandler);

    positionSpotlight(targetEl);
    setTimeout(() => positionSpotlight(targetEl), 260);
    return true;
  }

  function launchTryItNow(tutorialId, stepIndex = -1) {
    const tut = findTutorial(tutorialId);
    if (!tut) return;
    const { mode } = getWorkspaceContext();
    if (mode === 'SOLO' && tut.groupOnly) {
      window.Ipon?.toast?.('This feature is for Group workspaces. Switch to or create a Group workspace to try it.');
      return;
    }
    const targetPage = (stepIndex >= 0 && tut.steps[stepIndex]?.page) || tut.tryPage || 'dashboard.html';
    if (dialogEl?.open) dialogEl.close();
    if (targetPage.toLowerCase() === currentPageFile()) {
      showSpotlight(tut.id, stepIndex);
      return;
    }
    try {
      sessionStorage.setItem(HANDOFF_KEY, JSON.stringify({
        tutorialId: tut.id,
        stepIndex,
        targetPage: targetPage.toLowerCase(),
        ts: Date.now()
      }));
    } catch { /* ignore */ }
    window.location.href = targetPage;
  }

  function consumePendingSpotlightHandoff() {
    let payload = null;
    try {
      const raw = sessionStorage.getItem(HANDOFF_KEY);
      if (!raw) return;
      payload = JSON.parse(raw);
      if (!payload || Date.now() - Number(payload.ts || 0) > 60_000) {
        sessionStorage.removeItem(HANDOFF_KEY);
        return;
      }
      if (payload.targetPage && payload.targetPage !== currentPageFile()) return;
      sessionStorage.removeItem(HANDOFF_KEY);
    } catch {
      return;
    }
    if (!payload?.tutorialId) return;
    // Wait briefly so async workspace panels finish rendering before highlighting
    setTimeout(() => {
      showSpotlight(payload.tutorialId, Number.isFinite(payload.stepIndex) ? payload.stepIndex : -1);
    }, 550);
  }

  function open(tutorialId = null, stepIndex = 0) {
    clearSpotlight();
    // Close any open non-tutorial dialogs (e.g. My Account modal) so the learning center sits cleanly on top
    document.querySelectorAll('dialog[open]').forEach((dlg) => {
      if (dlg.id !== 'ipon-tutorial-dialog') {
        try { dlg.close(); } catch { /* ignore */ }
      }
    });
    const dlg = ensureDialog();
    if (tutorialId && findTutorial(tutorialId)) {
      openTutorialDetail(tutorialId, stepIndex);
    } else {
      activeTutorialId = null;
      renderLibrary();
    }
    if (!dlg.open) {
      if (typeof dlg.showModal === 'function') dlg.showModal();
      else dlg.setAttribute('open', '');
    }
  }

  function close() {
    if (dialogEl?.open) dialogEl.close();
    clearSpotlight();
  }

  function bindGlobalTriggers() {
    document.addEventListener('click', (event) => {
      const trigger = event.target.closest('[data-tutorial-open]');
      if (!trigger) return;
      event.preventDefault();
      const targetId = trigger.dataset.tutorialId || null;
      open(targetId);
    });
  }

  const api = {
    open,
    close,
    showSpotlight,
    clearSpotlight,
    getTutorials: () => TUTORIALS,
    getCategories: () => CATEGORIES,
    getProgress: readProgress,
    setTutorialCompleted
  };

  window.IponTutorial = api;
  if (window.Ipon && typeof window.Ipon === 'object') {
    window.Ipon.openTutorial = open;
  }

  bindGlobalTriggers();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', consumePendingSpotlightHandoff, { once: true });
  } else {
    consumePendingSpotlightHandoff();
  }
})();
