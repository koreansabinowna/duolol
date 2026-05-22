const router  = require('express').Router();
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const db      = require('../db/connection');

router.post('/register', async (req, res) => {
  const { username, email, password, lol_game_name, lol_tag_line } = req.body;
  if (!username || !email || !password || !lol_game_name || !lol_tag_line)
    return res.status(400).json({ error: 'Todos os campos são obrigatórios' });
  try {
    const hash = await bcrypt.hash(password, 12);
    const [r] = await db.execute(
      'INSERT INTO users (username,email,password_hash,lol_game_name,lol_tag_line) VALUES (?,?,?,?,?)',
      [username.trim(), email.trim().toLowerCase(), hash, lol_game_name.trim(), lol_tag_line.trim()]
    );
    const token = jwt.sign({ id: r.insertId, username }, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.status(201).json({ token, user: { id: r.insertId, username, lol_game_name, lol_tag_line } });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Usuário ou email já cadastrado' });
    console.error(err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email e senha obrigatórios' });
  try {
    const [rows] = await db.execute(
      'SELECT * FROM users WHERE email=? AND is_banned=0 LIMIT 1',
      [email.trim().toLowerCase()]
    );
    if (!rows.length) return res.status(401).json({ error: 'Credenciais inválidas' });
    const u = rows[0];
    if (!await bcrypt.compare(password, u.password_hash))
      return res.status(401).json({ error: 'Credenciais inválidas' });
    await db.execute('UPDATE users SET online_status=?,last_seen_at=NOW() WHERE id=?', ['online', u.id]);
    const token = jwt.sign({ id: u.id, username: u.username }, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: {
      id: u.id, username: u.username, lol_game_name: u.lol_game_name,
      lol_tag_line: u.lol_tag_line, solo_tier: u.solo_tier, solo_rank: u.solo_rank,
      solo_lp: u.solo_lp, flex_tier: u.flex_tier, flex_rank: u.flex_rank,
      flex_lp: u.flex_lp, avatar_url: u.avatar_url, bio: u.bio
    }});
  } catch (err) { console.error(err); res.status(500).json({ error: 'Erro interno' }); }
});

router.post('/logout', require('../middleware/auth'), async (req, res) => {
  await db.execute('UPDATE users SET online_status=?,last_seen_at=NOW() WHERE id=?', ['offline', req.user.id]);
  res.json({ ok: true });
});

module.exports = router;
