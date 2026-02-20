/**
 * views/timetable.js  —  Full weekly timetable with check-in
 */
'use strict';

const TimetableView = (() => {
  let _realmId = null;
  let _user    = null;
  let _ttData  = null;
  const DAYS   = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

  function render(user, realmId) {
    _user    = user;
    _realmId = realmId;
    App.setTitle('Timetable');
    App.setBack(false);

    const isSenior = user.role === 'senior_admin';
    const todayIdx = (new Date().getDay() + 6) % 7; // Mon=0

    document.getElementById('view-root').innerHTML = `
      <div class="timetable-scroll">
        <div class="day-tabs" id="day-tabs">
          ${DAYS.map((d, i) => `<button class="day-tab${i === todayIdx ? ' today' : ''}" data-day="${d.toLowerCase()}">${d.slice(0,3)}</button>`).join('')}
        </div>
        <div id="tt-content"><div class="spinner"></div></div>
      </div>`;

    document.querySelectorAll('.day-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.day-tab').forEach((t) => t.classList.remove('active'));
        tab.classList.add('active');
        _renderDay(tab.dataset.day, isSenior);
      });
    });

    // Select today by default
    const todayTab = document.querySelector(`.day-tab[data-day="${DAYS[todayIdx].toLowerCase()}"]`);
    todayTab?.classList.add('active');

    _loadTimetable(isSenior, DAYS[todayIdx].toLowerCase());
  }

  async function _loadTimetable(isSenior, defaultDay) {
    try {
      const res = await API.timetable(_realmId).get();
      _ttData   = res.data;
      _renderDay(defaultDay, isSenior);
    } catch (err) {
      document.getElementById('tt-content').innerHTML =
        `<div class="empty-state"><p>Could not load timetable.<br>${esc(err.message)}</p></div>`;
    }
  }

  function _renderDay(day, isSenior) {
    const periods = (_ttData?.schedule?.[day] || []).sort((a, b) => a.startTime.localeCompare(b.startTime));
    const now     = new Date();
    const todayKey = DAYS[(now.getDay() + 6) % 7].toLowerCase();
    const isToday  = day === todayKey;
    const nowMin   = now.getHours() * 60 + now.getMinutes();

    const content = document.getElementById('tt-content');
    if (!content) return;

    if (!periods.length) {
      content.innerHTML = `<div class="empty-state"><p>No classes on ${capitalize(day)}${_ttData?.weekType ? ` (${_ttData.weekType} week)` : ''}.</p></div>
        ${isSenior ? `<div style="padding:0 16px"><button class="btn btn-outline btn-full" id="btn-add-period">＋ Add Period</button></div>` : ''}`;
      document.getElementById('btn-add-period')?.addEventListener('click', () => _showAddPeriod(day));
      return;
    }

    content.innerHTML = `
      <div class="periods-list">
        ${periods.map((p) => _periodCard(p, isToday, nowMin)).join('')}
        ${isSenior ? `<button class="btn btn-outline btn-full" id="btn-add-period">＋ Add Period</button>` : ''}
      </div>`;

    content.querySelectorAll('.checkin-btn[data-period-id]').forEach((btn) => {
      if (!btn.disabled && !btn.classList.contains('closed')) {
        btn.addEventListener('click', () => _checkIn(btn));
      }
    });
    content.querySelectorAll('.edit-period-btn').forEach((btn) => {
      btn.addEventListener('click', () => _showEditPeriod(btn.dataset.pid, day));
    });
    content.querySelectorAll('.del-period-btn').forEach((btn) => {
      btn.addEventListener('click', () => _delPeriod(btn.dataset.pid, day));
    });
    document.getElementById('btn-add-period')?.addEventListener('click', () => _showAddPeriod(day));
  }

  function _periodCard(p, isToday, nowMin) {
    const [sh, sm] = p.startTime.split(':').map(Number);
    const [eh, em] = p.endTime.split(':').map(Number);
    const startMin = sh * 60 + sm;
    const endMin   = eh * 60 + em;
    const isNow    = isToday && nowMin >= startMin && nowMin < endMin;
    const dur      = endMin - startMin;
    const durStr   = `${Math.floor(dur / 60) > 0 ? Math.floor(dur / 60) + 'h ' : ''}${dur % 60 > 0 ? dur % 60 + 'm' : ''}`;
    const isSenior = _user?.role === 'senior_admin';

    return `
      <div class="period-card${isNow ? ' active-now' : ''}">
        <div class="period-timeline">
          <div class="time">${p.startTime.slice(0,5)}</div>
          <div class="dur">${durStr}</div>
          <div class="time">${p.endTime.slice(0,5)}</div>
        </div>
        <div class="period-details">
          <div class="period-subject">${esc(p.subject)}</div>
          <div class="period-sub">${[p.room, p.teacher].filter(Boolean).map(esc).join(' · ')}</div>
          ${p.weekType && p.weekType !== 'both' ? `<span class="chip chip-gray" style="margin-top:4px">${p.weekType} week</span>` : ''}
          ${isNow ? `<span class="chip chip-primary" style="margin-top:4px">Now ▶</span>` : ''}
          ${isToday && _user?.role === 'student' ? _checkinBtn(p, isNow, nowMin) : ''}
        </div>
        ${isSenior ? `<div style="display:flex;flex-direction:column;gap:4px;">
          <button class="icon-btn edit-period-btn" data-pid="${p.id}" title="Edit" style="width:32px;height:32px;">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button class="icon-btn del-period-btn" data-pid="${p.id}" title="Delete" style="width:32px;height:32px;color:var(--danger);">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/></svg>
          </button>
        </div>` : ''}
      </div>`;
  }

  function _checkinBtn(p, isNow, nowMin) {
    return `<button class="checkin-btn" data-period-id="${p.id}">Check In</button>`;
  }

  async function _checkIn(btn) {
    const pid = btn.dataset.periodId;
    btn.disabled = true; btn.textContent = '…';
    try {
      await API.attendance(_realmId).checkIn({ periodId: pid });
      btn.textContent = 'Checked In ✅';
      btn.classList.add('closed');
      App.toast('Attendance recorded!', 'success');
    } catch (err) {
      btn.textContent = 'Check In';
      btn.disabled = false;
      App.toast(err.message || 'Failed', 'danger');
    }
  }

  // ── Senior: add / edit / delete period ────────────────────────────────────────
  function _periodFormHtml(p = {}) {
    return `
      <div style="display:flex;flex-direction:column;gap:12px;">
        <div class="form-group"><label class="form-label">Subject</label><input class="form-input" id="pf-subject" value="${esc(p.subject||'')}"/></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
          <div class="form-group"><label class="form-label">Start</label><input class="form-input" id="pf-start" type="time" value="${p.startTime||''}"/></div>
          <div class="form-group"><label class="form-label">End</label><input class="form-input" id="pf-end" type="time" value="${p.endTime||''}"/></div>
        </div>
        <div class="form-group"><label class="form-label">Room</label><input class="form-input" id="pf-room" value="${esc(p.room||'')}"/></div>
        <div class="form-group"><label class="form-label">Teacher</label><input class="form-input" id="pf-teacher" value="${esc(p.teacher||'')}"/></div>
        <div class="form-group"><label class="form-label">Week</label>
          <select class="form-input" id="pf-week">
            <option value="both" ${p.weekType==='both'?'selected':''}>Both</option>
            <option value="odd"  ${p.weekType==='odd' ?'selected':''}>Odd only</option>
            <option value="even" ${p.weekType==='even'?'selected':''}>Even only</option>
          </select>
        </div>
      </div>`;
  }

  function _readForm(modal) {
    return {
      subject:   modal.querySelector('#pf-subject').value.trim(),
      startTime: modal.querySelector('#pf-start').value,
      endTime:   modal.querySelector('#pf-end').value,
      room:      modal.querySelector('#pf-room').value.trim(),
      teacher:   modal.querySelector('#pf-teacher').value.trim(),
      weekType:  modal.querySelector('#pf-week').value,
    };
  }

  function _showAddPeriod(day) {
    App.showModal({
      title: `Add Period — ${capitalize(day)}`,
      body: _periodFormHtml({ weekType: 'both' }),
      actions: [
        { label: 'Cancel', cls: 'btn-outline', action: 'cancel' },
        { label: 'Add', cls: 'btn-primary', action: 'add' },
      ],
      onAction: async (action, modal) => {
        if (action !== 'add') return;
        const data = { ..._readForm(modal), day };
        if (!data.subject || !data.startTime || !data.endTime) { App.toast('Subject and times are required.', 'warning'); return; }
        try {
          await API.timetable(_realmId).addPeriod(data);
          App.toast('Period added!', 'success');
          App.closeModal();
          const res = await API.timetable(_realmId).get();
          _ttData = res.data;
          _renderDay(day, true);
        } catch (err) { App.toast(err.message, 'danger'); }
      },
    });
  }

  function _showEditPeriod(pid, day) {
    const period = _ttData?.schedule?.[day]?.find((p) => p.id === pid);
    if (!period) return;
    App.showModal({
      title: 'Edit Period',
      body: _periodFormHtml(period),
      actions: [
        { label: 'Cancel', cls: 'btn-outline', action: 'cancel' },
        { label: 'Save', cls: 'btn-primary', action: 'save' },
      ],
      onAction: async (action, modal) => {
        if (action !== 'save') return;
        const data = _readForm(modal);
        try {
          await API.timetable(_realmId).updatePeriod(pid, data);
          App.toast('Period updated!', 'success');
          App.closeModal();
          const res = await API.timetable(_realmId).get();
          _ttData = res.data;
          _renderDay(day, true);
        } catch (err) { App.toast(err.message, 'danger'); }
      },
    });
  }

  async function _delPeriod(pid, day) {
    if (!confirm('Remove this period?')) return;
    try {
      await API.timetable(_realmId).removePeriod(pid);
      App.toast('Period removed.', 'success');
      const res = await API.timetable(_realmId).get();
      _ttData = res.data;
      _renderDay(day, true);
    } catch (err) { App.toast(err.message, 'danger'); }
  }

  function esc(s) { const d = document.createElement('div'); d.textContent = String(s ?? ''); return d.innerHTML; }
  function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  return { render };
})();

window.TimetableView = TimetableView;
