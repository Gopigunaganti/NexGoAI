import os
from backend.models import Base
from dotenv import load_dotenv
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy import text

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")

if not DATABASE_URL:
    raise RuntimeError("DATABASE_URL is missing from your .env file")

engine = create_async_engine(
    DATABASE_URL,
    echo=False,
    pool_pre_ping=True,
)

async def create_tables():
    async with engine.begin() as connection:
        await connection.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
        await connection.run_sync(Base.metadata.create_all)
        # Existing anonymous records stay unassigned until explicitly migrated.
        for table in ("conversations", "documents"):
            await connection.execute(text(
                f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS owner_id VARCHAR(100)"
            ))
            await connection.execute(text(
                f"CREATE INDEX IF NOT EXISTS ix_{table}_owner_id ON {table} (owner_id)"
            ))
async def test_database_connection():
    async with engine.connect() as connection:
        result = await connection.execute(text("SELECT version()"))
        return result.scalar()
