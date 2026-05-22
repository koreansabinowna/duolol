const router = require('express').Router();
const db     = require('../db/connection');
const auth   = require('../middleware/auth');

router.get('/', auth, async (req, res) => {
  const [rows] = await db.execute(
    `SELECT c.id,c.last_msg_at,
            u.id AS partner_id,u.username,u.lol_game_name,u.avatar_url,u.online_status,
            (SELECT m.content FROM messages m WHERE m.conversation_id=c.id AND m.is_deleted=0 ORDER BY m.created_at DESC LIMIT 1) AS last_message,
            (SELECT COUNT(*) FROM messages m WHERE m.conversation_id=c.id AND m.is_read=0 AND m.sender_id!=?) AS unread_count
     FROM conversations c
     JOIN users u ON u.id=IF(c.user_a_id=?,c.user_b_id,c.user_a_id)
     WHERE c.user_a_id=? OR c.user_b_id=?
     ORDER BY COALESCE(c.last_msg_at,c.created_at) DESC`,
    [req.user.id, req.user.id, req.user.id, req.user.id]
  );
  res.json(rows);
});

router.post('/open', auth, async (req, res) => {
  const { partner_id } = req.body;
  const a = Math.min(req.user.id, parseInt(partner_id));
  const b = Math.max(req.user.id, parseInt(partner_id));
  const [ex] = await db.execute('SELECT id FROM conversations WHERE user_a_id=? AND user_b_id=?', [a, b]);
  if (ex.length) return res.json({ conversation_id: ex[0].id });
  const [r] = await db.execute('INSERT INTO conversations (user_a_id,user_b_id) VALUES (?,?)', [a, b]);
  res.json({ conversation_id: r.insertId });
});

router.get('/:convId', auth, async (req, res) => {
  const [conv] = await db.execute(
    'SELECT id FROM conversations WHERE id=? AND (user_a_id=? OR user_b_id=?)',
    [req.params.convId, req.user.id, req.user.id]
  );
  if (!conv.length) return res.status(403).json({ error: 'Acesso negado' });
  const [msgs] = await db.execute(
    `SELECT m.id,m.content,m.is_read,m.created_at,m.sender_id,u.username,u.avatar_url
     FROM messages m JOIN users u ON u.id=m.sender_id
     WHERE m.conversation_id=? AND m.is_deleted=0
     ORDER BY m.created_at DESC LIMIT 50`,
    [req.params.convId]
  );
  await db.execute('UPDATE messages SET is_read=1 WHERE conversation_id=? AND sender_id!=? AND is_read=0',
    [req.params.convId, req.user.id]);
  res.json(msgs.reverse());
});

router.post('/:convId', auth, async (req, res) => {
  const { content } = req.body;
  if (!content?.trim()) return res.status(400).json({ error: 'Mensagem vazia' });
  const [conv] = await db.execute(
    'SELECT id,user_a_id,user_b_id FROM conversations WHERE id=? AND (user_a_id=? OR user_b_id=?)',
    [req.params.convId, req.user.id, req.user.id]
  );
  if (!conv.length) return res.status(403).json({ error: 'Acesso negado' });
  const [r] = await db.execute('INSERT INTO messages (conversation_id,sender_id,content) VALUES (?,?,?)',
    [req.params.convId, req.user.id, content.trim()]);
  await db.execute('UPDATE conversations SET last_msg_at=NOW() WHERE id=?', [req.params.convId]);
  const receiverId = conv[0].user_a_id === req.user.id ? conv[0].user_b_id : conv[0].user_a_id;
  await db.execute('INSERT INTO notifications (user_id,actor_id,type,reference_id) VALUES (?,?,?,?)',
    [receiverId, req.user.id, 'NEW_MESSAGE', req.params.convId]);
  res.status(201).json({ id: r.insertId, content: content.trim(), sender_id: req.user.id, created_at: new Date() });
});

module.exports = router;
