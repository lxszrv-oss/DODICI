from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import secrets
import uuid

app = FastAPI(title="DODICI API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://127.0.0.1:8080",
        "http://localhost:8080",
        "https://dans-assumption-reprints-avenue.trycloudflare.com",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class Choice(BaseModel):
    game_id: str
    level: int
    card: int


games = {}


@app.get("/health")
def health():
    return {
        "ok": True,
        "service": "DODICI"
    }


@app.post("/game/start")
def start_game():
    game_id = str(uuid.uuid4())

    games[game_id] = {
        "level": 1,
        "winning_cards": {
            1: secrets.randbelow(3)
        },
        "finished": False
    }

    return {
        "ok": True,
        "game_id": game_id,
        "level": 1
    }


@app.post("/game/choice")
def choice(data: Choice):
    game = games.get(data.game_id)

    if game is None:
        return {
            "ok": False,
            "error": "game_not_found"
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