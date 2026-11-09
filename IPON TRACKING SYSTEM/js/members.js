(async function () {
  'use strict';
  const state = await Ipon.init();
  const tbody = document.getElementById('members-body');
  const form = document.getElementById('member-form');
  const search = document.getElementById('member-search');
  let members = [];
  document.getElementById('date-registered').value = Ipon.isoDate();
  if (!state.configured || !state.profile) { tbody.innerHTML = '<tr><td colspan="6" class="empty-state">Connect Supabase to load members.</td></tr>'; return; }

  function render() {
    const query = search.value.trim().toLowerCase();
    const visible = members.filter((member) => member.full_name.toLowerCase().includes(query));
    document.getElementById('member-count').textContent = `${visible.length} member${visible.length === 1 ? '' : 's'}`;
    tbody.innerHTML = visible.length ? visible.map((member) => `<tr>
      <td><strong>${Ipon.escapeHtml(member.full_name)}</strong></td><td>${Ipon.escapeHtml(member.contact_number || '—')}</td><td>${Ipon.dateLabel(member.date_registered)}</td>
      <td>${Ipon.money(member.monthly_contribution_amount)}</td><td><span class="status status-${member.status.toLowerCase()}">${member.status}</span></td>
      <td>${state.profile.role === 'ADMIN' ? `<div class="table-actions"><button class="icon-action" data-action="edit" data-id="${member.id}">Edit</button>${member.status === 'ACTIVE' ? `<button class="icon-action" data-action="deactivate" data-id="${member.id}">Deactivate</button>` : ''}</div>` : ''}</td></tr>`).join('') : '<tr><td colspan="6" class="empty-state">No matching members.</td></tr>';
  }
  async function load() {
    const { data, error } = await Ipon.client.from('members').select('*').order('full_name');
    if (error) throw error; members = data; render();
  }
  function resetForm() {
    form.reset(); form.elements.member_id.value = ''; document.getElementById('date-registered').value = Ipon.isoDate();
    document.getElementById('member-form-title').textContent = 'Add member'; document.getElementById('cancel-edit').hidden = true;
  }
  form?.addEventListener('submit', async (event) => {
    event.preventDefault(); const button = form.querySelector('[type="submit"]'); const values = new FormData(form); Ipon.setBusy(button, true);
    try {
      if (values.get('member_id')) await Ipon.rpc('update_member', { p_member_id: values.get('member_id'), p_full_name: values.get('full_name'), p_contact_number: values.get('contact_number'), p_monthly_contribution_amount: Number(values.get('monthly_contribution_amount')), p_notes: values.get('notes') || null });
      else await Ipon.rpc('create_member', { p_full_name: values.get('full_name'), p_contact_number: values.get('contact_number'), p_date_registered: values.get('date_registered'), p_monthly_contribution_amount: Number(values.get('monthly_contribution_amount')), p_notes: values.get('notes') || null });
      Ipon.toast(values.get('member_id') ? 'Member updated.' : 'Member added.'); resetForm(); await load();
    } catch (error) { Ipon.toast(Ipon.friendlyError(error), 'error'); } finally { Ipon.setBusy(button, false); }
  });
  tbody.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-action]'); if (!button) return; const member = members.find((item) => item.id === button.dataset.id); if (!member) return;
    if (button.dataset.action === 'edit') {
      form.elements.member_id.value = member.id; form.elements.full_name.value = member.full_name; form.elements.contact_number.value = member.contact_number || '';
      form.elements.date_registered.value = member.date_registered; form.elements.monthly_contribution_amount.value = member.monthly_contribution_amount; form.elements.notes.value = member.notes || '';
      document.getElementById('member-form-title').textContent = 'Edit member'; document.getElementById('cancel-edit').hidden = false; form.scrollIntoView({ behavior: 'smooth' });
    } else {
      const accepted = await Ipon.confirmAction({ title: 'Deactivate member?', message: `${member.full_name} will stop receiving new contribution periods. Existing records remain available.`, acceptLabel: 'Deactivate' });
      if (!accepted) return;
      try { await Ipon.rpc('deactivate_member', { p_member_id: member.id }); Ipon.toast('Member deactivated.'); await load(); } catch (error) { Ipon.toast(Ipon.friendlyError(error), 'error'); }
    }
  });
  document.getElementById('cancel-edit')?.addEventListener('click', resetForm); search.addEventListener('input', render);
  try { await load(); } catch (error) { tbody.innerHTML = `<tr><td colspan="6" class="empty-state">${Ipon.escapeHtml(Ipon.friendlyError(error))}</td></tr>`; }
})();
