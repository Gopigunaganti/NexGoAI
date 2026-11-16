import os
import unittest
from unittest.mock import AsyncMock, Mock, call

os.environ.setdefault("GROQ_API_KEY", "test-key")

from fastapi.testclient import TestClient

from backend.db_session import get_db
from backend.main import app


class ClearConversationsTests(unittest.TestCase):
    def setUp(self):
        self.conversations = [object(), object()]
        result = Mock()
        result.scalars.return_value.all.return_value = self.conversations

        self.db = Mock()
        self.db.execute = AsyncMock(return_value=result)
        self.db.delete = AsyncMock()
        self.db.commit = AsyncMock()
        self.db.rollback = AsyncMock()

        async def override_get_db():
            yield self.db

        app.dependency_overrides[get_db] = override_get_db
        self.client = TestClient(app)

    def tearDown(self):
        app.dependency_overrides.clear()
        self.client.close()

    def test_deletes_every_conversation_and_commits_once(self):
        response = self.client.delete("/api/v1/conversations")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["deleted_count"], 2)
        self.assertEqual(
            self.db.delete.await_args_list,
            [call(self.conversations[0]), call(self.conversations[1])],
        )
        self.db.commit.assert_awaited_once()
        self.db.rollback.assert_not_awaited()

    def test_empty_collection_is_idempotent(self):
        self.db.execute.return_value.scalars.return_value.all.return_value = []

        response = self.client.delete("/api/v1/conversations")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["deleted_count"], 0)
        self.db.delete.assert_not_awaited()
        self.db.commit.assert_awaited_once()

    def test_database_failure_rolls_back_and_returns_service_unavailable(self):
        self.db.commit.side_effect = RuntimeError("database unavailable")

        response = self.client.delete("/api/v1/conversations")

        self.assertEqual(response.status_code, 503)
        self.db.rollback.assert_awaited_once()
