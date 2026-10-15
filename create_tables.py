import asyncio

from backend.database import create_tables


async def main():
    await create_tables()
    print("Database tables created successfully!")


asyncio.run(main())