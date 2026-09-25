const API_URL = "https://dodici.onrender.com";

const tg = window.Telegram?.WebApp;

if (tg) {
  tg.ready();
  tg.expand();
}

const telegramInitData = tg?.initData || "";
const telegramUser = tg?.initDataUnsafe?.user || null;

const cards = [...document.querySelectorAll(".card")];

const levelEl = document.getElementById("level");
const attemptEl = document.getElementById("attempt");
const statusEl = document.getElementById("status");

const end = document.getElementById("end");
const endTitle = document.getElementById("endTitle");
const endText = document.getElementById("endText");

const mainMenu = document.getElementById("mainMenu");

const menuButton = document.getElementById("menuButton");
const sideMenu = document.getElementById("sideMenu");
const menuOverlay = document.getElementById("menuOverlay");

const ratingButton = document.getElementById("ratingButton");
const profileButton = document.getElementById("profileButton");
const howButton = document.getElementById("howButton");
const settingsButton = document.getElementById("settingsButton");

let gameId = null;
let level = 1;
let attempt = 1;
let locked = false;

const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

function playSound(type) {
  if (audioCtx.state === "suspended") {
    audioCtx.resume();
  }

  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();

  osc.connect(gain);
  gain.connect(audioCtx.destination);

  const now = audioCtx.currentTime;

  if (type === "win") {
    osc.frequency.setValueAtTime(520, now);
    osc.frequency.setValueAtTime(780, now + 0.08);
    osc.frequency.setValueAtTime(1040, now + 0.16);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(0.25, now + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);

    osc.start(now);
    osc.stop(now + 0.35);
  }

  if (type === "lose") {
    osc.frequency.setValueAtTime(220, now);
    osc.frequency.exponentialRampToValueAtTime(90, now + 0.35);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(0.3, now + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);

    osc.start(now);
    osc.stop(now + 0.4);
  }

  if (type === "level") {
    osc.frequency.setValueAtTime(660, now);
    osc.frequency.setValueAtTime(880, now + 0.1);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(0.18, now + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);

    osc.start(now);
    osc.stop(now + 0.25);
  }

  if (type === "start") {
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
  levelEl.textContent = String(level).padStart(2, "0") + " / 12";
  attemptEl.textContent = attempt;
}

function reset() {
  cards.forEach((card, i) => {
    card.classList.remove("good", "bad");
    card.textContent = i + 1;
  });
}

function finish(title, text) {
  endTitle.textContent = title;
  endText.textContent = text;
  end.classList.remove("hidden");
}

async function startGame() {
  try {
    const response = await fetch(`${API_URL}/game/start`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Telegram-Init-Data": telegramInitData
      },
      body: "{}"
    });

    const data = await response.json();

    if (!data.ok) {
      throw new Error(data.error || "Не удалось начать игру");
    }

    gameId = data.game_id;
    level = data.level;
    locked = false;

    reset();

    end.classList.add("hidden");

    statusEl.textContent = "Выбери одну карту";

    hud();
  } catch (error) {
    console.error(error);
    statusEl.textContent = "Ошибка соединения с сервером";
  }
}

async function choose(i) {
  if (locked || !gameId) {
    return;
  }

  locked = true;

  statusEl.textContent = "Проверяем…";

  try {
    const response = await fetch(`${API_URL}/game/choice`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Telegram-Init-Data": telegramInitData
      },
      body: JSON.stringify({
        game_id: gameId,
        level: level,
        card: String(i)
      })
    });

    const data = await response.json();

    if (!data.ok) {
      throw new Error(data.error || "Ошибка сервера");
    }

    if (data.correct) {
      cards[i].classList.add("good");

      playSound("win");

      document.body.classList.add("victory");

      setTimeout(() => {
        document.body.classList.remove("victory");
      }, 800);

      cards[i].textContent = "😈";

      statusEl.textContent = "Правильно! Следующий уровень…";

      if (data.won) {
        finish(
          "ТЫ ПРОШЁЛ DODICI",
          "12 из 12. Поздравляем!"
        );

        return;
      }

      setTimeout(() => {
        level = data.level;

        playSound("level");

        attempt++;

        reset();

        cards.forEach(card => {
          card.classList.remove("card-enter");
        });

        void cards[0].offsetWidth;

        cards.forEach(card => {
          card.classList.add("card-enter");
        });

        locked = false;

        statusEl.textContent = "Выбери одну карту";

        hud();
      }, 650);
    } else {
      cards[i].classList.add("bad");

      playSound("lose");

      cards[i].textContent = "😇";

      statusEl.textContent = "Ой! Это была не та карточка 💥";

      finish(
        "ЗАБЕГ ОКОНЧЕН",
        "Ты дошёл до уровня " + level + " из 12."
      );
    }
  } catch (error) {
    console.error(error);

    statusEl.textContent = "Ошибка соединения с сервером";

    locked = false;
  }
}

cards.forEach(card => {
  card.addEventListener("click", () => {
    choose(Number(card.dataset.index));
  });
});

document.getElementById("restart").addEventListener("click", () => {
  attempt++;
  startGame();
});

mainMenu.addEventListener("click", () => {
  playSound("start");

  mainMenu.classList.add("hidden");

  startGame();
});

function openMenu() {
  sideMenu.classList.add("open");
  menuOverlay.classList.add("visible");
}

function closeMenu() {
  sideMenu.classList.remove("open");
  menuOverlay.classList.remove("visible");
}

menuButton.addEventListener("click", () => {
  openMenu();
});

menuOverlay.addEventListener("click", () => {
  closeMenu();
});


function getPlayerId(player) {
  return (
    player.telegram_id ??
    player.user_id ??
    player.id ??
    player.telegram_user_id ??
    null
  );
}

function isCurrentPlayer(player) {
  if (!telegramUser) {
    return false;
  }

  const playerId = getPlayerId(player);

  if (playerId !== null) {
    return String(playerId) === String(telegramUser.id);
  }

  if (
    player.username &&
    telegramUser.username &&
    player.username.toLowerCase() === telegramUser.username.toLowerCase()
  ) {
    return true;
  }

  return false;
}

function getPlaceClass(place) {
  if (place === 1) {
    return "rating-gold";
  }

  if (place === 2) {
    return "rating-silver";
  }

  if (place === 3) {
    return "rating-bronze";
  }

  return "";
}

function getPlaceIcon(place) {
  if (place === 1) {
    return "🥇";
  }

  if (place === 2) {
    return "🥈";
  }

  if (place === 3) {
    return "🥉";
  }

  return place;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function createRatingStyles() {
  if (document.getElementById("dodici-rating-styles")) {
    return;
  }

  const style = document.createElement("style");

  style.id = "dodici-rating-styles";

  style.textContent = `
    .rating-modal {
      position: fixed;
      inset: 0;
      z-index: 5000;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 18px;
      background: rgba(0, 0, 0, 0.78);
      backdrop-filter: blur(10px);
      opacity: 0;
      visibility: hidden;
      transition: opacity 0.25s ease, visibility 0.25s ease;
    }

    .rating-modal.visible {
      opacity: 1;
      visibility: visible;
    }

    .rating-window {
      width: min(470px, 100%);
      max-height: min(720px, 88vh);
      overflow: hidden;
      border: 1px solid rgba(255, 255, 255, 0.13);
      border-radius: 26px;
      background:
        radial-gradient(circle at 50% -10%, rgba(255, 190, 60, 0.18), transparent 35%),
        radial-gradient(circle at 0% 100%, rgba(120, 70, 255, 0.16), transparent 40%),
        linear-gradient(145deg, #191522, #0a0b11 70%);
      box-shadow:
        0 30px 90px rgba(0, 0, 0, 0.7),
        inset 0 1px 0 rgba(255, 255, 255, 0.06);
      transform: translateY(20px) scale(0.96);
      transition: transform 0.3s cubic-bezier(.17,.89,.32,1.2);
    }

    .rating-modal.visible .rating-window {
      transform: translateY(0) scale(1);
    }

    .rating-header {
      position: relative;
      padding: 24px 22px 18px;
      text-align: center;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    }

    .rating-crown {
      font-size: 38px;
      line-height: 1;
      margin-bottom: 7px;
    }

    .rating-title {
      margin: 0;
      color: #fff;
      font-size: 25px;
      font-weight: 950;
      letter-spacing: 2px;
    }

    .rating-subtitle {
      margin-top: 6px;
      color: rgba(255, 255, 255, 0.45);
      font-size: 11px;
      letter-spacing: 2px;
      text-transform: uppercase;
    }

    .rating-close {
      position: absolute;
      top: 15px;
      right: 15px;
      width: 38px;
      height: 38px;
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 12px;
      background: rgba(255, 255, 255, 0.06);
      color: #fff;
      font-size: 20px;
      cursor: pointer;
    }

    .rating-list {
      max-height: calc(min(720px, 88vh) - 155px);
      overflow-y: auto;
      padding: 12px;
    }

    .rating-list::-webkit-scrollbar {
      width: 5px;
    }

    .rating-list::-webkit-scrollbar-thumb {
      background: rgba(255, 255, 255, 0.15);
      border-radius: 10px;
    }

    .rating-row {
      display: grid;
      grid-template-columns: 48px 1fr auto;
      align-items: center;
      gap: 12px;
      margin-bottom: 8px;
      padding: 12px 13px;
      border: 1px solid rgba(255, 255, 255, 0.07);
      border-radius: 17px;
      background: rgba(255, 255, 255, 0.045);
      transition: transform 0.2s ease, background 0.2s ease;
    }

    .rating-row:hover {
      transform: translateX(3px);
      background: rgba(255, 255, 255, 0.08);
    }

    .rating-row.me {
      border-color: rgba(255, 215, 70, 0.75);
      background:
        linear-gradient(90deg, rgba(255, 200, 50, 0.17), rgba(255, 170, 30, 0.05));
      box-shadow:
        0 0 18px rgba(255, 190, 40, 0.12),
        inset 0 0 20px rgba(255, 200, 50, 0.04);
    }

    .rating-row.me::after {
      content: "ЭТО ТЫ";
      margin-left: 6px;
      color: #ffd84d;
      font-size: 8px;
      font-weight: 900;
      letter-spacing: 1px;
    }

    .rating-place {
      display: flex;
      align-items: center;
      justify-content: center;
      min-width: 42px;
      font-size: 17px;
      font-weight: 900;
    }

    .rating-gold .rating-place {
      color: #ffd84d;
      text-shadow: 0 0 15px rgba(255, 210, 60, 0.7);
    }

    .rating-silver .rating-place {
      color: #dce2eb;
      text-shadow: 0 0 13px rgba(220, 225, 235, 0.45);
    }

    .rating-bronze .rating-place {
      color: #d89155;
      text-shadow: 0 0 13px rgba(210, 130, 70, 0.5);
    }

    .rating-name {
      min-width: 0;
    }

    .rating-name-main {
      overflow: hidden;
      color: #fff;
      font-size: 14px;
      font-weight: 800;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .rating-level {
      margin-top: 3px;
      color: rgba(255, 255, 255, 0.42);
      font-size: 10px;
    }

    .rating-points {
      text-align: right;
      color: #fff;
      font-size: 14px;
      font-weight: 900;
      white-space: nowrap;
    }

    .rating-points span {
      display: block;
      margin-top: 2px;
      color: rgba(255, 255, 255, 0.38);
      font-size: 9px;
      font-weight: 600;
    }

    .rating-empty {
      padding: 45px 20px;
      text-align: center;
      color: rgba(255, 255, 255, 0.45);
    }

    @media (max-width: 480px) {
      .rating-modal {
        padding: 10px;
      }

      .rating-window {
        border-radius: 23px;
      }

      .rating-row {
        grid-template-columns: 40px 1fr auto;
        gap: 8px;
        padding: 11px 9px;
      }

      .rating-row.me::after {
        display: none;
      }

      .rating-title {
        font-size: 22px;
      }
    }
  `;

  document.head.appendChild(style);
}

function showRatingModal(rating) {
  createRatingStyles();

  const oldModal = document.getElementById("ratingModal");

  if (oldModal) {
    oldModal.remove();
  }

  const modal = document.createElement("div");

  modal.id = "ratingModal";
  modal.className = "rating-modal";

  const rows = rating
    .map((player) => {
      const place = Number(player.place);
      const name =
        player.first_name ||
        player.username ||
        "Игрок";

      const bestLevel =
        player.best_level !== undefined &&
        player.best_level !== null
          ? player.best_level
          : 0;

      const points =
        player.points !== undefined &&
        player.points !== null
          ? player.points
          : 0;

      const me = isCurrentPlayer(player);
      const placeClass = getPlaceClass(place);

      return `
        <div class="rating-row ${placeClass} ${me ? "me" : ""}">
          <div class="rating-place">
            ${getPlaceIcon(place)}
          </div>

          <div class="rating-name">
            <div class="rating-name-main">
              ${escapeHtml(name)}
            </div>

            <div class="rating-level">
              Лучший уровень: ${escapeHtml(bestLevel)}
            </div>
          </div>

          <div class="rating-points">
            ${escapeHtml(points)}
            <span>ОЧКОВ</span>
          </div>
        </div>
      `;
    })
    .join("");

  modal.innerHTML = `
    <div class="rating-window">
      <div class="rating-header">
        <button class="rating-close" id="ratingClose">×</button>

        <div class="rating-crown">🏆</div>

        <h2 class="rating-title">
          РЕЙТИНГ DODICI
        </h2>

        <div class="rating-subtitle">
          Лучшие игроки
        </div>
      </div>

      <div class="rating-list">
        ${
          rows ||
          `<div class="rating-empty">
            🏆<br><br>
            Рейтинг пока пуст
          </div>`
        }
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  requestAnimationFrame(() => {
    modal.classList.add("visible");
  });

  const closeRating = () => {
    modal.classList.remove("visible");

    setTimeout(() => {
      modal.remove();
    }, 300);
  };

  document
    .getElementById("ratingClose")
    .addEventListener("click", closeRating);

  modal.addEventListener("click", (event) => {
    if (event.target === modal) {
      closeRating();
    }
  });
}

ratingButton.addEventListener("click", async () => {
  closeMenu();

  try {
    ratingButton.disabled = true;

    const response = await fetch(`${API_URL}/rating`);

    const data = await response.json();

    if (!data.ok) {
      throw new Error(
        data.error || "Не удалось загрузить рейтинг"
      );
    }

    showRatingModal(data.rating || []);
  } catch (error) {
    console.error(error);

    alert("❌ Не удалось загрузить рейтинг");
  } finally {
    ratingButton.disabled = false;
  }
});

profileButton.addEventListener("click", async () => {
  closeMenu();

  try {
    profileButton.disabled = true;

    const response = await fetch(
      `${API_URL}/player/profile`,
      {
        method: "GET",
        headers: {
          "X-Telegram-Init-Data": telegramInitData
        }
      }
    );

    const data = await response.json();

    if (!data.ok) {
      throw new Error(
        data.error || "Не удалось загрузить профиль"
      );
    }

    const player = data.player;

    const oldProfile = document.getElementById(
      "profileModal"
    );

    if (oldProfile) {
      oldProfile.remove();
    }

    const profileModal = document.createElement("div");

    profileModal.id = "profileModal";
    profileModal.className = "profile-modal";

    profileModal.innerHTML = `
      <div class="profile-window">

        <button
          class="profile-close"
          id="profileClose"
          type="button"
          aria-label="Закрыть профиль"
        >
          ×
        </button>

        <div class="profile-avatar">
          👤
        </div>

        <div class="profile-title">
          ПРОФИЛЬ
        </div>

        <div class="profile-name">
          ${escapeHtml(player.first_name || "Игрок")}
        </div>

        <div class="profile-stats">

          <div class="profile-stat">
            <div class="profile-stat-icon">
              🎮
            </div>

            <div class="profile-stat-value">
              ${escapeHtml(player.games_played)}
            </div>

            <div class="profile-stat-label">
              ИГР
            </div>
          </div>

          <div class="profile-stat">
            <div class="profile-stat-icon">
              🏆
            </div>

            <div class="profile-stat-value">
              ${escapeHtml(player.wins)}
            </div>

            <div class="profile-stat-label">
              ПОБЕД
            </div>
          </div>

          <div class="profile-stat">
            <div class="profile-stat-icon">
              💥
            </div>

            <div class="profile-stat-value">
              ${escapeHtml(player.losses)}
            </div>

            <div class="profile-stat-label">
              ПОРАЖЕНИЙ
            </div>
          </div>

        </div>

        <div class="profile-best">

          <div class="profile-best-label">
            ЛУЧШИЙ УРОВЕНЬ
          </div>

          <div class="profile-best-value">
            ${escapeHtml(player.best_level)}
            <span>/ 12</span>
          </div>

        </div>

      </div>
    `;

    document.body.appendChild(profileModal);

    requestAnimationFrame(() => {
      profileModal.classList.add("visible");
    });

    const closeProfile = () => {
      profileModal.classList.remove("visible");

      setTimeout(() => {
        profileModal.remove();
      }, 300);
    };

    document
      .getElementById("profileClose")
      .addEventListener("click", closeProfile);

    profileModal.addEventListener("click", (event) => {
      if (event.target === profileModal) {
        closeProfile();
      }
    });

  } catch (error) {
    console.error(error);

    alert("❌ Не удалось загрузить профиль");
  } finally {
    profileButton.disabled = false;
  }
});

howButton.addEventListener("click", () => {
  closeMenu();

  alert(
    "❓ КАК ИГРАТЬ\n\n" +
    "Выбери одну из трёх карт.\n" +
    "Угадаешь — переходишь дальше.\n" +
    "Ошибёшься — игра заканчивается.\n\n" +
    "Пройди все 12 уровней!"
  );
});

settingsButton.addEventListener("click", () => {
  closeMenu();

  const oldSettings = document.getElementById("settingsModal");

  if (oldSettings) {
    oldSettings.remove();
  }

  const settingsModal = document.createElement("div");

  settingsModal.id = "settingsModal";
  settingsModal.className = "settings-modal";

  settingsModal.innerHTML = `
    <div class="settings-window">

      <button
        class="settings-close"
        id="settingsClose"
        type="button"
        aria-label="Закрыть настройки"
      >
        ×
      </button>

      <div class="settings-icon">
        ⚙️
      </div>

      <div class="settings-title">
        НАСТРОЙКИ
      </div>

      <div class="settings-list">

        <div class="settings-row">
          <div class="settings-row-left">
            <span class="settings-row-icon">🔊</span>

            <div>
              <div class="settings-row-title">
                Звуки
              </div>

              <div class="settings-row-subtitle">
                Звуковые эффекты игры
              </div>
            </div>
          </div>

          <button
            class="settings-toggle active"
            id="soundToggle"
            type="button"
            aria-label="Звуки"
          >
            <span></span>
          </button>
        </div>

        <div class="settings-row">
          <div class="settings-row-left">
            <span class="settings-row-icon">📳</span>

            <div>
              <div class="settings-row-title">
                Вибрация
              </div>

              <div class="settings-row-subtitle">
                Тактильный отклик
              </div>
            </div>
          </div>

          <button
            class="settings-toggle active"
            id="vibrationToggle"
            type="button"
            aria-label="Вибрация"
          >
            <span></span>
          </button>
        </div>

        <div class="settings-row">
          <div class="settings-row-left">
            <span class="settings-row-icon">🌙</span>

            <div>
              <div class="settings-row-title">
                Тема
              </div>

              <div class="settings-row-subtitle">
                Тёмная тема
              </div>
            </div>
          </div>

          <div class="settings-theme">
            DARK
          </div>
        </div>

      </div>

    </div>
  `;

  document.body.appendChild(settingsModal);

  requestAnimationFrame(() => {
    settingsModal.classList.add("visible");
  });

  const closeSettings = () => {
    settingsModal.classList.remove("visible");

    setTimeout(() => {
      settingsModal.remove();
    }, 300);
  };

  document
    .getElementById("settingsClose")
    .addEventListener("click", closeSettings);

  settingsModal.addEventListener("click", (event) => {
    if (event.target === settingsModal) {
      closeSettings();
    }
  });

  document
    .getElementById("soundToggle")
    .addEventListener("click", (event) => {
      event.currentTarget.classList.toggle("active");
    });

  document
    .getElementById("vibrationToggle")
    .addEventListener("click", (event) => {
      event.currentTarget.classList.toggle("active");
    });
});