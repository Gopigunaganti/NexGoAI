import asyncio

from backend.database import test_database_connection


async def main():
    version = await test_database_connection()
    print("Database connected successfully!")
    print(version)


asyncio.run(main())
