(() => {
  'use strict';

  const CURRENT_POLICY_VERSION = '2026-11-16';
  const RETENTION_REMINDER_INTERVAL_MS = 14 * 24 * 60 * 60 * 1000;

  const POLICY_TERMS_HTML = `
    <h3>Purpose &amp; non-custodial scope</h3>
    <p>myIPON records savings-related activity entered by authorized users. It is a tracking system only and does not hold, transfer, receive, or safeguard money.</p>
    <p>Recording payment methods (such as GCash, Maya, Bank, or Cash), reference numbers, optional payout receiving accounts, or wallet reconciliation balances helps your group track where funds sit offline; myIPON never initiates or processes real financial transfers.</p>
    <h3>Accounts &amp; your responsibilities</h3>
    <ul>
      <li>Verify your email with a one-time code, use accurate formal profile information, and keep your sign-in credentials and optional two-factor authenticator (TOTP) codes private.</li>
      <li>Use only accounts, workspaces, and savings-group records you are authorized to access.</li>
      <li>Verify important balances, member payouts, and excess carry-over entries against physical or e-wallet receipts.</li>
      <li>Accept the current Terms of Use and Privacy Policy upon your first sign-in or after major policy updates.</li>
    </ul>
    <h3>Notifications &amp; email delivery scope</h3>
    <p><strong>Notifications and direct chat messages are delivered in-app only.</strong> You must open or keep myIPON running on your device or browser to view and receive real-time alerts for new messages, payment reviews, contribution updates, replies, and announcements. Activity notifications are <strong>not sent via email</strong> and are not guaranteed to arrive when the app is completely closed on a phone.</p>
    <p>Automated <strong>emails</strong> are reserved strictly for account security and retention notices: 6-digit email verification (OTP) codes, password recovery links, dormant savings check-in reminders (90 days idle), and 7-day prior warnings before 6-month inactive account or abandoned savings retention.</p>
    <h3>Approvals, ongoing savings protection &amp; dormant retention</h3>
    <p>Only confirmed entries affect tracked savings totals. Rejected and voided entries carry mandatory reasons and remain recorded in the group audit trail (retained for <strong>90 days</strong>) for accountability.</p>
    <p><strong>Ongoing savings &amp; active goals are never deleted while you keep saving</strong>, no matter how many months or years it takes your group to reach a target. Active savings records, confirmed ledgers, and ongoing goals stay intact as long as contributions or goal activity continue.</p>
    <p><strong>Forgotten or abandoned savings policy:</strong> To prevent completely abandoned workspaces from filling storage indefinitely while giving fair notice, groups with <strong>zero contributions, transactions, or goal updates</strong> receive a friendly <strong>email reminder at 90 days</strong>, and if still untouched by <strong>6 months</strong> receive a <strong>7-day prior email notice</strong> before dormant records and untouched goals move into the <strong>30-day Recycle Bin</strong> (still recoverable for 30 days before permanent database &amp; cloud storage removal).</p>
    <p>Group Owners and Administrators manage invitations, role assignments, ownership transfers, the <strong>30-day soft-delete member recovery bin</strong>, completed goals, finished batch resets, and permanent group deletions. When a goal or finished savings batch is marked <strong>Done / Removed</strong>, it moves into the <strong>30-day Recycle Bin</strong> with a visible remaining-days countdown before automatic removal from the database and cloud storage. Completed financial years older than <strong>1 year</strong> can also be exported to CSV first and rolled up into permanent annual net-savings summaries (<code>financial_annual_archives</code>).</p>
    <h3>Uploads, character limits &amp; automatic cleanup</h3>
    <p>Profile photos, group QR codes, receipts, announcement media, record discussion replies, and chat attachments must stay lawful and relevant to group tracking. Never post PINs, OTP codes, passwords, or private banking credentials. Chat messages, transaction notes, and record replies are capped at <strong>500 characters</strong> (Group Announcements remain unlimited so full notices stay complete).</p>
    <p>To keep database and cloud storage responsive without disturbing active savers, automated nightly maintenance runs every midnight (<strong>12:00 AM Manila time</strong>) strictly on expired temporary/binned data:</p>
    <div class="policy-retention-grid">
      <div class="policy-retention-row"><span class="policy-ttl-badge is-keep">Ongoing</span><div class="policy-retention-detail"><strong>Active savings &amp; ongoing goals (Protected)</strong><span>Confirmed group savings ledgers and active goals are <strong>never auto-deleted</strong> while deposits or goal updates stay active, regardless of duration.</span></div></div>
      <div class="policy-retention-row"><span class="policy-ttl-badge is-warn">90d &rarr; 6m</span><div class="policy-retention-detail"><strong>Forgotten savings &amp; goals (Email reminder + 7d notice)</strong><span>If a group stops depositing or updating goals: an email check-in goes out at <strong>90 days</strong> and a final warning <strong>7 days prior to 6 months</strong> before dormant data moves into the 30-day Bin.</span></div></div>
      <div class="policy-retention-row"><span class="policy-ttl-badge">30-day Bin</span><div class="policy-retention-detail"><strong>Completed goals, finished batches &amp; removed items</strong><span>Goals or savings batches marked Done / Reset, soft-deleted members, and deleted announcements stay recoverable in the Bin for <strong>30 days</strong> with a live days-left countdown, then auto-delete permanently from the database and Storage.</span></div></div>
      <div class="policy-retention-row"><span class="policy-ttl-badge">30 days</span><div class="policy-retention-detail"><strong>Call logs &amp; read notifications</strong><span>Voice/video call logs and read notifications clear automatically after 30 days.</span></div></div>
      <div class="policy-retention-row"><span class="policy-ttl-badge">90 days</span><div class="policy-retention-detail"><strong>Direct messages, chat files, logs &amp; rejected receipts</strong><span>Chat messages, chat attachments, audit logs, security activity events, unread notifications, and rejected or voided receipt files are deleted automatically after 90 days.</span></div></div>
      <div class="policy-retention-row"><span class="policy-ttl-badge is-warn">6 months</span><div class="policy-retention-detail"><strong>Truly inactive accounts (7-day prior notice)</strong><span>Abandoned accounts with zero logins, member contributions, or active group savings activity for 6 months receive an email warning <strong>7 days prior</strong> before permanent account removal.</span></div></div>
      <div class="policy-retention-row"><span class="policy-ttl-badge is-keep">1+ year</span><div class="policy-retention-detail"><strong>CSV export &amp; permanent annual roll-ups</strong><span>Confirmed transactions older than 1 year remain preserved until Group Admins download CSV backups and create permanent annual net-savings summaries.</span></div></div>
    </div>
    <h3>Development availability</h3>
    <p>The system is under active development. Features, release notes, and automated alerts may be updated, incomplete, or temporarily unavailable. Do not treat myIPON as a bank, wallet, or the sole official financial record.</p>`;

  const POLICY_PRIVACY_HTML = `
    <h3>Information we process</h3>
    <p>myIPON may store your formal name, email address, mobile number, optional profile picture, optional payout receiving account details (channel, account name, and account number), policy consent version and timestamp, assigned roles, savings-group memberships, contributions, expenses, withdrawals, annual archived summaries, payment channel tags, reconciliation records, in-record comments, direct messages, media attachments, announcement reactions, feature requests, bug reports, and security-related account events.</p>
    <h3>How information is used &amp; media storage</h3>
    <ul>
      <li>Authenticate accounts (including email OTP verification, password recovery, and optional TOTP two-factor authentication) and enforce database row-level isolation per group and role.</li>
      <li>Calculate monthly summaries, calendar progress, wallet balances, CSV/print reports, annual roll-up summaries, and audit logs.</li>
      <li>Store uploaded images, voice notes, documents, and receipts inside dedicated cloud object storage buckets (<code>ipon-media</code>, <code>chat-attachments</code>, <code>announcements</code>, <code>record-comments</code>) referenced by URL rather than storing raw binary blobs or Base64 strings inside database tables.</li>
      <li>Deliver <strong>in-app notifications</strong> (and device banners while myIPON stays open) for payment reviews, chat messages, discussion replies, account status changes, and announcements. Activity alerts are <strong>not sent to your email</strong>; email is reserved strictly for OTP verification codes, password recovery links, dormant savings reminders (90 days idle), and 7-day inactivity/retention warnings.</li>
      <li>Summarize high-level platform updates in Super Admin release notes without exposing private group financial balances, and display optional requester credit on implemented feature requests when attribution is enabled.</li>
    </ul>
    <h3>Browser storage &amp; device alerts</h3>
    <p>The app stores session credentials, cross-tab sync keys, your light or dark theme selection, per-account policy consent cache keys, periodic data-retention reminder timestamps, and optional Web Push subscription tokens locally on your browser or Android app so settings stay consistent. Open myIPON directly to check incoming messages and activity notifications (alerts are in-app only and not emailed). Device alerts can be disabled anytime in your device settings or Account preferences.</p>
    <h3>Who can access it</h3>
    <p>Access is strictly limited by assigned role and active savings group. Authorized group administrators and treasurers review permitted group workspace activity and payout info. Platform administrators manage system health, storage hygiene, account access, bug reports, and feature requests, and are not intended to view private group savings ledgers.</p>
    <h3>Detailed data retention, ongoing savings protection &amp; automatic deletion</h3>
    <p>To keep database tables lean and fast while protecting active group savers permanently, scheduled <code>pg_cron</code> jobs execute nightly at <strong>12:00 AM Manila time</strong> (paired with cloud Storage object cleanup and PostgreSQL <code>autovacuum</code> disk reclamation):</p>
    <div class="policy-retention-grid">
      <div class="policy-retention-row"><span class="policy-ttl-badge is-keep">Ongoing</span><div class="policy-retention-detail"><strong>Active savings &amp; ongoing goals (Immune)</strong><span>Active goals (<code>savings_goals</code>) and unbinned savings records (<code>contributions</code>, <code>withdrawals</code>, <code>expenses</code>, <code>contribution_periods</code>) are never automatically erased while contributions or goal updates remain active.</span></div></div>
      <div class="policy-retention-row"><span class="policy-ttl-badge is-warn">90d &rarr; 6m</span><div class="policy-retention-detail"><strong>Dormant / forgotten savings (Email + 7d notice)</strong><span>Groups with zero deposits or goal updates receive an email reminder at <strong>90 days</strong> and a final warning <strong>7 days prior to 6 months</strong> before dormant ledgers and untouched goals move into the 30-day Bin.</span></div></div>
      <div class="policy-retention-row"><span class="policy-ttl-badge">7 days</span><div class="policy-retention-detail"><strong>Login rate-limit &amp; throttle logs</strong><span>Failed sign-in attempt counters (<code>auth_login_throttles</code>) expire automatically after 7 days.</span></div></div>
      <div class="policy-retention-row"><span class="policy-ttl-badge">30-day Bin</span><div class="policy-retention-detail"><strong>Done / reset batches, binned goals, members &amp; notices</strong><span>Completed goals or reset savings batches (<code>savings_cycle_batches</code>), deleted announcements, and soft-deleted member profiles remain recoverable for <strong>30 days</strong> with an exact remaining-days countdown before permanent purge from PostgreSQL and cloud Storage.</span></div></div>
      <div class="policy-retention-row"><span class="policy-ttl-badge">30 days</span><div class="policy-retention-detail"><strong>Call logs &amp; read notifications</strong><span>Voice/video call session metadata (<code>call_sessions</code>) and read alerts (<code>notifications</code>) are purged automatically after 30 days.</span></div></div>
      <div class="policy-retention-row"><span class="policy-ttl-badge">90 days</span><div class="policy-retention-detail"><strong>Direct messages &amp; chat Storage files</strong><span>Messages (<code>messages</code>) and uploaded media in <code>chat-attachments</code> older than 90 days are deleted automatically. Messages, notes, and replies are capped at 500 characters.</span></div></div>
      <div class="policy-retention-row"><span class="policy-ttl-badge">90 days</span><div class="policy-retention-detail"><strong>Unread alerts, rejected receipts &amp; logs</strong><span>Unread notifications, rejected or voided receipt attachments (alongside their Storage files), <code>audit_logs</code>, and <code>account_activity</code> clear automatically after 90 days.</span></div></div>
      <div class="policy-retention-row"><span class="policy-ttl-badge is-warn">6 months</span><div class="policy-retention-detail"><strong>Inactive accounts (7-day warning email)</strong><span>Accounts inactive for 6 months (zero logins, member contributions, or active group savings activity) receive an email warning <strong>7 days prior</strong> to permanent removal (shared groups promote an active successor automatically).</span></div></div>
      <div class="policy-retention-row"><span class="policy-ttl-badge is-keep">1+ year</span><div class="policy-retention-detail"><strong>Annual financial roll-ups</strong><span>Confirmed transactions older than 1 year can be exported to CSV first and summarized into permanent <code>financial_annual_archives</code> totals—never erased silently.</span></div></div>
    </div>
    <p>Confirming permanent group deletion immediately clears that group's workspace data. Users are also shown a periodic in-app storage reminder every 14 days and can review retention rules anytime under Account Preferences.</p>
    <h3>Questions</h3>
    <p>For privacy, payout-info visibility, or account concerns, email <a href="https://mail.google.com/mail/?view=cm&fs=1&to=zedrickdemonteverde1@gmail.com&su=myIPON%20Inquiry" target="_blank" rel="noopener noreferrer">zedrickdemonteverde1@gmail.com</a>.</p>`;

  function ipon() {
    return window.Ipon || {};
  }

  function openPolicyDialog(policyName = 'terms') {
    if (typeof document === 'undefined' || !document.body || typeof document.createElement !== 'function') return false;
    const policy = policyName === 'privacy' ? 'privacy' : 'terms';
    document.getElementById('ipon-retention-dialog')?.close?.();
    let dialog = document.getElementById('ipon-policy-dialog');
    if (!dialog) {
      dialog = document.createElement('dialog');
      dialog.id = 'ipon-policy-dialog';
      dialog.className = 'policy-dialog';
      dialog.setAttribute('aria-labelledby', 'ipon-policy-title');
      dialog.innerHTML = `
        <div class="policy-sheet">
          <header class="policy-header">
            <div>
              <h2 id="ipon-policy-title">Terms of use</h2>
              <p>Last updated: November 16, 2026</p>
            </div>
            <button class="dialog-close" type="button" data-inapp-policy-close aria-label="Close policy"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"></path></svg></button>
          </header>
          <div class="policy-content">
            <section data-inapp-policy-section="terms">${POLICY_TERMS_HTML}</section>
            <section data-inapp-policy-section="privacy" hidden>${POLICY_PRIVACY_HTML}</section>
          </div>
        </div>`;
      dialog.querySelector?.('[data-inapp-policy-close]')?.addEventListener?.('click', () => dialog.close?.());
      dialog.addEventListener?.('click', (event) => {
        if (event.target === dialog) dialog.close?.();
      });
      document.body.appendChild(dialog);
    }
    const titleEl = dialog.querySelector?.('#ipon-policy-title');
    if (titleEl) titleEl.textContent = policy === 'privacy' ? 'Privacy policy' : 'Terms of use';
    dialog.querySelectorAll?.('[data-inapp-policy-section]')?.forEach?.((sec) => {
      sec.hidden = sec.dataset?.inappPolicySection !== policy;
    });
    const scrollBox = dialog.querySelector?.('.policy-content');
    if (scrollBox) scrollBox.scrollTop = 0;
    if (typeof dialog.showModal === 'function' && !dialog.open) dialog.showModal();
    return true;
  }

  function openRetentionPolicyDialog() {
    if (typeof document === 'undefined' || !document.body || typeof document.createElement !== 'function') return false;
    let dialog = document.getElementById('ipon-retention-dialog');
    if (!dialog) {
      dialog = document.createElement('dialog');
      dialog.id = 'ipon-retention-dialog';
      dialog.className = 'form-dialog retention-policy-dialog';
      dialog.setAttribute('aria-labelledby', 'ipon-retention-title');
      dialog.innerHTML = `
        <div class="form-dialog-sheet">
          <header class="form-dialog-header">
            <div>
              <h2 id="ipon-retention-title">Data &amp; storage retention</h2>
              <p>Automatic schedule &amp; storage guidelines · Last updated: November 16, 2026</p>
            </div>
            <button class="dialog-close" type="button" data-retention-dialog-close aria-label="Close retention policy"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button>
          </header>
          <div class="retention-policy-body">
            <p class="retention-policy-lead">myIPON runs automated database and cloud storage maintenance every midnight (12:00 AM PHT) via scheduled <code>pg_cron</code> jobs so storage stays clean while keeping ongoing group savings &amp; active goals 100% protected.</p>
            <div class="retention-policy-grid">
              <article class="retention-policy-item">
                <strong>Ongoing · Active savings &amp; goals (Protected)</strong>
                <p>Active savings and goals stay safe while you keep saving. If untouched for <strong>90 days</strong> we send an email check-in; after <strong>6 months</strong> without deposits or goal edits (+ a 7-day notice), dormant data moves to the 30-day Bin.</p>
              </article>
              <article class="retention-policy-item">
                <strong>30-day Bin · Done goals, reset batches, members &amp; alerts</strong>
                <p>Done goals, reset savings batches, deleted announcements, and removed members stay recoverable in the Bin with a live remaining-days badge for 30 days, then auto-delete from database &amp; Storage. Call logs and read alerts also clear after 30 days.</p>
              </article>
              <article class="retention-policy-item">
                <strong>90 days · Automatic nightly cleanup</strong>
                <p>Direct messages, files in <code>chat-attachments</code>, rejected/voided receipt images, unread alerts, audit logs, and security activity logs older than 90 days are deleted automatically.</p>
              </article>
              <article class="retention-policy-item">
                <strong>6 months · Truly inactive accounts (7-day notice)</strong>
                <p>Accounts with zero logins, member contributions, or active group savings participation for 6 months receive an email warning 7 days before permanent removal.</p>
              </article>
              <article class="retention-policy-item">
                <strong>1+ year · CSV annual roll-up &amp; cloud media storage</strong>
                <p>Confirmed year-old ledgers can be exported to CSV first in <strong>Reports &rarr; Annual data roll-up</strong> and rolled into permanent totals. Messages &amp; notes are capped at 500 characters, and media lives in cloud Storage alongside PostgreSQL <code>autovacuum</code>.</p>
              </article>
              <article class="retention-policy-item">
                <strong>In-app alerts vs. Email delivery</strong>
                <p>Chat messages, payment reviews, and activity notifications are delivered <strong>in-app only</strong> while myIPON is open. Automated emails are sent strictly for OTP verification codes, password resets, 90-day dormant savings check-ins, and 7-day retention notices.</p>
              </article>
            </div>
            <div class="retention-policy-actions">
              <button class="button button-secondary" type="button" data-policy-open-inapp="terms">Terms of use</button>
              <button class="button button-secondary" type="button" data-policy-open-inapp="privacy">Privacy policy</button>
              <button class="button button-primary" type="button" data-retention-dialog-close>Got it</button>
            </div>
          </div>
        </div>`;
      dialog.querySelectorAll?.('[data-retention-dialog-close]')?.forEach?.((btn) => {
        btn.addEventListener?.('click', () => dialog.close?.());
      });
      dialog.querySelectorAll?.('[data-policy-open-inapp]')?.forEach?.((btn) => {
        btn.addEventListener?.('click', (event) => {
          event.preventDefault?.();
          openPolicyDialog(btn.dataset?.policyOpenInapp || 'privacy');
        });
      });
      dialog.addEventListener?.('click', (event) => {
        if (event.target === dialog) dialog.close?.();
      });
      document.body.appendChild(dialog);
    }
    if (typeof dialog.showModal === 'function' && !dialog.open) dialog.showModal();
    return true;
  }

  function maybeShowRetentionReminder(profile = ipon().profile, { force = false } = {}) {
    if (!profile?.id || typeof document === 'undefined' || !document.body || typeof document.createElement !== 'function') return false;
    if (document.body.dataset?.page === 'login') return false;
    const key = `ipon_retention_reminder_${profile.id}`;
    try {
      const lastSeen = Number(localStorage.getItem(key) || 0);
      if (!force && lastSeen > 0 && Date.now() - lastSeen < RETENTION_REMINDER_INTERVAL_MS) {
        return false;
      }
    } catch { }
    if (document.getElementById('ipon-retention-reminder')) return true;

    const card = document.createElement('aside');
    card.id = 'ipon-retention-reminder';
    card.className = 'retention-reminder-card';
    card.setAttribute('role', 'status');
    card.setAttribute('aria-live', 'polite');
    card.innerHTML = `
      <div class="retention-reminder-head">
        <strong>Storage &amp; data retention reminder</strong>
        <button class="dialog-close retention-reminder-close" type="button" aria-label="Dismiss retention reminder"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button>
      </div>
      <p>Ongoing savings &amp; active goals stay safe while active; abandoned savings get 90-day &amp; 6-month email reminders before the 30-day Bin, chat clears after 90 days, and inactive accounts (6 months) get a 7-day email notice.</p>
      <div class="retention-reminder-actions">
        <button class="button button-secondary button-sm" type="button" data-retention-rules-open>Retention rules</button>
        <button class="button button-primary button-sm" type="button" data-retention-ack>Got it</button>
      </div>`;
    const dismiss = () => {
      try { localStorage.setItem(key, String(Date.now())); } catch { }
      card.remove?.();
    };
    card.querySelector('.retention-reminder-close')?.addEventListener?.('click', dismiss);
    card.querySelector('[data-retention-ack]')?.addEventListener?.('click', dismiss);
    card.querySelector('[data-retention-rules-open]')?.addEventListener?.('click', (event) => {
      event.preventDefault?.();
      openRetentionPolicyDialog();
    });
    document.body.appendChild(card);
    return true;
  }

  function hasAcceptedCurrentPolicy(profile = ipon().profile) {
    if (!profile?.id) return true;
    const key = `ipon_policy_accepted_${profile.id}`;
    if (Object.prototype.hasOwnProperty.call(profile, 'policy_accepted_version')) {
      if (profile.policy_accepted_version === CURRENT_POLICY_VERSION) {
        try { localStorage.setItem(key, CURRENT_POLICY_VERSION); } catch { }
        return true;
      }
      return false;
    }
    try {
      return localStorage.getItem(key) === CURRENT_POLICY_VERSION;
    } catch {
      return false;
    }
  }

  function maybeShowPolicyConsentModal(profile = ipon().profile, { force = false, onAccept = null } = {}) {
    if (!profile?.id || typeof document === 'undefined' || !document.body || typeof document.createElement !== 'function') return false;
    if (document.body.dataset?.page === 'login') return false;
    if (!force && hasAcceptedCurrentPolicy(profile)) return false;
    let dialog = document.getElementById('ipon-policy-consent-dialog');
    if (dialog) {
      if (typeof dialog.showModal === 'function' && !dialog.open) dialog.showModal();
      return true;
    }

    dialog = document.createElement('dialog');
    dialog.id = 'ipon-policy-consent-dialog';
    dialog.className = 'policy-consent-dialog';
    dialog.setAttribute('aria-labelledby', 'ipon-consent-title');
    dialog.innerHTML = `
      <div class="policy-consent-sheet">
        <header class="policy-consent-header">
          <div>
            <span class="policy-consent-eyebrow">Policy update · Effective Nov 16, 2026</span>
            <h2 id="ipon-consent-title">Terms of Use &amp; Privacy Policy</h2>
            <p>Please review our updated platform terms, exact data retention windows, and inactivity policy before continuing.</p>
          </div>
          <div class="policy-consent-tabs" role="tablist" aria-label="Policy documents">
            <button class="policy-consent-tab" id="ipon-consent-tab-terms" type="button" role="tab" aria-selected="true" data-consent-tab="terms">Terms of Use</button>
            <button class="policy-consent-tab" id="ipon-consent-tab-privacy" type="button" role="tab" aria-selected="false" data-consent-tab="privacy">Privacy Policy</button>
          </div>
        </header>
        <div class="policy-content policy-consent-body" id="ipon-consent-scroll">
          <section data-consent-panel="terms">
            ${POLICY_TERMS_HTML}
          </section>
          <section data-consent-panel="privacy" hidden>
            ${POLICY_PRIVACY_HTML}
          </section>
        </div>
        <footer class="policy-consent-footer">
          <label class="policy-consent-check" for="ipon-consent-checkbox">
            <input id="ipon-consent-checkbox" type="checkbox">
            <span>I have read and agree to the myIPON Terms of Use and Privacy Policy.</span>
          </label>
          <p class="policy-consent-error" id="ipon-consent-error" role="alert" aria-live="polite" hidden></p>
          <div class="policy-consent-actions">
            <button class="button button-primary policy-consent-agree-btn" id="ipon-consent-agree-btn" type="button" disabled>I agree &amp; continue</button>
            <button class="button button-secondary policy-consent-signout-btn" id="ipon-consent-signout" type="button">Sign out</button>
          </div>
        </footer>
      </div>`;

    const scrollBox = dialog.querySelector?.('#ipon-consent-scroll');
    const checkbox = dialog.querySelector?.('#ipon-consent-checkbox');
    const errorEl = dialog.querySelector?.('#ipon-consent-error');
    const agreeBtn = dialog.querySelector?.('#ipon-consent-agree-btn');
    const signOutBtn = dialog.querySelector?.('#ipon-consent-signout');
    const coreApi = ipon();

    const showConsentError = (text = '') => {
      if (!errorEl) return;
      errorEl.textContent = text;
      errorEl.hidden = !text;
      errorEl.classList?.toggle?.('is-visible', Boolean(text));
    };

    const selectTab = (tabName) => {
      const active = tabName === 'privacy' ? 'privacy' : 'terms';
      dialog.querySelectorAll?.('[data-consent-tab]')?.forEach?.((btn) => {
        const isCurrent = btn.dataset?.consentTab === active;
        btn.setAttribute?.('aria-selected', isCurrent ? 'true' : 'false');
      });
      dialog.querySelectorAll?.('[data-consent-panel]')?.forEach?.((panel) => {
        panel.hidden = panel.dataset?.consentPanel !== active;
      });
      if (scrollBox) scrollBox.scrollTop = 0;
    };

    dialog.querySelectorAll?.('[data-consent-tab]')?.forEach?.((btn) => {
      btn.addEventListener?.('click', () => selectTab(btn.dataset?.consentTab));
    });

    checkbox?.addEventListener?.('change', () => {
      if (agreeBtn) agreeBtn.disabled = !checkbox.checked;
      if (checkbox.checked) showConsentError('');
    });

    const remindAcceptedChoice = () => {
      showConsentError('Please check the confirmation box and click "I agree & continue" (or Sign out) to proceed.');
      errorEl?.scrollIntoView?.({ block: 'nearest' });
    };

    const ensureModalLocked = () => {
      if (dialog.dataset?.accepted === '1' || dialog.isConnected === false) return;
      if (!dialog.open && typeof dialog.showModal === 'function') {
        try { dialog.showModal(); } catch { }
      }
      remindAcceptedChoice();
    };

    let gatePushed = false;
    const handlePopstate = () => {
      if (dialog.dataset?.accepted === '1' || dialog.isConnected === false) return;
      try { window.history?.pushState?.({ iponPolicyGate: true }, ''); } catch { }
      ensureModalLocked();
    };
    const handleBackBlocked = () => {
      ensureModalLocked();
    };
    const cleanupGateListeners = () => {
      if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
        window.removeEventListener('popstate', handlePopstate);
        window.removeEventListener('ipon:policy-back-blocked', handleBackBlocked);
      }
    };

    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('ipon:policy-back-blocked', handleBackBlocked);
      if (!window.Capacitor && typeof window.history?.pushState === 'function') {
        try {
          window.history.pushState({ iponPolicyGate: true }, '');
          gatePushed = true;
          window.addEventListener('popstate', handlePopstate);
        } catch { }
      }
    }

    dialog.addEventListener?.('cancel', (event) => {
      if (dialog.dataset?.accepted !== '1') {
        event.preventDefault?.();
        remindAcceptedChoice();
      }
    });

    dialog.addEventListener?.('close', () => {
      if (dialog.dataset?.accepted !== '1' && dialog.isConnected !== false) {
        queueMicrotask(ensureModalLocked);
      }
    });

    signOutBtn?.addEventListener?.('click', () => {
      if (dialog.dataset) dialog.dataset.accepted = '1';
      cleanupGateListeners();
      coreApi.signOut?.().catch(() => { });
    });

    agreeBtn?.addEventListener?.('click', async () => {
      if (!checkbox?.checked) {
        showConsentError('Please check the confirmation box above before continuing.');
        checkbox?.focus?.();
        return;
      }
      showConsentError('');
      coreApi.setBusy?.(agreeBtn, true, 'Saving agreement…');
      try {
        const client = coreApi.client;
        let savedAt = new Date().toISOString();
        if (client?.rpc) {
          const callPromise = client.rpc('accept_current_policy', { p_version: CURRENT_POLICY_VERSION });
          const { data, error } = coreApi.withTimeout ? await coreApi.withTimeout(callPromise, 12000) : await callPromise;
          if (error) throw error;
          if (data?.policy_accepted_at) savedAt = data.policy_accepted_at;
        }
        profile.policy_accepted_version = CURRENT_POLICY_VERSION;
        profile.policy_accepted_at = savedAt;
        coreApi.updateLocalProfile?.({
          policy_accepted_version: CURRENT_POLICY_VERSION,
          policy_accepted_at: savedAt
        });
        try {
          localStorage.setItem(`ipon_policy_accepted_${profile.id}`, CURRENT_POLICY_VERSION);
          localStorage.setItem(`ipon_retention_reminder_${profile.id}`, String(Date.now()));
        } catch { }
        if (dialog.dataset) dialog.dataset.accepted = '1';
        cleanupGateListeners();
        if (gatePushed && window.history?.state?.iponPolicyGate && typeof window.history.replaceState === 'function') {
          try { window.history.replaceState({}, ''); } catch { }
        }
        dialog.close?.();
        dialog.remove?.();
        document.getElementById('ipon-retention-reminder')?.remove?.();
        coreApi.toast?.('Thank you — Terms & Privacy agreement saved.', 'success');
        if (typeof onAccept === 'function') onAccept();
      } catch (err) {
        coreApi.setBusy?.(agreeBtn, false);
        if (agreeBtn && checkbox) agreeBtn.disabled = !checkbox.checked;
        showConsentError(coreApi.friendlyError ? coreApi.friendlyError(err) : String(err?.message || err));
      }
    });

    document.body.appendChild(dialog);
    if (typeof dialog.showModal === 'function' && !dialog.open) dialog.showModal();
    return true;
  }

  function formatBinExpiry(itemOrExpiresAt) {
    const rawExpires = typeof itemOrExpiresAt === 'object' && itemOrExpiresAt !== null
      ? itemOrExpiresAt.expires_at
      : itemOrExpiresAt;
    const rawDays = typeof itemOrExpiresAt === 'object' && itemOrExpiresAt !== null && Number.isFinite(Number(itemOrExpiresAt.days_remaining))
      ? Number(itemOrExpiresAt.days_remaining)
      : Math.ceil((new Date(rawExpires).getTime() - Date.now()) / 86400000);
    const days = Math.max(0, Number.isFinite(rawDays) ? rawDays : 0);
    const api = ipon();
    const deleteDate = rawExpires && api.dateLabel
      ? api.dateLabel(rawExpires, { month: 'short', day: 'numeric', year: 'numeric' })
      : '';
    if (days <= 0) {
      return {
        days: 0,
        urgent: true,
        text: 'Expires today · Auto-deletes tonight'
      };
    }
    const dayLabel = `${days} day${days === 1 ? '' : 's'} left`;
    return {
      days,
      urgent: days <= 7,
      text: deleteDate ? `${dayLabel} · Auto-deletes ${deleteDate}` : `${dayLabel} to recover`
    };
  }

  function renderBinItemCard(item, { canPurge = true } = {}) {
    const api = ipon();
    const esc = api.escapeHtml || ((v) => String(v ?? ''));
    const expiry = formatBinExpiry(item);
    const typeClassMap = {
      announcement: 'is-deduction',
      goal: 'is-goal',
      savings_cycle: 'is-cycle',
      member: 'is-addition'
    };
    const typeClass = typeClassMap[item.item_type] || 'is-addition';
    const label = item.type_label || item.item_type || 'Item';
    const dateText = api.dateLabel ? api.dateLabel(item.deleted_at) : String(item.deleted_at || '').slice(0, 10);
    return `<article class="bin-item">
      <div class="bin-item-main">
        <div class="bin-item-top">
          <span class="record-type-pill ${typeClass}">${esc(label)}</span>
          <span class="bin-item-expiry${expiry.urgent ? ' is-urgent' : ''}">${esc(expiry.text)}</span>
        </div>
        <strong>${esc(item.title)}</strong>
        ${item.subtitle ? `<p class="bin-item-subtitle">${esc(item.subtitle)}</p>` : ''}
        <p class="bin-item-reason">Reason: ${esc(item.reason || 'No reason provided')}</p>
        <p class="bin-item-meta">Moved to bin by ${esc(item.deleted_by_name || 'Group Administrator')} on ${esc(dateText)}</p>
      </div>
      <div class="bin-item-actions">
        <button class="button button-secondary" type="button" data-recover-type="${esc(item.item_type)}" data-recover-id="${esc(item.item_id)}" data-recover-label="${esc(label)}" data-recover-title="${esc(item.title)}">Recover</button>
        ${canPurge ? `<button class="button button-danger button-sm" type="button" data-purge-type="${esc(item.item_type)}" data-purge-id="${esc(item.item_id)}" data-purge-label="${esc(label)}" data-purge-title="${esc(item.title)}">Delete forever</button>` : ''}
      </div>
    </article>`;
  }

  function bindBinActionList(listEl, { reloadBin, onChanged } = {}) {
    if (!listEl || listEl.dataset?.binActionsBound === '1') return;
    if (listEl.dataset) listEl.dataset.binActionsBound = '1';
    listEl.addEventListener('click', async (event) => {
      const api = ipon();
      const recoverBtn = event.target?.closest?.('[data-recover-id]');
      if (recoverBtn) {
        const itemType = recoverBtn.dataset.recoverType;
        const itemId = recoverBtn.dataset.recoverId;
        const itemLabel = recoverBtn.dataset.recoverLabel || 'Item';
        const itemTitle = recoverBtn.dataset.recoverTitle || 'this item';
        const isCycle = itemType === 'savings_cycle';
        const accepted = await api.confirmAction({
          title: `Recover ${itemLabel.toLowerCase()}?`,
          message: isCycle
            ? `"${itemTitle}" will restore all records, receipts, comments, and periods back into the active workspace.`
            : `"${itemTitle}" will be restored to active records.`,
          acceptLabel: 'Recover'
        });
        if (!accepted) return;
        api.setBusy?.(recoverBtn, true, 'Recovering…');
        try {
          await api.rpc('recover_bin_item', { p_item_type: itemType, p_item_id: itemId });
          api.toast?.(`${itemLabel} recovered.`);
          if (typeof reloadBin === 'function') await reloadBin();
          if (typeof onChanged === 'function') await onChanged('recover', itemType);
        } catch (error) {
          if (typeof reloadBin === 'function') await reloadBin().catch(() => { });
          api.toast?.(api.friendlyError ? api.friendlyError(error) : String(error?.message || error), 'error');
        } finally {
          api.setBusy?.(recoverBtn, false);
        }
        return;
      }

      const purgeBtn = event.target?.closest?.('[data-purge-id]');
      if (!purgeBtn) return;
      const itemType = purgeBtn.dataset.purgeType;
      const itemId = purgeBtn.dataset.purgeId;
      const itemLabel = purgeBtn.dataset.purgeLabel || 'Item';
      const itemTitle = purgeBtn.dataset.purgeTitle || 'this item';
      const accepted = await api.confirmAction({
        title: `Permanently delete ${itemLabel.toLowerCase()}?`,
        message: `Delete "${itemTitle}" permanently from the database and cloud storage? This cannot be undone and will not wait for the 30-day timer.`,
        acceptLabel: 'Delete forever'
      });
      if (!accepted) return;
      api.setBusy?.(purgeBtn, true, 'Deleting…');
      try {
        await api.rpc('purge_bin_item_permanently', { p_item_type: itemType, p_item_id: itemId });
        api.toast?.(`${itemLabel} permanently deleted.`);
        if (typeof reloadBin === 'function') await reloadBin();
        if (typeof onChanged === 'function') await onChanged('purge', itemType);
      } catch (error) {
        if (typeof reloadBin === 'function') await reloadBin().catch(() => { });
        api.toast?.(api.friendlyError ? api.friendlyError(error) : String(error?.message || error), 'error');
      } finally {
        api.setBusy?.(purgeBtn, false);
      }
    });
  }

  let activeBinChangedCb = null;

  function openRecycleBin({ defaultType = '', onChanged = null } = {}) {
    if (typeof document === 'undefined' || !document.body || typeof document.createElement !== 'function') return false;
    activeBinChangedCb = typeof onChanged === 'function' ? onChanged : null;
    const api = ipon();
    let dialog = document.getElementById('ipon-shared-bin-dialog');
    if (!dialog) {
      dialog = document.createElement('dialog');
      dialog.id = 'ipon-shared-bin-dialog';
      dialog.className = 'form-dialog bin-dialog';
      dialog.setAttribute('aria-labelledby', 'ipon-shared-bin-title');
      dialog.innerHTML = `
        <div class="form-dialog-sheet">
          <header class="form-dialog-header">
            <div>
              <h2 id="ipon-shared-bin-title">Recycle bin</h2>
              <p>Completed goals, finished savings batches, members &amp; announcements stay recoverable with a 30-day countdown before auto-deletion.</p>
            </div>
            <button class="dialog-close" type="button" data-shared-bin-close aria-label="Close recycle bin"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button>
          </header>
          <div class="bin-body">
            <div class="bin-toolbar">
              <span id="ipon-shared-bin-count">Loading bin items…</span>
              <select id="ipon-shared-bin-filter" aria-label="Filter recycle bin items by type">
                <option value="">All types</option>
                <option value="goal">Savings goals</option>
                <option value="savings_cycle">Savings batches</option>
                <option value="member">Members</option>
                <option value="announcement">Announcements</option>
              </select>
            </div>
            <div class="bin-list" id="ipon-shared-bin-list"></div>
          </div>
        </div>`;
      const filterEl = dialog.querySelector('#ipon-shared-bin-filter');
      const countEl = dialog.querySelector('#ipon-shared-bin-count');
      const listEl = dialog.querySelector('#ipon-shared-bin-list');
      const reloadBin = async () => {
        if (!countEl || !listEl) return;
        countEl.textContent = 'Loading bin items…';
        listEl.innerHTML = '<p class="empty-state">Loading bin items…</p>';
        try {
          const result = await api.rpc('get_bin_items', { p_type: filterEl?.value || null });
          const items = Array.isArray(result) ? result : [];
          countEl.textContent = `${items.length} recoverable item${items.length === 1 ? '' : 's'}`;
          listEl.innerHTML = items.length
            ? items.map((item) => renderBinItemCard(item, { canPurge: true })).join('')
            : '<p class="empty-state">No binned items waiting inside the 30-day recovery window.</p>';
        } catch (error) {
          countEl.textContent = 'Unable to load bin';
          listEl.innerHTML = `<p class="empty-state">${(api.escapeHtml || String)(api.friendlyError ? api.friendlyError(error) : String(error?.message || error))}</p>`;
        }
      };
      dialog._reloadBin = reloadBin;
      filterEl?.addEventListener('change', reloadBin);
      dialog.querySelector('[data-shared-bin-close]')?.addEventListener('click', () => dialog.close?.());
      dialog.addEventListener('click', (event) => {
        if (event.target === dialog) dialog.close?.();
      });
      bindBinActionList(listEl, {
        reloadBin,
        onChanged: async (action, itemType) => {
          if (typeof activeBinChangedCb === 'function') await activeBinChangedCb(action, itemType);
        }
      });
      document.body.appendChild(dialog);
    }
    const filterEl = dialog.querySelector('#ipon-shared-bin-filter');
    if (filterEl) filterEl.value = defaultType || '';
    if (typeof dialog.showModal === 'function' && !dialog.open) dialog.showModal();
    dialog._reloadBin?.();
    return true;
  }

  function openFinishSavingsBatchDialog({ onDone = null } = {}) {
    if (typeof document === 'undefined' || !document.body || typeof document.createElement !== 'function') return false;
    const api = ipon();
    document.getElementById('ipon-finish-batch-dialog')?.remove?.();
    const dialog = document.createElement('dialog');
    dialog.id = 'ipon-finish-batch-dialog';
    dialog.className = 'form-dialog';
    dialog.setAttribute('aria-labelledby', 'ipon-finish-batch-title');
    const yearNow = new Date().getFullYear();
    const defaultTitle = `Batch ${yearNow} — Completed Savings`;
    dialog.innerHTML = `
      <div class="form-dialog-sheet">
        <header class="form-dialog-header">
          <div>
            <h2 id="ipon-finish-batch-title">Finish batch &amp; reset savings</h2>
            <p>Move completed group savings into the 30-day Recycle Bin and start cleanly back at ₱0.00.</p>
          </div>
          <button class="dialog-close" type="button" data-finish-batch-close aria-label="Close batch reset dialog"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button>
        </header>
        <form id="ipon-finish-batch-form" class="form-grid" novalidate>
          <div class="batch-reset-box field-wide">
            <strong>How finished batches work</strong>
            <ul>
              <li><strong>Ongoing goals stay safe:</strong> Active targets are never erased unless you choose to mark them done.</li>
              <li><strong>30-day recovery window:</strong> Your finished contributions, withdrawals, expenses, and receipts are stored together in the Bin with a daily countdown.</li>
              <li><strong>Automatic cleanup:</strong> If not recovered within 30 days, the binned batch is permanently deleted from PostgreSQL and cloud storage.</li>
            </ul>
          </div>
          <div class="field field-wide">
            <label for="batch-reset-title">Batch name</label>
            <input id="batch-reset-title" name="title" minlength="2" maxlength="160" value="${(api.escapeHtml || String)(defaultTitle)}" required>
          </div>
          <div class="field field-wide">
            <label for="batch-reset-reason">Reason or closing note (optional)</label>
            <textarea id="batch-reset-reason" name="reason" maxlength="500" placeholder="e.g., Year-end payout settled and ready for a fresh cycle"></textarea>
          </div>
          <label class="batch-reset-check field-wide" for="batch-reset-include-goals">
            <input id="batch-reset-include-goals" type="checkbox" name="include_completed_goals" checked>
            <span>Also move any <strong>Completed</strong> or <strong>Cancelled</strong> goals into the 30-day Bin (keeps Active goals untouched).</span>
          </label>
          <div class="form-actions field-wide">
            <button class="button button-secondary" type="button" data-finish-batch-close>Cancel</button>
            <button class="button button-primary" id="ipon-finish-batch-submit" type="submit" data-requires-data>Move to 30d Bin &amp; reset to ₱0</button>
          </div>
        </form>
      </div>`;
    const closeDlg = () => {
      dialog.close?.();
      dialog.remove?.();
    };
    dialog.querySelectorAll?.('[data-finish-batch-close]')?.forEach?.((btn) => btn.addEventListener('click', closeDlg));
    dialog.addEventListener?.('click', (event) => {
      if (event.target === dialog) closeDlg();
    });
    const form = dialog.querySelector('#ipon-finish-batch-form');
    const titleInput = dialog.querySelector('#batch-reset-title');
    const reasonInput = dialog.querySelector('#batch-reset-reason');
    const goalsCheckbox = dialog.querySelector('#batch-reset-include-goals');
    const submitBtn = dialog.querySelector('#ipon-finish-batch-submit');
    form?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const title = String(titleInput?.value || '').trim();
      if (title.length < 2) {
        api.toast?.('Enter a batch name of at least 2 characters.', 'error');
        titleInput?.focus?.();
        return;
      }
      const accepted = await api.confirmAction({
        title: 'Move finished batch to 30-day Bin & reset to ₱0?',
        message: `All current group contributions, withdrawals, expenses, and periods will move into "${title}" inside the 30-day Recycle Bin, resetting workspace totals to ₱0.00. You can recover it anytime within 30 days.`,
        acceptLabel: 'Move to 30d Bin'
      });
      if (!accepted) return;
      api.setBusy?.(submitBtn, true, 'Resetting…');
      try {
        const res = await api.rpc('archive_and_reset_savings_cycle', {
          p_title: title,
          p_reason: String(reasonInput?.value || '').trim() || null,
          p_include_completed_goals: Boolean(goalsCheckbox?.checked)
        });
        api.toast?.('Savings batch moved to 30-day Bin. Active workspace reset to ₱0.00.');
        closeDlg();
        if (typeof onDone === 'function') await onDone(res);
      } catch (error) {
        api.toast?.(api.friendlyError ? api.friendlyError(error) : String(error?.message || error), 'error');
        api.setBusy?.(submitBtn, false);
      }
    });
    document.body.appendChild(dialog);
    if (typeof dialog.showModal === 'function') dialog.showModal();
    return true;
  }

  const exports = {
    CURRENT_POLICY_VERSION,
    openPolicyDialog,
    openRetentionPolicyDialog,
    maybeShowRetentionReminder,
    hasAcceptedCurrentPolicy,
    maybeShowPolicyConsentModal,
    formatBinExpiry,
    renderBinItemCard,
    bindBinActionList,
    openRecycleBin,
    openFinishSavingsBatchDialog
  };

  window.IponPolicy = exports;
  if (window.Ipon && typeof window.Ipon === 'object') {
    Object.assign(window.Ipon, exports);
  }
})();
