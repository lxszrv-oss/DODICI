const API_URL = "https://dodici.onrender.com";

const tg = window.Telegram?.WebApp;
if (tg) {
  tg.ready();
  tg.expand();
}

const cards = [...document.querySelectorAll('.card')];
const levelEl = document.getElementById('level');
const attemptEl = document.getElementById('attempt');
const statusEl = document.getElementById('status');
const end = document.getElementById('end');
const endTitle = document.getElementById('endTitle');
const endText = document.getElementById('endText');

let gameId = null;
let level = 1;
let attempt = 1;
let locked = false;

function hud() {
  levelEl.textContent = String(level).padStart(2, '0') + ' / 12';
  attemptEl.textContent = attempt;
}

function reset() {
  cards.forEach(c => c.classList.remove('good', 'bad'));
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
        'Content-Type': 'application/json'
      },
      body: '{}'
    });

    const data = await response.json();

    if (!data.ok) {
      throw new Error('Не удалось начать игру');
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
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        game_id: gameId,
        level: level,
        card: i
      })
    });

    const data = await response.json();

    if (!data.ok) {
      throw new Error(data.error || 'Ошибка сервера');
    }

    if (data.correct) {
      cards[i].classList.add('good');
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
        attempt++;
        reset();
        locked = false;
        statusEl.textContent = 'Выбери одну карту';
        hud();
      }, 650);

    } else {
      cards[i].classList.add('bad');
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

cards.forEach(card => {
  card.addEventListener('click', () => {
    choose(Number(card.dataset.index));
  });
});

document.getElementById('restart').addEventListener('click', () => {
  attempt++;
  startGame();
});

startGame();