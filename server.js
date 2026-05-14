const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 3000;
const MAX_PLAYERS = 6;
const ROOM_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const players = {};
const games = {};

app.use(express.static(path.join(__dirname, 'public')));

function roomId() {
  let id = '';
  for (let i = 0; i < 4; i += 1) {
    id += ROOM_CHARS[Math.floor(Math.random() * ROOM_CHARS.length)];
  }
  return games[id] ? roomId() : id;
}

function publicGame(game) {
  return {
    id: game.id,
    hostId: game.hostId,
    status: game.status,
    players: game.players.map((player) => ({
      id: player.id,
      name: player.name,
      active: player.active,
    })),
    turn: game.turn,
    lastWord: game.lastWord,
    nextLetter: game.nextLetter,
    history: game.history,
    winner: game.winner,
  };
}

function lobbyRooms() {
  return Object.values(games)
    .filter((game) => game.status !== 'finished')
    .map((game) => ({
      id: game.id,
      host: game.players[0]?.name || '',
      count: game.players.length,
      max: MAX_PLAYERS,
      status: game.status,
    }));
}

function sendLobby() {
  io.emit('lobby:update', lobbyRooms());
}

function sendGame(game) {
  io.to(game.id).emit('game:update', publicGame(game));
}

function activePlayers(game) {
  return game.players.filter((player) => player.active);
}

function nextActiveIndex(game, fromIndex) {
  for (let step = 1; step <= game.players.length; step += 1) {
    const index = (fromIndex + step) % game.players.length;
    if (game.players[index].active) return index;
  }
  return -1;
}

function finishIfNeeded(game) {
  const active = activePlayers(game);
  if (active.length > 1) return false;

  game.status = 'finished';
  game.winner = active[0] ? { id: active[0].id, name: active[0].name } : null;
  io.to(game.id).emit('game:finished', publicGame(game));
  delete games[game.id];
  sendLobby();
  return true;
}

function playerRoom(socketId) {
  return Object.values(games).find((game) =>
    game.players.some((player) => player.id === socketId)
  );
}

function playerRoomId(socketId) {
  return Object.keys(games).find((id) =>
    games[id].players.some((player) => player.id === socketId)
  );
}

function removeDuplicateOpenPlayers(name, currentSocketId) {
  Object.values(games).forEach((game) => {
    if (game.status === 'playing') return;

    const before = game.players.length;
    game.players = game.players.filter((player) => {
      const samePlayer = player.name === name && player.id !== currentSocketId;
      if (samePlayer) {
        const oldSocket = io.sockets.sockets.get(player.id);
        if (oldSocket) oldSocket.leave(game.id);
      }
      return !samePlayer;
    });

    if (before === game.players.length) return;

    if (game.players.length === 0) {
      delete games[game.id];
      return;
    }

    game.hostId = game.players[0].id;
    game.status = game.players.length > 1 ? 'ready' : 'waiting';
    sendGame(game);
  });
}

function leaveRoom(socket, roomId = playerRoomId(socket.id)) {
  const game = games[roomId];
  if (!game) return;

  const index = game.players.findIndex((player) => player.id === socket.id);
  if (index === -1) return;

  socket.leave(game.id);

  if (game.status !== 'playing') {
    if (game.hostId === socket.id) {
      io.to(game.id).emit('game:error', 'Автор вийшов. Кімнату закрито.');
      delete games[game.id];
    } else {
      game.players.splice(index, 1);
      game.status = game.players.length > 1 ? 'ready' : 'waiting';
      sendGame(game);
    }
    sendLobby();
    return;
  }

  if (index !== -1 && game.players[index].active) {
    game.players[index].active = false;
    if (game.turn === index) game.turn = nextActiveIndex(game, index);
    if (!finishIfNeeded(game)) sendGame(game);
  }
}

function createGame(socket) {
  leaveRoom(socket);
  removeDuplicateOpenPlayers(players[socket.id], socket.id);

  const id = roomId();
  const game = {
    id,
    hostId: socket.id,
    status: 'waiting',
    players: [{ id: socket.id, name: players[socket.id], active: true }],
    turn: 0,
    used: [],
    history: [],
    lastWord: '',
    nextLetter: '',
    winner: null,
  };

  games[id] = game;
  socket.join(id);
  return game;
}

function joinGame(socket, id) {
  const game = games[String(id || '').trim().toUpperCase()];
  if (!game) return { error: 'Кімнату не знайдено.' };
  if (game.status === 'playing') return { error: 'Гра вже почалась.' };
  if (game.players.length >= MAX_PLAYERS) return { error: 'Кімната заповнена.' };
  if (game.players.some((player) => player.id === socket.id)) return { game };

  leaveRoom(socket);
  removeDuplicateOpenPlayers(players[socket.id], socket.id);
  game.players.push({ id: socket.id, name: players[socket.id], active: true });
  game.status = game.players.length > 1 ? 'ready' : 'waiting';
  socket.join(game.id);
  return { game };
}

function submitWord(socket, data) {
  const game = games[data?.roomId];
  if (!game || game.status !== 'playing') return { error: 'Гра не активна.' };

  const player = game.players.find((item) => item.id === socket.id);
  if (!player) return { error: 'Ви не учасник цієї гри.' };

  const current = game.players[game.turn];
  if (!current || current.id !== socket.id) return { error: 'Зараз не ваш хід.' };

  const word = String(data?.word || '').trim().toLowerCase();
  if (!word) return { error: 'Введіть слово.' };
  if (game.used.includes(word)) return { error: 'Це слово вже було використано.' };
  if (game.nextLetter && word[0] !== game.nextLetter) {
    return { error: `Слово має починатися на "${game.nextLetter.toUpperCase()}".` };
  }

  game.used.push(word);
  game.history.push({ player: current.name, word });
  game.lastWord = word;
  game.nextLetter = word[word.length - 1];
  game.turn = nextActiveIndex(game, game.turn);
  sendGame(game);
  return {};
}

function skipTurn(socket, roomId) {
  const game = games[roomId];
  if (!game || game.status !== 'playing') return { error: 'Гра не активна.' };

  const index = game.players.findIndex((player) => player.id === socket.id);
  if (index === -1) return { error: 'Ви не учасник цієї гри.' };
  if (index !== game.turn) return { error: 'Зараз не ваш хід.' };

  game.players[index].active = false;
  io.to(game.id).emit('game:message', `${game.players[index].name} вибув з гри.`);

  if (!finishIfNeeded(game)) {
    game.turn = nextActiveIndex(game, index);
    sendGame(game);
  }

  return {};
}

io.on('connection', (socket) => {
  socket.emit('lobby:update', lobbyRooms());

  socket.on('player:name', (name, callback) => {
    const reply = typeof callback === 'function' ? callback : () => {};
    const clean = String(name || '').trim();
    if (clean.length < 2) return reply({ error: 'Імʼя має містити мінімум 2 символи.' });

    players[socket.id] = clean.slice(0, 20);
    removeDuplicateOpenPlayers(players[socket.id], socket.id);
    reply({ name: players[socket.id], id: socket.id });
    sendLobby();
  });

  socket.on('game:create', (callback) => {
    const reply = typeof callback === 'function' ? callback : () => {};
    if (!players[socket.id]) return reply({ error: 'Спочатку введіть імʼя.' });

    const game = createGame(socket);
    reply({ roomId: game.id });
    sendLobby();
    sendGame(game);
  });

  socket.on('game:join', (id, callback) => {
    const reply = typeof callback === 'function' ? callback : () => {};
    if (!players[socket.id]) return reply({ error: 'Спочатку введіть імʼя.' });

    const result = joinGame(socket, id);
    if (result.error) return reply({ error: result.error });

    reply({ roomId: result.game.id });
    sendLobby();
    sendGame(result.game);
  });

  socket.on('game:start', (roomId, callback) => {
    const reply = typeof callback === 'function' ? callback : () => {};
    const game = games[roomId];
    if (!game) return reply({ error: 'Кімнату не знайдено.' });
    if (!game.players.some((player) => player.id === socket.id)) {
      return reply({ error: 'Ви не учасник цієї гри.' });
    }
    if (game.hostId !== socket.id) return reply({ error: 'Почати гру може тільки автор.' });
    if (game.players.length < 2) return reply({ error: 'Потрібен мінімум один партнер.' });

    game.status = 'playing';
    game.turn = 0;
    reply({});
    sendLobby();
    sendGame(game);
  });

  socket.on('game:word', (data, callback) => {
    const reply = typeof callback === 'function' ? callback : () => {};
    reply(submitWord(socket, data));
  });
  socket.on('game:skip', (roomId, callback) => {
    const reply = typeof callback === 'function' ? callback : () => {};
    reply(skipTurn(socket, roomId));
  });
  socket.on('game:leave', (roomId) => leaveRoom(socket, roomId));

  socket.on('disconnect', () => {
    leaveRoom(socket);
    delete players[socket.id];
  });
});

server.listen(PORT, () => {
  console.log(`Server started: http://localhost:${PORT}`);
});
