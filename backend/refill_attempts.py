from sqlalchemy import text

from main import engine


with engine.begin() as connection:
    result = connection.execute(
        text(
            """
            UPDATE players
            SET
                attempts = attempts + 5,
                updated_at = CURRENT_TIMESTAMP
            """
        )
    )

    print(
        f"Added 5 attempts to {result.rowcount} players"
    )