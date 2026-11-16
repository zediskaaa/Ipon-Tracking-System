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
    <h3>Approvals, audit trail &amp; financial roll-ups</h3>
    <p>Only confirmed entries affect tracked savings totals. Rejected and voided entries carry mandatory reasons and remain recorded in the group audit trail (retained for <strong>90 days</strong>) for accountability.</p>
    <p>Group Owners and Administrators manage invitations, role assignments, ownership transfers, the <strong>30-day soft-delete member recovery bin</strong>, and permanent group deletions. Completed financial years older than <strong>1 year</strong> are never deleted automatically—administrators may export full CSV backups first and compress them into permanent annual net-savings summaries (<code>financial_annual_archives</code>).</p>
    <h3>Uploads, character limits &amp; automatic cleanup</h3>
    <p>Profile photos, group QR codes, receipts, announcement media, record discussion replies, and chat attachments must stay lawful and relevant to group tracking. Never post PINs, OTP codes, passwords, or private banking credentials. Chat messages, transaction notes, and record replies are capped at <strong>500 characters</strong> (Group Announcements remain unlimited so full notices stay complete).</p>
    <p>To keep database and cloud storage responsive and prevent capacity exhaustion, automated nightly maintenance runs every midnight (<strong>12:00 AM Manila time</strong>) to remove expired operational data:</p>
    <div class="policy-retention-grid">
      <div class="policy-retention-row"><span class="policy-ttl-badge">90 days</span><div class="policy-retention-detail"><strong>Direct messages &amp; chat files</strong><span>Chat messages and shared attachments (photos, videos, voice notes, documents) older than 90 days are deleted automatically from database and cloud storage.</span></div></div>
      <div class="policy-retention-row"><span class="policy-ttl-badge">30 days</span><div class="policy-retention-detail"><strong>Call logs, read alerts &amp; member bin</strong><span>Call logs and read notifications clear after 30 days. Soft-deleted member records stay recoverable for 30 days before permanent removal if unlinked to active contribution ledgers.</span></div></div>
      <div class="policy-retention-row"><span class="policy-ttl-badge">90 days</span><div class="policy-retention-detail"><strong>Audit logs, security logs &amp; rejected receipts</strong><span>Audit logs, security activity events, unread notifications, and rejected or voided receipt attachments are cleared automatically after 90 days.</span></div></div>
      <div class="policy-retention-row"><span class="policy-ttl-badge is-warn">6 months</span><div class="policy-retention-detail"><strong>Inactive accounts (7-day prior notice)</strong><span>Accounts with zero sign-ins or activity for 6 months receive an automated email warning <strong>7 days prior</strong> before permanent account deletion.</span></div></div>
      <div class="policy-retention-row"><span class="policy-ttl-badge is-keep">1+ year</span><div class="policy-retention-detail"><strong>Financial ledgers &amp; annual summaries</strong><span>Confirmed contributions, expenses, and withdrawals stay preserved until Group Admins download CSV backups and create permanent annual net-savings summaries.</span></div></div>
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
      <li>Deliver email, in-app, and optional Web Push notifications for payment reviews, discussion replies, account status changes, inactivity warnings, and announcements.</li>
      <li>Summarize high-level platform updates in Super Admin release notes without exposing private group financial balances, and display optional requester credit on implemented feature requests when attribution is enabled.</li>
    </ul>
    <h3>Browser storage &amp; device alerts</h3>
    <p>The app stores session credentials, cross-tab sync keys, your light or dark theme selection, per-account policy consent cache keys, periodic data-retention reminder timestamps, and optional Web Push subscription tokens locally on your browser or Android app so settings stay consistent. Push alerts can be disabled anytime in your device settings or Account preferences.</p>
    <h3>Who can access it</h3>
    <p>Access is strictly limited by assigned role and active savings group. Authorized group administrators and treasurers review permitted group workspace activity and payout info. Platform administrators manage system health, storage hygiene, account access, bug reports, and feature requests, and are not intended to view private group savings ledgers.</p>
    <h3>Detailed data retention, automatic cleanup &amp; deletion schedule</h3>
    <p>To keep database tables lean and fast without touching confirmed financial ledgers, scheduled <code>pg_cron</code> jobs execute nightly at <strong>12:00 AM Manila time</strong> (paired with cloud Storage object cleanup and PostgreSQL <code>autovacuum</code> disk reclamation):</p>
    <div class="policy-retention-grid">
      <div class="policy-retention-row"><span class="policy-ttl-badge">7 days</span><div class="policy-retention-detail"><strong>Login rate-limit &amp; throttle logs</strong><span>Failed sign-in attempt counters (<code>auth_login_throttles</code>) expire automatically after 7 days.</span></div></div>
      <div class="policy-retention-row"><span class="policy-ttl-badge">30 days</span><div class="policy-retention-detail"><strong>Call logs &amp; read notifications</strong><span>Voice/video call session metadata (<code>call_sessions</code>) and read alerts (<code>notifications</code>) are purged automatically after 30 days.</span></div></div>
      <div class="policy-retention-row"><span class="policy-ttl-badge">30 days</span><div class="policy-retention-detail"><strong>Member recovery bin</strong><span>Soft-deleted member profiles remain recoverable for 30 days before permanent deletion when unlinked to active contribution ledgers.</span></div></div>
      <div class="policy-retention-row"><span class="policy-ttl-badge">90 days</span><div class="policy-retention-detail"><strong>Direct messages &amp; chat Storage files</strong><span>Messages (<code>messages</code>) and uploaded media in <code>chat-attachments</code> older than 90 days are deleted automatically. Messages, notes, and replies are capped at 500 characters.</span></div></div>
      <div class="policy-retention-row"><span class="policy-ttl-badge">90 days</span><div class="policy-retention-detail"><strong>Unread alerts, rejected receipts &amp; logs</strong><span>Unread notifications, rejected or voided receipt attachments (alongside their Storage files), <code>audit_logs</code>, and <code>account_activity</code> clear automatically after 90 days.</span></div></div>
      <div class="policy-retention-row"><span class="policy-ttl-badge is-warn">6 months</span><div class="policy-retention-detail"><strong>Inactive accounts (7-day warning email)</strong><span>Accounts inactive for 6 months (zero logins or activity) receive an email warning <strong>7 days prior</strong> to permanent removal of their profile, messages, media, and authentication credentials (shared groups promote an active successor automatically).</span></div></div>
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
            <p class="retention-policy-lead">myIPON runs automated database and cloud storage maintenance every midnight (12:00 AM PHT) via scheduled <code>pg_cron</code> jobs so storage stays clean without deleting active group savings ledgers.</p>
            <div class="retention-policy-grid">
              <article class="retention-policy-item">
                <strong>90 days · Automatic nightly cleanup</strong>
                <p>Direct messages, files in <code>chat-attachments</code>, rejected/voided receipt images, unread alerts, audit logs, and security activity logs older than 90 days are deleted automatically.</p>
              </article>
              <article class="retention-policy-item">
                <strong>30 days · Call logs, alerts &amp; recovery bin</strong>
                <p>Call logs and read notifications clear automatically after 30 days. Soft-deleted member records stay recoverable in the recovery bin for 30 days before permanent cleanup.</p>
              </article>
              <article class="retention-policy-item">
                <strong>6 months · Inactive accounts (7-day notice)</strong>
                <p>Accounts with zero sign-ins or activity for 6 months automatically receive an email warning 7 days before permanent removal of their profile, messages, media, and credentials.</p>
              </article>
              <article class="retention-policy-item">
                <strong>1+ year · Financial annual roll-up (CSV first)</strong>
                <p>Confirmed savings records are never deleted automatically. After 1 year, Group Admins can export CSV backups first in <strong>Reports &rarr; Annual data roll-up</strong> and summarize the year into permanent totals.</p>
              </article>
              <article class="retention-policy-item">
                <strong>500-char limit &amp; cloud media storage</strong>
                <p>Chat messages, transaction notes, and record replies are capped at 500 characters (Announcements remain unlimited). Photos and voice notes are stored in cloud object buckets instead of raw database blobs, alongside PostgreSQL <code>autovacuum</code>.</p>
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
      <p>Chat messages and media older than 90 days clear automatically, year-old records can be rolled up after CSV export, and inactive accounts (6 months) receive a 7-day email notice before removal.</p>
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
          <div class="policy-consent-bar">
            <div class="policy-consent-tabs" role="tablist" aria-label="Policy documents">
              <button class="policy-consent-tab" id="ipon-consent-tab-terms" type="button" role="tab" aria-selected="true" data-consent-tab="terms">Terms of Use</button>
              <button class="policy-consent-tab" id="ipon-consent-tab-privacy" type="button" role="tab" aria-selected="false" data-consent-tab="privacy">Privacy Policy</button>
            </div>
            <div class="policy-consent-highlights" aria-label="Key retention rules">
              <span class="policy-consent-chip">90d Chat &amp; Logs</span>
              <span class="policy-consent-chip">30d Calls &amp; Bin</span>
              <span class="policy-consent-chip">6mo Inactive Notice</span>
              <span class="policy-consent-chip">1yr CSV Roll-up</span>
            </div>
          </div>
        </header>
        <div class="policy-content policy-consent-body" id="ipon-consent-scroll">
          <section data-consent-panel="terms">
            ${POLICY_TERMS_HTML}
            <div class="policy-consent-switch-hint">
              <span>Want to review our Privacy Policy and full 7-to-90 day retention table next?</span>
              <button class="button button-secondary button-sm" type="button" data-consent-jump="privacy">Read Privacy Policy &rarr;</button>
            </div>
          </section>
          <section data-consent-panel="privacy" hidden>
            ${POLICY_PRIVACY_HTML}
          </section>
        </div>
        <footer class="policy-consent-footer">
          <label class="policy-consent-check" for="ipon-consent-checkbox">
            <input id="ipon-consent-checkbox" type="checkbox">
            <span>I have read and agree to the myIPON <strong>Terms of Use</strong> and <strong>Privacy Policy</strong>, including the automated retention schedules (90-day chat/logs, 30-day calls/recovery bin, and 6-month inactivity cleanup).</span>
          </label>
          <p class="policy-consent-error" id="ipon-consent-error" role="alert" aria-live="polite"></p>
          <div class="policy-consent-actions">
            <div class="policy-consent-actions-left">
              <button class="button button-secondary button-sm" id="ipon-consent-signout" type="button">Sign out</button>
              <span class="policy-consent-once-note">Shown once per account after policy updates.</span>
            </div>
            <button class="button button-primary policy-consent-agree-btn" id="ipon-consent-agree-btn" type="button" disabled>I agree &amp; continue</button>
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
    dialog.querySelector?.('[data-consent-jump]')?.addEventListener?.('click', () => selectTab('privacy'));

    checkbox?.addEventListener?.('change', () => {
      if (agreeBtn) agreeBtn.disabled = !checkbox.checked;
      if (checkbox.checked) showConsentError('');
    });

    dialog.addEventListener?.('cancel', (event) => {
      if (dialog.dataset?.accepted !== '1') {
        event.preventDefault?.();
        showConsentError('Please check the confirmation box and click "I agree & continue" to proceed.');
      }
    });

    signOutBtn?.addEventListener?.('click', () => {
      if (dialog.dataset) dialog.dataset.accepted = '1';
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

  const exports = {
    CURRENT_POLICY_VERSION,
    openPolicyDialog,
    openRetentionPolicyDialog,
    maybeShowRetentionReminder,
    hasAcceptedCurrentPolicy,
    maybeShowPolicyConsentModal
  };

  window.IponPolicy = exports;
  if (window.Ipon && typeof window.Ipon === 'object') {
    Object.assign(window.Ipon, exports);
  }
})();
