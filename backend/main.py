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


app = FastAPI(title="DODICI API")


logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("dodici")


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


BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN")


class Choice(BaseModel):
    game_id: str
    level: int
    card: int


class TelegramAuth(BaseModel):
    init_data: str


games = {}


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

    # Telegram Mini App validation:
    # secret_key = HMAC-SHA256(key="WebAppData", message=bot_token)
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

    if not hmac.compare_digest(calculated_hash, received_hash):
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


@app.get("/health")
def health():
    return {
        "ok": True,
        "service": "DODICI"
    }


@app.post("/auth/telegram")
def telegram_auth(data: TelegramAuth):
    user, error = validate_telegram_init_data(data.init_data)

    if error:
        return {
            "ok": False,
            "error": error
        }

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


@app.post("/game/start")
def start_game(
    x_telegram_init_data: str | None = Header(default=None)
):
    logger.info(
        "POST /game/start received, initData_present=%s",
        bool(x_telegram_init_data)
    )

    if not x_telegram_init_data:
        logger.error("game/start rejected: Telegram initData missing")
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

    game_id = str(uuid.uuid4())

    games[game_id] = {
        "user_id": user.get("id"),
        "level": 1,
        "winning_cards": {
            1: secrets.randbelow(3)
        },
        "finished": False
    }

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

    game = games.get(data.game_id)

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

    if not correct:
        game["finished"] = True

        return {
            "ok": True,
            "correct": False,
            "level": data.level,
            "game_over": True
        }

    if data.level == 12:
        game["finished"] = True

        return {
            "ok": True,
            "correct": True,
            "level": 12,
            "game_over": True,
            "won": True
        }

    next_level = data.level + 1

    game["level"] = next_level
    game["winning_cards"][next_level] = secrets.randbelow(3)

    return {
        "ok": True,
        "correct": True,
        "level": next_level,
        "game_over": False
    }