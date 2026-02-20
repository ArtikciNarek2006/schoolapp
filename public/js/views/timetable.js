/**
 * views/timetable.js  —  Full weekly timetable with check-in
 *
 * Backend schedule shape:
 *   { schedule: { odd: { monday:[...], tuesday:[...], ... }, even: {...} } }
 * Periods have: subjectCode, subjectName, teacher, room, startTime, endTime, attendanceRequired
 * API period routes: POST/PATCH/DELETE /:weekType/:day[/:periodId]
 */
'use strict';

const TimetableView = (() => {
  const DAYS      = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const WEEK_TYPES = ['odd', 'even'];

  let _realmId = null;
  let _user    = null;
  let _ttData  = null;   // full timetable document (.schedule = { odd:{...}, even:{...} })
  let _curDay  = null;   // e.g. 'monday'

  function render(user, realmId) {
    _user    = user;
    _realmId = realmId;
    App.setTitle('Timetable');
    App.setBack(false);

    const isSenior = user.role === 'senior_admin';
    const todayIdx = (new Date().getDay() + 6) % 7; // Mon=0 … Sun=6
    _curDay = DAYS[todayIdx];

    document.getElementById('view-root').innerHTML = `
      <div class="timetable-scroll">
        <div class="day-tabs" id="day-tabs">
          ${DAYS.map((d, i) => `
            <button class="day-tab${i === todayIdx ? ' today active' : ''}" data-day="${d}">
              ${DAY_LABELS[i]}
            </button>`).join('')}
        </div>
        <div id="tt-content"><div class="spinner"></div></div>
      </div>`;

    // Day tab click
    document.querySelectorAll('.day-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.day-tab').forEach((t) => t.classList.remove('active'));
        tab.classList.add('active');
        _curDay = tab.dataset.day;
        _renderDay(_curDay, isSenior);
      });
    });

    _load(isSenior);
  }

  async function _load(isSenior) {
    try {
      const res = await API.timetable(_realmId).get();
      _ttData   = res.data;
      _renderDay(_curDay, isSenior);
    } catch (err) {
      document.getElementById('tt-content').innerHTML =
        `<div class="empty-state"><p>Could not load timetable.<br>${esc(err.message)}</p></div>`;
    }
  }

  /**
   * Collect periods for a given day across both week types,
   * tagging each with ._weekType so we can pass it to the API.
   */
  function _periodsForDay(day) {
    if (!_ttData?.schedule) return [];
    const all = [];
    for (const wt of WEEK_TYPES) {
      const list = _ttData.schedule[wt]?.[day] || [];
      list.forEach((p) => all.push({ ...p, _weekType: wt }));
    }
    // Sort by startTime, then weekType
    all.sort((a, b) => a.startTime.localeCompare(b.startTime) || a._weekType.localeCompare(b._weekType));
    return all;
  }

  function _renderDay(day, isSenior) {
    const periods = _periodsForDay(day);
    const now     = new Date();
    const todayKey = DAYS[(now.getDay() + 6) % 7];
    const isToday  = day === todayKey;
    const nowMin   = now.getHours() * 60 + now.getMinutes();

    const content = document.getElementById('tt-content');
    if (!content) return;

    if (!periods.length) {
      content.innerHTML = `
        <div class="empty-state"><p>No classes on ${capitalize(day)}.</p></div>
        ${isSenior ? `<div style="padding:0 16px 16px"><button class="btn btn-outline btn-full" id="btn-add-period">＋ Add Period</button></div>` : ''}`;
      document.getElementById('btn-add-period')?.addEventListener('click', () => _showAddPeriod(day));
      return;
    }

    content.innerHTML = `
      <div class="periods-list">
        ${periods.map((p) => _periodCard(p, isToday, nowMin, isSenior)).join('')}
        ${isSenior ? `<div style="padding:4px 16px 16px"><button class="btn btn-outline btn-full" id="btn-add-period">＋ Add Period</button></div>` : ''}
      </div>`;

    // Check-in buttons (students)
    content.querySelectorAll('.checkin-btn[data-period-id]').forEach((btn) => {
      if (!btn.disabled && !btn.classList.contains('closed')) {
        btn.addEventListener('click', () => _checkIn(btn));
      }
    });

    // Edit / delete (senior)
    content.querySelectorAll('.edit-period-btn').forEach((btn) =>
      btn.addEventListener('click', () => _showEditPeriod(btn.dataset.pid, btn.dataset.wt, day)));
    content.querySelectorAll('.del-period-btn').forEach((btn) =>
      btn.addEventListener('click', () => _delPeriod(btn.dataset.pid, btn.dataset.wt, day)));

    document.getElementById('btn-add-period')?.addEventListener('click', () => _showAddPeriod(day));
  }

  function _periodCard(p, isToday, nowMin, isSenior) {
    const [sh, sm] = p.startTime.split(':').map(Number);
    const [eh, em] = p.endTime.split(':').map(Number);
    const startMin = sh * 60 + sm;
    const endMin   = eh * 60 + em;
    const isNow    = isToday && nowMin >= startMin && nowMin < endMin;
    const dur      = endMin - startMin;
    const durStr   = `${Math.floor(dur / 60) > 0 ? Math.floor(dur / 60) + 'h ' : ''}${dur % 60 > 0 ? dur % 60 + 'm' : ''}`.trim();
    const label    = p.subjectName || p.subjectCode || '—';

    return `
      <div class="period-card${isNow ? ' active-now' : ''}">
        <div class="period-timeline">
          <div class="time">${p.startTime.slice(0,5)}</div>
          <div class="dur">${durStr}</div>
          <div class="time">${p.endTime.slice(0,5)}</div>
        </div>
        <div class="period-details">
          <div class="period-subject">${esc(label)}</div>
          <div class="period-sub">${[p.room, p.teacher].filter(Boolean).map(esc).join(' · ')}</div>
          <div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:4px;">
            <span class="chip chip-gray">${p._weekType} week</span>
            ${p.subjectCode ? `<span class="chip" style="background:var(--surface-3);color:var(--text-2)">${esc(p.subjectCode)}</span>` : ''}
            ${isNow ? `<span class="chip chip-primary">Now ▶</span>` : ''}
          </div>
          ${isToday && _user?.role === 'student' && p.attendanceRequired ? `
            <button class="checkin-btn" data-period-id="${p.id}">Check In</button>` : ''}
        </div>
        ${isSenior ? `<div style="display:flex;flex-direction:column;gap:4px;align-self:flex-start;padding-top:4px;">
          <button class="icon-btn edit-period-btn" data-pid="${p.id}" data-wt="${p._weekType}" title="Edit">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" style="width:18px;height:18px"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button class="icon-btn del-period-btn" data-pid="${p.id}" data-wt="${p._weekType}" title="Delete" style="color:var(--danger)">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" style="width:18px;height:18px"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/></svg>
          </button>
        </div>` : ''}
      </div>`;
  }

  // ── Check-in ─────────────────────────────────────────────────────────────────
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

  // ── Period form ───────────────────────────────────────────────────────────────
  function _periodFormHtml(p = {}) {
    return `
      <div style="display:flex;flex-direction:column;gap:12px;">
        <div class="form-group">
          <label class="form-label">Week</label>
          <select class="form-input" id="pf-week">
            <option value="odd"  ${(p._weekType||p.weekType)==='odd'  ?'selected':''}>Odd weeks</option>
            <option value="even" ${(p._weekType||p.weekType)==='even' ?'selected':''}>Even weeks</option>
          </select>
        </div>
        <div class="form-group"><label class="form-label">Subject Code <span style="color:var(--danger)">*</span></label>
          <input class="form-input" id="pf-code" value="${esc(p.subjectCode||'')}" placeholder="e.g. MATH101" autocapitalize="characters"/></div>
        <div class="form-group"><label class="form-label">Subject Name</label>
          <input class="form-input" id="pf-name" value="${esc(p.subjectName||'')}" placeholder="e.g. Mathematics"/></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
          <div class="form-group"><label class="form-label">Start <span style="color:var(--danger)">*</span></label>
            <input class="form-input" id="pf-start" type="time" value="${p.startTime||''}"/></div>
          <div class="form-group"><label class="form-label">End <span style="color:var(--danger)">*</span></label>
            <input class="form-input" id="pf-end" type="time" value="${p.endTime||''}"/></div>
        </div>
        <div class="form-group"><label class="form-label">Room</label>
          <input class="form-input" id="pf-room" value="${esc(p.room||'')}" placeholder="e.g. A-101"/></div>
        <div class="form-group"><label class="form-label">Teacher</label>
          <input class="form-input" id="pf-teacher" value="${esc(p.teacher||'')}" placeholder="e.g. Ms. Smith"/></div>
        <label style="display:flex;align-items:center;gap:10px;font-size:.9rem;cursor:pointer;">
          <input type="checkbox" id="pf-att" ${p.attendanceRequired !== false ? 'checked' : ''}/>
          Attendance required
        </label>
      </div>`;
  }

  function _readForm(modal) {
    return {
      weekType:             modal.querySelector('#pf-week').value,
      subjectCode:          modal.querySelector('#pf-code').value.trim().toUpperCase(),
      subjectName:          modal.querySelector('#pf-name').value.trim(),
      startTime:            modal.querySelector('#pf-start').value,
      endTime:              modal.querySelector('#pf-end').value,
      room:                 modal.querySelector('#pf-room').value.trim() || null,
      teacher:              modal.querySelector('#pf-teacher').value.trim() || null,
      attendanceRequired:   modal.querySelector('#pf-att').checked,
    };
  }

  function _showAddPeriod(day) {
    App.showModal({
      title: `Add Period — ${capitalize(day)}`,
      body: _periodFormHtml({}),
      actions: [
        { label: 'Cancel', cls: 'btn-outline', action: 'cancel' },
        { label: 'Add',    cls: 'btn-primary',  action: 'add' },
      ],
      onAction: async (action, modal) => {
        if (action !== 'add') return;
        const data = _readForm(modal);
        if (!data.subjectCode || !data.startTime || !data.endTime) {
          App.toast('Subject code and times are required.', 'warning'); return;
        }
        const { weekType, ...body } = data;  // weekType goes in URL
        try {
          await API.timetable(_realmId).addPeriod(weekType, day, body);
          App.toast('Period added!', 'success');
          App.closeModal();
          const res = await API.timetable(_realmId).get();
          _ttData = res.data;
          _renderDay(day, true);
        } catch (err) { App.toast(err.message, 'danger'); }
      },
    });
  }

  function _showEditPeriod(pid, weekType, day) {
    // Find the period in the correct slot
    const period = (_ttData?.schedule?.[weekType]?.[day] || []).find((p) => p.id === pid);
    if (!period) { App.toast('Period not found.', 'danger'); return; }

    App.showModal({
      title: 'Edit Period',
      body: _periodFormHtml({ ...period, _weekType: weekType }),
      actions: [
        { label: 'Cancel', cls: 'btn-outline', action: 'cancel' },
        { label: 'Save',   cls: 'btn-primary',  action: 'save' },
      ],
      onAction: async (action, modal) => {
        if (action !== 'save') return;
        const data = _readForm(modal);
        const newWt = data.weekType;
        const { weekType: _wt, ...body } = data;

        try {
          // If weekType changed: delete from old slot, add to new slot
          if (newWt !== weekType) {
            await API.timetable(_realmId).removePeriod(weekType, day, pid);
            await API.timetable(_realmId).addPeriod(newWt, day, body);
          } else {
            await API.timetable(_realmId).updatePeriod(weekType, day, pid, body);
          }
          App.toast('Period updated!', 'success');
          App.closeModal();
          const res = await API.timetable(_realmId).get();
          _ttData = res.data;
          _renderDay(day, true);
        } catch (err) { App.toast(err.message, 'danger'); }
      },
    });
  }

  async function _delPeriod(pid, weekType, day) {
    if (!confirm('Delete this period?')) return;
    try {
      await API.timetable(_realmId).removePeriod(weekType, day, pid);
      App.toast('Period deleted.', 'success');
      const res = await API.timetable(_realmId).get();
      _ttData = res.data;
      _renderDay(day, true);
    } catch (err) { App.toast(err.message, 'danger'); }
  }

  function capitalize(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''; }
  function esc(s) { const d = document.createElement('div'); d.textContent = String(s ?? ''); return d.innerHTML; }

  return { render };
})();

window.TimetableView = TimetableView;
