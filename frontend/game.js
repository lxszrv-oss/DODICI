const API_URL = "https://dodici.onrender.com";

const tg = window.Telegram?.WebApp;

if (tg) {
  tg.ready();
  tg.expand();
}

const telegramInitData = tg?.initData || "";
const telegramUser = tg?.initDataUnsafe?.user || null;


/* =========================
   ELEMENTS
========================= */

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


/* =========================
   GAME STATE
========================= */

let gameId = null;
let level = 1;
let attempt = 1;
let locked = false;


/* =========================
   SOUND
========================= */

const AudioContextClass =
  window.AudioContext || window.webkitAudioContext;

const audioCtx = AudioContextClass
  ? new AudioContextClass()
  : null;


function playSound(type) {
  const soundEnabled =
    localStorage.getItem("dodici_sound") !== "off";

  if (!soundEnabled || !audioCtx) {
    return;
  }

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
    gain.gain.exponentialRampToValueAtTime(
      0.25,
      now + 0.03
    );
    gain.gain.exponentialRampToValueAtTime(
      0.001,
      now + 0.35
    );

    osc.start(now);
    osc.stop(now + 0.35);
  }

  if (type === "lose") {
    osc.frequency.setValueAtTime(220, now);
    osc.frequency.exponentialRampToValueAtTime(
      90,
      now + 0.35
    );

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(
      0.3,
      now + 0.03
    );
    gain.gain.exponentialRampToValueAtTime(
      0.001,
      now + 0.4
    );

    osc.start(now);
    osc.stop(now + 0.4);
  }

  if (type === "level") {
    osc.frequency.setValueAtTime(660, now);
    osc.frequency.setValueAtTime(880, now + 0.1);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(
      0.18,
      now + 0.03
    );
    gain.gain.exponentialRampToValueAtTime(
      0.001,
      now + 0.25
    );

    osc.start(now);
    osc.stop(now + 0.25);
  }

  if (type === "start") {
    osc.frequency.setValueAtTime(440, now);
    osc.frequency.setValueAtTime(660, now + 0.08);
    osc.frequency.setValueAtTime(880, now + 0.16);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(
      0.18,
      now + 0.03
    );
    gain.gain.exponentialRampToValueAtTime(
      0.001,
      now + 0.3
    );

    osc.start(now);
    osc.stop(now + 0.3);
  }
}


/* =========================
   VIBRATION
========================= */

function vibrate(pattern = 20) {
  const vibrationEnabled =
    localStorage.getItem("dodici_vibration") !== "off";

  if (!vibrationEnabled) {
    return;
  }

  if (tg?.HapticFeedback) {
    tg.HapticFeedback.impactOccurred("light");
    return;
  }

  if (navigator.vibrate) {
    navigator.vibrate(pattern);
  }
}


/* =========================
   CARD DESIGN
========================= */

function cardMarkup(i, value = i + 1) {
  return `
    <span class="card-glow"></span>

    <span class="card-crown">
      ♛
    </span>

    <span class="card-number">
      ${value}
    </span>

    <span class="card-shine"></span>
  `;
}


/* =========================
   HUD
========================= */

function updateHud() {
  levelEl.textContent =
    String(level).padStart(2, "0") + " / 12";

  attemptEl.textContent = attempt;
}


/* =========================
   RESET CARDS
========================= */

function resetCards() {
  cards.forEach((card, i) => {
    card.classList.remove(
      "good",
      "bad",
      "card-enter"
    );

    card.innerHTML = cardMarkup(i);
  });
}


/* =========================
   RESULT CARD
========================= */

function setCardResult(card, emoji) {
  card.innerHTML = `
    <span class="card-glow"></span>

    <span class="card-crown">
      ♛
    </span>

    <span class="card-number">
      ${emoji}
    </span>

    <span class="card-shine"></span>
  `;
}


/* =========================
   FINISH GAME
========================= */

function finish(title, text) {
  endTitle.textContent = title;
  endText.textContent = text;

  end.classList.remove("hidden");
}


/* =========================
   START GAME
========================= */

async function startGame() {
  try {
    locked = true;

    const response = await fetch(
      `${API_URL}/game/start`,
      {
        method: "POST",

        headers: {
          "Content-Type": "application/json",
          "X-Telegram-Init-Data": telegramInitData
        },

        body: "{}"
      }
    );

    const data = await response.json();

    if (!data.ok) {
      throw new Error(
        data.error || "Не удалось начать игру"
      );
    }

    gameId = data.game_id;

    level = data.level;
    locked = false;

    resetCards();

    end.classList.add("hidden");

    statusEl.textContent =
      "Выбери одну карту";

    updateHud();

    cards.forEach(card => {
      card.classList.add("card-enter");
    });

  } catch (error) {
    console.error(error);

    locked = false;

    statusEl.textContent =
      "Ошибка соединения с сервером";
  }
}


/* =========================
   CHOOSE CARD
========================= */

async function choose(i) {
  if (locked || !gameId) {
    return;
  }

  locked = true;

  vibrate(18);

  statusEl.textContent =
    "Проверяем…";

  try {
    const response = await fetch(
      `${API_URL}/game/choice`,
      {
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
      }
    );

    const data = await response.json();

    if (!data.ok) {
      throw new Error(
        data.error || "Ошибка сервера"
      );
    }


    /* =====================
       CORRECT
    ===================== */

    if (data.correct) {

      cards[i].classList.add("good");

      setCardResult(
        cards[i],
        "😈"
      );

      playSound("win");

      vibrate([
        15,
        35,
        25
      ]);

      document.body.classList.add(
        "victory"
      );

      setTimeout(() => {
        document.body.classList.remove(
          "victory"
        );
      }, 800);

      statusEl.textContent =
        "Правильно! Следующий уровень…";


      /* ===================
         FINAL LEVEL
      =================== */

      if (data.won) {

        finish(
          "ТЫ ПРОШЁЛ DODICI",
          "12 из 12. Поздравляем!"
        );

        return;
      }


      /* ===================
         NEXT LEVEL
      =================== */

      setTimeout(() => {

        level = data.level;

        attempt++;

        playSound("level");

        vibrate(18);

        resetCards();

        cards.forEach(card => {
          card.classList.add(
            "card-enter"
          );
        });

        locked = false;

        statusEl.textContent =
          "Выбери одну карту";

        updateHud();

      }, 650);


      return;
    }


    /* =====================
       WRONG
    ===================== */

    cards[i].classList.add("bad");

    setCardResult(
      cards[i],
      "😇"
    );

    playSound("lose");

    vibrate([
      40,
      50,
      40
    ]);

    statusEl.textContent =
      "Ой! Это была не та карточка 💥";

    finish(
      "ЗАБЕГ ОКОНЧЕН",
      "Ты дошёл до уровня " +
      level +
      " из 12."
    );

  } catch (error) {

    console.error(error);

    statusEl.textContent =
      "Ошибка соединения с сервером";

    locked = false;
  }
}


/* =========================
   CARD CLICK
========================= */

cards.forEach(card => {

  card.addEventListener(
    "click",
    () => {
      choose(
        Number(
          card.dataset.index
        )
      );
    }
  );

});


/* =========================
   RESTART
========================= */

document
  .getElementById("restart")
  .addEventListener(
    "click",
    () => {

      attempt++;

      startGame();
    }
  );


/* =========================
   START MENU CLICK
========================= */

mainMenu.addEventListener(
  "click",
  () => {

    playSound("start");

    vibrate(25);

    mainMenu.classList.add(
      "hidden"
    );

    startGame();
  }
);


/* =========================
   SIDE MENU
========================= */

function openMenu() {
  sideMenu.classList.add("open");

  menuOverlay.classList.add(
    "visible"
  );
}


function closeMenu() {
  sideMenu.classList.remove(
    "open"
  );

  menuOverlay.classList.remove(
    "visible"
  );
}


menuButton.addEventListener(
  "click",
  () => {

    vibrate(10);

    openMenu();
  }
);


menuOverlay.addEventListener(
  "click",
  closeMenu
);


/* =========================
   PLAYER HELPERS
========================= */

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

  const playerId =
    getPlayerId(player);

  if (playerId !== null) {

    return (
      String(playerId) ===
      String(telegramUser.id)
    );
  }

  return !!(
    player.username &&
    telegramUser.username &&
    player.username.toLowerCase() ===
    telegramUser.username.toLowerCase()
  );
}


/* =========================
   HTML ESCAPE
========================= */

function escapeHtml(value) {

  return String(value ?? "")
    .replaceAll(
      "&",
      "&amp;"
    )
    .replaceAll(
      "<",
      "&lt;"
    )
    .replaceAll(
      ">",
      "&gt;"
    )
    .replaceAll(
      '"',
      "&quot;"
    )
    .replaceAll(
      "'",
      "&#039;"
    );
}


/* =========================
   RATING STYLES
========================= */

function createRatingStyles() {

  if (
    document.getElementById(
      "dodici-rating-styles"
    )
  ) {
    return;
  }

  const style =
    document.createElement(
      "style"
    );

  style.id =
    "dodici-rating-styles";

  style.textContent = `
    .rating-modal {
      opacity: 0;
      visibility: hidden;
      pointer-events: none;
      transition: .25s;
    }

    .rating-modal.visible {
      opacity: 1;
      visibility: visible;
      pointer-events: auto;
    }

    .rating-window {
      width: min(470px, 100%);
      max-height: 88vh;
      overflow: hidden;
      border: 1px solid rgba(64,127,255,.42);
      border-radius: 28px;
      background: linear-gradient(
        145deg,
        #0a1b44,
        #040818
      );
      box-shadow: 0 30px 100px #000b;
      transform:
        translateY(20px)
        scale(.96);
      transition: .3s;
    }

    .rating-modal.visible
    .rating-window {
      transform:
        translateY(0)
        scale(1);
    }

    .rating-header {
      position: relative;
      padding: 23px 20px 18px;
      text-align: center;
      border-bottom:
        1px solid #436fc722;
    }

    .rating-icon {
      font-size: 36px;
    }

    .rating-title {
      color: #fff;
      font-size: 23px;
      font-weight: 1000;
      letter-spacing: .06em;
    }

    .rating-subtitle {
      margin-top: 5px;
      color: #6279a8;
      font-size: 9px;
      font-weight: 800;
      letter-spacing: .18em;
    }

    .rating-close {
      position: absolute;
      top: 12px;
      right: 13px;
      width: 38px;
      height: 38px;
      border: 1px solid #5b85e022;
      border-radius: 50%;
      background: #ffffff0d;
      color: #dce8ff;
      font-size: 23px;
    }

    .rating-list {
      max-height:
        calc(88vh - 150px);
      overflow-y: auto;
      padding: 12px;
    }

    .rating-row {
      display: grid;
      grid-template-columns:
        43px 1fr auto;
      align-items: center;
      gap: 10px;
      margin-bottom: 8px;
      padding: 11px;
      border: 1px solid #4373de22;
      border-radius: 16px;
      background: #11275485;
    }

    .rating-row.me {
      border-color: #ffd02c9e;
      background:
        linear-gradient(
          90deg,
          #ffc21f22,
          #1b2a5a6b
        );
    }

    .rating-place {
      text-align: center;
      font-size: 17px;
      font-weight: 950;
    }

    .rating-gold .rating-place {
      color: #ffd83b;
    }

    .rating-silver .rating-place {
      color: #dbe7ff;
    }

    .rating-bronze .rating-place {
      color: #e09358;
    }

    .rating-name-main {
      overflow: hidden;
      color: #fff;
      font-size: 13px;
      font-weight: 800;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .rating-level {
      margin-top: 3px;
      color: #5e75a2;
      font-size: 9px;
    }

    .rating-points {
      text-align: right;
      color: #fff;
      font-size: 14px;
      font-weight: 950;
    }

    .rating-points span {
      display: block;
      margin-top: 2px;
      color: #52698f;
      font-size: 8px;
    }

    .rating-empty {
      padding: 40px;
      text-align: center;
      color: #62749b;
    }
  `;

  document.head.appendChild(
    style
  );
}


/* =========================
   RATING MODAL
========================= */

function showRatingModal(
  rating
) {

  createRatingStyles();

  document
    .getElementById(
      "ratingModal"
    )
    ?.remove();

  const modal =
    document.createElement(
      "div"
    );

  modal.id =
    "ratingModal";

  modal.className =
    "rating-modal";

  const rows =
    rating
      .map(player => {

        const place =
          Number(
            player.place
          );

        const name =
          player.first_name ||
          player.username ||
          "Игрок";

        const bestLevel =
          player.best_level ?? 0;

        const points =
          player.points ?? 0;

        const me =
          isCurrentPlayer(
            player
          );

        let placeIcon =
          place;

        if (place === 1) {
          placeIcon = "🥇";
        }

        if (place === 2) {
          placeIcon = "🥈";
        }

        if (place === 3) {
          placeIcon = "🥉";
        }

        let placeClass = "";

        if (place === 1) {
          placeClass =
            "rating-gold";
        }

        if (place === 2) {
          placeClass =
            "rating-silver";
        }

        if (place === 3) {
          placeClass =
            "rating-bronze";
        }

        return `
          <div
            class="
              rating-row
              ${placeClass}
              ${me ? "me" : ""}
            "
          >

            <div class="rating-place">
              ${placeIcon}
            </div>

            <div class="rating-name">

              <div
                class="rating-name-main"
              >
                ${escapeHtml(name)}
              </div>

              <div
                class="rating-level"
              >
                Лучший уровень:
                ${escapeHtml(bestLevel)}
              </div>

            </div>

            <div
              class="rating-points"
            >
              ${escapeHtml(points)}

              <span>
                ОЧКОВ
              </span>
            </div>

          </div>
        `;
      })
      .join("");


  modal.innerHTML = `

    <div class="rating-window">

      <div class="rating-header">

        <button
          class="rating-close"
          id="ratingClose"
          type="button"
        >
          ×
        </button>

        <div class="rating-icon">
          🏆
        </div>

        <div class="rating-title">
          РЕЙТИНГ DODICI
        </div>

        <div class="rating-subtitle">
          Лучшие игроки
        </div>

      </div>

      <div class="rating-list">

        ${
          rows ||
          `
            <div class="rating-empty">
              🏆
              <br>
              <br>
              Рейтинг пока пуст
            </div>
          `
        }

      </div>

    </div>

  `;


  document.body.appendChild(
    modal
  );

  requestAnimationFrame(
    () => {
      modal.classList.add(
        "visible"
      );
    }
  );


  const closeRating =
    () => {

      modal.classList.remove(
        "visible"
      );

      setTimeout(
        () => {
          modal.remove();
        },
        300
      );
    };


  modal
    .querySelector(
      "#ratingClose"
    )
    .addEventListener(
      "click",
      closeRating
    );


  modal.addEventListener(
    "click",
    event => {

      if (
        event.target === modal
      ) {
        closeRating();
      }

    }
  );
}


/* =========================
   RATING BUTTON
========================= */

ratingButton.addEventListener(
  "click",
  async () => {

    closeMenu();

    try {

      ratingButton.disabled =
        true;

      const response =
        await fetch(
          `${API_URL}/rating`
        );

      const data =
        await response.json();

      if (!data.ok) {

        throw new Error(
          data.error ||
          "Не удалось загрузить рейтинг"
        );
      }

      showRatingModal(
        data.rating || []
      );

    } catch (error) {

      console.error(error);

      alert(
        "❌ Не удалось загрузить рейтинг"
      );

    } finally {

      ratingButton.disabled =
        false;
    }

  }
);


/* =========================
   PROFILE
========================= */

profileButton.addEventListener(
  "click",
  async () => {

    closeMenu();

    try {

      profileButton.disabled =
        true;

      const response =
        await fetch(
          `${API_URL}/player/profile`,
          {
            method: "GET",

            headers: {
              "X-Telegram-Init-Data":
                telegramInitData
            }
          }
        );

      const data =
        await response.json();

      if (!data.ok) {

        throw new Error(
          data.error ||
          "Не удалось загрузить профиль"
        );
      }

      const player =
        data.player;

      document
        .getElementById(
          "profileModal"
        )
        ?.remove();


      const modal =
        document.createElement(
          "div"
        );

      modal.id =
        "profileModal";

      modal.className =
        "profile-modal";


      modal.innerHTML = `

        <div class="profile-window">

          <button
            class="profile-close"
            id="profileClose"
            type="button"
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
            ${escapeHtml(
              player.first_name ||
              "Игрок"
            )}
          </div>

          <div class="profile-stats">

            <div class="profile-stat">

              <div class="profile-stat-icon">
                🎮
              </div>

              <div class="profile-stat-value">
                ${escapeHtml(
                  player.games_played
                )}
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
                ${escapeHtml(
                  player.wins
                )}
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
                ${escapeHtml(
                  player.losses
                )}
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

              ${escapeHtml(
                player.best_level
              )}

              <span>
                / 12
              </span>

            </div>

          </div>

        </div>

      `;


      document.body.appendChild(
        modal
      );


      requestAnimationFrame(
        () => {

          modal.classList.add(
            "visible"
          );

        }
      );


      const closeProfile =
        () => {

          modal.classList.remove(
            "visible"
          );

          setTimeout(
            () => {
              modal.remove();
            },
            300
          );
        };


      modal
        .querySelector(
          "#profileClose"
        )
        .addEventListener(
          "click",
          closeProfile
        );


      modal.addEventListener(
        "click",
        event => {

          if (
            event.target === modal
          ) {
            closeProfile();
          }

        }
      );


    } catch (error) {

      console.error(error);

      alert(
        "❌ Не удалось загрузить профиль"
      );

    } finally {

      profileButton.disabled =
        false;
    }

  }
);


/* =========================
   HOW TO PLAY
========================= */

howButton.addEventListener(
  "click",
  () => {

    closeMenu();

    alert(
      "❓ КАК ИГРАТЬ\n\n" +
      "Выбери одну из трёх карт.\n" +
      "Угадаешь — переходишь дальше.\n" +
      "Ошибёшься — игра заканчивается.\n\n" +
      "Пройди все 12 уровней!"
    );
  }
);


/* =========================
   SETTINGS
========================= */

settingsButton.addEventListener(
  "click",
  () => {

    closeMenu();

    document
      .getElementById(
        "settingsModal"
      )
      ?.remove();


    const modal =
      document.createElement(
        "div"
      );

    modal.id =
      "settingsModal";

    modal.className =
      "settings-modal";


    modal.innerHTML = `

      <div class="settings-window">

        <button
          class="settings-close"
          id="settingsClose"
          type="button"
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

              <span class="settings-row-icon">
                🔊
              </span>

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
              class="settings-toggle"
              id="soundToggle"
              type="button"
            >
              <span></span>
            </button>

          </div>


          <div class="settings-row">

            <div class="settings-row-left">

              <span class="settings-row-icon">
                📳
              </span>

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
              class="settings-toggle"
              id="vibrationToggle"
              type="button"
            >
              <span></span>
            </button>

          </div>


          <div class="settings-row">

            <div class="settings-row-left">

              <span class="settings-row-icon">
                🌙
              </span>

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


    document.body.appendChild(
      modal
    );


    requestAnimationFrame(
      () => {

        modal.classList.add(
          "visible"
        );

      }
    );


    const closeSettings =
      () => {

        modal.classList.remove(
          "visible"
        );

        setTimeout(
          () => {
            modal.remove();
          },
          300
        );
      };


    modal
      .querySelector(
        "#settingsClose"
      )
      .addEventListener(
        "click",
        closeSettings
      );


    modal.addEventListener(
      "click",
      event => {

        if (
          event.target === modal
        ) {
          closeSettings();
        }

      }
    );


    /* =====================
       SETTINGS STATE
    ===================== */

    const soundToggle =
      modal.querySelector(
        "#soundToggle"
      );

    const vibrationToggle =
      modal.querySelector(
        "#vibrationToggle"
      );


    const soundEnabled =
      localStorage.getItem(
        "dodici_sound"
      ) !== "off";


    const vibrationEnabled =
      localStorage.getItem(
        "dodici_vibration"
      ) !== "off";


    soundToggle.classList.toggle(
      "active",
      soundEnabled
    );


    vibrationToggle.classList.toggle(
      "active",
      vibrationEnabled
    );


    /* =====================
       SOUND TOGGLE
    ===================== */

    soundToggle.addEventListener(
      "click",
      () => {

        const enabled =
          soundToggle.classList.toggle(
            "active"
          );

        localStorage.setItem(
          "dodici_sound",
          enabled
            ? "on"
            : "off"
        );
      }
    );


    /* =====================
       VIBRATION TOGGLE
    ===================== */

    vibrationToggle.addEventListener(
      "click",
      () => {

        const enabled =
          vibrationToggle.classList.toggle(
            "active"
          );

        localStorage.setItem(
          "dodici_vibration",
          enabled
            ? "on"
            : "off"
        );
      }
    );

  }
);