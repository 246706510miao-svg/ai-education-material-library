import secrets

from fastapi import Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from material_service.app.errors import UnauthorizedError

bearer = HTTPBearer(auto_error=False)


async def require_api_token(request: Request) -> None:
    credentials: HTTPAuthorizationCredentials | None = await bearer(request)
    expected = request.app.state.settings.material_service_api_token.get_secret_value()
    if (
        credentials is None
        or credentials.scheme.casefold() != "bearer"
        or not secrets.compare_digest(credentials.credentials, expected)
    ):
        raise UnauthorizedError("A valid project API Token is required.")

