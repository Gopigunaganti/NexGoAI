import unittest
from unittest.mock import AsyncMock, Mock, patch

from fastapi import FastAPI, Depends
from fastapi.testclient import TestClient

from backend.auth import require_user


class AuthenticationTests(unittest.TestCase):
    def setUp(self):
        app = FastAPI()

        @app.get('/private')
        async def private(user=Depends(require_user)):
            return {'user': user}

        self.client = TestClient(app)

    def tearDown(self):
        self.client.close()

    def test_missing_token_is_rejected(self):
        self.assertEqual(self.client.get('/private').status_code, 401)

    @patch.dict('os.environ', {'SUPABASE_URL': 'https://example.supabase.co', 'SUPABASE_PUBLISHABLE_KEY': 'public'})
    @patch('backend.auth.httpx.AsyncClient')
    def test_provider_rejection_is_rejected(self, client):
        client.return_value.__aenter__.return_value.get = AsyncMock(return_value=Mock(status_code=401))
        response = self.client.get('/private', headers={'Authorization': 'Bearer invalid'})
        self.assertEqual(response.status_code, 401)

    @patch.dict('os.environ', {'SUPABASE_URL': 'https://example.supabase.co', 'SUPABASE_PUBLISHABLE_KEY': 'public'})
    @patch('backend.auth.httpx.AsyncClient')
    def test_verified_identity_comes_from_provider(self, client):
        response = Mock(status_code=200)
        response.json.return_value = {'id': 'eb269a93-2c51-4795-b8ba-51c69313adef', 'email_confirmed_at': '2026-01-01'}
        client.return_value.__aenter__.return_value.get = AsyncMock(return_value=response)
        result = self.client.get('/private', headers={'Authorization': 'Bearer valid'})
        self.assertEqual(result.json()['user'], response.json.return_value['id'])
