(async function () {
  'use strict';
  const state = await Ipon.init();
  if (state.failed || !state.configured || !state.profile) return;
  if (state.profile.role !== 'ADMIN') { location.replace('dashboard.html'); return; }

  const body = document.getElementById('audit-body');
  const tableFilter = document.getElementById('audit-table-filter');
  const actionFilter = document.getElementById('audit-action-filter');
  const pager = document.getElementById('audit-pager');
  const pageSize = 50;
  let page = 0;
  let actors = new Map();

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
    const pages = Math.max(1, Math.ceil(count / pageSize));
    document.getElementById('audit-count').textContent = `${count} recorded event${count === 1 ? '' : 's'}`;
    pager.querySelector('span').textContent = `Page ${page + 1} of ${pages}`;
    pager.querySelector('[data-page="previous"]').disabled = page === 0;
    pager.querySelector('[data-page="next"]').disabled = page >= pages - 1;
    body.innerHTML = data.length ? data.map((row) => `<tr><td>${Ipon.dateLabel(row.changed_at, { dateStyle: 'medium', timeStyle: 'short' })}</td><td>${Ipon.escapeHtml(actors.get(row.changed_by) || 'System')}</td><td>${Ipon.escapeHtml(row.table_name.replaceAll('_', ' '))}</td><td><span class="status status-${row.action.toLowerCase()}">${Ipon.escapeHtml(row.action)}</span></td><td><span class="audit-record-id" title="${Ipon.escapeHtml(row.record_id || '')}">${Ipon.escapeHtml(row.record_id || '—')}</span></td><td>${Ipon.escapeHtml(summary(row))}</td></tr>`).join('') : '<tr><td colspan="6" class="empty-state">No matching audit activity.</td></tr>';
  }

  try {
    const { data: profiles, error } = await Ipon.client.from('profiles').select('id,full_name');
    if (error) throw error;
    actors = new Map(profiles.map((profile) => [profile.id, profile.full_name]));
    await load();
  } catch (error) { body.innerHTML = `<tr><td colspan="6" class="empty-state">${Ipon.escapeHtml(Ipon.friendlyError(error))}</td></tr>`; }

  [tableFilter, actionFilter].forEach((filter) => filter.addEventListener('change', async () => { page = 0; await load(); }));
  pager.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-page]');
    if (!button || button.disabled) return;
    page += button.dataset.page === 'next' ? 1 : -1;
    await load();
  });
})();
