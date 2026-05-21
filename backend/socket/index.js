const jwt = require('jsonwebtoken');
const db = require('../db/connection');

const onlineUsers = new Map(); // userId -> socketId

module.exports = (io) => {
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('Token ausente'));
    try {
      socket.user = jwt.verify(token, process.env.JWT_SECRET);
      next();
    } catch {
      next(new Error('Token inválido'));
    }
  });

  io.on('connection', async (socket) => {
    const userId = socket.user.id;
    onlineUsers.set(userId, socket.id);

    // Marcar online no banco
    await db.execute('UPDATE users SET online_status = ?, last_seen_at = NOW() WHERE id = ?', ['online', userId]);

    // Avisar amigos que está online
    const [friends] = await db.execute(
      `SELECT IF(f.user_a_id = ?, f.user_b_id, f.user_a_id) AS friend_id
       FROM friendships f WHERE f.user_a_id = ? OR f.user_b_id = ?`,
      [userId, userId, userId]
    );
    friends.forEach(({ friend_id }) => {
      const fSocket = onlineUsers.get(friend_id);
      if (fSocket) io.to(fSocket).emit('friend_online', { user_id: userId, status: 'online' });
    });

    // Entrar em sala pessoal para notificações
    socket.join(`user_${userId}`);

    // Enviar mensagem via socket
    socket.on('send_message', async ({ conversation_id, content }) => {
      if (!content?.trim()) return;
      try {
        const [conv] = await db.execute(
          'SELECT id, user_a_id, user_b_id FROM conversations WHERE id = ? AND (user_a_id = ? OR user_b_id = ?)',
          [conversation_id, userId, userId]
        );
        if (!conv.length) return;
        const [result] = await db.execute(
          'INSERT INTO messages (conversation_id, sender_id, content) VALUES (?,?,?)',
          [conversation_id, userId, content.trim()]
        );
        await db.execute('UPDATE conversations SET last_msg_at = NOW() WHERE id = ?', [conversation_id]);
        const receiverId = conv[0].user_a_id === userId ? conv[0].user_b_id : conv[0].user_a_id;
        const msg = { id: result.insertId, conversation_id, sender_id: userId, content: content.trim(), created_at: new Date() };
        // Emitir para os dois lados
        socket.emit('new_message', msg);
        const rSocket = onlineUsers.get(receiverId);
        if (rSocket) io.to(rSocket).emit('new_message', msg);
        // Notificação
        io.to(`user_${receiverId}`).emit('notification', { type: 'NEW_MESSAGE', actor_id: userId });
      } catch (err) {
        console.error('Socket send_message error:', err);
      }
    });

    // Digitando
    socket.on('typing', ({ conversation_id }) => {
      socket.to(`conv_${conversation_id}`).emit('typing', { user_id: userId, conversation_id });
    });

    socket.on('join_conversation', (conversation_id) => {
      socket.join(`conv_${conversation_id}`);
    });

    // Desconexão
    socket.on('disconnect', async () => {
      onlineUsers.delete(userId);
      await db.execute('UPDATE users SET online_status = ?, last_seen_at = NOW() WHERE id = ?', ['offline', userId]);
      friends.forEach(({ friend_id }) => {
        const fSocket = onlineUsers.get(friend_id);
        if (fSocket) io.to(fSocket).emit('friend_online', { user_id: userId, status: 'offline' });
      });
    });
  });

  // Expor função para emitir notificações de fora
  io.notifyUser = (userId, event, data) => {
    io.to(`user_${userId}`).emit(event, data);
  };
};
