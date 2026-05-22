require('dotenv').config();
const express = require('express');
const http    = require('http');
const { Server } = require('socket.io');
const cors   = require('cors');
const path   = require('path');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, { cors: { origin: '*' } });

app.use(cors());
app.use(express.json());

// ── API routes ────────────────────────────────
app.use('/api/auth',          require('./routes/auth'));
app.use('/api/posts',         require('./routes/posts'));
app.use('/api/users',         require('./routes/users'));
app.use('/api/messages',      require('./routes/messages'));
app.use('/api/notifications', require('./routes/notifications'));

app.get('/health', (_, res) => res.json({ status: 'ok', ts: new Date() }));

// ── Serve frontend estático ───────────────────
app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (_, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ── Socket.io ────────────────────────────────
require('./socket')(io);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 DUOQ.GG rodando na porta ${PORT}`));
