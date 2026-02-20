/**
 * views/dashboard.js  —  Today's schedule + quick attendance stats
 */
'use strict';

const DashboardView = (() => {
  let _realmId = null;

  function render(user, realmId) {
    _realmId = realmId;
    App.setTitle('Dashboard');
    App.setBack(false);

    const root = document.getElementById('view-root');
    root.innerHTML = `<div class="dashboard-scroll" id="dash-inner"><div class="spinner"></div></div>`;

    _load(user);
  }

  async function _load(user) {
    const inner = document.getElementById('dash-inner');
    try {
      const [todayRes, statsRes] = await Promise.allSettled([
        API.timetable(_realmId).today(),
        API.attendance(_realmId).myAnalytics(),
      ]);

      const today     = todayRes.status === 'fulfilled' ? todayRes.value.data  : null;
      const stats     = statsRes.status === 'fulfilled' ? statsRes.value.data : null;
      const dow       = new Date().toLocaleDateString('en-US', { weekday: 'long' });
      const dateStr   = new Date().toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' });
      const firstName = (user.displayName || '').split(' ')[0];

      inner.innerHTML = `
        <div>
          <p class="greeting">Good ${_greet()}, <span>${firstName}</span> 👋</p>
          <p class="text-sm text-muted mt-2">${dow}, ${dateStr}</p>
        </div>

        ${stats ? _statsHtml(stats) : ''}
        ${stats?.atRisk ? `<div class="at-risk-banner">⚠ Attendance below 80% — ${Math.round(((stats.totalPresent||0)/Math.max(1,(stats.totalPresent||0)+(stats.totalAbsent||0)))*100)}% present</div>` : ''}

        <div>
          <div class="section-header" style="padding-left:0;padding-right:0;">
            <span class="section-title">Today's Schedule</span>
            <span class="text-xs text-muted">${today?.weekType ? today.weekType + ' week' : ''}</span>
          </div>
          ${_todayHtml(today)}
        </div>`;

      // Wire check-in buttons
      inner.querySelectorAll('.checkin-btn[data-period-id]').forEach((btn) => {
        if (btn.disabled || btn.classList.contains('closed')) return;
        btn.addEventListener('click', () => _checkIn(btn));
      });
    } catch (err) {
      inner.innerHTML = `<div class="empty-state"><p>Failed to load dashboard.<br>${err.message}</p></div>`;
    }
  }

  function _greet() {
    const h = new Date().getHours();
    if (h < 12) return 'morning';
    if (h < 17) return 'afternoon';
    return 'evening';
  }

  function _statsHtml(s) {
    const tot = (s.totalPresent || 0) + (s.totalAbsent || 0);
    const pct = tot > 0 ? Math.round((s.totalPresent / tot) * 100) : 0;
    return `
      <div class="stats-row">
        <div class="stat-card">
          <div class="stat-num status-present">${s.totalPresent ?? 0}</div>
          <div class="stat-label">Present</div>
        </div>
        <div class="stat-card">
          <div class="stat-num status-absent">${s.totalAbsent ?? 0}</div>
          <div class="stat-label">Absent</div>
        </div>
        <div class="stat-card">
          <div class="stat-num" style="color:var(--primary)">${pct}%</div>
          <div class="stat-label">Attendance</div>
        </div>
      </div>`;
  }

  function _todayHtml(today) {
    const periods = today?.periods;
    if (!periods || periods.length === 0) {
      return `<div class="card"><p class="text-muted text-sm text-center">No classes scheduled today.</p></div>`;
    }
    const rows = periods.map((p) => {
      const statusIcon = p.attendanceStatus === 'present' ? '✅'
        : p.attendanceStatus === 'absent' ? '❌'
        : p.attendanceStatus === 'pending' ? '⏳'
        : '';
      const canCheckIn = p.checkinWindowOpen && p.attendanceStatus !== 'present';
      const btnClass   = canCheckIn ? '' : 'closed';
      const btnText    = p.attendanceStatus === 'present' ? 'Checked In' : canCheckIn ? 'Check In' : p.attendanceStatus === 'absent' ? 'Missed' : 'Upcoming';
      return `
        <div class="period-row">
          <div class="period-time">${_fmtTime(p.startTime)}<br><span style="font-size:.65rem;color:var(--text-3)">${_fmtTime(p.endTime)}</span></div>
          <div class="period-info">
            <div class="period-name">${esc(p.subjectName || p.subjectCode || '—')}</div>
            <div class="period-room">${esc(p.room || '')} ${esc(p.teacher || '')}</div>
          </div>
          <div style="text-align:right">
            <div style="font-size:1rem">${statusIcon}</div>
            <button class="checkin-btn ${btnClass}" data-period-id="${p.id}" ${p.attendanceStatus === 'present' ? 'disabled' : ''}>${btnText}</button>
          </div>
        </div>`;
    }).join('');
    return `<div class="card today-card">${rows}</div>`;
  }

  async function _checkIn(btn) {
    const periodId = btn.dataset.periodId;
    btn.disabled   = true;
    btn.textContent = '…';
    try {
      await API.attendance(_realmId).checkIn({ periodId });
      btn.textContent = 'Checked In ✅';
      btn.classList.add('closed');
      App.toast('Attendance recorded!', 'success');
    } catch (err) {
      btn.textContent = 'Check In';
      btn.disabled = false;
      App.toast(err.message, 'danger');
    }
  }

  function _fmtTime(t) { return t ? t.slice(0, 5) : ''; }
  function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

  return { render };
})();

window.DashboardView = DashboardView;
