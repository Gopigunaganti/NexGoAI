import os
import unittest
from unittest.mock import AsyncMock, Mock, call

os.environ.setdefault("GROQ_API_KEY", "test-key")

from fastapi.testclient import TestClient

from backend.auth import require_user
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
        app.dependency_overrides[require_user] = lambda: "test-user"
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
        self.assertIn("conversations.owner_id =", str(self.db.execute.await_args.args[0]))
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

    def test_foreign_conversation_cannot_be_read_or_deleted(self):
        self.db.get = AsyncMock(return_value=Mock(owner_id='another-user'))
        for method in (self.client.get, self.client.delete):
            response = method('/api/v1/conversations/foreign-id')
            self.assertEqual(response.status_code, 404)
        self.db.delete.assert_not_awaited()

    def test_foreign_document_cannot_be_deleted(self):
        self.db.get = AsyncMock(return_value=Mock(owner_id='another-user'))
        response = self.client.delete('/api/v1/documents/foreign-id')
        self.assertEqual(response.status_code, 404)
        self.db.delete.assert_not_awaited()

    def test_foreign_chat_cannot_be_used_for_generation(self):
        self.db.get = AsyncMock(return_value=Mock(owner_id='another-user'))
        for endpoint in ('/api/v1/chat', '/api/v1/chat/stream'):
            response = self.client.post(endpoint, json={'message': 'Hello', 'conversation_id': 'foreign-id'})
            self.assertEqual(response.status_code, 404)

    def test_foreign_document_cannot_be_retrieved(self):
        self.db.execute.return_value.scalars.return_value.all.return_value = []
        for endpoint in ('/api/v1/chat', '/api/v1/chat/stream'):
            response = self.client.post(endpoint, json={'message': 'Hello', 'document_ids': ['foreign-id']})
            self.assertEqual(response.status_code, 404)
