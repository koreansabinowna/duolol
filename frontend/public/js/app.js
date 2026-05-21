/* DUOQ.GG - Frontend SPA */
const API = '/api';
let token = localStorage.getItem('duoq_token');
let me = JSON.parse(localStorage.getItem('duoq_me') || 'null');
let socket = null;
let currentFilter = 'solo';
let currentChatPartner = null;
let currentConvId = null;
let notifCount = 0;
let msgCount = 0;

// ── Helpers ────────────────────────────────────
const $ = id => document.getElementById(id);
const qs = sel => document.querySelector(sel);

function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  return fetch(API + path, { headers, ...opts, body: opts.body ? JSON.stringify(opts.body) : undefined })
    .then(async r => {
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw data;
      return data;
    });
}

function eloClass(tier) {
  if (!tier) return 'elo-unranked';
  return 'elo-' + tier.toLowerCase();
}

function eloLabel(tier, rank, lp) {
  if (!tier) return 'Sem Rank';
  if (['MASTER','GRANDMASTER','CHALLENGER'].includes(tier)) return `${tier} ${lp || 0}LP`;
  return `${tier} ${rank || ''} ${lp || 0}LP`.trim();
}

function timeAgo(dateStr) {
  const diff = (Date.now() - new Date(dateStr)) / 1000;
  if (diff < 60) return 'agora';
  if (diff < 3600) return Math.floor(diff / 60) + 'min';
  if (diff < 86400) return Math.floor(diff / 3600) + 'h';
  return Math.floor(diff / 86400) + 'd';
}

function avatarColor(name) {
  const colors = ['#C8963E','#3B82F6','#A78BFA','#22C55E','#F59E0B','#EC4899','#14B8A6','#EF4444'];
  let h = 0; for (let c of name) h = (h * 31 + c.charCodeAt(0)) % colors.length;
  return colors[h];
}

function avatar(user, size = 'av-md') {
  const col = avatarColor(user.username || user.lol_game_name || 'U');
  const letter = (user.username || user.lol_game_name || 'U')[0].toUpperCase();
  const status = user.online_status || 'offline';
  const dotClass = status === 'online' ? 'dot-online' : status === 'away' ? 'dot-away' : 'dot-offline';
  if (user.avatar_url) {
    return `<img src="${user.avatar_url}" class="av ${size}" style="object-fit:cover;" alt="">`;
  }
  return `<div class="av ${size}" style="background:${col}">${letter}<div class="status-dot ${dotClass}"></div></div>`;
}

function toast(msg, duration = 2500) {
  const t = $('toast');
  t.textContent = msg;
  t.style.opacity = '1';
  clearTimeout(t._t);
  t._t = setTimeout(() => t.style.opacity = '0', duration);
}

// ── Auth ───────────────────────────────────────
document.querySelectorAll('.auth-tab').forEach(tab => {
  tab.onclick = () => {
    document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    $('register-form').style.display = tab.dataset.tab === 'register' ? '' : 'none';
    $('login-form').style.display = tab.dataset.tab === 'login' ? '' : 'none';
    $('auth-error').style.display = 'none';
  };
});

async function register(e) {
  e.preventDefault();
  const btn = $('btn-register');
  btn.disabled = true;
  btn.textContent = 'AGUARDE...';
  try {
    const res = await api('/auth/register', {
      method: 'POST',
      body: {
        username: $('reg-username').value.trim(),
        email: $('reg-email').value.trim(),
        password: $('reg-password').value,
        lol_game_name: $('reg-lol-name').value.trim(),
        lol_tag_line: $('reg-lol-tag').value.trim()
      }
    });
    saveSession(res);
  } catch (err) {
    showAuthError(err.error || 'Erro ao cadastrar');
  } finally {
    btn.disabled = false; btn.textContent = 'CRIAR CONTA';
  }
}

async function login(e) {
  e.preventDefault();
  const btn = $('btn-login');
  btn.disabled = true; btn.textContent = 'AGUARDE...';
  try {
    const res = await api('/auth/login', { method: 'POST', body: { email: $('login-email').value.trim(), password: $('login-password').value } });
    saveSession(res);
  } catch (err) {
    showAuthError(err.error || 'Email ou senha inválidos');
  } finally {
    btn.disabled = false; btn.textContent = 'ENTRAR';
  }
}

function showAuthError(msg) {
  const el = $('auth-error');
  el.textContent = msg;
  el.style.display = 'block';
}

function saveSession({ token: t, user }) {
  token = t; me = user;
  localStorage.setItem('duoq_token', t);
  localStorage.setItem('duoq_me', JSON.stringify(user));
  bootApp();
}

async function logout() {
  try { await api('/auth/logout', { method: 'POST' }); } catch {}
  localStorage.clear();
  token = null; me = null;
  if (socket) { socket.disconnect(); socket = null; }
  $('app-screen').style.display = 'none';
  $('auth-screen').style.display = '';
}

// ── Boot ───────────────────────────────────────
function bootApp() {
  $('auth-screen').style.display = 'none';
  $('app-screen').style.display = '';
  initSocket();
  loadPage('feed');
  refreshMe();
  pollOnlineCount();
  setInterval(pollOnlineCount, 10000);
  loadNotifCount();
  loadMsgCount();
}

async function refreshMe() {
  try {
    const user = await api('/users/me');
    me = { ...me, ...user };
    localStorage.setItem('duoq_me', JSON.stringify(me));
    renderSidebarRanks();
  } catch {}
}

function initSocket() {
  const scriptEl = document.createElement('script');
  scriptEl.src = '/socket.io/socket.io.js';
  scriptEl.onload = () => {
    socket = io({ auth: { token } });
    socket.on('connect', () => console.log('Socket conectado'));
    socket.on('new_message', onSocketMessage);
    socket.on('notification', onSocketNotif);
    socket.on('friend_online', ({ user_id, status }) => updateFriendStatus(user_id, status));
  };
  document.head.appendChild(scriptEl);
}

function onSocketMessage(msg) {
  if (currentConvId && msg.conversation_id == currentConvId) {
    appendBubble(msg, msg.sender_id == me.id ? 'me' : 'them');
  } else {
    msgCount++;
    updateMsgBadge();
    toast('💬 Nova mensagem recebida');
  }
}

function onSocketNotif(notif) {
  notifCount++;
  updateNotifBadge();
  const icons = { POST_LIKE:'❤️', POST_COMMENT:'💬', FRIEND_REQUEST:'👤', FRIEND_ACCEPTED:'✅', NEW_MESSAGE:'💬', ELO_UPDATE:'🏆' };
  toast((icons[notif.type] || '🔔') + ' Nova notificação');
}

// ── Navigation ─────────────────────────────────
function loadPage(name) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.s-item').forEach(i => i.classList.remove('active'));
  const page = $('page-' + name);
  const navItem = $('nav-' + name);
  if (page) page.classList.add('active');
  if (navItem) navItem.classList.add('active');

  if (name === 'feed') loadFeed();
  if (name === 'explore') loadExplore();
  if (name === 'messages') loadConversations();
  if (name === 'notifications') loadNotifications();
  if (name === 'profile') loadMyProfile();
}

// ── Feed ───────────────────────────────────────
let feedLoading = false;
async function loadFeed() {
  if (feedLoading) return;
  feedLoading = true;
  const container = $('feed-posts');
  container.innerHTML = '<div class="loading"><div class="spinner"></div> Carregando feed...</div>';
  try {
    const posts = await api(`/posts?queue=${currentFilter}&limit=25`);
    renderFeed(posts);
  } catch { container.innerHTML = '<div class="empty"><i class="ti ti-alert-circle"></i><p>Erro ao carregar o feed</p></div>'; }
  feedLoading = false;
}

function renderFeed(posts) {
  const c = $('feed-posts');
  if (!posts.length) { c.innerHTML = '<div class="empty"><i class="ti ti-mood-empty"></i><p>Nenhum post nesta fila ainda. Seja o primeiro!</p></div>'; return; }
  c.innerHTML = posts.map(postHTML).join('');
}

function postHTML(p) {
  const soloLabel = eloLabel(p.solo_tier, p.solo_rank, p.solo_lp);
  const flexLabel = eloLabel(p.flex_tier, p.flex_rank, p.flex_lp);
  return `
  <div class="post-card" id="post-${p.id}">
    <div class="post-head">
      ${avatar(p, 'av-md')}
      <div class="post-meta">
        <div class="post-top">
          <span class="post-name" onclick="viewProfile(${p.user_id})">${p.username}</span>
          <span class="post-nick">${p.lol_game_name}#${p.lol_tag_line}</span>
          <span class="post-time">${timeAgo(p.created_at)}</span>
        </div>
        <div class="post-elos">
          <span class="elo ${eloClass(p.solo_tier)}">Solo ${soloLabel}</span>
          <span class="elo ${eloClass(p.flex_tier)}">Flex ${flexLabel}</span>
        </div>
      </div>
    </div>
    <div class="post-body">${escapeHtml(p.content)}</div>
    <div style="margin-bottom:8px">
      <span class="tag ${p.queue_type === 'SOLO' || p.queue_type === 'BOTH' ? 'tag-solo on' : 'tag-flex on'}" style="cursor:default">
        ${p.queue_type === 'FLEX' ? 'Flex' : p.queue_type === 'BOTH' ? 'Solo + Flex' : 'Solo/Duo'}
      </span>
    </div>
    <div class="post-actions">
      <button class="act-btn ${p.liked_by_me ? 'liked' : ''}" onclick="toggleLike(${p.id}, this)">
        <i class="ti ti-heart"></i> <span class="like-count">${p.total_likes}</span>
      </button>
      <button class="act-btn" onclick="toggleComments(${p.id})">
        <i class="ti ti-message-2"></i> <span>${p.total_comments}</span>
      </button>
      ${p.user_id !== me?.id ? `
      <button class="act-btn" onclick="addFriend(${p.user_id}, this)">
        <i class="ti ti-user-plus"></i> <span>Adicionar</span>
      </button>
      <button class="act-btn" style="margin-left:auto" onclick="openDM(${p.user_id}, '${p.username}')">
        <i class="ti ti-send"></i> DM
      </button>` : `
      <button class="act-btn" onclick="deletePost(${p.id})" style="margin-left:auto;color:var(--dim)">
        <i class="ti ti-trash"></i>
      </button>`}
    </div>
    <div class="comments-section" id="comments-${p.id}">
      <div class="comments-list" id="clist-${p.id}"><div class="loading"><div class="spinner"></div></div></div>
      <div class="comment-input-row">
        <input class="comment-inp" placeholder="Adicionar comentário..." onkeydown="if(event.key==='Enter')submitComment(${p.id}, this)">
        <button class="btn-send" onclick="submitComment(${p.id}, this.previousElementSibling)"><i class="ti ti-send"></i></button>
      </div>
    </div>
  </div>`;
}

async function toggleLike(postId, btn) {
  try {
    const res = await api('/posts/' + postId + '/like', { method: 'POST' });
    const countEl = btn.querySelector('.like-count');
    const current = parseInt(countEl.textContent);
    countEl.textContent = res.liked ? current + 1 : current - 1;
    btn.classList.toggle('liked', res.liked);
  } catch { toast('Erro ao curtir'); }
}

async function toggleComments(postId) {
  const section = $('comments-' + postId);
  const isOpen = section.style.display === 'block';
  section.style.display = isOpen ? 'none' : 'block';
  if (!isOpen) {
    const list = $('clist-' + postId);
    try {
      const comments = await api('/posts/' + postId + '/comments');
      list.innerHTML = comments.length
        ? comments.map(c => `
          <div class="comment-item">
            ${avatar({username: c.username, avatar_url: c.avatar_url, online_status:'offline'}, 'av-sm')}
            <div class="comment-content">
              <div class="comment-author">${c.username}</div>
              <div class="comment-text">${escapeHtml(c.content)}</div>
            </div>
          </div>`).join('')
        : '<div style="color:var(--dim);font-size:13px;text-align:center;padding:12px">Sem comentários ainda</div>';
    } catch { list.innerHTML = 'Erro ao carregar'; }
  }
}

async function submitComment(postId, inp) {
  if (!inp.value.trim()) return;
  try {
    const c = await api('/posts/' + postId + '/comments', { method: 'POST', body: { content: inp.value } });
    const list = $('clist-' + postId);
    const div = document.createElement('div');
    div.className = 'comment-item';
    div.innerHTML = `${avatar(me, 'av-sm')}<div class="comment-content"><div class="comment-author">${me.username}</div><div class="comment-text">${escapeHtml(c.content)}</div></div>`;
    list.appendChild(div);
    inp.value = '';
  } catch { toast('Erro ao comentar'); }
}

async function deletePost(postId) {
  if (!confirm('Deletar este post?')) return;
  await api('/posts/' + postId, { method: 'DELETE' });
  $('post-' + postId).remove();
  toast('Post removido');
}

let postQueue = 'SOLO';
function setPostQueue(q, el) {
  postQueue = q;
  document.querySelectorAll('.composer-tag').forEach(t => t.classList.remove('on'));
  el.classList.add('on');
}

async function publishPost() {
  const ta = $('post-textarea');
  const content = ta.value.trim();
  if (!content || content.length < 5) return toast('Escreva um pouco mais!');
  if (content.length > 500) return toast('Máximo 500 caracteres');
  const btn = $('btn-publish');
  btn.disabled = true; btn.textContent = 'POSTANDO...';
  try {
    const post = await api('/posts', { method: 'POST', body: { content, queue_type: postQueue } });
    ta.value = '';
    const container = $('feed-posts');
    const div = document.createElement('div');
    div.innerHTML = postHTML({ ...post, username: me.username, lol_game_name: me.lol_game_name, lol_tag_line: me.lol_tag_line, solo_tier: me.solo_tier, solo_rank: me.solo_rank, solo_lp: me.solo_lp, flex_tier: me.flex_tier, flex_rank: me.flex_rank, flex_lp: me.flex_lp, online_status: 'online', liked_by_me: 0 });
    container.prepend(div.firstChild);
    toast('📢 Post publicado!');
  } catch (err) { toast(err.error || 'Erro ao publicar'); }
  btn.disabled = false; btn.textContent = 'POSTAR';
}

function setFilter(f) {
  currentFilter = f;
  document.querySelectorAll('.feed-filter').forEach(el => {
    el.classList.toggle('on', el.dataset.filter === f);
  });
  loadFeed();
}

// ── Explore ────────────────────────────────────
async function loadExplore() {
  const grid = $('explore-grid');
  grid.innerHTML = '<div class="loading" style="grid-column:1/-1"><div class="spinner"></div> Buscando jogadores...</div>';
  try {
    const users = await api('/users?limit=20');
    if (!users.length) { grid.innerHTML = '<div class="empty" style="grid-column:1/-1"><i class="ti ti-users-off"></i><p>Nenhum jogador encontrado</p></div>'; return; }
    grid.innerHTML = users.map(u => `
      <div class="player-card">
        <div class="pc-top">
          ${avatar(u, 'av-md')}
          <div><div class="pc-name">${u.username}</div><div class="pc-nick">${u.lol_game_name}#${u.lol_tag_line}</div></div>
        </div>
        <div style="display:flex;gap:5px;flex-wrap:wrap;margin-bottom:8px">
          <span class="elo ${eloClass(u.solo_tier)}">Solo ${eloLabel(u.solo_tier, u.solo_rank, u.solo_lp)}</span>
          <span class="elo ${eloClass(u.flex_tier)}">Flex ${eloLabel(u.flex_tier, u.flex_rank, u.flex_lp)}</span>
        </div>
        <div class="btn-invite" onclick="sendDuoInvite(${u.id}, this)">Convidar para Duo</div>
      </div>`).join('');
  } catch { grid.innerHTML = '<div class="empty" style="grid-column:1/-1"><i class="ti ti-alert-circle"></i><p>Erro ao carregar</p></div>'; }
}

async function searchPlayers() {
  const q = $('explore-search').value.trim();
  const grid = $('explore-grid');
  grid.innerHTML = '<div class="loading" style="grid-column:1/-1"><div class="spinner"></div></div>';
  try {
    const users = await api('/users?q=' + encodeURIComponent(q));
    grid.innerHTML = users.map(u => `
      <div class="player-card">
        <div class="pc-top">${avatar(u, 'av-md')}<div><div class="pc-name">${u.username}</div><div class="pc-nick">${u.lol_game_name}#${u.lol_tag_line}</div></div></div>
        <div style="display:flex;gap:5px;flex-wrap:wrap;margin-bottom:8px">
          <span class="elo ${eloClass(u.solo_tier)}">Solo ${eloLabel(u.solo_tier, u.solo_rank, u.solo_lp)}</span>
          <span class="elo ${eloClass(u.flex_tier)}">Flex ${eloLabel(u.flex_tier, u.flex_rank, u.flex_lp)}</span>
        </div>
        <div class="btn-invite" onclick="sendDuoInvite(${u.id}, this)">Convidar para Duo</div>
      </div>`).join('') || '<div class="empty" style="grid-column:1/-1"><p>Nenhum resultado</p></div>';
  } catch {}
}

async function sendDuoInvite(userId, el) {
  el.className = 'btn-invite sent';
  el.textContent = '✓ Convite Enviado';
  try { await api('/users/me/friend-request', { method: 'POST', body: { receiver_id: userId } }); toast('🎮 Convite enviado!'); }
  catch (err) { toast(err.error || 'Erro ao enviar convite'); }
}

// ── Conversations / Messages ───────────────────
async function loadConversations() {
  const list = $('conv-list');
  list.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  try {
    const convs = await api('/messages');
    if (!convs.length) { list.innerHTML = '<div class="empty"><i class="ti ti-messages-off"></i><p>Nenhuma conversa ainda</p></div>'; return; }
    list.innerHTML = convs.map(c => `
      <div class="conv-item ${c.unread_count > 0 ? 'unread' : ''}" onclick="openConv(${c.id}, ${c.partner_id}, '${c.username}')">
        ${avatar(c, 'av-md')}
        <div class="conv-meta">
          <div class="conv-name">${c.username}</div>
          <div class="conv-last">${c.last_message || 'Iniciar conversa'}</div>
        </div>
        ${c.unread_count > 0 ? `<div class="unread-badge">${c.unread_count}</div>` : ''}
      </div>`).join('');
  } catch { list.innerHTML = '<div class="empty"><i class="ti ti-alert-circle"></i><p>Erro ao carregar</p></div>'; }
  msgCount = 0; updateMsgBadge();
}

async function openDM(partnerId, partnerName) {
  try {
    const { conversation_id } = await api('/messages/open', { method: 'POST', body: { partner_id: partnerId } });
    openChatWindow(conversation_id, partnerId, partnerName);
  } catch { toast('Erro ao abrir conversa'); }
}

async function openConv(convId, partnerId, partnerName) {
  openChatWindow(convId, partnerId, partnerName);
}

function openChatWindow(convId, partnerId, partnerName) {
  currentConvId = convId;
  currentChatPartner = { id: partnerId, name: partnerName };
  $('chat-partner-name').textContent = partnerName;
  const win = $('chat-window');
  win.classList.add('open');
  loadMessages(convId);
  if (socket) {
    socket.emit('join_conversation', convId);
  }
}

async function loadMessages(convId) {
  const msgs = $('chat-msgs');
  msgs.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  try {
    const list = await api('/messages/' + convId);
    msgs.innerHTML = '';
    list.forEach(m => appendBubble(m, m.sender_id == me?.id ? 'me' : 'them'));
    msgs.scrollTop = msgs.scrollHeight;
  } catch { msgs.innerHTML = '<div class="empty"><p>Erro ao carregar mensagens</p></div>'; }
}

function appendBubble(msg, side) {
  const msgs = $('chat-msgs');
  const div = document.createElement('div');
  div.className = 'bubble ' + side;
  div.textContent = msg.content;
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
}

async function sendChatMessage() {
  if (!currentConvId) return;
  const inp = $('chat-input');
  const content = inp.value.trim();
  if (!content) return;
  inp.value = '';
  if (socket && socket.connected) {
    socket.emit('send_message', { conversation_id: currentConvId, content });
    appendBubble({ content, sender_id: me.id }, 'me');
  } else {
    try {
      const msg = await api('/messages/' + currentConvId, { method: 'POST', body: { content } });
      appendBubble(msg, 'me');
    } catch { toast('Erro ao enviar'); inp.value = content; }
  }
}

// ── Notifications ──────────────────────────────
async function loadNotifications() {
  const list = $('notif-list');
  list.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  try {
    const notifs = await api('/notifications');
    await api('/notifications/read-all', { method: 'PATCH' });
    notifCount = 0; updateNotifBadge();
    if (!notifs.length) { list.innerHTML = '<div class="empty"><i class="ti ti-bell-off"></i><p>Sem notificações</p></div>'; return; }
    const icons = { POST_LIKE:'ti-heart', POST_COMMENT:'ti-message-2', COMMENT_REPLY:'ti-message-reply', FRIEND_REQUEST:'ti-user-plus', FRIEND_ACCEPTED:'ti-user-check', NEW_MESSAGE:'ti-send', DUO_INVITE:'ti-sword', ELO_UPDATE:'ti-trophy', SYSTEM:'ti-info-circle' };
    list.innerHTML = notifs.map(n => `
      <div class="notif-item ${n.is_read ? '' : 'unread'}">
        <div class="notif-icon"><i class="ti ${icons[n.type] || 'ti-bell'}"></i></div>
        <div>
          <div class="notif-text">${n.actor_username ? `<strong>${n.actor_username}</strong> ` : ''}${notifText(n.type)}</div>
          <div class="notif-time">${timeAgo(n.created_at)}</div>
        </div>
      </div>`).join('');
  } catch { list.innerHTML = '<div class="empty"><p>Erro ao carregar</p></div>'; }
}

function notifText(type) {
  const t = { POST_LIKE:'curtiu seu post', POST_COMMENT:'comentou no seu post', COMMENT_REPLY:'respondeu seu comentário', FRIEND_REQUEST:'enviou solicitação de amizade', FRIEND_ACCEPTED:'aceitou sua solicitação', NEW_MESSAGE:'enviou uma mensagem', DUO_INVITE:'te convidou para duo', ELO_UPDATE:'seu elo foi atualizado', SYSTEM:'mensagem do sistema' };
  return t[type] || type;
}

async function loadNotifCount() {
  try {
    const { count } = await api('/notifications/count');
    notifCount = count;
    updateNotifBadge();
  } catch {}
}

async function loadMsgCount() {
  try {
    const convs = await api('/messages');
    msgCount = convs.reduce((a, c) => a + (c.unread_count || 0), 0);
    updateMsgBadge();
  } catch {}
}

function updateNotifBadge() {
  const b = $('notif-badge');
  b.textContent = notifCount;
  b.style.display = notifCount > 0 ? '' : 'none';
}
function updateMsgBadge() {
  const b = $('msg-badge');
  b.textContent = msgCount;
  b.style.display = msgCount > 0 ? '' : 'none';
}

// ── Profile ────────────────────────────────────
async function loadMyProfile() {
  try {
    const user = await api('/users/me');
    me = { ...me, ...user };
    renderProfile(user, true);
  } catch {}
}

function renderProfile(user, isMe) {
  const soloLabel = eloLabel(user.solo_tier, user.solo_rank, user.solo_lp);
  const flexLabel = eloLabel(user.flex_tier, user.flex_rank, user.flex_lp);
  const soloLP = user.solo_lp || 0;
  const flexLP = user.flex_lp || 0;
  $('profile-content').innerHTML = `
    <div class="profile-banner">
      <div class="profile-top">
        ${avatar(user, 'av-xl')}
        <div class="profile-info">
          <div class="profile-name">${user.username}</div>
          <div class="profile-nick">${user.lol_game_name}#${user.lol_tag_line}</div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px">
            <span class="elo ${eloClass(user.solo_tier)}">Solo ${soloLabel}</span>
            <span class="elo ${eloClass(user.flex_tier)}">Flex ${flexLabel}</span>
          </div>
        </div>
        ${isMe ? `
          <div style="display:flex;flex-direction:column;gap:8px">
            <button class="btn-outline" onclick="syncElo()"><i class="ti ti-refresh"></i> Sync Elo</button>
            <button class="btn-outline" onclick="logout()" style="border-color:rgba(239,68,68,.4);color:#FCA5A5">Sair</button>
          </div>` : ''}
      </div>
      <div class="profile-stats">
        <div><div class="pstat-num">${user.total_posts || 0}</div><div class="pstat-lbl">Posts</div></div>
        <div><div class="pstat-num">${user.total_friends || 0}</div><div class="pstat-lbl">Amigos</div></div>
        <div><div class="pstat-num">${user.total_likes_received || 0}</div><div class="pstat-lbl">Curtidas</div></div>
      </div>
    </div>
    <div style="padding:16px 20px">
      <div class="rp-title">Ranks</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:20px">
        <div class="rank-card">
          <div class="rank-row"><span class="rank-label">Solo/Duo</span><span class="rank-val ${eloClass(user.solo_tier)}" style="font-size:14px">${soloLabel}</span></div>
          <div class="rank-row"><span class="rank-lp">${user.solo_wins || 0}V ${user.solo_losses || 0}D</span></div>
          <div class="rank-bar"><div class="rank-fill" style="width:${Math.min(soloLP,100)}%;background:var(--gold)"></div></div>
        </div>
        <div class="rank-card">
          <div class="rank-row"><span class="rank-label">Flex</span><span class="rank-val" style="font-size:14px;color:#93C5FD">${flexLabel}</span></div>
          <div class="rank-row"><span class="rank-lp">${user.flex_wins || 0}V ${user.flex_losses || 0}D</span></div>
          <div class="rank-bar"><div class="rank-fill" style="width:${Math.min(flexLP,100)}%;background:var(--blue)"></div></div>
        </div>
      </div>
      ${user.roles?.length ? `<div class="rp-title">Lanes</div><div style="display:flex;gap:8px;flex-wrap:wrap">${user.roles.map(r => `<span class="tag tag-solo on" style="cursor:default">${r.role}</span>`).join('')}</div>` : ''}
      ${user.bio ? `<div style="margin-top:16px"><div class="rp-title">Bio</div><p style="font-size:14px;color:var(--muted);line-height:1.6">${escapeHtml(user.bio)}</p></div>` : ''}
    </div>`;
  renderSidebarRanks();
}

async function viewProfile(userId) {
  loadPage('profile');
  try {
    const user = await api('/users/' + userId);
    renderProfile(user, userId == me?.id);
  } catch {}
}

async function syncElo() {
  toast('⏳ Sincronizando com a Riot API...');
  try {
    const res = await api('/users/me/sync-elo', { method: 'POST' });
    if (res.warning) { toast('⚠️ ' + res.warning, 4000); return; }
    toast('✅ Elo atualizado com sucesso!');
    loadMyProfile();
  } catch (err) {
    toast('❌ ' + (err.error || 'Erro ao sincronizar'));
  }
}

// ── Friends sidebar ────────────────────────────
async function loadFriends() {
  try {
    const friends = await api('/users/me/friends');
    const list = $('friends-online');
    list.innerHTML = '';
    friends.forEach(f => {
      const div = document.createElement('div');
      div.className = 'friend-row';
      div.id = 'friend-' + f.id;
      div.onclick = () => openDM(f.id, f.username);
      div.innerHTML = `${avatar(f, 'av-sm')}<span class="friend-name">${f.username}</span>`;
      list.appendChild(div);
    });
  } catch {}
}

function updateFriendStatus(userId, status) {
  const el = $('friend-' + userId);
  if (!el) return;
  const dot = el.querySelector('.status-dot');
  if (dot) dot.className = 'status-dot dot-' + status;
}

async function addFriend(userId, btn) {
  try {
    await api('/users/me/friend-request', { method: 'POST', body: { receiver_id: userId } });
    btn.innerHTML = '<i class="ti ti-check"></i> <span>Enviado</span>';
    btn.style.color = 'var(--green)';
    toast('✅ Solicitação enviada!');
  } catch (err) { toast(err.error || 'Erro ao adicionar'); }
}

// ── Sidebar rank display ───────────────────────
function renderSidebarRanks() {
  if (!me) return;
  const soloLabel = eloLabel(me.solo_tier, me.solo_rank, me.solo_lp);
  const flexLabel = eloLabel(me.flex_tier, me.flex_rank, me.flex_lp);
  const soloLP = me.solo_lp || 0;
  const flexLP = me.flex_lp || 0;
  $('rp-ranks').innerHTML = `
    <div class="rank-card">
      <div class="rank-row"><span class="rank-label">Solo/Duo</span><span class="rank-val">${soloLabel}</span></div>
      <div class="rank-bar"><div class="rank-fill" style="width:${Math.min(soloLP,100)}%;background:var(--gold)"></div></div>
    </div>
    <div class="rank-card" style="margin-top:6px">
      <div class="rank-row"><span class="rank-label">Flex</span><span class="rank-val" style="color:#93C5FD">${flexLabel}</span></div>
      <div class="rank-bar"><div class="rank-fill" style="width:${Math.min(flexLP,100)}%;background:var(--blue)"></div></div>
    </div>`;
}

async function pollOnlineCount() {
  try {
    const { count } = await api('/users/stats/online');
    const el = $('online-count');
    if (el) el.textContent = count;
  } catch {}
}

// ── Utils ──────────────────────────────────────
function escapeHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Init ───────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  if (token && me) {
    bootApp();
  }
});
