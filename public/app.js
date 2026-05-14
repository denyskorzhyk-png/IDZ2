const socket = io();

const state = {
  id: '',
  name: '',
  roomId: '',
  game: null,
};

const $ = (id) => document.getElementById(id);

const el = {
  name: $('name'),
  saveName: $('save-name'),
  player: $('player'),
  rooms: $('rooms'),
  createRoom: $('create-room'),
  roomId: $('room-id'),
  roomStatus: $('room-status'),
  players: $('players'),
  startGame: $('start-game'),
  leaveRoom: $('leave-room'),
  gameRoomId: $('game-room-id'),
  turn: $('turn'),
  rule: $('rule'),
  word: $('word'),
  sendWord: $('send-word'),
  skipTurn: $('skip-turn'),
  leaveGame: $('leave-game'),
  gamePlayers: $('game-players'),
  history: $('history'),
  winner: $('winner'),
  finishPlayers: $('finish-players'),
  finishHistory: $('finish-history'),
  backLobby: $('back-lobby'),
};

function show(id) {
  document.querySelectorAll('.screen').forEach((screen) => screen.classList.remove('active'));
  $(id).classList.add('active');
}

function error(id, message = '') {
  $(id).textContent = message;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function ask(event, payload) {
  return new Promise((resolve) => {
    if (payload === undefined) {
      socket.emit(event, resolve);
      return;
    }

    socket.emit(event, payload, resolve);
  });
}

function renderLobby(rooms) {
  if (!rooms.length) {
    el.rooms.innerHTML = '<p class="muted">Активних кімнат поки немає. Створіть першу гру.</p>';
    return;
  }

  el.rooms.innerHTML = rooms.map((room) => `
    <div class="room">
      <div>
        <b>Кімната ${escapeHtml(room.id)}</b>
        <p class="muted">
          Автор: ${escapeHtml(room.host)} |
          Гравці: ${room.count}/${room.max} |
          Статус: ${room.status}
        </p>
      </div>
      <button data-join="${escapeHtml(room.id)}" ${room.status === 'playing' ? 'disabled' : ''}>
        Приєднатись
      </button>
    </div>
  `).join('');
}

function renderRoom(game) {
  const isHost = game.hostId === state.id;

  state.roomId = game.id;
  state.game = game;

  el.roomId.textContent = game.id;
  el.roomStatus.textContent = game.status === 'ready'
    ? 'Є мінімум два гравці. Автор може починати.'
    : 'Очікуємо ще одного гравця.';
  el.players.innerHTML = game.players.map((player) => `
    <div class="player">
      ${escapeHtml(player.name)}
      ${player.id === game.hostId ? '(автор)' : ''}
      ${player.id === state.id ? '(ви)' : ''}
    </div>
  `).join('');
  el.startGame.style.display = isHost ? 'inline-block' : 'none';
  el.startGame.disabled = game.players.length < 2;
  show('room');
}

function renderPlayers(game) {
  el.gamePlayers.innerHTML = game.players.map((player, index) => {
    const classes = [
      'player',
      index === game.turn && game.status === 'playing' ? 'current' : '',
      player.active ? '' : 'inactive',
    ].join(' ');

    return `
      <div class="${classes}">
        ${escapeHtml(player.name)}
        ${player.id === state.id ? '(ви)' : ''}
        ${player.active ? '' : '- вибув'}
        ${index === game.turn && player.active ? '- хід' : ''}
      </div>
    `;
  }).join('');
}

function renderHistory(target, history) {
  target.innerHTML = history.length
    ? history.map((item) => `
      <div class="word">
        <b>${escapeHtml(item.player)}:</b> ${escapeHtml(item.word)}
      </div>
    `).join('')
    : '<p class="muted">Слів ще немає.</p>';
}

function renderGame(game) {
  const me = game.players.find((player) => player.id === state.id);
  const current = game.players[game.turn];
  const isMyTurn = current?.id === state.id;
  const isActive = Boolean(me?.active);

  state.roomId = game.id;
  state.game = game;

  el.gameRoomId.textContent = game.id;
  el.turn.textContent = isActive
    ? isMyTurn ? 'Ваш хід.' : `Хід гравця ${current?.name || ''}.`
    : 'Ви вибули, але можете спостерігати за грою.';
  el.rule.textContent = game.lastWord
    ? `Останнє слово: ${game.lastWord}. Наступне має починатися на "${game.nextLetter.toUpperCase()}".`
    : 'Перший гравець може ввести будь-яке слово.';

  el.word.disabled = !isMyTurn || !isActive;
  el.sendWord.disabled = !isMyTurn || !isActive;
  el.skipTurn.disabled = !isMyTurn || !isActive;
  renderPlayers(game);
  renderHistory(el.history, game.history);
  show('game');

  if (isMyTurn && isActive) el.word.focus();
}

function renderFinish(game) {
  state.roomId = '';
  state.game = game;
  el.winner.textContent = game.winner ? `Переможець: ${game.winner.name}` : 'Переможця немає';
  el.finishPlayers.innerHTML = game.players.map((player) => `
    <div class="player ${player.active ? 'current' : 'inactive'}">
      ${escapeHtml(player.name)} ${player.active ? '- переможець' : '- вибув'}
    </div>
  `).join('');
  renderHistory(el.finishHistory, game.history);
  show('finish');
}

async function saveName() {
  error('start-error');
  const response = await ask('player:name', el.name.value);
  if (response.error) return error('start-error', response.error);

  state.id = response.id;
  state.name = response.name;
  el.player.textContent = `Гравець: ${state.name}`;
  show('lobby');
}

async function createRoom() {
  error('lobby-error');
  const response = await ask('game:create');
  if (response.error) return error('lobby-error', response.error);
  state.roomId = response.roomId;
}

async function joinRoom(roomId) {
  error('lobby-error');
  const response = await ask('game:join', roomId);
  if (response.error) return error('lobby-error', response.error);
  state.roomId = response.roomId;
}

async function startGame() {
  error('room-error');
  const response = await ask('game:start', state.roomId);
  if (response.error) error('room-error', response.error);
}

async function sendWord() {
  error('word-error');
  const response = await ask('game:word', {
    roomId: state.roomId,
    word: el.word.value,
  });
  if (response.error) return error('word-error', response.error);
  el.word.value = '';
}

async function skipTurn() {
  if (!confirm('Відмовитись від ходу і вибути з гри?')) return;
  error('word-error');
  const response = await ask('game:skip', state.roomId);
  if (response.error) error('word-error', response.error);
}

function leave() {
  if (state.roomId) socket.emit('game:leave', state.roomId);
  state.roomId = '';
  state.game = null;
  show('lobby');
}

el.saveName.addEventListener('click', saveName);
el.name.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') saveName();
});
el.createRoom.addEventListener('click', createRoom);
el.startGame.addEventListener('click', startGame);
el.leaveRoom.addEventListener('click', leave);
el.leaveGame.addEventListener('click', leave);
el.sendWord.addEventListener('click', sendWord);
el.word.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') sendWord();
});
el.skipTurn.addEventListener('click', skipTurn);
el.backLobby.addEventListener('click', () => {
  state.roomId = '';
  state.game = null;
  show('lobby');
});
el.rooms.addEventListener('click', (event) => {
  const button = event.target.closest('[data-join]');
  if (button) joinRoom(button.dataset.join);
});

socket.on('lobby:update', renderLobby);
socket.on('game:update', (game) => {
  if (game.status === 'waiting' || game.status === 'ready') renderRoom(game);
  if (game.status === 'playing') renderGame(game);
  if (game.status === 'finished') renderFinish(game);
});
socket.on('game:finished', renderFinish);
socket.on('game:error', (message) => {
  state.roomId = '';
  state.game = null;
  show('lobby');
  error('lobby-error', message);
});
socket.on('game:message', console.log);
