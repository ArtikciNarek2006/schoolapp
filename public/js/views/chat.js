/**
 * views/chat.js  —  Group list + real-time message thread
 */
'use strict';

const ChatView = (() => {
  let _realmId   = null;
  let _user      = null;
  let _groups    = [];
  let _activeGid = null;
  let _messages  = [];
  let _replyTo   = null;
  let _typingTimer = null;
  let _unread    = {}; // groupId → count
  const _typingUsers = {}; // groupId → Map<userId, displayName>

  // ── Entry points ─────────────────────────────────────────────────────────────
  function render(user, realmId, params) {
    _user    = user;
    _realmId = realmId;
    App.setTitle('Chat');
    App.setBack(false);
    App.setBarAction(null);

    const root = document.getElementById('view-root');
    root.innerHTML = `
      <div class="chat-layout">
        <div id="group-panel">
          ${_isSenior() ? `<div style="padding:10px 16px 0"><button class="btn btn-outline btn-sm" id="btn-new-group" style="width:100%">＋ New Group</button></div>` : ''}
          <div class="group-list" id="group-list"><div class="spinner"></div></div>
        </div>
      </div>`;

    document.getElementById('btn-new-group')?.addEventListener('click', _showCreateGroup);

    _loadGroups().then(() => {
      if (params.groupId) _openGroup(params.groupId);
    });

    _bindSocketEvents();
  }

  function _isSenior() { return _user?.role === 'senior_admin' || _user?.role === 'project_admin'; }

  // ── Socket events ─────────────────────────────────────────────────────────────
  function _bindSocketEvents() {
    SocketManager.on('new_message',   _onNewMessage);
    SocketManager.on('message_deleted', _onMessageDeleted);
    SocketManager.on('typing',        _onTyping);
    SocketManager.on('stop_typing',   _onStopTyping);
  }

  function destroy() {
    SocketManager.off('new_message',   _onNewMessage);
    SocketManager.off('message_deleted', _onMessageDeleted);
    SocketManager.off('typing',        _onTyping);
    SocketManager.off('stop_typing',   _onStopTyping);
  }

  function _onNewMessage({ message }) {
    if (!message) return;
    if (message.groupId === _activeGid) {
      _messages.push(message);
      _appendBubble(message);
      _scrollBottom();
    } else {
      _unread[message.groupId] = (_unread[message.groupId] || 0) + 1;
      _updateGroupPreview(message);
      App.updateChatBadge(Object.values(_unread).reduce((a, b) => a + b, 0));
    }
  }

  function _onMessageDeleted({ groupId, messageId }) {
    if (groupId !== _activeGid) return;
    const el = document.querySelector(`[data-msg-id="${messageId}"]`);
    if (el) el.querySelector('.bubble-text').textContent = '[Message deleted]';
  }

  function _onTyping({ groupId, userId, displayName }) {
    if (groupId !== _activeGid || userId === _user.id) return;
    if (!_typingUsers[groupId]) _typingUsers[groupId] = new Map();
    _typingUsers[groupId].set(userId, displayName);
    _renderTyping(groupId);
  }

  function _onStopTyping({ groupId, userId }) {
    _typingUsers[groupId]?.delete(userId);
    _renderTyping(groupId);
  }

  function _renderTyping(groupId) {
    const el = document.getElementById('typing-indicator');
    if (!el || groupId !== _activeGid) return;
    const names = [...(_typingUsers[groupId]?.values() || [])];
    el.innerHTML = names.length
      ? `<span class="typing-dots"><span></span><span></span><span></span></span> ${esc(names[0])} is typing…`
      : '';
  }

  // ── Group list ────────────────────────────────────────────────────────────────
  async function _loadGroups() {
    try {
      const res = await API.groups(_realmId).list(_isSenior() ? { all: 'true' } : {});
      _groups   = res.data || [];
      _renderGroupList();
    } catch (err) {
      document.getElementById('group-list').innerHTML =
        `<div class="empty-state"><p>Failed to load groups</p></div>`;
    }
  }

  function _renderGroupList() {
    const el = document.getElementById('group-list');
    if (!el) return;
    if (!_groups.length) {
      el.innerHTML = `<div class="empty-state">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
        <p>No groups yet</p></div>`;
      return;
    }
    el.innerHTML = _groups.map((g) => {
      const u   = _unread[g.id] || 0;
      const av  = _avatarInitials(g.name);
      const chip = g.type === 'general' ? '' : g.type === 'mandatory' ? '<span class="chip chip-warning" style="font-size:.6rem;padding:1px 6px">M</span>' : '<span class="chip chip-gray" style="font-size:.6rem;padding:1px 6px">V</span>';
      return `<div class="group-item ${g.id === _activeGid ? 'active' : ''} ${g.isArchived ? 'opacity:0.5' : ''}" data-gid="${g.id}">
        <div class="avatar" style="background:${_strColor(g.name)};color:#fff">${av}</div>
        <div class="meta">
          <div class="name">${esc(g.name)} ${chip} ${g.isArchived ? '<span class="chip chip-gray" style="font-size:.6rem">archived</span>' : ''}</div>
          <div class="last-msg">${g.memberIds?.length ?? 0} members</div>
        </div>
        ${u ? `<div class="unread">${u > 99 ? '99+' : u}</div>` : ''}
      </div>`;
    }).join('');

    el.querySelectorAll('[data-gid]').forEach((item) => {
      item.addEventListener('click', () => {
        const gid = item.dataset.gid;
        _unread[gid] = 0;
        App.updateChatBadge(Object.values(_unread).reduce((a, b) => a + b, 0));
        item.querySelector('.unread')?.remove();
        Router.navigate('chat', { groupId: gid });
      });
    });
  }

  function _updateGroupPreview(message) {
    const item = document.querySelector(`[data-gid="${message.groupId}"] .last-msg`);
    if (item) item.textContent = message.content?.slice(0, 40) || '[file]';
    const uEl = document.querySelector(`[data-gid="${message.groupId}"] .unread`);
    if (uEl) uEl.textContent = _unread[message.groupId];
  }

  // ── Message thread ────────────────────────────────────────────────────────────
  async function _openGroup(groupId) {
    _activeGid = groupId;
    const group = _groups.find((g) => g.id === groupId);
    if (!group) { await _loadGroups(); }

    const g = _groups.find((g) => g.id === groupId) || { name: '…', type: 'general', memberIds: [] };
    App.setTitle(g.name);
    App.setBack(() => { _activeGid = null; App.setTitle('Chat'); App.setBack(false); Router.navigate('chat'); _renderGroupList(); });
    App.setBarAction(
      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg>`,
      () => _showGroupMenu(g)
    );

    document.getElementById('view-root').innerHTML = `
      <div class="message-screen">
        <div class="message-list" id="msg-list"><div class="spinner"></div></div>
        <div class="typing-indicator" id="typing-indicator"></div>
        ${g.isArchived ? `<div style="text-align:center;padding:12px;font-size:.82rem;color:var(--text-2)">This group is archived</div>` : _composeHtml()}
      </div>`;

    if (!g.isArchived) _bindCompose(groupId);

    // Load history
    try {
      const res  = await API.messages(_realmId)(groupId).list({ limit: 60 });
      _messages  = res.data || [];
      _renderMessages();
      _scrollBottom(false);
    } catch (err) {
      App.toast('Could not load messages', 'danger');
    }

    // Mark group active in list (if visible)
    document.querySelectorAll('.group-item').forEach((el) => {
      el.classList.toggle('active', el.dataset.gid === groupId);
    });
  }

  function _composeHtml() {
    return `
      <div class="compose-bar">
        <button class="attach-btn" id="btn-attach" title="Attach file">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
        </button>
        <textarea class="compose-input" id="compose-input" placeholder="Message…" rows="1"></textarea>
        <button class="send-btn" id="btn-send" title="Send">
          <svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
        </button>
        <input type="file" id="file-input" class="hidden" />
      </div>`;
  }

  function _bindCompose(groupId) {
    const inp     = document.getElementById('compose-input');
    const sendBtn = document.getElementById('btn-send');
    const attachBtn = document.getElementById('btn-attach');
    const fileInp = document.getElementById('file-input');
    if (!inp) return;

    // Auto-resize
    inp.addEventListener('input', () => {
      inp.style.height = 'auto';
      inp.style.height = Math.min(inp.scrollHeight, 140) + 'px';
      _emitTyping(groupId);
    });

    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); _sendText(groupId, inp); }
    });
    sendBtn.addEventListener('click', () => _sendText(groupId, inp));

    attachBtn.addEventListener('click', () => {
      fileInp.accept = '';
      fileInp.click();
    });
    fileInp.addEventListener('change', () => {
      const file = fileInp.files[0];
      if (file) _uploadFile(groupId, file);
      fileInp.value = '';
    });
  }

  function _emitTyping(groupId) {
    if (!SocketManager.isConnected()) return;
    SocketManager.emit('typing', { groupId });
    clearTimeout(_typingTimer);
    _typingTimer = setTimeout(() => SocketManager.emit('stop_typing', { groupId }), 2000);
  }

  async function _sendText(groupId, inp) {
    const content = inp.value.trim();
    if (!content) return;
    inp.value = '';
    inp.style.height = 'auto';

    const payload = { groupId, type: 'text', content };
    if (_replyTo) { payload.replyToId = _replyTo.id; _clearReply(); }

    const res = await SocketManager.emit('send_message', payload);
    if (!res?.success) App.toast(res?.message || 'Failed to send', 'danger');
    inp.focus();
  }

  async function _uploadFile(groupId, file) {
    const isImage = file.type.startsWith('image/');
    const fd = new FormData();
    fd.append('file', file);
    try {
      App.toast('Uploading…');
      const res = await (isImage
        ? API.messages(_realmId)(groupId).uploadImage(fd)
        : API.messages(_realmId)(groupId).uploadFile(fd));
      if (!res.success) App.toast('Upload failed', 'danger');
    } catch (err) {
      App.toast(err.message, 'danger');
    }
  }

  // ── Rendering ─────────────────────────────────────────────────────────────────
  function _renderMessages() {
    const list = document.getElementById('msg-list');
    if (!list) return;
    if (!_messages.length) {
      list.innerHTML = `<div class="empty-state"><p>No messages yet. Say hello! 👋</p></div>`;
      return;
    }
    list.innerHTML = '';
    _messages.forEach((m) => _appendBubble(m, false));
  }

  function _appendBubble(msg, scroll = false) {
    const list = document.getElementById('msg-list');
    if (!list) return;

    const empty = list.querySelector('.empty-state');
    if (empty) empty.remove();

    const isMine  = msg.senderId === _user.id;
    const isSystem = msg.type === 'system' || !msg.senderId;

    if (isSystem) {
      const div = document.createElement('div');
      div.innerHTML = `<div class="bubble system">${esc(msg.content)}</div>`;
      list.appendChild(div.firstElementChild);
      return;
    }

    const time   = msg.createdAt ? new Date(msg.createdAt).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' }) : '';
    const sName  = !isMine ? esc(msg.sender?.displayName || '?') : '';
    const reply  = msg.replyToId ? _buildReplyRef(msg.replyToId, isMine) : '';
    const body   = _buildMsgBody(msg);

    const wrap = document.createElement('div');
    wrap.className = 'bubble-wrap' + (isMine ? ' mine' : '');
    wrap.dataset.msgId = msg.id;
    wrap.innerHTML = `
      ${!isMine ? `<div class="avatar avatar-sm" style="background:${_strColor(msg.sender?.displayName||'')}; color:#fff; align-self:flex-end; flex-shrink:0;">${_avatarInitials(msg.sender?.displayName||'?')}</div>` : ''}
      <div>
        ${!isMine ? `<div style="font-size:.72rem;font-weight:600;color:var(--text-2);margin-bottom:2px;">${sName}</div>` : ''}
        <div class="bubble ${isMine ? 'mine' : 'theirs'}" data-msg-id="${msg.id}">
          ${reply}
          <div class="bubble-text">${body}</div>
          <div class="msg-time">${time}</div>
        </div>
      </div>`;

    // Context menu on long-press or right-click
    const bubble = wrap.querySelector('.bubble');
    bubble.addEventListener('contextmenu', (e) => { e.preventDefault(); _showCtxMenu(e, msg, isMine); });
    bubble.addEventListener('touchstart', _touchStart.bind(null, bubble, msg, isMine), { passive: true });
    bubble.addEventListener('touchend',   _touchEnd.bind(null, bubble));

    list.appendChild(wrap);
    if (scroll) _scrollBottom();
  }

  let _touchTimer = null;
  function _touchStart(bubble, msg, isMine, e) {
    _touchTimer = setTimeout(() => _showCtxMenu({ clientX: e.touches[0].clientX, clientY: e.touches[0].clientY }, msg, isMine), 500);
  }
  function _touchEnd() { clearTimeout(_touchTimer); }

  function _buildMsgBody(msg) {
    if (msg.type === 'image' && msg.fileUrl) {
      return `<a href="${msg.fileUrl}" target="_blank"><img class="chat-img" src="${msg.fileUrl}" alt="${esc(msg.fileName||'image')}" loading="lazy"/></a>`;
    }
    if (msg.type === 'file' && msg.fileUrl) {
      return `<a href="${msg.fileUrl}" target="_blank" class="file-attach" style="color:inherit;text-decoration:none">
        📎 <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(msg.fileName||'file')}</span>
        <span style="font-size:.7rem;opacity:.7">${_fmtSize(msg.fileSize)}</span>
      </a>${msg.content ? `<span>${esc(msg.content)}</span>` : ''}`;
    }
    return esc(msg.content || '').replace(/\n/g, '<br>');
  }

  function _buildReplyRef(replyId, isMine) {
    const ref = _messages.find((m) => m.id === replyId);
    if (!ref) return '';
    const preview = ref.content?.slice(0, 60) || '[file]';
    return `<div class="reply-ref">${esc(ref.sender?.displayName || 'Unknown')}: ${esc(preview)}</div>`;
  }

  function _showCtxMenu(e, msg, isMine) {
    document.querySelector('.ctx-menu')?.remove();
    const menu = document.createElement('div');
    menu.className = 'ctx-menu';
    menu.style.cssText = `top:${Math.min(e.clientY, window.innerHeight - 160)}px;left:${Math.min(e.clientX, window.innerWidth - 180)}px;`;

    const canDelete = isMine || _isSenior();
    menu.innerHTML = `
      <div class="ctx-menu-item" data-action="reply">↩ Reply</div>
      ${!msg.deletedAt && canDelete ? `<div class="ctx-menu-item danger" data-action="delete">🗑 Delete</div>` : ''}`;

    menu.addEventListener('click', (ev) => {
      const action = ev.target.dataset.action;
      if (action === 'reply') _setReply(msg);
      if (action === 'delete') _deleteMessage(msg.id);
      menu.remove();
    });

    document.body.appendChild(menu);
    setTimeout(() => document.addEventListener('click', () => menu.remove(), { once: true }), 10);
  }

  function _setReply(msg) {
    _replyTo = msg;
    let bar = document.getElementById('reply-bar');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'reply-bar';
      bar.style.cssText = 'display:flex;align-items:center;gap:8px;padding:8px 14px;background:var(--primary-light);font-size:.82rem;border-top:1px solid var(--border);';
      const composeBar = document.querySelector('.compose-bar');
      composeBar?.parentElement.insertBefore(bar, composeBar);
    }
    bar.innerHTML = `<span style="flex:1;color:var(--text-2)">↩ Replying to <strong>${esc(msg.sender?.displayName || '?')}</strong>: ${esc(msg.content?.slice(0, 40) || '[file]')}</span>
      <button id="clear-reply" style="font-size:1rem;line-height:1">✕</button>`;
    bar.querySelector('#clear-reply').addEventListener('click', _clearReply);
  }

  function _clearReply() {
    _replyTo = null;
    document.getElementById('reply-bar')?.remove();
  }

  async function _deleteMessage(msgId) {
    const res = await SocketManager.emit('delete_message', { groupId: _activeGid, messageId: msgId });
    if (!res?.success) App.toast(res?.message || 'Could not delete', 'danger');
  }

  function _scrollBottom(smooth = true) {
    const list = document.getElementById('msg-list');
    if (!list) return;
    list.scrollTo({ top: list.scrollHeight, behavior: smooth ? 'smooth' : 'instant' });
  }

  // ── Group context menu ─────────────────────────────────────────────────────────
  function _showGroupMenu(group) {
    const canLeave = group.type === 'voluntary';
    const items = [
      canLeave ? { label: 'Leave group', action: 'leave', danger: true } : null,
      _isSenior() && !group.isArchived ? { label: 'Archive group', action: 'archive', danger: true } : null,
    ].filter(Boolean);

    if (!items.length) return;

    App.showModal({
      title: group.name,
      body: items.map((it) =>
        `<button class="btn ${it.danger ? 'btn-danger' : 'btn-outline'} btn-full" data-action="${it.action}">${it.label}</button>`
      ).join('<div style="height:8px"></div>'),
      onMount: (modal) => {
        modal.querySelectorAll('[data-action]').forEach((btn) => {
          btn.addEventListener('click', async () => {
            App.closeModal();
            if (btn.dataset.action === 'leave')   await _leaveGroup(group.id);
            if (btn.dataset.action === 'archive') await _archiveGroup(group.id);
          });
        });
      },
    });
  }

  async function _leaveGroup(gid) {
    try {
      await API.groups(_realmId).leave(gid);
      App.toast('Left group.', 'success');
      _activeGid = null;
      Router.navigate('chat');
      await _loadGroups();
    } catch (err) { App.toast(err.message, 'danger'); }
  }

  async function _archiveGroup(gid) {
    try {
      await API.groups(_realmId).archive(gid);
      App.toast('Group archived.', 'success');
      _activeGid = null;
      Router.navigate('chat');
      await _loadGroups();
    } catch (err) { App.toast(err.message, 'danger'); }
  }

  function _showCreateGroup() {
    App.showModal({
      title: 'New Group',
      body: `
        <div style="display:flex;flex-direction:column;gap:14px;">
          <div class="form-group">
            <label class="form-label">Group Name</label>
            <input class="form-input" id="new-grp-name" placeholder="e.g. Study Group A"/>
          </div>
          <div class="form-group">
            <label class="form-label">Type</label>
            <select class="form-input" id="new-grp-type">
              <option value="voluntary">Voluntary (students can join)</option>
              <option value="mandatory">Mandatory (admin assigns members)</option>
            </select>
          </div>
        </div>`,
      actions: [
        { label: 'Cancel', cls: 'btn-outline', action: 'cancel' },
        { label: 'Create', cls: 'btn-primary', action: 'create' },
      ],
      onAction: async (action, modal) => {
        if (action !== 'create') return;
        const name = modal.querySelector('#new-grp-name').value.trim();
        const type = modal.querySelector('#new-grp-type').value;
        if (!name) { App.toast('Enter a name', 'warning'); return; }
        try {
          await API.groups(_realmId).create({ name, type });
          App.toast('Group created!', 'success');
          App.closeModal();
          await _loadGroups();
        } catch (err) { App.toast(err.message, 'danger'); }
      },
    });
  }

  // ── Helpers ───────────────────────────────────────────────────────────────────
  function _fmtSize(bytes) {
    if (!bytes) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
  }

  function esc(s) { const d = document.createElement('div'); d.textContent = String(s ?? ''); return d.innerHTML; }

  function _avatarInitials(name) {
    const parts = String(name).split(' ').filter(Boolean);
    if (!parts.length) return '?';
    return parts.length > 1 ? (parts[0][0] + parts[1][0]).toUpperCase() : parts[0].substring(0, 2).toUpperCase();
  }

  const COLORS = ['#4f46e5','#7c3aed','#db2777','#d97706','#065f46','#1d4ed8','#9d174d'];
  function _strColor(str) { let h = 0; for (const c of String(str)) h = (h * 31 + c.charCodeAt(0)) & 0xffffffff; return COLORS[Math.abs(h) % COLORS.length]; }

  return { render, destroy };
})();

window.ChatView = ChatView;
