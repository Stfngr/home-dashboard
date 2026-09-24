from contextlib import asynccontextmanager, closing
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import secrets
import sqlite3
from typing import Annotated, Any

from fastapi import Depends, FastAPI, HTTPException, Path as PathParam, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, field_validator

NAME = r"^[a-z0-9][a-z0-9-]{0,63}$"
Name = Annotated[str, PathParam(pattern=NAME)]


class Update(BaseModel):
    model_config = ConfigDict(extra="forbid")
    updated_at: AwareDatetime
    payload: dict[str, Any]

    @field_validator("payload")
    @classmethod
    def valid_json(cls, value):
        if len(json.dumps(value, allow_nan=False).encode()) > 256_000:
            raise ValueError("Payload too large")
        return value


class Recipe(BaseModel):
    model_config = ConfigDict(extra="allow", strict=True)
    id: int = Field(gt=0)
    title: str = Field(min_length=1)
    ingredients: list[str] = Field(min_length=1)
    instructions: list[str] = Field(min_length=1)
    image_url: str = ""
    source_url: str = ""

    @field_validator("ingredients", "instructions")
    @classmethod
    def nonempty_items(cls, values):
        if any(not value.strip() for value in values):
            raise ValueError("Empty recipe text")
        return values


class RecipePayload(BaseModel):
    date: str
    automatic: bool = Field(default=False, strict=True)
    recipe: Recipe

    @field_validator("date")
    @classmethod
    def valid_date(cls, value):
        from datetime import date
        date.fromisoformat(value)
        return value


class ResidentTasks(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    id: str = Field(min_length=1)
    name: str = Field(min_length=1)
    off_day: bool
    tasks: list[str]

    @field_validator("id", "name")
    @classmethod
    def nonempty_text(cls, value):
        if not value.strip():
            raise ValueError("Empty resident text")
        return value

    @field_validator("tasks")
    @classmethod
    def nonempty_tasks(cls, values):
        if any(not value.strip() for value in values):
            raise ValueError("Empty task")
        return values

    def model_post_init(self, __context):
        if self.off_day and self.tasks:
            raise ValueError("Days off cannot have tasks")


class HouseholdTasksPayload(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    date: str
    residents: list[ResidentTasks] = Field(min_length=1)

    @field_validator("date")
    @classmethod
    def valid_date(cls, value):
        from datetime import date
        date.fromisoformat(value)
        return value

    @field_validator("residents")
    @classmethod
    def unique_resident_ids(cls, values):
        if len({resident.id for resident in values}) != len(values):
            raise ValueError("Duplicate resident id")
        return values


def create_app(database: Path | None = None, tokens: dict[str, str] | None = None):
    database = database or Path(os.environ.get("HOME_DASHBOARD_DB", "/data/dashboard.sqlite"))

    @asynccontextmanager
    async def lifespan(app):
        configured = tokens
        if configured is None:
            configured = json.loads(os.environ.get("HOME_DASHBOARD_TOKENS", "{}"))
        if not isinstance(configured, dict) or not configured or any(
            not re.fullmatch(NAME, source) or not isinstance(token, str) or len(token) < 32
            or not token.isascii() or any(char.isspace() for char in token)
            for source, token in configured.items()
        ) or len(set(configured.values())) != len(configured):
            raise ValueError("Configure unique tokens of at least 32 characters per source")
        app.state.tokens = dict(configured)
        database.parent.mkdir(parents=True, exist_ok=True)
        with closing(sqlite3.connect(database)) as connection:
            connection.execute("PRAGMA journal_mode=WAL")
            connection.execute("""CREATE TABLE IF NOT EXISTS states (
                source TEXT NOT NULL, key TEXT NOT NULL, updated_at TEXT NOT NULL,
                payload TEXT NOT NULL, PRIMARY KEY (source, key))""")
            connection.commit()
        yield

    app = FastAPI(title="Home Dashboard", lifespan=lifespan, docs_url=None, redoc_url=None)
    bearer = HTTPBearer(auto_error=False)

    def authorize(source: Name, credentials: Annotated[
        HTTPAuthorizationCredentials | None, Depends(bearer)
    ]):
        if credentials is None:
            raise HTTPException(401, "Bearer token required", headers={"WWW-Authenticate": "Bearer"})
        supplied = credentials.credentials.encode()
        owner = next((name for name, token in app.state.tokens.items()
                      if secrets.compare_digest(token.encode(), supplied)), None)
        if owner is None:
            raise HTTPException(401, "Invalid token", headers={"WWW-Authenticate": "Bearer"})
        if owner != source:
            raise HTTPException(403, "Token cannot write this source")

    @app.exception_handler(RequestValidationError)
    async def invalid_request(request, error):
        return JSONResponse(status_code=400, content={"detail": "Invalid request"})

    @app.get("/health")
    def health():
        with closing(sqlite3.connect(database)) as connection:
            connection.execute("SELECT 1 FROM states LIMIT 1")
        return {"status": "ok"}

    @app.put("/api/v1/state/{source}/{key}", dependencies=[Depends(authorize)])
    def put_state(source: Name, key: Name, update: Update):
        if (source, key) == ("recipe-bot", "current-recipe"):
            try:
                RecipePayload.model_validate(update.payload)
            except ValueError:
                raise HTTPException(400, "Invalid recipe payload") from None
        elif (source, key) == ("household-agent", "current-tasks"):
            try:
                HouseholdTasksPayload.model_validate(update.payload)
            except ValueError:
                raise HTTPException(400, "Invalid household tasks payload") from None
        timestamp = update.updated_at.astimezone(timezone.utc).isoformat(timespec="microseconds")
        payload = json.dumps(update.payload, allow_nan=False, ensure_ascii=True)
        with closing(sqlite3.connect(database, timeout=10)) as connection, connection:
            cursor = connection.execute("""INSERT INTO states VALUES (?, ?, ?, ?)
                ON CONFLICT(source, key) DO UPDATE SET
                updated_at=excluded.updated_at, payload=excluded.payload
                WHERE excluded.updated_at > states.updated_at""", (source, key, timestamp, payload))
            applied = cursor.rowcount == 1
        # Equal and older updates are acknowledged, allowing an outbox to retire retries.
        return {"applied": applied}

    @app.get("/api/v1/state/{source}/{key}")
    def get_state(source: Name, key: Name, response: Response):
        with closing(sqlite3.connect(database, timeout=10)) as connection:
            row = connection.execute("SELECT updated_at, payload FROM states WHERE source=? AND key=?",
                                     (source, key)).fetchone()
        if row is None:
            raise HTTPException(404, "No state yet")
        response.headers["Cache-Control"] = "no-store"
        return {"source": source, "key": key, "updated_at": row[0], "payload": json.loads(row[1])}

    return app
