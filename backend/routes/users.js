const router = require('express').Router();
const axios = require('axios');
const db = require('../db/connection');
const auth = require('../middleware/auth');

const RIOT_KEY = process.env.RIOT_API_KEY;
const REGION = process.env.RIOT_REGION || 'br1';
const AMERICAS = 'americas';

// Meu perfil
router.get('/me', auth, async (req, res) => {
  const [rows] = await db.execute(
    `SELECT id, username, email, lol_game_name, lol_tag_line, avatar_url, bio,
            solo_tier, solo_rank, solo_lp, solo_wins, solo_losses,
            flex_tier, flex_rank, flex_lp, flex_wins, flex_losses,
            online_status, elo_last_updated_at, created_at
     FROM users WHERE id = ?`, [req.user.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Usuário não encontrado' });
  const [roles] = await db.execute('SELECT role, priority FROM user_roles WHERE user_id = ? ORDER BY priority', [req.user.id]);
  const [stats] = await db.execute(
    `SELECT
      (SELECT COUNT(*) FROM posts WHERE user_id = ? AND is_deleted = 0) AS total_posts,
      (SELECT COUNT(*) FROM friendships WHERE user_a_id = ? OR user_b_id = ?) AS total_friends,
      (SELECT COUNT(*) FROM post_likes pl JOIN posts p ON p.id = pl.post_id WHERE p.user_id = ?) AS total_likes_received`,
    [req.user.id, req.user.id, req.user.id, req.user.id]
  );
  res.json({ ...rows[0], roles, ...stats[0] });
});

// Perfil de outro usuário
router.get('/:id', auth, async (req, res) => {
  const [rows] = await db.execute(
    `SELECT id, username, lol_game_name, lol_tag_line, avatar_url, bio,
            solo_tier, solo_rank, solo_lp, solo_wins, solo_losses,
            flex_tier, flex_rank, flex_lp, flex_wins, flex_losses, online_status
     FROM users WHERE id = ?`, [req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Usuário não encontrado' });
  const [roles] = await db.execute('SELECT role, priority FROM user_roles WHERE user_id = ? ORDER BY priority', [req.params.id]);
  const [fr] = await db.execute(
    `SELECT status FROM friend_requests WHERE (sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?) LIMIT 1`,
    [req.user.id, req.params.id, req.params.id, req.user.id]
  );
  const [friendship] = await db.execute(
    `SELECT id FROM friendships WHERE (user_a_id = ? AND user_b_id = ?) OR (user_a_id = ? AND user_b_id = ?) LIMIT 1`,
    [req.user.id, req.params.id, req.params.id, req.user.id]
  );
  res.json({ ...rows[0], roles, friendship_status: friendship.length ? 'friends' : (fr[0]?.status || null) });
});

// Buscar jogadores
router.get('/', auth, async (req, res) => {
  const { q, tier, queue = 'SOLO', page = 1 } = req.query;
  const offset = (parseInt(page) - 1) * 20;
  try {
    let where = 'u.id != ? AND u.is_banned = 0';
    const params = [req.user.id];
    if (q) { where += ' AND (u.username LIKE ? OR u.lol_game_name LIKE ?)'; params.push(`%${q}%`, `%${q}%`); }
    if (tier) {
      const col = queue === 'FLEX' ? 'flex_tier' : 'solo_tier';
      where += ` AND u.${col} = ?`;
      params.push(tier.toUpperCase());
    }
    const [users] = await db.execute(
      `SELECT u.id, u.username, u.lol_game_name, u.lol_tag_line, u.avatar_url,
              u.solo_tier, u.solo_rank, u.solo_lp, u.flex_tier, u.flex_rank, u.flex_lp, u.online_status
       FROM users u WHERE ${where}
       ORDER BY u.online_status = 'online' DESC, u.updated_at DESC
       LIMIT 20 OFFSET ${offset}`,
      params
    );
    res.json(users);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro na busca' });
  }
});

// Atualizar perfil
router.patch('/me', auth, async (req, res) => {
  const { bio, roles } = req.body;
  if (bio !== undefined) await db.execute('UPDATE users SET bio = ? WHERE id = ?', [bio, req.user.id]);
  if (Array.isArray(roles)) {
    await db.execute('DELETE FROM user_roles WHERE user_id = ?', [req.user.id]);
    for (let i = 0; i < Math.min(roles.length, 5); i++) {
      await db.execute('INSERT IGNORE INTO user_roles (user_id, role, priority) VALUES (?,?,?)', [req.user.id, roles[i], i + 1]);
    }
  }
  res.json({ ok: true });
});

// Sincronizar elo com a Riot API
router.post('/me/sync-elo', auth, async (req, res) => {
  if (!RIOT_KEY || RIOT_KEY.startsWith('RGAPI-xxxxxxxx')) {
    return res.status(200).json({ warning: 'Chave da Riot API não configurada. Configure RIOT_API_KEY no .env' });
  }
  try {
    const [user] = await db.execute('SELECT lol_game_name, lol_tag_line, lol_puuid, lol_summoner_id FROM users WHERE id = ?', [req.user.id]);
    const u = user[0];
    let puuid = u.lol_puuid;
    let summonerId = u.lol_summoner_id;

    if (!puuid) {
      const { data: acc } = await axios.get(
        `https://${AMERICAS}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(u.lol_game_name)}/${encodeURIComponent(u.lol_tag_line)}`,
        { headers: { 'X-Riot-Token': RIOT_KEY } }
      );
      puuid = acc.puuid;
      await db.execute('UPDATE users SET lol_puuid = ? WHERE id = ?', [puuid, req.user.id]);
    }

    if (!summonerId) {
      const { data: summoner } = await axios.get(
        `https://${REGION}.api.riotgames.com/lol/summoner/v4/summoners/by-puuid/${puuid}`,
        { headers: { 'X-Riot-Token': RIOT_KEY } }
      );
      summonerId = summoner.id;
      await db.execute('UPDATE users SET lol_summoner_id = ?, lol_account_id = ? WHERE id = ?', [summoner.id, summoner.accountId, req.user.id]);
    }

    const { data: leagues } = await axios.get(
      `https://${REGION}.api.riotgames.com/lol/league/v4/entries/by-summoner/${summonerId}`,
      { headers: { 'X-Riot-Token': RIOT_KEY } }
    );

    let soloData = leagues.find(l => l.queueType === 'RANKED_SOLO_5x5');
    let flexData  = leagues.find(l => l.queueType === 'RANKED_FLEX_SR');

    const updates = { elo_last_updated_at: new Date() };
    if (soloData) {
      Object.assign(updates, {
        solo_tier: soloData.tier, solo_rank: soloData.rank,
        solo_lp: soloData.leaguePoints, solo_wins: soloData.wins, solo_losses: soloData.losses
      });
      await db.execute(
        'INSERT INTO elo_history (user_id, queue_type, tier, `rank`, lp, wins, losses) VALUES (?,?,?,?,?,?,?)',
        [req.user.id, 'SOLO', soloData.tier, soloData.rank, soloData.leaguePoints, soloData.wins, soloData.losses]
      );
    }
    if (flexData) {
      Object.assign(updates, {
        flex_tier: flexData.tier, flex_rank: flexData.rank,
        flex_lp: flexData.leaguePoints, flex_wins: flexData.wins, flex_losses: flexData.losses
      });
      await db.execute(
        'INSERT INTO elo_history (user_id, queue_type, tier, `rank`, lp, wins, losses) VALUES (?,?,?,?,?,?,?)',
        [req.user.id, 'FLEX', flexData.tier, flexData.rank, flexData.leaguePoints, flexData.wins, flexData.losses]
      );
    }

    const setCols = Object.keys(updates).map(k => `${k} = ?`).join(', ');
    await db.execute(`UPDATE users SET ${setCols} WHERE id = ?`, [...Object.values(updates), req.user.id]);

    await db.execute('INSERT INTO notifications (user_id, type, body) VALUES (?,?,?)',
      [req.user.id, 'ELO_UPDATE', 'Seu elo foi atualizado com sucesso!']);

    res.json({ solo: soloData, flex: flexData });
  } catch (err) {
    console.error('Riot API error:', err.response?.data || err.message);
    res.status(500).json({ error: 'Erro ao sincronizar com a Riot API', detail: err.response?.data?.status?.message });
  }
});

// Amigos
router.get('/me/friends', auth, async (req, res) => {
  const [rows] = await db.execute(
    `SELECT u.id, u.username, u.lol_game_name, u.lol_tag_line, u.avatar_url,
            u.solo_tier, u.solo_rank, u.flex_tier, u.flex_rank, u.online_status, u.last_seen_at
     FROM friendships f
     JOIN users u ON u.id = IF(f.user_a_id = ?, f.user_b_id, f.user_a_id)
     WHERE (f.user_a_id = ? OR f.user_b_id = ?)
     ORDER BY u.online_status = 'online' DESC, u.username ASC`,
    [req.user.id, req.user.id, req.user.id]
  );
  res.json(rows);
});

router.post('/me/friend-request', auth, async (req, res) => {
  const { receiver_id } = req.body;
  if (receiver_id == req.user.id) return res.status(400).json({ error: 'Não pode adicionar a si mesmo' });
  try {
    await db.execute(
      'INSERT IGNORE INTO friend_requests (sender_id, receiver_id) VALUES (?,?)',
      [req.user.id, receiver_id]
    );
    await db.execute(
      'INSERT INTO notifications (user_id, actor_id, type) VALUES (?,?,?)',
      [receiver_id, req.user.id, 'FRIEND_REQUEST']
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao enviar solicitação' });
  }
});

router.patch('/me/friend-request/:id', auth, async (req, res) => {
  const { action } = req.body; // 'accept' | 'reject'
  const [fr] = await db.execute('SELECT * FROM friend_requests WHERE id = ? AND receiver_id = ?', [req.params.id, req.user.id]);
  if (!fr.length) return res.status(404).json({ error: 'Solicitação não encontrada' });
  const request = fr[0];
  if (action === 'accept') {
    await db.execute('UPDATE friend_requests SET status = ? WHERE id = ?', ['ACCEPTED', req.params.id]);
    const a = Math.min(request.sender_id, request.receiver_id);
    const b = Math.max(request.sender_id, request.receiver_id);
    await db.execute('INSERT IGNORE INTO friendships (user_a_id, user_b_id) VALUES (?,?)', [a, b]);
    await db.execute('INSERT INTO notifications (user_id, actor_id, type) VALUES (?,?,?)',
      [request.sender_id, req.user.id, 'FRIEND_ACCEPTED']);
  } else {
    await db.execute('UPDATE friend_requests SET status = ? WHERE id = ?', ['REJECTED', req.params.id]);
  }
  res.json({ ok: true });
});

// Contador de online procurando duo
router.get('/stats/online', auth, async (req, res) => {
  const [rows] = await db.execute(
    `SELECT COUNT(DISTINCT p.user_id) AS count FROM posts p
     JOIN users u ON u.id = p.user_id
     WHERE p.is_deleted = 0 AND p.created_at >= NOW() - INTERVAL 3 HOUR AND u.online_status != 'offline'`
  );
  res.json({ count: rows[0].count });
});

module.exports = router;
