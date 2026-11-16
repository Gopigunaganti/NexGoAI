"""Validate access tokens with the configured identity provider."""
import os
from uuid import UUID

import httpx
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

bearer = HTTPBearer(auto_error=False)


async def require_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer),
) -> str:
    if credentials is None:
        raise HTTPException(status_code=401, detail="Sign in to continue.")
    url = os.getenv("SUPABASE_URL", "").rstrip("/")
    key = os.getenv("SUPABASE_PUBLISHABLE_KEY", "")
    if not url.startswith("https://") or not key:
        raise HTTPException(status_code=503, detail="Authentication is not configured.")
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.get(
                f"{url}/auth/v1/user",
                headers={"apikey": key, "Authorization": f"Bearer {credentials.credentials}"},
            )
    except httpx.RequestError as exc:
        raise HTTPException(status_code=503, detail="Sign-in service is unavailable.") from exc
    if response.status_code in (401, 403):
        raise HTTPException(status_code=401, detail="Your session expired. Sign in again.")
    if response.status_code != 200:
        raise HTTPException(status_code=503, detail="Sign-in service is unavailable.")
    try:
        user = response.json()
        if not (user.get("email_confirmed_at") or user.get("phone_confirmed_at")):
            raise ValueError("Unverified user")
        return str(UUID(user["id"]))
    except (ValueError, KeyError, TypeError) as exc:
        raise HTTPException(status_code=401, detail="A verified account is required.") from exc
