/**
 * views/profile.js  —  User profile + change password + realm info
 */
'use strict';

const ProfileView = (() => {
  let _realmId = null;
  let _user    = null;

  function render(user, realmId) {
    _user    = user;
    _realmId = realmId;
    App.setTitle('Profile');
    App.setBack(false);

    const initials = _initials(user.displayName);
    const roleLabel = { project_admin: 'Project Admin', senior_admin: 'Senior Admin', student: 'Student' }[user.role] || user.role;

    document.getElementById('view-root').innerHTML = `
      <div class="profile-scroll">

        <!-- Hero -->
        <div class="profile-hero">
          <div class="avatar avatar-lg" style="background:var(--primary);color:#fff;font-size:1.6rem">${initials}</div>
          <div class="profile-name">${esc(user.displayName)}</div>
          <div class="profile-role">${roleLabel}</div>
          <span class="chip chip-primary">@${esc(user.username)}</span>
        </div>

        <!-- Attendance analytics (students only) -->
        ${user.role === 'student' ? `<div id="attendance-stats"><div class="spinner"></div></div>` : ''}

        <!-- Quick actions -->
        <div class="card">
          <div style="display:flex;flex-direction:column;gap:2px;">
            <button class="list-item" id="btn-change-pass" style="background:none;border:none;width:100%;text-align:left;">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" style="width:20px;height:20px;color:var(--text-2)"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
              <div style="flex:1">Change Password</div>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" style="width:16px;height:16px;color:var(--text-3)"><polyline points="9 18 15 12 9 6"/></svg>
            </button>

            ${user.role === 'student' && _realmId ? `
            <button class="list-item" id="btn-full-attendance" style="background:none;border:none;width:100%;text-align:left;">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" style="width:20px;height:20px;color:var(--text-2)"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
              <div style="flex:1">My Attendance History</div>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" style="width:16px;height:16px;color:var(--text-3)"><polyline points="9 18 15 12 9 6"/></svg>
            </button>` : ''}

            <button class="list-item" id="btn-logout" style="background:none;border:none;width:100%;text-align:left;color:var(--danger);">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" style="width:20px;height:20px;"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
              <div style="flex:1">Sign Out</div>
            </button>
          </div>
        </div>

        <!-- App info -->
        <div class="text-center text-xs text-muted" style="padding-bottom:8px;">
          SchoolApp · Phase 5 · ${new Date().getFullYear()}
        </div>
      </div>`;

    document.getElementById('btn-change-pass').addEventListener('click', _showChangePassword);
    document.getElementById('btn-logout').addEventListener('click', _logout);
    document.getElementById('btn-full-attendance')?.addEventListener('click', _showAttendanceHistory);

    if (user.role === 'student') _loadAttendanceStats();
  }

  async function _loadAttendanceStats() {
    const el = document.getElementById('attendance-stats');
    if (!el) return;
    try {
      const res  = await API.attendance(_realmId).myAnalytics();
      const s    = res.data;
      const pct  = s.presentPct ?? 0;
      const bar  = Math.min(pct, 100);
      el.innerHTML = `
        <div class="card">
          <div class="font-semibold mb-1">Attendance Overview</div>
          <div style="display:flex;gap:16px;margin-bottom:12px;">
            <div><div class="stat-num status-present" style="font-size:1.2rem">${s.present}</div><div class="text-xs text-muted">Present</div></div>
            <div><div class="stat-num status-absent" style="font-size:1.2rem">${s.absent}</div><div class="text-xs text-muted">Absent</div></div>
            <div><div class="stat-num" style="font-size:1.2rem;color:var(--primary)">${pct}%</div><div class="text-xs text-muted">Rate</div></div>
          </div>
          <div style="background:var(--surface-3);border-radius:999px;height:8px;overflow:hidden">
            <div style="width:${bar}%;height:100%;background:${pct >= 80 ? 'var(--success)' : pct >= 60 ? 'var(--warning)' : 'var(--danger)'};border-radius:999px;transition:.4s"></div>
          </div>
          ${s.atRisk ? '<div class="at-risk-banner" style="margin-top:10px">⚠ Attendance below 80% — you may be at risk</div>' : ''}
          ${s.bySubject?.length ? `<div style="margin-top:14px">
            ${s.bySubject.map((sub) => `<div style="display:flex;align-items:center;justify-content:space-between;padding:5px 0;font-size:.83rem;border-bottom:1px solid var(--border);">
              <span class="truncate" style="max-width:55%">${esc(sub.subject)}</span>
              <span style="color:${sub.rate >= 80 ? 'var(--success)' : sub.rate >= 60 ? 'var(--warning)' : 'var(--danger)'};">${sub.present}/${sub.present + sub.absent} (${sub.rate}%)</span>
            </div>`).join('')}
          </div>` : ''}
        </div>`;
    } catch (err) {
      el.innerHTML = `<div class="text-sm text-muted text-center">Could not load attendance stats.</div>`;
    }
  }

  async function _showAttendanceHistory() {
    App.showModal({
      title: 'Attendance History',
      body: `<div id="att-hist-content"><div class="spinner"></div></div>`,
    });
    try {
      const res     = await API.attendance(_realmId).mine({ limit: 100 });
      const records = res.data || [];
      const modal   = document.querySelector('.modal');
      const content = modal?.querySelector('#att-hist-content');
      if (!content) return;
      if (!records.length) { content.innerHTML = '<div class="empty-state"><p>No attendance records yet.</p></div>'; return; }
      content.innerHTML = records.map((r) => {
        const icon = r.status === 'present' ? '✅' : r.status === 'absent' ? '❌' : '⏳';
        const date = new Date(r.createdAt).toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' });
        return `<div class="period-row">
          <div class="period-time">${date}</div>
          <div class="period-info"><div class="period-name">${esc(r.subject||r.periodId)}</div></div>
          <div style="font-size:1.1rem">${icon}</div>
        </div>`;
      }).join('');
    } catch (err) {
      document.querySelector('#att-hist-content').innerHTML = `<div class="empty-state"><p>${esc(err.message)}</p></div>`;
    }
  }

  function _showChangePassword() {
    App.showModal({
      title: 'Change Password',
      body: `
        <div style="display:flex;flex-direction:column;gap:14px;">
          <div class="form-group"><label class="form-label">Current Password</label><input class="form-input" type="password" id="cp-current" autocomplete="current-password"/></div>
          <div class="form-group"><label class="form-label">New Password</label><input class="form-input" type="password" id="cp-new" autocomplete="new-password" placeholder="Min 8 characters"/></div>
          <div class="form-group"><label class="form-label">Confirm New Password</label><input class="form-input" type="password" id="cp-confirm" autocomplete="new-password"/></div>
        </div>`,
      actions: [
        { label: 'Cancel', cls: 'btn-outline', action: 'cancel' },
        { label: 'Change', cls: 'btn-primary', action: 'change' },
      ],
      onAction: async (action, modal) => {
        if (action !== 'change') return;
        const current = modal.querySelector('#cp-current').value;
        const next    = modal.querySelector('#cp-new').value;
        const confirm = modal.querySelector('#cp-confirm').value;
        if (!current || !next) { App.toast('All fields required.', 'warning'); return; }
        if (next !== confirm) { App.toast('New passwords do not match.', 'warning'); return; }
        if (next.length < 8)  { App.toast('Password must be at least 8 characters.', 'warning'); return; }
        try {
          await API.auth.changePassword(current, next);
          App.toast('Password changed!', 'success');
          App.closeModal();
        } catch (err) { App.toast(err.message, 'danger'); }
      },
    });
  }

  async function _logout() {
    try { await API.auth.logout(); } catch { /* ignore */ }
    App.signOut();
  }

  function _initials(name) {
    const parts = (name || '').split(' ').filter(Boolean);
    if (!parts.length) return '?';
    return parts.length > 1 ? (parts[0][0] + parts[1][0]).toUpperCase() : parts[0].substring(0, 2).toUpperCase();
  }

  function esc(s) { const d = document.createElement('div'); d.textContent = String(s ?? ''); return d.innerHTML; }

  return { render };
})();

window.ProfileView = ProfileView;
