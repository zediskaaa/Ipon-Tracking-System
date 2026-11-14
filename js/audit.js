(async function () {
  'use strict';
  const state = await Ipon.init();
  if (state.failed || !state.configured || !state.profile) return;
  if (state.profile.role !== 'ADMIN') { location.replace('dashboard.html'); return; }

  const body = document.getElementById('audit-body');
  const searchInput = document.getElementById('audit-search');
  const dateFromInput = document.getElementById('audit-date-from');
  const dateToInput = document.getElementById('audit-date-to');
  const tableFilter = document.getElementById('audit-table-filter');
  const actionFilter = document.getElementById('audit-action-filter');
  const pager = document.getElementById('audit-pager');
  const detailDialog = document.getElementById('audit-detail-dialog');
  const detailEyebrow = document.getElementById('audit-detail-eyebrow');
  const detailTitle = document.getElementById('audit-detail-title');
  const detailMeta = document.getElementById('audit-detail-meta');
  const detailActor = document.getElementById('audit-detail-actor');
  const detailSubject = document.getElementById('audit-detail-subject');
  const detailRecord = document.getElementById('audit-detail-record');
  const detailChanges = document.getElementById('audit-detail-changes');
  const pageSize = 50;
  let page = 0;
  let actors = new Map();
  let lookups = {
    profiles: actors,
    actors,
    members: new Map(),
    groups: new Map(),
    periods: new Map()
  };
  let rows = [];
  let previewImages = [];

  function renderAuditValueHtml(descriptor, sideLabel) {
    if (!descriptor || descriptor.kind === 'empty') {
      return `<span class="audit-diff-muted">${Ipon.escapeHtml(descriptor?.text || 'None')}</span>`;
    }
    if (descriptor.kind === 'image' && descriptor.src) {
      const idx = previewImages.push({ src: descriptor.src, label: descriptor.caption || sideLabel || 'Attachment' }) - 1;
      return `<button type="button" class="audit-diff-media" data-audit-image-idx="${idx}"><img src="${Ipon.escapeHtml(descriptor.src)}" alt="${Ipon.escapeHtml(descriptor.caption || sideLabel || 'Attachment')}"><span><strong>${Ipon.escapeHtml(descriptor.caption || 'View image')}</strong><small>Click to enlarge</small></span></button>`;
    }
    const titleAttr = descriptor.title ? ` title="${Ipon.escapeHtml(descriptor.title)}"` : '';
    return `<span${titleAttr}>${Ipon.escapeHtml(descriptor.text || '—')}</span>`;
  }

  function renderAuditComparison(entry) {
    previewImages = [];
    if (!entry.changes.length) {
      detailChanges.innerHTML = '<div class="audit-diff-empty">No user-visible fields changed in this update.</div>';
      return;
    }
    if (entry.mode === 'create' || entry.mode === 'delete') {
      const bannerClass = entry.mode === 'delete' ? 'audit-snapshot-banner is-delete' : 'audit-snapshot-banner';
      const bannerText = entry.mode === 'delete'
        ? 'Record removed — details stored before deletion:'
        : 'New record created with these details:';
      const cards = entry.changes.map((change) => {
        const valueDesc = entry.mode === 'delete' ? change.before : change.after;
        return `<article class="audit-snapshot-item"><span class="audit-snapshot-label">${Ipon.escapeHtml(change.label)}</span><div class="audit-diff-val${valueDesc.muted ? ' is-muted' : ''}">${renderAuditValueHtml(valueDesc, change.label)}</div></article>`;
      }).join('');
      detailChanges.innerHTML = `<div class="${bannerClass}">${Ipon.escapeHtml(bannerText)}</div><div class="audit-snapshot-grid">${cards}</div>`;
      return;
    }

    detailChanges.innerHTML = entry.changes.map((change) => {
      if (change.display === 'detail') {
        const valueDesc = change.detailValue || change.after;
        const toneClass = change.detailTone ? ` is-${change.detailTone}` : ' is-neutral';
        const tag = change.detailTag || 'Recorded';
        return `
      <article class="audit-diff-card is-detail">
        <div class="audit-diff-field">${Ipon.escapeHtml(change.label)}</div>
        <div class="audit-diff-detail${toneClass}">
          <span class="audit-diff-tag">${Ipon.escapeHtml(tag)}</span>
          <div class="audit-diff-val${valueDesc?.muted ? ' is-muted' : ''}">${renderAuditValueHtml(valueDesc, `${tag} — ${change.label}`)}</div>
        </div>
      </article>`;
      }
      return `
      <article class="audit-diff-card">
        <div class="audit-diff-field">${Ipon.escapeHtml(change.label)}</div>
        <div class="audit-diff-pair">
          <div class="audit-diff-side is-before">
            <span class="audit-diff-tag">Before</span>
            <div class="audit-diff-val${change.before.muted ? ' is-muted' : ''}">${renderAuditValueHtml(change.before, `Before — ${change.label}`)}</div>
          </div>
          <div class="audit-diff-arrow" aria-hidden="true">→</div>
          <div class="audit-diff-side is-after">
            <span class="audit-diff-tag">After</span>
            <div class="audit-diff-val${change.after.muted ? ' is-muted' : ''}">${renderAuditValueHtml(change.after, `After — ${change.label}`)}</div>
          </div>
        </div>
      </article>`;
    }).join('');
  }

  async function loadLookups() {
    const [profileRes, memberRes, groupRes, periodRes] = await Promise.allSettled([
      Ipon.client.from('profiles').select('id,full_name'),
      Ipon.client.from('members').select('id,full_name'),
      Ipon.client.from('groups').select('id,name'),
      Ipon.client.from('contribution_periods').select('id,member_id,period_month')
    ]);
    if (profileRes.status === 'rejected') throw profileRes.reason;
    if (profileRes.value.error) throw profileRes.value.error;

    actors = new Map((profileRes.value.data || []).map((profile) => [profile.id, profile.full_name]));
    const members = memberRes.status === 'fulfilled' && !memberRes.value.error
      ? new Map((memberRes.value.data || []).map((member) => [member.id, member.full_name]))
      : new Map();
    const groups = groupRes.status === 'fulfilled' && !groupRes.value.error
      ? new Map((groupRes.value.data || []).map((group) => [group.id, group.name]))
      : new Map();
    const periods = periodRes.status === 'fulfilled' && !periodRes.value.error
      ? new Map((periodRes.value.data || []).map((period) => [period.id, { member_id: period.member_id, period_month: period.period_month }]))
      : new Map();

    lookups = { profiles: actors, actors, members, groups, periods };
  }

  async function load() {
    if (!rows.length) body.innerHTML = '<tr class="loading-row"><td colspan="6">Loading audit activity…</td></tr>';
    let query = Ipon.client.from('audit_logs').select('id,table_name,record_id,action,old_data,new_data,changed_by,changed_at', { count: 'exact' });
    if (tableFilter.value) query = query.eq('table_name', tableFilter.value);
    if (actionFilter.value) query = query.eq('action', actionFilter.value);
    if (dateFromInput?.value) query = query.gte('changed_at', `${dateFromInput.value}T00:00:00+08:00`);
    if (dateToInput?.value) query = query.lte('changed_at', `${dateToInput.value}T23:59:59+08:00`);

    const search = (searchInput?.value || '').trim();
    if (search) {
      const lower = search.toLowerCase();
      const matchedActors = [...actors.entries()].filter(([, name]) => String(name || '').toLowerCase().includes(lower)).map(([id]) => id);
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(search);
      const orParts = [];
      if (matchedActors.length) orParts.push(`changed_by.in.(${matchedActors.join(',')})`);
      if (isUuid) orParts.push(`record_id.eq.${search}`);
      if ('system'.includes(lower)) orParts.push('changed_by.is.null');
      if (!orParts.length) {
        rows = [];
        document.getElementById('audit-count').textContent = '0 recorded events';
        pager.querySelector('span').textContent = 'Page 1 of 1';
        pager.querySelector('[data-page="previous"]').disabled = true;
        pager.querySelector('[data-page="next"]').disabled = true;
        body.innerHTML = '<tr><td colspan="6" class="empty-state">No matching audit activity.</td></tr>';
        return;
      }
      query = query.or(orParts.join(','));
    }

    const { data, count, error } = await query.order('changed_at', { ascending: false }).range(page * pageSize, (page + 1) * pageSize - 1);
    if (error) throw error;
    rows = data || [];
    const effectiveLookups = Ipon.collectAuditLookupsFromRows(rows, lookups);
    lookups = effectiveLookups;

    const total = Number(count || 0);
    const pages = Math.max(1, Math.ceil(total / pageSize));
    document.getElementById('audit-count').textContent = `${total} recorded event${total === 1 ? '' : 's'}`;
    pager.querySelector('span').textContent = `Page ${page + 1} of ${pages}`;
    pager.querySelector('[data-page="previous"]').disabled = page === 0;
    pager.querySelector('[data-page="next"]').disabled = page >= pages - 1;

    body.innerHTML = rows.length ? rows.map((row) => {
      const entry = Ipon.formatAuditEntry(row, effectiveLookups);
      return `<tr><td data-label="Date and time">${Ipon.dateLabel(row.changed_at, { dateStyle: 'medium', timeStyle: 'short' })}</td><td data-label="Actor">${Ipon.escapeHtml(entry.actor)}</td><td data-label="Record type">${Ipon.escapeHtml(entry.tableLabel)}</td><td data-label="Action"><span class="status status-${row.action.toLowerCase()}">${Ipon.escapeHtml(entry.actionLabel)}</span></td><td data-label="Record ID"><span class="audit-record-id" title="${Ipon.escapeHtml(row.record_id || '')}">${Ipon.escapeHtml(row.record_id || '—')}</span></td><td data-label="Summary"><button class="audit-detail-trigger" type="button" data-audit-open="${Ipon.escapeHtml(row.id)}">${Ipon.escapeHtml(entry.summary)}</button></td></tr>`;
    }).join('') : '<tr><td colspan="6" class="empty-state">No matching audit activity.</td></tr>';
  }

  body.addEventListener('click', (event) => {
    const trigger = event.target.closest('[data-audit-open]');
    if (!trigger) return;
    const row = rows.find((item) => String(item.id) === trigger.dataset.auditOpen);
    if (!row) return;
    const entry = Ipon.formatAuditEntry(row, lookups);
    if (detailEyebrow) detailEyebrow.textContent = `Audit details · ${entry.tableLabel}`;
    detailTitle.textContent = entry.summary;
    detailMeta.textContent = `${entry.actionLabel} · ${Ipon.dateLabel(row.changed_at, { dateStyle: 'medium', timeStyle: 'short' })}`;
    if (detailActor) detailActor.textContent = entry.actor;
    if (detailSubject) detailSubject.textContent = entry.subject;
    detailRecord.textContent = row.record_id || '—';
    renderAuditComparison(entry);
    detailDialog.showModal();
  });
  detailChanges?.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-audit-image-idx]');
    if (!btn) return;
    const item = previewImages[Number(btn.dataset.auditImageIdx)];
    if (!item?.src) return;
    Ipon.openImageViewer?.(item.src, item.label || 'Audit media', detailTitle?.textContent || '');
  });
  document.getElementById('close-audit-dialog').addEventListener('click', () => detailDialog.close());
  detailDialog.addEventListener('click', (event) => { if (event.target === detailDialog) detailDialog.close(); });

  try {
    await loadLookups();
    await load();
  } catch (error) { Ipon.showInlineError(body, error, load, 6); } finally { Ipon.setLoading(false); }
  Ipon.subscribeToChanges('audit', ['audit_logs', 'profiles', 'members', 'groups'], async () => {
    await loadLookups();
    await load();
  });

  let searchTimer = null;
  const resetAndLoad = async () => { page = 0; try { await load(); } catch (error) { Ipon.showInlineError(body, error, load, 6); } };
  [tableFilter, actionFilter, dateFromInput, dateToInput].forEach((filter) => filter?.addEventListener('change', resetAndLoad));
  searchInput?.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(resetAndLoad, 220);
  });
  pager.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-page]');
    if (!button || button.disabled) return;
    page += button.dataset.page === 'next' ? 1 : -1;
    try { await load(); } catch (error) { Ipon.showInlineError(body, error, load, 6); }
  });
})();
