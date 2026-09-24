from fastapi import FastAPI, Header
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import hashlib
import hmac
import json
import logging
import os
import secrets
import time
import uuid
from urllib.parse import parse_qsl

from sqlalchemy import create_engine, text


app = FastAPI(title="DODICI API")


# ============================================================
# DATABASE
# ============================================================

DATABASE_URL = os.getenv("DATABASE_URL")

engine = None

if DATABASE_URL:
    engine = create_engine(
        DATABASE_URL,
        pool_pre_ping=True
    )

    with engine.connect() as connection:
        connection.execute(text("SELECT 1"))

    with engine.begin() as connection:
        connection.execute(
            text(
                """
                CREATE TABLE IF NOT EXISTS games (
                    game_id VARCHAR(36) PRIMARY KEY,
                    user_id BIGINT NOT NULL,
                    level INTEGER NOT NULL DEFAULT 1,
                    winning_cards TEXT NOT NULL,
                    finished BOOLEAN NOT NULL DEFAULT FALSE,
                    won BOOLEAN NOT NULL DEFAULT FALSE,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
                """
            )
        )

        connection.execute(
            text(
                """
                CREATE TABLE IF NOT EXISTS players (
                    telegram_id BIGINT PRIMARY KEY,
                    username VARCHAR(255),
                    first_name VARCHAR(255),
                    games_played INTEGER NOT NULL DEFAULT 0,
                    wins INTEGER NOT NULL DEFAULT 0,
                    losses INTEGER NOT NULL DEFAULT 0,
                    best_level INTEGER NOT NULL DEFAULT 0,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
                """
            )
        )


# ============================================================
# LOGGING
# ============================================================

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("dodici")


# ============================================================
# CORS
# ============================================================

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://127.0.0.1:8080",
        "http://localhost:8080",
        "https://dodici-game.onrender.com",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ============================================================
# TELEGRAM
# ============================================================

BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN")


# ============================================================
# MODELS
# ============================================================

class Choice(BaseModel):
    game_id: str
    level: int
    card: int


class TelegramAuth(BaseModel):
    init_data: str


# ============================================================
# DATABASE HELPERS
# ============================================================

def require_database():
    if engine is None:
        logger.error("DATABASE_URL is not configured")
        return False

    return True


def ensure_player(user):
    """
    Creates the player if they don't exist.
    Updates Telegram username/name if they already exist.
    """

    if not require_database():
        return False

    telegram_id = user.get("id")
    username = user.get("username")
    first_name = user.get("first_name")

    with engine.begin() as connection:
        connection.execute(
            text(
                """
                INSERT INTO players (
                    telegram_id,
                    username,
                    first_name
                )
                VALUES (
                    :telegram_id,
                    :username,
                    :first_name
                )
                ON CONFLICT (telegram_id)
                DO UPDATE SET
                    username = EXCLUDED.username,
                    first_name = EXCLUDED.first_name,
                    updated_at = CURRENT_TIMESTAMP
                """
            ),
            {
                "telegram_id": telegram_id,
                "username": username,
                "first_name": first_name
            }
        )

    return True


def get_player(telegram_id):
    if not require_database():
        return None

    with engine.connect() as connection:
        result = connection.execute(
            text(
                """
                SELECT
                    telegram_id,
                    username,
                    first_name,
                    games_played,
                    wins,
                    losses,
                    best_level,
                    created_at,
                    updated_at
                FROM players
                WHERE telegram_id = :telegram_id
                """
            ),
            {
                "telegram_id": telegram_id
            }
        ).mappings().first()

    if result is None:
        return None

    return dict(result)


def get_game(game_id: str):
    if not require_database():
        return None

    with engine.connect() as connection:
        result = connection.execute(
            text(
                """
                SELECT
                    game_id,
                    user_id,
                    level,
                    winning_cards,
                    finished,
                    won
                FROM games
                WHERE game_id = :game_id
                """
            ),
            {
                "game_id": game_id
            }
        ).mappings().first()

    if result is None:
        return None

    try:
        winning_cards = json.loads(result["winning_cards"])
    except Exception:
        logger.exception(
            "Failed to decode winning_cards for game_id=%s",
            game_id
        )
        return None

    return {
        "game_id": result["game_id"],
        "user_id": result["user_id"],
        "level": result["level"],
        "winning_cards": {
            int(key): value
            for key, value in winning_cards.items()
        },
        "finished": result["finished"],
        "won": result["won"]
    }


def update_player_after_game(
    telegram_id,
    won,
    level
):
    """
    Updates player statistics after a finished game.
    """

    if not require_database():
        return

    with engine.begin() as connection:
        connection.execute(
            text(
                """
                UPDATE players
                SET
                    games_played = games_played + 1,
                    wins = wins + :wins,
                    losses = losses + :losses,
                    best_level = GREATEST(best_level, :level),
                    updated_at = CURRENT_TIMESTAMP
                WHERE telegram_id = :telegram_id
                """
            ),
            {
                "telegram_id": telegram_id,
                "wins": 1 if won else 0,
                "losses": 0 if won else 1,
                "level": level
            }
        )


# ============================================================
# TELEGRAM AUTH VALIDATION
# ============================================================

def validate_telegram_init_data(init_data: str):
    if not BOT_TOKEN:
        logger.error("TELEGRAM_BOT_TOKEN is not configured")
        return None, "telegram_token_not_configured"

    if not init_data:
        logger.error("Telegram initData is empty")
        return None, "telegram_init_data_empty"

    try:
        parsed = dict(parse_qsl(init_data, keep_blank_values=True))
    except Exception:
        logger.exception("Failed to parse Telegram initData")
        return None, "invalid_init_data"

    received_hash = parsed.pop("hash", None)

    if not received_hash:
        logger.error("Telegram initData hash is missing")
        return None, "hash_missing"

    auth_date = parsed.get("auth_date")

    if not auth_date:
        logger.error("Telegram auth_date is missing")
        return None, "auth_date_missing"

    try:
        auth_timestamp = int(auth_date)
    except ValueError:
        logger.error("Telegram auth_date is invalid")
        return None, "invalid_auth_date"

    if abs(time.time() - auth_timestamp) > 86400:
        logger.error("Telegram initData is expired")
        return None, "init_data_expired"

    data_check_string = "\n".join(
        f"{key}={value}"
        for key, value in sorted(parsed.items())
    )

    secret_key = hmac.new(
        b"WebAppData",
        BOT_TOKEN.encode(),
        hashlib.sha256
    ).digest()

    calculated_hash = hmac.new(
        secret_key,
        data_check_string.encode(),
        hashlib.sha256
    ).hexdigest()

    if not hmac.compare_digest(
        calculated_hash,
        received_hash
    ):
        logger.error("Telegram initData signature is invalid")
        return None, "invalid_telegram_signature"

    user_raw = parsed.get("user")

    if not user_raw:
        logger.error("Telegram user is missing")
        return None, "telegram_user_missing"

    try:
        user = json.loads(user_raw)
    except json.JSONDecodeError:
        logger.exception("Telegram user JSON is invalid")
        return None, "invalid_telegram_user"

    if not user.get("id"):
        logger.error("Telegram user ID is missing")
        return None, "telegram_user_id_missing"

    logger.info(
        "Telegram user authenticated: id=%s username=%s",
        user.get("id"),
        user.get("username")
    )

    return user, None


# ============================================================
# HEALTH
# ============================================================

@app.get("/health")
def health():
    database_ok = False

    if engine is not None:
        try:
            with engine.connect() as connection:
                connection.execute(text("SELECT 1"))
            database_ok = True
        except Exception:
            logger.exception("Database health check failed")

    return {
        "ok": True,
        "service": "DODICI",
        "database": database_ok
    }


# ============================================================
# TELEGRAM AUTH
# ============================================================

@app.post("/auth/telegram")
def telegram_auth(data: TelegramAuth):
    user, error = validate_telegram_init_data(
        data.init_data
    )

    if error:
        return {
            "ok": False,
            "error": error
        }

    ensure_player(user)

    return {
        "ok": True,
        "user": {
            "id": user.get("id"),
            "first_name": user.get("first_name"),
            "last_name": user.get("last_name"),
            "username": user.get("username"),
            "photo_url": user.get("photo_url")
        }
    }


# ============================================================
# PLAYER PROFILE
# ============================================================

@app.get("/player/profile")
def player_profile(
    x_telegram_init_data: str | None = Header(default=None)
):
    if not x_telegram_init_data:
        return {
            "ok": False,
            "error": "telegram_auth_required"
        }

    user, error = validate_telegram_init_data(
        x_telegram_init_data
    )

    if error:
        return {
            "ok": False,
            "error": error
        }

    if not require_database():
        return {
            "ok": False,
            "error": "database_not_configured"
        }

    ensure_player(user)

    player = get_player(
        user.get("id")
    )

    if player is None:
        return {
            "ok": False,
            "error": "player_not_found"
        }

    return {
        "ok": True,
        "player": {
            "telegram_id": player["telegram_id"],
            "username": player["username"],
            "first_name": player["first_name"],
            "games_played": player["games_played"],
            "wins": player["wins"],
            "losses": player["losses"],
            "best_level": player["best_level"]
        }
    }


# ============================================================
# START GAME
# ============================================================

@app.post("/game/start")
def start_game(
    x_telegram_init_data: str | None = Header(default=None)
):
    logger.info(
        "POST /game/start received, initData_present=%s",
        bool(x_telegram_init_data)
    )

    if not x_telegram_init_data:
        logger.error(
            "game/start rejected: Telegram initData missing"
        )

        return {
            "ok": False,
            "error": "telegram_auth_required"
        }

    user, error = validate_telegram_init_data(
        x_telegram_init_data
    )

    if error:
        logger.error(
            "game/start rejected: %s",
            error
        )

        return {
            "ok": False,
            "error": error
        }

    if not require_database():
        return {
            "ok": False,
            "error": "database_not_configured"
        }

    ensure_player(user)

    game_id = str(uuid.uuid4())

    winning_cards = {
        1: secrets.randbelow(3)
    }

    with engine.begin() as connection:
        connection.execute(
            text(
                """
                INSERT INTO games (
                    game_id,
                    user_id,
                    level,
                    winning_cards,
                    finished,
                    won
                )
                VALUES (
                    :game_id,
                    :user_id,
                    :level,
                    :winning_cards,
                    :finished,
                    :won
                )
                """
            ),
            {
                "game_id": game_id,
                "user_id": user.get("id"),
                "level": 1,
                "winning_cards": json.dumps(winning_cards),
                "finished": False,
                "won": False
            }
        )

    logger.info(
        "Game started: game_id=%s user_id=%s",
        game_id,
        user.get("id")
    )

    return {
        "ok": True,
        "game_id": game_id,
        "level": 1,
        "user": {
            "id": user.get("id"),
            "first_name": user.get("first_name"),
            "username": user.get("username")
        }
    }


# ============================================================
# GAME CHOICE
# ============================================================

@app.post("/game/choice")
def choice(
    data: Choice,
    x_telegram_init_data: str | None = Header(default=None)
):
    logger.info(
        "POST /game/choice received, game_id=%s level=%s card=%s",
        data.game_id,
        data.level,
        data.card
    )

    if not x_telegram_init_data:
        return {
            "ok": False,
            "error": "telegram_auth_required"
        }

    user, error = validate_telegram_init_data(
        x_telegram_init_data
    )

    if error:
        return {
            "ok": False,
            "error": error
        }

    if not require_database():
        return {
            "ok": False,
            "error": "database_not_configured"
        }

    ensure_player(user)

    game = get_game(data.game_id)

    if game is None:
        return {
            "ok": False,
            "error": "game_not_found"
        }

    if game["user_id"] != user.get("id"):
        return {
            "ok": False,
            "error": "game_user_mismatch"
        }

    if not 1 <= data.level <= 12 or not 0 <= data.card <= 2:
        return {
            "ok": False,
            "error": "invalid_input"
        }

    if game["finished"]:
        return {
            "ok": False,
            "error": "game_finished"
        }

    if data.level != game["level"]:
        return {
            "ok": False,
            "error": "wrong_level"
        }

    winning_card = game["winning_cards"].get(data.level)

    if winning_card is None:
        return {
            "ok": False,
            "error": "game_state_error"
        }

    correct = data.card == winning_card

    # --------------------------------------------------------
    # WRONG CARD
    # --------------------------------------------------------

    if not correct:
        with engine.begin() as connection:
            connection.execute(
                text(
                    """
                    UPDATE games
                    SET finished = TRUE,
                        won = FALSE
                    WHERE game_id = :game_id
                    """
                ),
                {
                    "game_id": data.game_id
                }
            )

        update_player_after_game(
            telegram_id=user.get("id"),
            won=False,
            level=data.level
        )

        return {
            "ok": True,
            "correct": False,
            "level": data.level,
            "game_over": True
        }

    # --------------------------------------------------------
    # FINAL LEVEL
    # --------------------------------------------------------

    if data.level == 12:
        with engine.begin() as connection:
            connection.execute(
                text(
                    """
                    UPDATE games
                    SET finished = TRUE,
                        won = TRUE
                    WHERE game_id = :game_id
                    """
                ),
                {
                    "game_id": data.game_id
                }
            )

        update_player_after_game(
            telegram_id=user.get("id"),
            won=True,
            level=12
        )

        return {
            "ok": True,
            "correct": True,
            "level": 12,
            "game_over": True,
            "won": True
        }

    # --------------------------------------------------------
    # NEXT LEVEL
    # --------------------------------------------------------

    next_level = data.level + 1
    next_winning_card = secrets.randbelow(3)

    game["winning_cards"][next_level] = next_winning_card

    with engine.begin() as connection:
        connection.execute(
            text(
                """
                UPDATE games
                SET level = :level,
                    winning_cards = :winning_cards
                WHERE game_id = :game_id
                """
            ),
            {
                "game_id": data.game_id,
                "level": next_level,
                "winning_cards": json.dumps(
                    game["winning_cards"]
                )
            }
        )

    return {
        "ok": True,
        "correct": True,
        "level": next_level,
        "game_over": False
    }

