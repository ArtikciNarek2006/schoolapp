/**
 * views/notices.js  —  Notice board with real-time updates
 */
'use strict';

const NoticesView = (() => {
  let _realmId = null;
  let _user    = null;

  function render(user, realmId) {
    _user    = user;
    _realmId = realmId;
    App.setTitle('Notices');
    App.setBack(false);
    App.setBarAction(null);

    const isSenior = user.role === 'senior_admin' || user.role === 'project_admin';

    document.getElementById('view-root').innerHTML = `
      <div class="notices-scroll" id="notices-inner"><div class="spinner"></div></div>
      ${isSenior ? `<button class="notice-fab" id="btn-new-notice" title="Post notice">＋</button>` : ''}`;

    _load(isSenior);

    document.getElementById('btn-new-notice')?.addEventListener('click', _showNewNotice);

    SocketManager.on('notice_published', _onNewNotice);
  }

  function destroy() { SocketManager.off('notice_published', _onNewNotice); }

  function _onNewNotice(data) {
    const notice  = data?.notice;
    if (!notice || notice.realmId !== _realmId) return;
    App.toast(`📢 New notice: ${notice.title}`, 'success');
    App.updateNoticeBadge(1); // increment
    _load(false); // refresh list
  }

  async function _load(includeExpired) {
    const inner = document.getElementById('notices-inner');
    if (!inner) return;
    try {
      const q   = includeExpired ? { includeExpired: 'true' } : {};
      const res = await API.notices(_realmId).list(q);
      const notices = res.data || [];
      if (!notices.length) {
        inner.innerHTML = `<div class="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
          <p>No notices yet</p></div>`;
        return;
      }
      inner.innerHTML = notices.map(_noticeCard).join('');
      inner.querySelectorAll('.notice-del-btn').forEach((btn) => {
        btn.addEventListener('click', (e) => { e.stopPropagation(); _deleteNotice(btn.dataset.id); });
      });
    } catch (err) {
      inner.innerHTML = `<div class="empty-state"><p>Failed to load notices.<br>${esc(err.message)}</p></div>`;
    }
  }

  function _noticeCard(n) {
    const isSenior = _user.role === 'senior_admin' || _user.role === 'project_admin';
    const date = new Date(n.createdAt).toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' });
    const expiry = n.expiresAt ? `Expires ${new Date(n.expiresAt).toLocaleDateString('en-GB', { day:'numeric', month:'short' })}` : '';
    const priorityChip = n.priority === 'urgent' ? '<span class="chip chip-danger">URGENT</span>'
      : n.priority === 'important' ? '<span class="chip chip-warning">Important</span>'
      : '';
    return `
      <div class="notice-card ${n.priority}">
        <div class="notice-head">
          <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;">
            <div>
              <div class="notice-title">${esc(n.title)} ${priorityChip}</div>
              <div class="notice-meta">${date} ${expiry ? '• ' + expiry : ''}</div>
            </div>
            ${isSenior ? `<button class="icon-btn notice-del-btn" data-id="${n.id}" title="Delete" style="margin-top:-4px">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
            </button>` : ''}
          </div>
        </div>
        <div class="notice-body">${esc(n.body).replace(/\n/g, '<br>')}</div>
      </div>`;
  }

  async function _deleteNotice(id) {
    if (!confirm('Delete this notice?')) return;
    try {
      await API.notices(_realmId).remove(id);
      App.toast('Notice removed.', 'success');
      _load(true);
    } catch (err) { App.toast(err.message, 'danger'); }
  }

  function _showNewNotice() {
    const today = new Date().toISOString().split('T')[0];
    App.showModal({
      title: 'Post a Notice',
      body: `
        <div style="display:flex;flex-direction:column;gap:14px;">
          <div class="form-group">
            <label class="form-label">Title</label>
            <input class="form-input" id="ntc-title" placeholder="e.g. School closed tomorrow" required />
          </div>
          <div class="form-group">
            <label class="form-label">Body</label>
            <textarea class="form-input" id="ntc-body" rows="4" placeholder="Write your notice here…"></textarea>
          </div>
          <div class="form-group">
            <label class="form-label">Priority</label>
            <select class="form-input" id="ntc-priority">
              <option value="normal">Normal</option>
              <option value="important">Important</option>
              <option value="urgent">Urgent</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Expires (optional)</label>
            <input class="form-input" id="ntc-expires" type="date" min="${today}" />
          </div>
        </div>`,
      actions: [
        { label: 'Cancel', cls: 'btn-outline', action: 'cancel' },
        { label: 'Post', cls: 'btn-primary', action: 'post' },
      ],
      onAction: async (action, modal) => {
        if (action !== 'post') return;
        const title    = modal.querySelector('#ntc-title').value.trim();
        const body     = modal.querySelector('#ntc-body').value.trim();
        const priority = modal.querySelector('#ntc-priority').value;
        const expires  = modal.querySelector('#ntc-expires').value;
        if (!title || !body) { App.toast('Title and body are required.', 'warning'); return; }
        try {
          await API.notices(_realmId).create({ title, body, priority, expiresAt: expires || null });
          App.toast('Notice posted!', 'success');
          App.closeModal();
          _load(true);
        } catch (err) { App.toast(err.message, 'danger'); }
      },
    });
  }

  function esc(s) { const d = document.createElement('div'); d.textContent = String(s ?? ''); return d.innerHTML; }

  return { render, destroy };
})();

window.NoticesView = NoticesView;
