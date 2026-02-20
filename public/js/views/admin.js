/**
 * views/admin.js  —  Senior admin panel (users, realm settings, attendance register)
 * Project admin: realm list management
 */
'use strict';

const AdminView = (() => {
  let _realmId = null;
  let _user    = null;

  function render(user, realmId) {
    _user    = user;
    _realmId = realmId;
    App.setTitle('Admin');
    App.setBack(false);

    if (user.role === 'project_admin') {
      _renderProjectAdmin();
    } else {
      _renderSeniorAdmin();
    }
  }

  // ── Project admin: manage realms ──────────────────────────────────────────────
  function _renderProjectAdmin() {
    document.getElementById('view-root').innerHTML = `
      <div class="admin-scroll">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <span class="section-title">Realms</span>
          <button class="btn btn-primary btn-sm" id="btn-new-realm">＋ New Realm</button>
        </div>
        <div id="realm-list"><div class="spinner"></div></div>
      </div>`;

    document.getElementById('btn-new-realm').addEventListener('click', _showNewRealm);
    _loadRealms();
  }

  async function _loadRealms() {
    const el = document.getElementById('realm-list');
    try {
      const res  = await API.realms.list();
      const list = res.data || [];
      if (!list.length) { el.innerHTML = '<div class="empty-state"><p>No realms yet</p></div>'; return; }
      el.innerHTML = `<div>${list.map((r) => `
        <div class="user-row">
          <div class="avatar" style="background:var(--primary);color:#fff">R</div>
          <div style="flex:1">
            <div class="font-semibold">${esc(r.name)}</div>
            <div class="text-xs text-muted">${r.status} · ${r.settings?.timezone || 'UTC'}</div>
          </div>
          <span class="chip ${r.status === 'active' ? 'chip-success' : 'chip-gray'}">${r.status}</span>
        </div>`).join('')}</div>`;
    } catch (err) { el.innerHTML = `<div class="empty-state"><p>${esc(err.message)}</p></div>`; }
  }

  function _showNewRealm() {
    App.showModal({
      title: 'Create Realm',
      body: `
        <div style="display:flex;flex-direction:column;gap:14px;">
          <div class="form-group"><label class="form-label">Realm Name</label><input class="form-input" id="rl-name" placeholder="e.g. Class 10-A"/></div>
          <div class="form-group"><label class="form-label">Timezone</label>
            <select class="form-input" id="rl-tz">
              <option value="UTC">UTC</option>
              <option value="Europe/London">Europe/London</option>
              <option value="Europe/Paris">Europe/Paris</option>
              <option value="America/New_York">America/New_York</option>
              <option value="Asia/Kolkata">Asia/Kolkata</option>
              <option value="Asia/Tokyo">Asia/Tokyo</option>
            </select>
          </div>
          <div style="border-top:1px solid var(--border);padding-top:14px;">
            <div class="section-title" style="margin-bottom:10px;">First Senior Admin</div>
            <div style="display:flex;flex-direction:column;gap:10px;">
              <div class="form-group"><label class="form-label">Display Name</label><input class="form-input" id="rl-admin-name" placeholder="Full name"/></div>
              <div class="form-group"><label class="form-label">Username</label><input class="form-input" id="rl-admin-user" autocapitalize="none" placeholder="e.g. teacher01"/></div>
              <div class="form-group"><label class="form-label">Password</label><input class="form-input" type="password" id="rl-admin-pass" placeholder="Min 8 chars"/></div>
            </div>
          </div>
        </div>`,
      actions: [
        { label: 'Cancel', cls: 'btn-outline', action: 'cancel' },
        { label: 'Create', cls: 'btn-primary', action: 'create' },
      ],
      onAction: async (action, modal) => {
        if (action !== 'create') return;
        const name   = modal.querySelector('#rl-name').value.trim();
        const tz     = modal.querySelector('#rl-tz').value;
        const admin  = {
          displayName: modal.querySelector('#rl-admin-name').value.trim(),
          username:    modal.querySelector('#rl-admin-user').value.trim(),
          password:    modal.querySelector('#rl-admin-pass').value,
        };
        if (!name || !admin.displayName || !admin.username || !admin.password) {
          App.toast('All fields are required.', 'warning'); return;
        }
        try {
          await API.realms.create({ name, timezone: tz, seniorAdmin: admin });
          App.toast('Realm created!', 'success');
          App.closeModal();
          _loadRealms();
        } catch (err) { App.toast(err.message, 'danger'); }
      },
    });
  }

  // ── Senior admin: users + attendance register ─────────────────────────────────
  function _renderSeniorAdmin() {
    document.getElementById('view-root').innerHTML = `
      <div class="admin-scroll">
        <div style="display:flex;gap:8px;margin-bottom:4px;">
          <button class="btn btn-outline btn-sm tab-btn active" data-tab="users">Users</button>
          <button class="btn btn-outline btn-sm tab-btn" data-tab="register">Register</button>
        </div>
        <div id="admin-tab-content"><div class="spinner"></div></div>
      </div>`;

    document.querySelectorAll('.tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        if (btn.dataset.tab === 'users') _loadUsers();
        else _loadRegister();
      });
    });

    _loadUsers();
  }

  async function _loadUsers() {
    const el = document.getElementById('admin-tab-content');
    el.innerHTML = '<div class="spinner"></div>';
    try {
      const res   = await API.users(_realmId).list();
      const users = res.data || [];
      el.innerHTML = `
        <div style="display:flex;justify-content:flex-end;margin-bottom:8px;">
          <button class="btn btn-primary btn-sm" id="btn-add-user">＋ Add User</button>
        </div>
        <div>${users.map(_userRow).join('')}</div>`;
      el.querySelector('#btn-add-user')?.addEventListener('click', _showAddUser);
      el.querySelectorAll('.del-user-btn').forEach((btn) => {
        btn.addEventListener('click', () => _deleteUser(btn.dataset.uid));
      });
    } catch (err) { el.innerHTML = `<div class="empty-state"><p>${esc(err.message)}</p></div>`; }
  }

  function _userRow(u) {
    const av = (u.displayName || '?').charAt(0).toUpperCase();
    return `<div class="user-row">
      <div class="avatar" style="background:var(--primary-light);color:var(--primary)">${av}</div>
      <div style="flex:1;min-width:0">
        <div class="font-semibold truncate">${esc(u.displayName)}</div>
        <div class="text-xs text-muted">@${esc(u.username)} · ${esc(u.role)}</div>
      </div>
      ${u.role !== 'senior_admin' ? `<button class="icon-btn del-user-btn" data-uid="${u.id}" title="Remove user" style="color:var(--danger)">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="22" y1="10" x2="16" y2="10"/></svg>
      </button>` : `<span class="chip chip-primary">Senior</span>`}
    </div>`;
  }

  function _showAddUser() {
    App.showModal({
      title: 'Add User',
      body: `
        <div style="display:flex;flex-direction:column;gap:12px;">
          <div class="form-group"><label class="form-label">Display Name</label><input class="form-input" id="au-name" placeholder="Full name"/></div>
          <div class="form-group"><label class="form-label">Username</label><input class="form-input" id="au-user" autocapitalize="none" placeholder="e.g. student01"/></div>
          <div class="form-group"><label class="form-label">Password</label><input class="form-input" type="password" id="au-pass" placeholder="Min 8 chars"/></div>
          <div class="form-group"><label class="form-label">Role</label>
            <select class="form-input" id="au-role">
              <option value="student">Student</option>
              <option value="senior_admin">Senior Admin</option>
            </select>
          </div>
        </div>`,
      actions: [
        { label: 'Cancel', cls: 'btn-outline', action: 'cancel' },
        { label: 'Add', cls: 'btn-primary', action: 'add' },
      ],
      onAction: async (action, modal) => {
        if (action !== 'add') return;
        const body = {
          displayName: modal.querySelector('#au-name').value.trim(),
          username:    modal.querySelector('#au-user').value.trim(),
          password:    modal.querySelector('#au-pass').value,
          role:        modal.querySelector('#au-role').value,
        };
        if (!body.displayName || !body.username || !body.password) {
          App.toast('All fields are required.', 'warning'); return;
        }
        try {
          await API.users(_realmId).create(body);
          App.toast('User added!', 'success');
          App.closeModal();
          _loadUsers();
        } catch (err) { App.toast(err.message, 'danger'); }
      },
    });
  }

  async function _deleteUser(uid) {
    if (!confirm('Remove this user?')) return;
    try {
      await API.users(_realmId).remove(uid);
      App.toast('User removed.', 'success');
      _loadUsers();
    } catch (err) { App.toast(err.message, 'danger'); }
  }

  async function _loadRegister() {
    const el = document.getElementById('admin-tab-content');
    el.innerHTML = '<div class="spinner"></div>';
    try {
      const res      = await API.attendance(_realmId).todayRegister();
      const register = res.data;
      if (!register || !register.students) {
        el.innerHTML = '<div class="empty-state"><p>No register data for today.</p></div>';
        return;
      }
      const periods  = register.periods || [];
      const students = register.students || [];

      if (!students.length) { el.innerHTML = '<div class="empty-state"><p>No students yet.</p></div>'; return; }

      // Simple table for today's register
      el.innerHTML = `
        <div style="overflow-x:auto;">
          <table style="width:100%;border-collapse:collapse;font-size:.8rem;">
            <thead>
              <tr style="background:var(--surface-3)">
                <th style="padding:8px;text-align:left;border:1px solid var(--border)">Student</th>
                ${periods.map((p) => `<th style="padding:8px;text-align:center;border:1px solid var(--border);max-width:60px;word-break:break-all;">${esc(p.subject.slice(0,8))}<br><span style="font-weight:400;color:var(--text-2)">${p.startTime.slice(0,5)}</span></th>`).join('')}
              </tr>
            </thead>
            <tbody>
              ${students.map((s) => `
                <tr>
                  <td style="padding:8px;border:1px solid var(--border);white-space:nowrap">${esc(s.displayName)}</td>
                  ${periods.map((p) => {
                    const rec = s.attendance?.[p.id];
                    const icon = rec?.status === 'present' ? '✅' : rec?.status === 'absent' ? '❌' : rec?.status === 'pending' ? '⏳' : '—';
                    const bg   = rec?.status === 'present' ? 'var(--success-light)' : rec?.status === 'absent' ? 'var(--danger-light)' : '';
                    return `<td style="text-align:center;border:1px solid var(--border);background:${bg}">${icon}</td>`;
                  }).join('')}
                </tr>`).join('')}
            </tbody>
          </table>
        </div>`;
    } catch (err) {
      el.innerHTML = `<div class="empty-state"><p>${esc(err.message)}</p></div>`;
    }
  }

  function esc(s) { const d = document.createElement('div'); d.textContent = String(s ?? ''); return d.innerHTML; }

  return { render };
})();

window.AdminView = AdminView;
