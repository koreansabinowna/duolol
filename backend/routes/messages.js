const router = require('express').Router();
const db = require('../db/connection');
const auth = require('../middleware/auth');

// Listar conversas
router.get('/', auth, async (req, res) => {
  const [rows] = await db.execute(
    `SELECT c.id, c.last_msg_at,
            u.id AS partner_id, u.username, u.lol_game_name, u.lol_tag_line,
            u.avatar_url, u.online_status,
            (SELECT m.content FROM messages m WHERE m.conversation_id = c.id AND m.is_deleted = 0 ORDER BY m.created_at DESC LIMIT 1) AS last_message,
            (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id AND m.is_read = 0 AND m.sender_id != ?) AS unread_count
     FROM conversations c
     JOIN users u ON u.id = IF(c.user_a_id = ?, c.user_b_id, c.user_a_id)
     WHERE c.user_a_id = ? OR c.user_b_id = ?
     ORDER BY c.last_msg_at DESC, c.created_at DESC`,
    [req.user.id, req.user.id, req.user.id, req.user.id]
  );
  res.json(rows);
});

// Abrir/criar conversa
router.post('/open', auth, async (req, res) => {
  const { partner_id } = req.body;
  const a = Math.min(req.user.id, parseInt(partner_id));
  const b = Math.max(req.user.id, parseInt(partner_id));
  const [existing] = await db.execute('SELECT id FROM conversations WHERE user_a_id = ? AND user_b_id = ?', [a, b]);
  if (existing.length) return res.json({ conversation_id: existing[0].id });
  const [result] = await db.execute('INSERT INTO conversations (user_a_id, user_b_id) VALUES (?,?)', [a, b]);
  res.json({ conversation_id: result.insertId });
});

// Mensagens de uma conversa
router.get('/:conversationId', auth, async (req, res) => {
  const { page = 1 } = req.query;
  const offset = (parseInt(page) - 1) * 50;
  const [conv] = await db.execute(
    'SELECT id FROM conversations WHERE id = ? AND (user_a_id = ? OR user_b_id = ?)',
    [req.params.conversationId, req.user.id, req.user.id]
  );
  if (!conv.length) return res.status(403).json({ error: 'Acesso negado' });
  const [msgs] = await db.execute(
    `SELECT m.id, m.content, m.is_read, m.created_at, m.sender_id,
            u.username, u.avatar_url
     FROM messages m JOIN users u ON u.id = m.sender_id
     WHERE m.conversation_id = ? AND m.is_deleted = 0
     ORDER BY m.created_at DESC LIMIT 50 OFFSET ${offset}`,
    [req.params.conversationId]
  );
  // Marcar como lidas
  await db.execute(
    'UPDATE messages SET is_read = 1 WHERE conversation_id = ? AND sender_id != ? AND is_read = 0',
    [req.params.conversationId, req.user.id]
  );
  res.json(msgs.reverse());
});

// Enviar mensagem
router.post('/:conversationId', auth, async (req, res) => {
  const { content } = req.body;
  if (!content || !content.trim()) return res.status(400).json({ error: 'Mensagem vazia' });
  const [conv] = await db.execute(
    'SELECT id, user_a_id, user_b_id FROM conversations WHERE id = ? AND (user_a_id = ? OR user_b_id = ?)',
    [req.params.conversationId, req.user.id, req.user.id]
  );
  if (!conv.length) return res.status(403).json({ error: 'Acesso negado' });
  const [result] = await db.execute(
    'INSERT INTO messages (conversation_id, sender_id, content) VALUES (?,?,?)',
    [req.params.conversationId, req.user.id, content.trim()]
  );
  await db.execute('UPDATE conversations SET last_msg_at = NOW() WHERE id = ?', [req.params.conversationId]);
  const receiverId = conv[0].user_a_id === req.user.id ? conv[0].user_b_id : conv[0].user_a_id;
  await db.execute(
    'INSERT INTO notifications (user_id, actor_id, type, reference_id) VALUES (?,?,?,?)',
    [receiverId, req.user.id, 'NEW_MESSAGE', req.params.conversationId]
  );
  res.status(201).json({ id: result.insertId, content: content.trim(), sender_id: req.user.id, created_at: new Date() });
});

module.exports = router;
