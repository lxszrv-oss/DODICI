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


# =========================
# DATABASE
# =========================

DATABASE_URL = os.getenv("DATABASE_URL")

if not DATABASE_URL:
    raise RuntimeError("DATABASE_URL is not set")

if DATABASE_URL.startswith("postgresql://"):
    DATABASE_URL = DATABASE_URL.replace(
        "postgresql://",
        "postgresql+psycopg://",
        1,
    )

if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace(
        "postgres://",
        "postgresql+psycopg://",
        1,
    )

engine = create_engine(
    DATABASE_URL,
    pool_pre_ping=True,
)


with engine.begin() as connection:

    connection.execute(
        text("SELECT 1")
    )

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
                points INTEGER NOT NULL DEFAULT 0,
                best_level INTEGER NOT NULL DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
    )

    connection.execute(
        text(
            """
            ALTER TABLE players
            ADD COLUMN IF NOT EXISTS points INTEGER NOT NULL DEFAULT 0
            """
        )
    )


# =========================
# APP
# =========================

logging.basicConfig(
    level=logging.INFO
)

app = FastAPI(
    title="DODICI"
)


app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


# =========================
# TELEGRAM
# =========================

BOT_TOKEN = os.getenv(
    "TELEGRAM_BOT_TOKEN"
)

if not BOT_TOKEN:
    raise RuntimeError(
        "TELEGRAM_BOT_TOKEN is not set"
    )


# =========================
# MODELS
# =========================

class Choice(BaseModel):
    game_id: str
    card: str
    level: int


class TelegramAuth(BaseModel):
    init_data: str


# =========================
# DATABASE HELPERS
# =========================

def require_database():

    if not DATABASE_URL:
        raise RuntimeError(
            "Database is not configured"
        )


def ensure_player(user):

    require_database()

    telegram_id = user.get("id")

    if not telegram_id:
        raise ValueError(
            "Telegram user id is missing"
        )

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
                "first_name": first_name,
            },
        )


def get_player(telegram_id):

    require_database()

    with engine.begin() as connection:

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
                    points,
                    best_level,
                    created_at,
                    updated_at
                FROM players
                WHERE telegram_id = :telegram_id
                """
            ),
            {
                "telegram_id": telegram_id
            },
        ).mappings().first()

    return result


def update_player_after_game(
    telegram_id,
    won,
    level
):

    require_database()

    with engine.begin() as connection:

        connection.execute(
            text(
                """
                UPDATE players
                SET
                    games_played = games_played + 1,
                    wins = wins + :wins,
                    losses = losses + :losses,
                    best_level = GREATEST(
                        best_level,
                        :level
                    ),
                    updated_at = CURRENT_TIMESTAMP
                WHERE telegram_id = :telegram_id
                """
            ),
            {
                "telegram_id": telegram_id,
                "wins": 1 if won else 0,
                "losses": 0 if won else 1,
                "level": level,
            },
        )


def get_game(game_id):

    require_database()

    with engine.begin() as connection:

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
            },
        ).mappings().first()

    return result


# =========================
# TELEGRAM AUTH
# =========================

def validate_telegram_init_data(
    init_data: str
):

    if not init_data:
        raise ValueError(
            "Telegram init data is missing"
        )

    parsed = dict(
        parse_qsl(
            init_data,
            keep_blank_values=True
        )
    )

    received_hash = parsed.pop(
        "hash",
        None
    )

    if not received_hash:
        raise ValueError(
            "Telegram hash is missing"
        )

    data_check_string = "\n".join(
        f"{key}={value}"
        for key, value in sorted(
            parsed.items()
        )
    )

    secret_key = hmac.new(
        b"WebAppData",
        BOT_TOKEN.encode(),
        hashlib.sha256,
    ).digest()

    calculated_hash = hmac.new(
        secret_key,
        data_check_string.encode(),
        hashlib.sha256,
    ).hexdigest()

    if not hmac.compare_digest(
        calculated_hash,
        received_hash
    ):
        raise ValueError(
            "Invalid Telegram init data"
        )

    auth_date = parsed.get(
        "auth_date"
    )

    if auth_date:

        try:

            auth_time = int(
                auth_date
            )

            if time.time() - auth_time > 86400:
                raise ValueError(
                    "Telegram auth data expired"
                )

        except ValueError:

            raise ValueError(
                "Invalid auth_date"
            )

    user_json = parsed.get(
        "user"
    )

    if not user_json:
        raise ValueError(
            "Telegram user data missing"
        )

    try:

        user = json.loads(
            user_json
        )

    except json.JSONDecodeError:

        raise ValueError(
            "Invalid Telegram user JSON"
        )

    if not user.get("id"):
        raise ValueError(
            "Telegram user id missing"
        )

    return user


# =========================
# HEALTH
# =========================

@app.get("/health")
def health():

    database_ok = False

    try:

        with engine.begin() as connection:

            connection.execute(
                text("SELECT 1")
            )

        database_ok = True

    except Exception:

        database_ok = False

    return {
        "ok": True,
        "service": "DODICI",
        "database": database_ok,
    }


# =========================
# TELEGRAM AUTH
# =========================

@app.post("/auth/telegram")
def auth_telegram(
    payload: TelegramAuth
):

    try:

        user = validate_telegram_init_data(
            payload.init_data
        )

        ensure_player(
            user
        )

        return {
            "ok": True,
            "user": {
                "id": user.get("id"),
                "username": user.get("username"),
                "first_name": user.get("first_name"),
            },
        }

    except Exception as error:

        logging.exception(
            "Telegram auth failed"
        )

        return {
            "ok": False,
            "error": str(error),
        }


# =========================
# PLAYER PROFILE
# =========================

@app.get("/player/profile")
def player_profile(
    x_telegram_init_data: str = Header(
        default=""
    )
):

    try:

        user = validate_telegram_init_data(
            x_telegram_init_data
        )

        ensure_player(
            user
        )

        player = get_player(
            user.get("id")
        )

        if not player:

            return {
                "ok": False,
                "error": "Player not found",
            }

        return {
            "ok": True,
            "player": {
                "telegram_id": player[
                    "telegram_id"
                ],
                "username": player[
                    "username"
                ],
                "first_name": player[
                    "first_name"
                ],
                "games_played": player[
                    "games_played"
                ],
                "wins": player[
                    "wins"
                ],
                "losses": player[
                    "losses"
                ],
                "points": player[
                    "points"
                ],
                "best_level": player[
                    "best_level"
                ],
            },
        }

    except Exception as error:

        logging.exception(
            "Profile request failed"
        )

        return {
            "ok": False,
            "error": str(error),
        }


# =========================
# START GAME
# =========================

@app.post("/game/start")
def start_game(
    x_telegram_init_data: str = Header(
        default=""
    )
):

    try:

        user = validate_telegram_init_data(
            x_telegram_init_data
        )

        ensure_player(
            user
        )

        game_id = str(
            uuid.uuid4()
        )

        winning_card = secrets.choice(
            [
                "A",
                "2",
                "3",
                "4",
                "5",
                "6",
                "7",
                "8",
                "9",
                "10",
                "J",
                "Q",
                "K",
            ]
        )

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
                        1,
                        :winning_cards,
                        FALSE,
                        FALSE
                    )
                    """
                ),
                {
                    "game_id": game_id,
                    "user_id": user.get("id"),
                    "winning_cards": winning_card,
                },
            )

        return {
            "ok": True,
            "game_id": game_id,
            "level": 1,
            "winning_card": winning_card,
        }

    except Exception as error:

        logging.exception(
            "Game start failed"
        )

        return {
            "ok": False,
            "error": str(error),
        }


# =========================
# GAME CHOICE
# =========================

@app.post("/game/choice")
def game_choice(
    payload: Choice,
    x_telegram_init_data: str = Header(
        default=""
    )
):

    try:

        user = validate_telegram_init_data(
            x_telegram_init_data
        )

        game = get_game(
            payload.game_id
        )

        if not game:

            return {
                "ok": False,
                "error": "Game not found",
            }

        if game["user_id"] != user.get("id"):

            return {
                "ok": False,
                "error": "This game belongs to another player",
            }

        if game["finished"]:

            return {
                "ok": False,
                "error": "Game already finished",
            }

        if payload.level != game["level"]:

            return {
                "ok": False,
                "error": "Wrong level",
            }

        winning_card = game[
            "winning_cards"
        ]

        correct = (
            payload.card == winning_card
        )

        # =========================
        # WRONG CARD
        # =========================

        if not correct:

            with engine.begin() as connection:

                connection.execute(
                    text(
                        """
                        UPDATE games
                        SET
                            finished = TRUE,
                            won = FALSE
                        WHERE game_id = :game_id
                        """
                    ),
                    {
                        "game_id": payload.game_id
                    },
                )

            update_player_after_game(
                user.get("id"),
                won=False,
                level=payload.level,
            )

            return {
                "ok": True,
                "correct": False,
                "game_over": True,
                "won": False,
                "level": payload.level,
            }

        # =========================
        # CORRECT CARD = +1 POINT
        # =========================

        with engine.begin() as connection:

    connection.execute(
        text(
            """
            UPDATE players
            SET
                points = points + :points_added,
                updated_at = CURRENT_TIMESTAMP
            WHERE telegram_id = :telegram_id
            """
        ),
        {
            "telegram_id": user.get("id"),
            "points_added": payload.level,
        },
    )

        # =========================
        # FINAL LEVEL
        # =========================

        if payload.level >= 12:

            with engine.begin() as connection:

                connection.execute(
                    text(
                        """
                        UPDATE games
                        SET
                            finished = TRUE,
                            won = TRUE
                        WHERE game_id = :game_id
                        """
                    ),
                    {
                        "game_id": payload.game_id
                    },
                )

            update_player_after_game(
                user.get("id"),
                won=True,
                level=12,
            )

            return {
                "ok": True,
                "correct": True,
                "game_over": True,
                "won": True,
                "level": 12,
                "points_added": 1,
            }

        # =========================
        # NEXT LEVEL
        # =========================

        next_level = (
            payload.level + 1
        )

        next_winning_card = secrets.choice(
            [
                "A",
                "2",
                "3",
                "4",
                "5",
                "6",
                "7",
                "8",
                "9",
                "10",
                "J",
                "Q",
                "K",
            ]
        )

        with engine.begin() as connection:

            connection.execute(
                text(
                    """
                    UPDATE games
                    SET
                        level = :level,
                        winning_cards = :winning_cards
                    WHERE game_id = :game_id
                    """
                ),
                {
                    "game_id": payload.game_id,
                    "level": next_level,
                    "winning_cards": next_winning_card,
                },
            )

        return {
            "ok": True,
            "correct": True,
            "game_over": False,
            "won": False,
            "level": next_level,
            "points_added": 1,
        }

    except Exception as error:

        logging.exception(
            "Game choice failed"
        )

        return {
            "ok": False,
            "error": str(error),
        }


# =========================

# RATING

@app.get("/rating")
def rating():
    try:
        with engine.begin() as connection:
            result = connection.execute(
                text("""
                    SELECT telegram_id, username, first_name, points, best_level
                    FROM players
                    ORDER BY points DESC, best_level DESC
                    LIMIT 100
                """)
            )

            players = []

            for index, row in enumerate(result, start=1):
                players.append({
                    "place": index,
                    "telegram_id": row.telegram_id,
                    "username": row.username,
                    "first_name": row.first_name,
                    "points": row.points,
                    "best_level": row.best_level,
                })

        return {
            "ok": True,
            "rating": players
        }

    except Exception as error:
        logging.exception("Rating request failed")

        return {
            "ok": False,
            "error": str(error)
        }

# RUN
# =========================

if __name__ == "__main__":

    import uvicorn

    uvicorn.run(
        "backend.main:app",
        host="0.0.0.0",
        port=int(
            os.getenv(
                "PORT",
                "8000"
            )
        ),
    )