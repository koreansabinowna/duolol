const router = require('express').Router();
const db = require('../db/connection');
const auth = require('../middleware/auth');

router.get('/', auth, async (req, res) => {
  const [rows] = await db.execute(
    `SELECT n.id, n.type, n.reference_id, n.body, n.is_read, n.created_at,
            u.id AS actor_id, u.username AS actor_username, u.avatar_url AS actor_avatar, u.lol_game_name AS actor_lol_name
     FROM notifications n
     LEFT JOIN users u ON u.id = n.actor_id
     WHERE n.user_id = ?
     ORDER BY n.created_at DESC LIMIT 50`,
    [req.user.id]
  );
  res.json(rows);
});

router.get('/count', auth, async (req, res) => {
  const [rows] = await db.execute('SELECT COUNT(*) AS count FROM notifications WHERE user_id = ? AND is_read = 0', [req.user.id]);
  res.json({ count: rows[0].count });
});

router.patch('/read-all', auth, async (req, res) => {
  await db.execute('UPDATE notifications SET is_read = 1 WHERE user_id = ?', [req.user.id]);
  res.json({ ok: true });
});

router.patch('/:id/read', auth, async (req, res) => {
  await db.execute('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
  res.json({ ok: true });
});

module.exports = router;
