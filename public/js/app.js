/* DUOQ.GG - Frontend SPA */
const API = '/api';
let token  = localStorage.getItem('duoq_token');
let me     = JSON.parse(localStorage.getItem('duoq_me') || 'null');
let socket = null;
let currentFilter      = 'solo';
let postQueue          = 'SOLO';
let currentConvId      = null;
let currentChatPartner = null;
let notifCount = 0;
let msgCount   = 0;

// ── Helpers ────────────────────────────────────
const $ = id => document.getElementById(id);

function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  return fetch(API + path, {
    headers,
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined
  }).then(async r => {
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
  if (['MASTER','GRANDMASTER','CHALLENGER'].includes(tier))
    return `${tier} ${lp || 0}LP`;
  return `${tier} ${rank || ''} ${lp || 0}LP`.trim();
}

function timeAgo(dateStr) {
  const diff = (Date.now() - new Date(dateStr)) / 1000;
  if (diff < 60)    return 'agora';
  if (diff < 3600)  return Math.floor(diff / 60) + 'min';
  if (diff < 86400) return Math.floor(diff / 3600) + 'h';
  return Math.floor(diff / 86400) + 'd';
}

function avatarColor(name) {
  const colors = ['#C8963E','#3B82F6','#A78BFA','#22C55E','#F59E0B','#EC4899','#14B8A6','#EF4444'];
  let h = 0;
  for (const c of String(name)) h = (h * 31 + c.charCodeAt(0)) % colors.length;
  return colors[Math.abs(h)];
}

function avatarHTML(user, size = 'av-md') {
  const col    = avatarColor(user.username || user.lol_game_name || 'U');
  const letter = (user.username || user.lol_game_name || 'U')[0].toUpperCase();
  const status = user.online_status || 'offline';
  const dotCls = status === 'online' ? 'dot-online' : status === 'away' ? 'dot-away' : 'dot-offline';
  if (user.avatar_url) {
    return `<img src="${user.avatar_url}" class="av ${size}" style="object-fit:cover" alt="">`;
  }
  return `<div class="av ${size}" style="background:${col};color:#0A0E1A">${letter}<div class="status-dot ${dotCls}"></div></div>`;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function toast(msg, duration = 2800) {
  const t = $('toast');
  t.textContent = msg;
  t.style.opacity = '1';
  clearTimeout(t._t);
  t._t = setTimeout(() => t.style.opacity = '0', duration);
}

// ── Auth tabs ──────────────────────────────────
document.querySelectorAll('.auth-tab').forEach(tab => {
  tab.onclick = () => {
    document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    $('register-form').style.display = tab.dataset.tab === 'register' ? '' : 'none';
    $('login-form').style.display    = tab.dataset.tab === 'login'    ? '' : 'none';
    $('auth-error').style.display    = 'none';
  };
});

// ── Register ───────────────────────────────────
async function register(e) {
  e.preventDefault();
  const btn = $('btn-register');
  btn.disabled = true; btn.textContent = 'AGUARDE...';
  $('auth-error').style.display = 'none';
  try {
    const res = await api('/auth/register', {
      method: 'POST',
      body: {
        username:      $('reg-username').value.trim(),
        email:         $('reg-email').value.trim(),
        password:      $('reg-password').value,
        lol_game_name: $('reg-lol-name').value.trim(),
        lol_tag_line:  $('reg-lol-tag').value.trim()
      }
    });
    saveSession(res);
  } catch (err) {
    showAuthError(err.error || 'Erro ao cadastrar. Tente novamente.');
  } finally {
    btn.disabled = false; btn.textContent = 'CRIAR CONTA';
  }
}

// ── Login ──────────────────────────────────────
async function login(e) {
  e.preventDefault();
  const btn = $('btn-login');
  btn.disabled = true; btn.textContent = 'AGUARDE...';
  $('auth-error').style.display = 'none';
  try {
    const res = await api('/auth/login', {
      method: 'POST',
      body: {
        email:    $('login-email').value.trim(),
        password: $('login-password').value
      }
    });
    saveSession(res);
  } catch (err) {
    showAuthError(err.error || 'Email ou senha inválidos.');
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
  token = t;
  me    = user;
  localStorage.setItem('duoq_token', t);
  localStorage.setItem('duoq_me', JSON.stringify(user));
  bootApp();
}

async function logout() {
  try { await api('/auth/logout', { method: 'POST' }); } catch {}
  localStorage.clear();
  token = null; me = null;
  if (socket) { socket.disconnect(); socket = null; }
  $('app-screen').style.display  = 'none';
  $('auth-screen').style.display = 'flex';
}

// ── Boot ───────────────────────────────────────
function bootApp() {
  // Mostra o app, esconde o auth
  $('auth-screen').style.display = 'none';
  $('app-screen').style.display = 'flex';

  // Atualiza avatar no compositor
  updateMyAvatar();

  // Carrega dados
  refreshMe();
  loadPage('feed');
  loadFriends();
  loadNotifCount();
  loadMsgCount();
  pollOnlineCount();

  // Polls periódicos
  setInterval(pollOnlineCount, 10000);
  setInterval(loadNotifCount,  30000);
  setInterval(loadMsgCount,    15000);

  // Socket
  initSocket();
}

function updateMyAvatar() {
  if (!me) return;
  const el = $('my-avatar-feed');
  if (!el) return;
  const col    = avatarColor(me.username || 'U');
  const letter = (me.username || 'U')[0].toUpperCase();
  el.style.background = col;
  el.textContent      = letter;
}

async function refreshMe() {
  try {
    const user = await api('/users/me');
    me = { ...me, ...user };
    localStorage.setItem('duoq_me', JSON.stringify(me));
    updateMyAvatar();
    renderSidebarRanks();
  } catch (err) {
    // Token expirado
    if (err.error && err.error.includes('Token')) logout();
  }
}

// ── Socket ─────────────────────────────────────
function initSocket() {
  if (typeof io === 'undefined') {
    const s = document.createElement('script');
    s.src    = '/socket.io/socket.io.js';
    s.onload = connectSocket;
    document.head.appendChild(s);
  } else {
    connectSocket();
  }
}

function connectSocket() {
  if (socket) return;
  socket = io({ auth: { token }, transports: ['websocket', 'polling'] });
  socket.on('connect',      () => console.log('🔌 Socket conectado'));
  socket.on('new_message',  onSocketMessage);
  socket.on('notification', onSocketNotif);
  socket.on('friend_online',({ user_id, status }) => updateFriendStatus(user_id, status));
  socket.on('connect_error', err => console.warn('Socket error:', err.message));
}

function onSocketMessage(msg) {
  if (currentConvId && msg.conversation_id == currentConvId) {
    appendBubble(msg, msg.sender_id == me?.id ? 'me' : 'them');
  } else {
    msgCount++;
    updateMsgBadge();
    toast('💬 Nova mensagem recebida');
  }
}

function onSocketNotif(notif) {
  notifCount++;
  updateNotifBadge();
  const icons = {
    POST_LIKE:'❤️', POST_COMMENT:'💬', FRIEND_REQUEST:'👤',
    FRIEND_ACCEPTED:'✅', NEW_MESSAGE:'💬', ELO_UPDATE:'🏆'
  };
  toast((icons[notif.type] || '🔔') + ' Nova notificação');
}

// ── Navigation ─────────────────────────────────
function loadPage(name) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.s-item').forEach(i => i.classList.remove('active'));
  const page = $('page-' + name);
  const nav  = $('nav-' + name);
  if (page) page.classList.add('active');
  if (nav)  nav.classList.add('active');

  const rp = document.querySelector('.right-panel');
  if (rp) rp.style.display = (name === 'feed' || name === 'explore') ? '' : 'none';

  if (name === 'feed')          loadFeed();
  if (name === 'explore')       loadExplore();
  if (name === 'messages')      loadConversations();
  if (name === 'notifications') loadNotifications();
  if (name === 'profile')       loadMyProfile();
}

// ── Feed ───────────────────────────────────────
let feedLoading = false;

async function loadFeed() {
  if (feedLoading) return;
  feedLoading = true;
  const c = $('feed-posts');
  c.innerHTML = '<div class="loading"><div class="spinner"></div> Carregando...</div>';
  try {
    const posts = await api(`/posts?queue=${currentFilter}&limit=25`);
    if (!posts.length) {
      c.innerHTML = '<div class="empty"><i class="ti ti-mood-empty"></i><p>Nenhum post aqui ainda. Seja o primeiro!</p></div>';
    } else {
      c.innerHTML = posts.map(postHTML).join('');
    }
  } catch (err) {
    console.error(err);
    c.innerHTML = '<div class="empty"><i class="ti ti-alert-circle"></i><p>Erro ao carregar o feed. Tente novamente.</p></div>';
  }
  feedLoading = false;
}

function postHTML(p) {
  const isMe = p.user_id == me?.id;
  return `
  <div class="post-card" id="post-${p.id}">
    <div class="post-head">
      ${avatarHTML(p, 'av-md')}
      <div class="post-meta">
        <div class="post-top">
          <span class="post-name" onclick="viewProfile(${p.user_id})">${escapeHtml(p.username)}</span>
          <span class="post-nick">${escapeHtml(p.lol_game_name)}#${escapeHtml(p.lol_tag_line)}</span>
          <span class="post-time">${timeAgo(p.created_at)}</span>
        </div>
        <div class="post-elos">
          <span class="elo ${eloClass(p.solo_tier)}">Solo ${eloLabel(p.solo_tier, p.solo_rank, p.solo_lp)}</span>
          <span class="elo ${eloClass(p.flex_tier)}">Flex ${eloLabel(p.flex_tier, p.flex_rank, p.flex_lp)}</span>
        </div>
      </div>
    </div>
    <div class="post-body">${escapeHtml(p.content)}</div>
    <div style="margin-bottom:8px">
      <span class="tag ${p.queue_type==='FLEX' ? 'tag-flex on' : 'tag-solo on'}" style="cursor:default;pointer-events:none">
        ${p.queue_type==='FLEX' ? 'Flex' : p.queue_type==='BOTH' ? 'Solo + Flex' : 'Solo/Duo'}
      </span>
    </div>
    <div class="post-actions">
      <button class="act-btn ${p.liked_by_me ? 'liked' : ''}" onclick="toggleLike(${p.id}, this)">
        <i class="ti ti-heart"></i> <span class="lk">${p.total_likes}</span>
      </button>
      <button class="act-btn" onclick="toggleComments(${p.id}, this)">
        <i class="ti ti-message-2"></i> <span>${p.total_comments}</span>
      </button>
      ${!isMe ? `
      <button class="act-btn" onclick="addFriend(${p.user_id}, this)">
        <i class="ti ti-user-plus"></i> <span>Adicionar</span>
      </button>
      <button class="act-btn" style="margin-left:auto" onclick="openDM(${p.user_id},'${escapeHtml(p.username)}')">
        <i class="ti ti-send"></i> DM
      </button>` : `
      <button class="act-btn" onclick="deletePost(${p.id})" style="margin-left:auto">
        <i class="ti ti-trash"></i> Deletar
      </button>`}
    </div>
    <div class="comments-section" id="comments-${p.id}" style="display:none">
      <div id="clist-${p.id}"></div>
      <div class="comment-input-row">
        <input class="comment-inp" id="cinp-${p.id}" placeholder="Comentar..." onkeydown="if(event.key==='Enter')submitComment(${p.id})">
        <button class="btn-send" onclick="submitComment(${p.id})"><i class="ti ti-send"></i></button>
      </div>
    </div>
  </div>`;
}

async function toggleLike(postId, btn) {
  try {
    const res  = await api('/posts/' + postId + '/like', { method: 'POST' });
    const span = btn.querySelector('.lk');
    span.textContent = parseInt(span.textContent) + (res.liked ? 1 : -1);
    btn.classList.toggle('liked', res.liked);
  } catch { toast('Erro ao curtir'); }
}

async function toggleComments(postId) {
  const section = $('comments-' + postId);
  const open    = section.style.display !== 'none';
  section.style.display = open ? 'none' : 'block';
  if (!open && !section.dataset.loaded) {
    section.dataset.loaded = '1';
    const list = $('clist-' + postId);
    list.innerHTML = '<div class="loading" style="padding:8px"><div class="spinner"></div></div>';
    try {
      const comments = await api('/posts/' + postId + '/comments');
      list.innerHTML = comments.length
        ? comments.map(c => `
          <div class="comment-item">
            ${avatarHTML({username:c.username, avatar_url:c.avatar_url, online_status:'offline'}, 'av-sm')}
            <div class="comment-content">
              <div class="comment-author">${escapeHtml(c.username)}</div>
              <div class="comment-text">${escapeHtml(c.content)}</div>
            </div>
          </div>`).join('')
        : '<div style="color:var(--dim);font-size:13px;padding:8px 0">Sem comentários ainda.</div>';
    } catch { list.innerHTML = '<div style="color:var(--dim);font-size:13px">Erro ao carregar.</div>'; }
  }
}

async function submitComment(postId) {
  const inp = $('cinp-' + postId);
  if (!inp || !inp.value.trim()) return;
  try {
    const c   = await api('/posts/' + postId + '/comments', { method:'POST', body:{ content: inp.value } });
    const list = $('clist-' + postId);
    const div  = document.createElement('div');
    div.className = 'comment-item';
    div.innerHTML = `${avatarHTML(me, 'av-sm')}<div class="comment-content"><div class="comment-author">${escapeHtml(me.username)}</div><div class="comment-text">${escapeHtml(c.content)}</div></div>`;
    list.appendChild(div);
    inp.value = '';
  } catch { toast('Erro ao comentar'); }
}

async function deletePost(postId) {
  if (!confirm('Deletar este post?')) return;
  await api('/posts/' + postId, { method: 'DELETE' });
  const el = $('post-' + postId);
  if (el) el.remove();
  toast('Post removido');
}

function setPostQueue(q, el) {
  postQueue = q;
  document.querySelectorAll('.composer-tag').forEach(t => {
    t.classList.remove('on');
    if (t.tagName === 'BUTTON') {
      t.style.background = 'rgba(100,100,100,.12)';
      t.style.color      = 'var(--muted)';
      t.style.borderColor= 'var(--dim)';
    }
  });
  el.classList.add('on');
  el.style.background  = '';
  el.style.color       = '';
  el.style.borderColor = '';
}

async function publishPost() {
  const ta      = $('post-textarea');
  const content = ta.value.trim();
  if (!content || content.length < 5) { toast('Escreva pelo menos 5 caracteres'); return; }
  if (content.length > 500)           { toast('Máximo 500 caracteres'); return; }
  const btn = $('btn-publish');
  btn.disabled = true; btn.textContent = 'POSTANDO...';
  try {
    const post = await api('/posts', { method:'POST', body:{ content, queue_type: postQueue } });
    ta.value = '';
    const c   = $('feed-posts');
    const div = document.createElement('div');
    div.innerHTML = postHTML({ ...post, username: me.username, lol_game_name: me.lol_game_name,
      lol_tag_line: me.lol_tag_line, solo_tier: me.solo_tier, solo_rank: me.solo_rank,
      solo_lp: me.solo_lp, flex_tier: me.flex_tier, flex_rank: me.flex_rank,
      flex_lp: me.flex_lp, online_status:'online', liked_by_me:0, total_likes:0, total_comments:0 });
    c.prepend(div.firstChild);
    toast('📢 Post publicado!');
  } catch (err) { toast(err.error || 'Erro ao publicar'); }
  btn.disabled = false; btn.textContent = 'POSTAR';
}

function setFilter(f) {
  currentFilter = f;
  document.querySelectorAll('.feed-filter').forEach(el => {
    el.classList.remove('on');
    if (el.dataset.filter === f) el.classList.add('on');
  });
  loadFeed();
}

// ── Explore ────────────────────────────────────
async function loadExplore() {
  const grid = $('explore-grid');
  grid.innerHTML = '<div class="loading" style="grid-column:1/-1"><div class="spinner"></div> Buscando jogadores...</div>';
  try {
    const users = await api('/users?limit=20');
    renderPlayerGrid(users);
  } catch { grid.innerHTML = '<div class="empty" style="grid-column:1/-1"><i class="ti ti-alert-circle"></i><p>Erro ao carregar</p></div>'; }
}

async function searchPlayers() {
  const q    = $('explore-search').value.trim();
  const grid = $('explore-grid');
  grid.innerHTML = '<div class="loading" style="grid-column:1/-1"><div class="spinner"></div></div>';
  try {
    const users = await api('/users?q=' + encodeURIComponent(q));
    renderPlayerGrid(users);
  } catch {}
}

function renderPlayerGrid(users) {
  const grid = $('explore-grid');
  if (!users.length) {
    grid.innerHTML = '<div class="empty" style="grid-column:1/-1"><i class="ti ti-users-off"></i><p>Nenhum jogador encontrado</p></div>';
    return;
  }
  grid.innerHTML = users.map(u => `
    <div class="player-card">
      <div class="pc-top">
        ${avatarHTML(u, 'av-md')}
        <div>
          <div class="pc-name">${escapeHtml(u.username)}</div>
          <div class="pc-nick">${escapeHtml(u.lol_game_name)}#${escapeHtml(u.lol_tag_line)}</div>
        </div>
      </div>
      <div style="display:flex;gap:5px;flex-wrap:wrap;margin-bottom:8px">
        <span class="elo ${eloClass(u.solo_tier)}">Solo ${eloLabel(u.solo_tier,u.solo_rank,u.solo_lp)}</span>
        <span class="elo ${eloClass(u.flex_tier)}">Flex ${eloLabel(u.flex_tier,u.flex_rank,u.flex_lp)}</span>
      </div>
      <div style="display:flex;gap:6px;margin-top:6px">
        <div class="btn-invite" style="flex:1" onclick="addFriendById(${u.id},'${escapeHtml(u.username)}',this)">+ Adicionar</div>
        <div class="btn-invite" style="flex:1;background:rgba(59,130,246,.1);border-color:rgba(59,130,246,.3);color:#93C5FD" onclick="openDM(${u.id},'${escapeHtml(u.username)}')">DM</div>
      </div>
    </div>`).join('');
}

async function addFriendById(userId, username, el) {
  try {
    await api('/users/me/friend-request', { method:'POST', body:{ receiver_id: userId } });
    el.className = 'btn-invite sent';
    el.textContent = '✓ Enviado';
    toast('✅ Solicitação enviada para ' + username);
  } catch (err) { toast(err.error || 'Erro'); }
}

// ── Messages ───────────────────────────────────
async function loadConversations() {
  const list = $('conv-list');
  list.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  msgCount = 0; updateMsgBadge();
  try {
    const convs = await api('/messages');
    if (!convs.length) {
      list.innerHTML = '<div class="empty"><i class="ti ti-messages-off"></i><p>Nenhuma conversa ainda</p></div>';
      return;
    }
    list.innerHTML = convs.map(c => `
      <div class="conv-item ${c.unread_count > 0 ? 'unread' : ''}" onclick="openConv(${c.id},${c.partner_id},'${escapeHtml(c.username)}')">
        ${avatarHTML(c, 'av-md')}
        <div class="conv-meta">
          <div class="conv-name">${escapeHtml(c.username)}</div>
          <div class="conv-last">${escapeHtml(c.last_message || 'Iniciar conversa')}</div>
        </div>
        ${c.unread_count > 0 ? `<div class="unread-badge">${c.unread_count}</div>` : ''}
      </div>`).join('');
  } catch { list.innerHTML = '<div class="empty"><p>Erro ao carregar</p></div>'; }
}

async function openDM(partnerId, partnerName) {
  try {
    const { conversation_id } = await api('/messages/open', { method:'POST', body:{ partner_id: partnerId } });
    openChatWindow(conversation_id, partnerId, partnerName);
  } catch { toast('Erro ao abrir conversa'); }
}

function openConv(convId, partnerId, partnerName) {
  openChatWindow(convId, partnerId, partnerName);
}

function openChatWindow(convId, partnerId, partnerName) {
  currentConvId      = convId;
  currentChatPartner = { id: partnerId, name: partnerName };
  $('chat-partner-name').textContent = partnerName;
  const av  = $('chat-av-header');
  const col = avatarColor(partnerName);
  av.style.background = col;
  av.style.color      = '#0A0E1A';
  av.textContent      = partnerName[0].toUpperCase();
  $('chat-window').classList.add('open');
  loadMessages(convId);
  if (socket) socket.emit('join_conversation', convId);
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
  const div  = document.createElement('div');
  div.className   = 'bubble ' + side;
  div.textContent = msg.content;
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
}

async function sendChatMessage() {
  if (!currentConvId) return;
  const inp     = $('chat-input');
  const content = inp.value.trim();
  if (!content) return;
  inp.value = '';
  appendBubble({ content, sender_id: me?.id }, 'me');
  if (socket?.connected) {
    socket.emit('send_message', { conversation_id: currentConvId, content });
  } else {
    try { await api('/messages/' + currentConvId, { method:'POST', body:{ content } }); }
    catch { toast('Erro ao enviar'); }
  }
}

// ── Notifications ──────────────────────────────
async function loadNotifications() {
  const list = $('notif-list');
  list.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  try {
    const notifs = await api('/notifications');
    await api('/notifications/read-all', { method:'PATCH' });
    notifCount = 0; updateNotifBadge();
    if (!notifs.length) {
      list.innerHTML = '<div class="empty"><i class="ti ti-bell-off"></i><p>Sem notificações</p></div>';
      return;
    }
    const icons = {
      POST_LIKE:'ti-heart', POST_COMMENT:'ti-message-2', COMMENT_REPLY:'ti-message-reply',
      FRIEND_REQUEST:'ti-user-plus', FRIEND_ACCEPTED:'ti-user-check',
      NEW_MESSAGE:'ti-send', DUO_INVITE:'ti-sword', ELO_UPDATE:'ti-trophy', SYSTEM:'ti-info-circle'
    };
    const texts = {
      POST_LIKE:'curtiu seu post', POST_COMMENT:'comentou no seu post',
      COMMENT_REPLY:'respondeu seu comentário', FRIEND_REQUEST:'enviou solicitação de amizade',
      FRIEND_ACCEPTED:'aceitou sua solicitação', NEW_MESSAGE:'enviou uma mensagem',
      DUO_INVITE:'te convidou para duo', ELO_UPDATE:'seu elo foi atualizado', SYSTEM:'mensagem do sistema'
    };
    list.innerHTML = notifs.map(n => `
      <div class="notif-item ${n.is_read ? '' : 'unread'}">
        <div class="notif-icon"><i class="ti ${icons[n.type] || 'ti-bell'}"></i></div>
        <div>
          <div class="notif-text">${n.actor_username ? `<strong>${escapeHtml(n.actor_username)}</strong> ` : ''}${texts[n.type] || n.type}</div>
          <div class="notif-time">${timeAgo(n.created_at)}</div>
        </div>
      </div>`).join('');
  } catch { list.innerHTML = '<div class="empty"><p>Erro ao carregar</p></div>'; }
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
    msgCount = convs.reduce((a, c) => a + (parseInt(c.unread_count) || 0), 0);
    updateMsgBadge();
  } catch {}
}

function updateNotifBadge() {
  const b = $('notif-badge');
  if (!b) return;
  b.textContent    = notifCount;
  b.style.display  = notifCount > 0 ? '' : 'none';
}
function updateMsgBadge() {
  const b = $('msg-badge');
  if (!b) return;
  b.textContent   = msgCount;
  b.style.display = msgCount > 0 ? '' : 'none';
}

// ── Profile ────────────────────────────────────
async function loadMyProfile() {
  try {
    const user = await api('/users/me');
    me = { ...me, ...user };
    localStorage.setItem('duoq_me', JSON.stringify(me));
    renderProfile(user, true);
  } catch {}
}

async function viewProfile(userId) {
  loadPage('profile');
  try {
    const user = await api('/users/' + userId);
    renderProfile(user, userId == me?.id);
  } catch {}
}

function renderProfile(user, isMe) {
  const soloLabel = eloLabel(user.solo_tier, user.solo_rank, user.solo_lp);
  const flexLabel = eloLabel(user.flex_tier, user.flex_rank, user.flex_lp);
  $('profile-content').innerHTML = `
    <div class="profile-banner">
      <div class="profile-top">
        ${avatarHTML(user, 'av-xl')}
        <div class="profile-info">
          <div class="profile-name">${escapeHtml(user.username)}</div>
          <div class="profile-nick">${escapeHtml(user.lol_game_name)}#${escapeHtml(user.lol_tag_line)}</div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px">
            <span class="elo ${eloClass(user.solo_tier)}">Solo ${soloLabel}</span>
            <span class="elo ${eloClass(user.flex_tier)}">Flex ${flexLabel}</span>
          </div>
        </div>
        <div style="display:flex;flex-direction:column;gap:8px">
          ${isMe
            ? `<button class="btn-outline" onclick="syncElo()"><i class="ti ti-refresh"></i> Sync Elo</button>
               <button class="btn-outline" onclick="logout()" style="border-color:rgba(239,68,68,.4);color:#FCA5A5">Sair</button>`
            : `<button class="btn-outline" onclick="addFriendById(${user.id},'${escapeHtml(user.username)}',this)">+ Adicionar</button>
               <button class="btn-outline" onclick="openDM(${user.id},'${escapeHtml(user.username)}')" style="border-color:rgba(59,130,246,.4);color:#93C5FD">DM</button>`}
        </div>
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
          <div class="rank-row"><span class="rank-label">Solo/Duo</span><span class="rank-val">${soloLabel}</span></div>
          <div class="rank-row"><span class="rank-lp">${user.solo_wins||0}V ${user.solo_losses||0}D</span></div>
          <div class="rank-bar"><div class="rank-fill" style="width:${Math.min(user.solo_lp||0,100)}%;background:var(--gold)"></div></div>
        </div>
        <div class="rank-card">
          <div class="rank-row"><span class="rank-label">Flex</span><span class="rank-val" style="color:#93C5FD">${flexLabel}</span></div>
          <div class="rank-row"><span class="rank-lp">${user.flex_wins||0}V ${user.flex_losses||0}D</span></div>
          <div class="rank-bar"><div class="rank-fill" style="width:${Math.min(user.flex_lp||0,100)}%;background:var(--blue)"></div></div>
        </div>
      </div>
      ${user.roles?.length ? `
        <div class="rp-title">Lanes</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">
          ${user.roles.map(r => `<span class="tag tag-solo on" style="cursor:default">${r.role}</span>`).join('')}
        </div>` : ''}
      ${user.bio ? `
        <div style="margin-top:16px">
          <div class="rp-title">Bio</div>
          <p style="font-size:14px;color:var(--muted);line-height:1.6;margin-top:6px">${escapeHtml(user.bio)}</p>
        </div>` : ''}
    </div>`;
  renderSidebarRanks();
}

// ── Friends sidebar ────────────────────────────
async function loadFriends() {
  try {
    const friends = await api('/users/me/friends');
    const list    = $('friends-online');
    if (!list) return;
    list.innerHTML = '';
    if (!friends.length) {
      list.innerHTML = '<div style="font-size:11px;color:var(--dim);padding:4px">Sem amigos ainda</div>';
      return;
    }
    friends.forEach(f => {
      const div = document.createElement('div');
      div.className   = 'friend-row';
      div.id          = 'friend-' + f.id;
      div.onclick     = () => openDM(f.id, f.username);
      div.innerHTML   = `${avatarHTML(f, 'av-sm')}<span class="friend-name">${escapeHtml(f.username)}</span>`;
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
    await api('/users/me/friend-request', { method:'POST', body:{ receiver_id: userId } });
    btn.innerHTML = '<i class="ti ti-check"></i> <span>Enviado</span>';
    btn.style.color = 'var(--green)';
    toast('✅ Solicitação enviada!');
  } catch (err) { toast(err.error || 'Erro ao adicionar'); }
}

// ── Sidebar ranks ──────────────────────────────
function renderSidebarRanks() {
  const el = $('rp-ranks');
  if (!el || !me) return;
  const soloLabel = eloLabel(me.solo_tier, me.solo_rank, me.solo_lp);
  const flexLabel = eloLabel(me.flex_tier, me.flex_rank, me.flex_lp);
  el.innerHTML = `
    <div class="rank-card">
      <div class="rank-row"><span class="rank-label">Solo/Duo</span><span class="rank-val">${soloLabel}</span></div>
      <div class="rank-bar"><div class="rank-fill" style="width:${Math.min(me.solo_lp||0,100)}%;background:var(--gold)"></div></div>
    </div>
    <div class="rank-card" style="margin-top:6px">
      <div class="rank-row"><span class="rank-label">Flex</span><span class="rank-val" style="color:#93C5FD">${flexLabel}</span></div>
      <div class="rank-bar"><div class="rank-fill" style="width:${Math.min(me.flex_lp||0,100)}%;background:var(--blue)"></div></div>
    </div>`;
}

// ── Sync Elo ───────────────────────────────────
async function syncElo() {
  toast('⏳ Sincronizando com a Riot API...');
  try {
    const res = await api('/users/me/sync-elo', { method:'POST' });
    if (res.warning) { toast('⚠️ ' + res.warning, 5000); return; }
    toast('✅ Elo atualizado!');
    loadMyProfile();
  } catch (err) { toast('❌ ' + (err.error || 'Erro ao sincronizar')); }
}

// ── Online count ───────────────────────────────
async function pollOnlineCount() {
  try {
    const { count } = await api('/users/stats/online');
    const el = $('online-count');
    if (el) el.textContent = count;
  } catch {}
}

// ── Init ───────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  if (token && me) {
    bootApp();
  }
});
