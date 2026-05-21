const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db/connection');

router.post('/register', async (req, res) => {
  const { username, email, password, lol_game_name, lol_tag_line } = req.body;
  if (!username || !email || !password || !lol_game_name || !lol_tag_line) {
    return res.status(400).json({ error: 'Todos os campos são obrigatórios' });
  }
  try {
    const hash = await bcrypt.hash(password, 12);
    const [result] = await db.execute(
      `INSERT INTO users (username, email, password_hash, lol_game_name, lol_tag_line)
       VALUES (?, ?, ?, ?, ?)`,
      [username.trim(), email.trim().toLowerCase(), hash, lol_game_name.trim(), lol_tag_line.trim()]
    );
    const token = jwt.sign(
      { id: result.insertId, username },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );
    res.status(201).json({ token, user: { id: result.insertId, username, lol_game_name, lol_tag_line } });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Usuário, email ou nick já cadastrado' });
    }
    console.error(err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email e senha obrigatórios' });
  try {
    const [rows] = await db.execute(
      'SELECT * FROM users WHERE email = ? AND is_banned = 0 LIMIT 1',
      [email.trim().toLowerCase()]
    );
    if (!rows.length) return res.status(401).json({ error: 'Credenciais inválidas' });
    const user = rows[0];
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Credenciais inválidas' });
    await db.execute('UPDATE users SET online_status = ?, last_seen_at = NOW() WHERE id = ?', ['online', user.id]);
    const token = jwt.sign({ id: user.id, username: user.username }, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.json({
      token,
      user: {
        id: user.id, username: user.username, lol_game_name: user.lol_game_name,
        lol_tag_line: user.lol_tag_line, solo_tier: user.solo_tier, solo_rank: user.solo_rank,
        solo_lp: user.solo_lp, flex_tier: user.flex_tier, flex_rank: user.flex_rank,
        flex_lp: user.flex_lp, avatar_url: user.avatar_url, bio: user.bio
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.post('/logout', require('../middleware/auth'), async (req, res) => {
  await db.execute('UPDATE users SET online_status = ?, last_seen_at = NOW() WHERE id = ?', ['offline', req.user.id]);
  res.json({ ok: true });
});

module.exports = router;
