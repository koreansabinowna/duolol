if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

const express = require('express');
const http    = require('http');
const { Server } = require('socket.io');
const cors    = require('cors');
const path    = require('path');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, { cors: { origin: '*' } });

app.use(cors());
app.use(express.json());

// Health check ANTES de tudo — EasyPanel usa isso para saber se o app está vivo
app.get('/health', (_, res) => res.json({ status: 'ok', ts: new Date() }));

// API
app.use('/api/auth',          require('./routes/auth'));
app.use('/api/posts',         require('./routes/posts'));
app.use('/api/users',         require('./routes/users'));
app.use('/api/messages',      require('./routes/messages'));
app.use('/api/notifications', require('./routes/notifications'));

// Frontend estático
app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (_, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// Socket.io
require('./socket')(io);

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 DUOQ.GG rodando na porta ${PORT}`);
  console.log(`   DB_HOST: ${process.env.DB_HOST || 'NÃO DEFINIDO'}`);
  console.log(`   DB_NAME: ${process.env.DB_NAME || 'NÃO DEFINIDO'}`);
  console.log(`   JWT_SECRET: ${process.env.JWT_SECRET ? 'OK' : 'NÃO DEFINIDO ⚠️'}`);
});

// Evita que erros não tratados derrubem o processo
process.on('uncaughtException',  err => console.error('uncaughtException:', err.message));
process.on('unhandledRejection', err => console.error('unhandledRejection:', err));
