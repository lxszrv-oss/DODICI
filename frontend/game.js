const API_URL = "https://dodici.onrender.com";

const tg = window.Telegram?.WebApp;

if (tg) {
  tg.ready();
  tg.expand();
}

const telegramInitData = tg?.initData || '';

const cards = [...document.querySelectorAll('.card')];

const levelEl = document.getElementById('level');
const attemptEl = document.getElementById('attempt');
const statusEl = document.getElementById('status');

const end = document.getElementById('end');
const endTitle = document.getElementById('endTitle');
const endText = document.getElementById('endText');

const mainMenu = document.getElementById('mainMenu');

const menuButton = document.getElementById('menuButton');
const sideMenu = document.getElementById('sideMenu');
const menuOverlay = document.getElementById('menuOverlay');

const ratingButton = document.getElementById('ratingButton');
const profileButton = document.getElementById('profileButton');
const howButton = document.getElementById('howButton');
const settingsButton = document.getElementById('settingsButton');

let gameId = null;
let level = 1;
let attempt = 1;
let locked = false;


// DODICI — sounds

const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

function playSound(type) {
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }

  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();

  osc.connect(gain);
  gain.connect(audioCtx.destination);

  const now = audioCtx.currentTime;

  if (type === 'win') {
    osc.frequency.setValueAtTime(520, now);
    osc.frequency.setValueAtTime(780, now + 0.08);
    osc.frequency.setValueAtTime(1040, now + 0.16);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(0.25, now + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);

    osc.start(now);
    osc.stop(now + 0.35);
  }

  if (type === 'lose') {
    osc.frequency.setValueAtTime(220, now);
    osc.frequency.exponentialRampToValueAtTime(90, now + 0.35);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(0.3, now + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);

    osc.start(now);
    osc.stop(now + 0.4);
  }

  if (type === 'level') {
    osc.frequency.setValueAtTime(660, now);
    osc.frequency.setValueAtTime(880, now + 0.1);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(0.18, now + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);

    osc.start(now);
    osc.stop(now + 0.25);
  }

  if (type === 'start') {
    osc.frequency.setValueAtTime(440, now);
    osc.frequency.setValueAtTime(660, now + 0.08);
    osc.frequency.setValueAtTime(880, now + 0.16);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(0.18, now + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);

    osc.start(now);
    osc.stop(now + 0.3);
  }
}


function hud() {
  levelEl.textContent = String(level).padStart(2, '0') + ' / 12';
  attemptEl.textContent = attempt;
}


function reset() {
  cards.forEach((c, i) => {
    c.classList.remove('good', 'bad');
    c.textContent = i + 1;
  });
}


function finish(title, text) {
  endTitle.textContent = title;
  endText.textContent = text;
  end.classList.remove('hidden');
}


async function startGame() {
  try {
    const response = await fetch(`${API_URL}/game/start`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Telegram-Init-Data': telegramInitData
      },
      body: '{}'
    });

    const data = await response.json();

    if (!data.ok) {
      throw new Error(data.error || 'Не удалось начать игру');
    }

    gameId = data.game_id;
    level = data.level;
    locked = false;

    reset();

    end.classList.add('hidden');

    statusEl.textContent = 'Выбери одну карту';

    hud();

  } catch (error) {
    console.error(error);
    statusEl.textContent = 'Ошибка соединения с сервером';
  }
}


async function choose(i) {
  if (locked || !gameId) return;

  locked = true;

  statusEl.textContent = 'Проверяем…';

  try {
    const response = await fetch(`${API_URL}/game/choice`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Telegram-Init-Data': telegramInitData
      },
      body: JSON.stringify({
        game_id: gameId,
        level: level,
        card: String(i)
      })
    });

    const data = await response.json();

    if (!data.ok) {
      throw new Error(data.error || 'Ошибка сервера');
    }

    if (data.correct) {

      cards[i].classList.add('good');

      playSound('win');

      document.body.classList.add('victory');

      setTimeout(() => {
        document.body.classList.remove('victory');
      }, 800);

      cards[i].textContent = '😈';

      statusEl.textContent = 'Правильно! Следующий уровень…';

      if (data.won) {
        finish(
          'ТЫ ПРОШЁЛ DODICI',
          '12 из 12. Поздравляем!'
        );

        return;
      }

      setTimeout(() => {

        level = data.level;

        playSound('level');

        attempt++;

        reset();

        cards.forEach(card => {
          card.classList.remove('card-enter');
        });

        void cards[0].offsetWidth;

        cards.forEach(card => {
          card.classList.add('card-enter');
        });

        locked = false;

        statusEl.textContent = 'Выбери одну карту';

        hud();

      }, 650);

    } else {

      cards[i].classList.add('bad');

      playSound('lose');

      cards[i].textContent = '😇';

      statusEl.textContent = 'Ой! Это была не та карточка 💥';

      finish(
        'ЗАБЕГ ОКОНЧЕН',
        'Ты дошёл до уровня ' + level + ' из 12.'
      );
    }

  } catch (error) {

    console.error(error);

    statusEl.textContent = 'Ошибка соединения с сервером';

    locked = false;
  }
}


// CARDS

cards.forEach(card => {

  card.addEventListener('click', () => {

    choose(Number(card.dataset.index));

  });

});


// RESTART

document.getElementById('restart').addEventListener('click', () => {

  attempt++;

  startGame();

});


// START SCREEN

mainMenu.addEventListener('click', () => {

  playSound('start');

  mainMenu.classList.add('hidden');

  startGame();

});


// SIDE MENU

function openMenu() {

  sideMenu.classList.add('open');

  menuOverlay.classList.add('visible');

}


function closeMenu() {

  sideMenu.classList.remove('open');

  menuOverlay.classList.remove('visible');

}


menuButton.addEventListener('click', () => {

  openMenu();

});


menuOverlay.addEventListener('click', () => {

  closeMenu();

});


// RATING

ratingButton.addEventListener('click', async () => {

  closeMenu();

  try {

    const response = await fetch(`${API_URL}/rating`);

    const data = await response.json();

    if (!data.ok) {
      throw new Error(data.error || 'Не удалось загрузить рейтинг');
    }

    if (!data.rating.length) {
      alert('🏆 Рейтинг пока пуст');
      return;
    }

    let text = '🏆 РЕЙТИНГ DODICI\n\n';

    data.rating.forEach(player => {

      const name =
        player.first_name ||
        player.username ||
        'Игрок';

      text +=
  player.place + '. ' +
  name +
  ' — ' +
  player.points +
  ' очк. • Лучший уровень: ' +
  player.best_level +
  '/12\n';

    });

    alert(text);

  } catch (error) {

    console.error(error);

    alert('❌ Не удалось загрузить рейтинг');

  }

});


// PROFILE

profileButton.addEventListener('click', async () => {

  closeMenu();

  try {

    const response = await fetch(`${API_URL}/player/profile`, {
      method: 'GET',
      headers: {
        'X-Telegram-Init-Data': telegramInitData
      }
    });

    const data = await response.json();

    if (!data.ok) {
      throw new Error(data.error || 'Не удалось загрузить профиль');
    }

    const player = data.player;

    alert(
      '👤 ПРОФИЛЬ ИГРОКА\n\n' +
      'Имя: ' + (player.first_name || 'Игрок') + '\n' +
      'Игры: ' + player.games_played + '\n' +
      'Победы: ' + player.wins + '\n' +
      'Поражения: ' + player.losses + '\n' +
      'Лучший уровень: ' + player.best_level
    );

  } catch (error) {

    console.error(error);

    alert('❌ Не удалось загрузить профиль');

  }

});


// HOW TO PLAY

howButton.addEventListener('click', () => {

  closeMenu();

  alert(
    '❓ КАК ИГРАТЬ\n\n' +
    'Выбери одну из трёх карт.\n' +
    'Угадаешь — переходишь дальше.\n' +
    'Ошибёшься — игра заканчивается.\n\n' +
    'Пройди все 12 уровней!'
  );

});


// SETTINGS

settingsButton.addEventListener('click', () => {

  closeMenu();

  alert('⚙️ Настройки скоро появятся');

});