const router = require('express').Router();
const db = require('../db/connection');
const auth = require('../middleware/auth');

// Feed paginado
router.get('/', auth, async (req, res) => {
  const { queue, page = 1, limit = 20 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);
  try {
    let where = 'p.is_deleted = 0';
    const params = [];
    if (queue && queue !== 'all') {
      where += ' AND (p.queue_type = ? OR p.queue_type = "BOTH")';
      params.push(queue.toUpperCase());
    }
    const [posts] = await db.execute(
      `SELECT p.id, p.content, p.queue_type, p.created_at,
              p.solo_tier_snapshot, p.flex_tier_snapshot,
              u.id AS user_id, u.username, u.lol_game_name, u.lol_tag_line,
              u.avatar_url, u.solo_tier, u.solo_rank, u.solo_lp,
              u.flex_tier, u.flex_rank, u.flex_lp, u.online_status,
              (SELECT COUNT(*) FROM post_likes l WHERE l.post_id = p.id) AS total_likes,
              (SELECT COUNT(*) FROM post_comments c WHERE c.post_id = p.id AND c.is_deleted = 0) AS total_comments,
              (SELECT COUNT(*) FROM post_likes lm WHERE lm.post_id = p.id AND lm.user_id = ?) AS liked_by_me
       FROM posts p JOIN users u ON u.id = p.user_id
       WHERE ${where}
       ORDER BY p.created_at DESC LIMIT ${parseInt(limit)} OFFSET ${offset}`,
      [req.user.id, ...params]
    );
    res.json(posts);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao buscar posts' });
  }
});

// Criar post
router.post('/', auth, async (req, res) => {
  const { content, queue_type } = req.body;
  if (!content || content.trim().length < 5) return res.status(400).json({ error: 'Conteúdo muito curto' });
  if (content.length > 500) return res.status(400).json({ error: 'Máximo 500 caracteres' });
  try {
    const [user] = await db.execute('SELECT solo_tier, solo_rank, flex_tier, flex_rank FROM users WHERE id = ?', [req.user.id]);
    const u = user[0];
    const soloSnap = u.solo_tier ? `${u.solo_tier} ${u.solo_rank || ''}`.trim() : null;
    const flexSnap = u.flex_tier ? `${u.flex_tier} ${u.flex_rank || ''}`.trim() : null;
    const [result] = await db.execute(
      'INSERT INTO posts (user_id, content, queue_type, solo_tier_snapshot, flex_tier_snapshot) VALUES (?,?,?,?,?)',
      [req.user.id, content.trim(), (queue_type || 'SOLO').toUpperCase(), soloSnap, flexSnap]
    );
    const [post] = await db.execute(
      `SELECT p.*, u.username, u.lol_game_name, u.lol_tag_line, u.avatar_url, u.online_status,
              u.solo_tier, u.solo_rank, u.solo_lp, u.flex_tier, u.flex_rank, u.flex_lp
       FROM posts p JOIN users u ON u.id = p.user_id WHERE p.id = ?`,
      [result.insertId]
    );
    res.status(201).json({ ...post[0], total_likes: 0, total_comments: 0, liked_by_me: 0 });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao criar post' });
  }
});

// Deletar post
router.delete('/:id', auth, async (req, res) => {
  await db.execute('UPDATE posts SET is_deleted = 1 WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
  res.json({ ok: true });
});

// Curtir / descurtir
router.post('/:id/like', auth, async (req, res) => {
  const postId = req.params.id;
  try {
    const [existing] = await db.execute('SELECT id FROM post_likes WHERE post_id = ? AND user_id = ?', [postId, req.user.id]);
    if (existing.length) {
      await db.execute('DELETE FROM post_likes WHERE post_id = ? AND user_id = ?', [postId, req.user.id]);
      return res.json({ liked: false });
    }
    await db.execute('INSERT INTO post_likes (post_id, user_id) VALUES (?,?)', [postId, req.user.id]);
    // Notificação
    const [post] = await db.execute('SELECT user_id FROM posts WHERE id = ?', [postId]);
    if (post.length && post[0].user_id !== req.user.id) {
      await db.execute(
        'INSERT INTO notifications (user_id, actor_id, type, reference_id) VALUES (?,?,?,?)',
        [post[0].user_id, req.user.id, 'POST_LIKE', postId]
      );
    }
    res.json({ liked: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro' });
  }
});

// Buscar comentários
router.get('/:id/comments', auth, async (req, res) => {
  const [rows] = await db.execute(
    `SELECT c.*, u.username, u.lol_game_name, u.lol_tag_line, u.avatar_url, u.solo_tier, u.solo_rank, u.flex_tier, u.flex_rank
     FROM post_comments c JOIN users u ON u.id = c.user_id
     WHERE c.post_id = ? AND c.is_deleted = 0 ORDER BY c.created_at ASC`,
    [req.params.id]
  );
  res.json(rows);
});

// Comentar
router.post('/:id/comments', auth, async (req, res) => {
  const { content, parent_id } = req.body;
  if (!content || content.trim().length < 1) return res.status(400).json({ error: 'Comentário vazio' });
  try {
    const [result] = await db.execute(
      'INSERT INTO post_comments (post_id, user_id, content, parent_id) VALUES (?,?,?,?)',
      [req.params.id, req.user.id, content.trim(), parent_id || null]
    );
    const [post] = await db.execute('SELECT user_id FROM posts WHERE id = ?', [req.params.id]);
    if (post.length && post[0].user_id !== req.user.id) {
      await db.execute(
        'INSERT INTO notifications (user_id, actor_id, type, reference_id) VALUES (?,?,?,?)',
        [post[0].user_id, req.user.id, 'POST_COMMENT', req.params.id]
      );
    }
    const [comment] = await db.execute(
      `SELECT c.*, u.username, u.lol_game_name, u.avatar_url FROM post_comments c
       JOIN users u ON u.id = c.user_id WHERE c.id = ?`,
      [result.insertId]
    );
    res.status(201).json(comment[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao comentar' });
  }
});

module.exports = router;
