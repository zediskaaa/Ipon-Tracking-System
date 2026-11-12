(async function () {
  'use strict';
  const state = await Ipon.init();
  if (state.failed || !state.configured || !state.profile) return;
  if (state.profile.role !== 'ADMIN') { location.replace('dashboard.html'); return; }

  const body = document.getElementById('audit-body');
  const tableFilter = document.getElementById('audit-table-filter');
  const actionFilter = document.getElementById('audit-action-filter');
  const pager = document.getElementById('audit-pager');
  const detailDialog = document.getElementById('audit-detail-dialog');
  const detailTitle = document.getElementById('audit-detail-title');
  const detailMeta = document.getElementById('audit-detail-meta');
  const detailRecord = document.getElementById('audit-detail-record');
  const detailBefore = document.getElementById('audit-detail-before');
  const detailAfter = document.getElementById('audit-detail-after');
  const pageSize = 50;
  let page = 0;
  let actors = new Map();
  let rows = [];

  function summary(row) {
    if (row.action === 'INSERT') return 'Record created';
    if (row.action === 'DELETE') return 'Record deleted';
    const ignored = new Set(['updated_at', 'reviewed_at', 'voided_at']);
    const before = row.old_data || {};
    const after = row.new_data || {};
    const fields = Object.keys(after).filter((key) => !ignored.has(key) && JSON.stringify(before[key]) !== JSON.stringify(after[key]));
    return fields.length ? `Changed: ${fields.slice(0, 4).join(', ')}${fields.length > 4 ? '…' : ''}` : 'Record updated';
  }

  async function load() {
    body.innerHTML = '<tr class="loading-row"><td colspan="6">Loading audit activity…</td></tr>';
    let query = Ipon.client.from('audit_logs').select('id,table_name,record_id,action,old_data,new_data,changed_by,changed_at', { count: 'exact' });
    if (tableFilter.value) query = query.eq('table_name', tableFilter.value);
    if (actionFilter.value) query = query.eq('action', actionFilter.value);
    const { data, count, error } = await query.order('changed_at', { ascending: false }).range(page * pageSize, (page + 1) * pageSize - 1);
    if (error) throw error;
    rows = data || [];
    const pages = Math.max(1, Math.ceil(count / pageSize));
    document.getElementById('audit-count').textContent = `${count} recorded event${count === 1 ? '' : 's'}`;
    pager.querySelector('span').textContent = `Page ${page + 1} of ${pages}`;
    pager.querySelector('[data-page="previous"]').disabled = page === 0;
    pager.querySelector('[data-page="next"]').disabled = page >= pages - 1;
    body.innerHTML = rows.length ? rows.map((row) => `<tr><td>${Ipon.dateLabel(row.changed_at, { dateStyle: 'medium', timeStyle: 'short' })}</td><td>${Ipon.escapeHtml(actors.get(row.changed_by) || 'System')}</td><td>${Ipon.escapeHtml(row.table_name.replaceAll('_', ' '))}</td><td><span class="status status-${row.action.toLowerCase()}">${Ipon.escapeHtml(row.action)}</span></td><td><span class="audit-record-id" title="${Ipon.escapeHtml(row.record_id || '')}">${Ipon.escapeHtml(row.record_id || '—')}</span></td><td><button class="audit-detail-trigger" type="button" data-audit-open="${Ipon.escapeHtml(row.id)}">${Ipon.escapeHtml(summary(row))}</button></td></tr>`).join('') : '<tr><td colspan="6" class="empty-state">No matching audit activity.</td></tr>';
  }

  body.addEventListener('click', (event) => {
    const trigger = event.target.closest('[data-audit-open]');
    if (!trigger) return;
    const row = rows.find((item) => String(item.id) === trigger.dataset.auditOpen);
    if (!row) return;
    detailTitle.textContent = summary(row);
    detailMeta.textContent = `${actors.get(row.changed_by) || 'System'} · ${row.table_name.replaceAll('_', ' ')} (${row.action}) · ${Ipon.dateLabel(row.changed_at, { dateStyle: 'medium', timeStyle: 'short' })}`;
    detailRecord.textContent = row.record_id || '—';
    detailBefore.textContent = row.old_data ? JSON.stringify(row.old_data, null, 2) : '—';
    detailAfter.textContent = row.new_data ? JSON.stringify(row.new_data, null, 2) : '—';
    detailDialog.showModal();
  });
  document.getElementById('close-audit-dialog').addEventListener('click', () => detailDialog.close());
  detailDialog.addEventListener('click', (event) => { if (event.target === detailDialog) detailDialog.close(); });

  try {
    const { data: profiles, error } = await Ipon.client.from('profiles').select('id,full_name');
    if (error) throw error;
    actors = new Map(profiles.map((profile) => [profile.id, profile.full_name]));
    await load();
  } catch (error) { Ipon.showInlineError(body, error, load, 6); }

  [tableFilter, actionFilter].forEach((filter) => filter.addEventListener('change', async () => { page = 0; try { await load(); } catch (error) { Ipon.showInlineError(body, error, load, 6); } }));
  pager.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-page]');
    if (!button || button.disabled) return;
    page += button.dataset.page === 'next' ? 1 : -1;
    try { await load(); } catch (error) { Ipon.showInlineError(body, error, load, 6); }
  });
})();
