import os
from pathlib import Path
from typing import Any
from uuid import uuid4

import httpx


class MaterialApiError(Exception):
    def __init__(self, error_code: str, message: str, request_id: str | None = None) -> None:
        super().__init__(message)
        self.error_code = error_code
        self.request_id = request_id


class MaterialApiClient:
    def __init__(
        self,
        *,
        base_url: str,
        api_token: str,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        timeout = httpx.Timeout(connect=10.0, read=130.0, write=130.0, pool=10.0)
        self._client = httpx.Client(
            base_url=base_url.rstrip("/"),
            headers={"Authorization": f"Bearer {api_token}"},
            timeout=timeout,
            transport=transport,
        )

    @classmethod
    def from_environment(cls) -> "MaterialApiClient":
        base_url = os.environ["MATERIAL_SERVICE_BASE_URL"]
        token = os.environ["MATERIAL_SERVICE_API_TOKEN"]
        return cls(base_url=base_url, api_token=token)

    def upload_pdf(self, *, file_path: Path, metadata: dict[str, Any]) -> dict[str, Any]:
        resolved = file_path.expanduser()
        if not resolved.is_file():
            raise FileNotFoundError(f"Local PDF does not exist: {resolved}")
        data = {key: _form_value(value) for key, value in metadata.items() if value is not None}
        data["idempotency_key"] = str(uuid4())
        with resolved.open("rb") as stream:
            response = self._client.post(
                "/v1/materials/ingest",
                data=data,
                files={"file": (resolved.name, stream, "application/pdf")},
            )
        return self._decode(response)

    def list_materials(
        self,
        *,
        course: str | None = None,
        unit: str | None = None,
        limit: int = 10,
    ) -> dict[str, Any]:
        params = {"limit": limit}
        if course is not None:
            params["course"] = course
        if unit is not None:
            params["unit"] = unit
        return self._decode(self._client.get("/v1/materials", params=params))

    def search_materials(
        self,
        *,
        query: str,
        course: str | None = None,
        unit: str | None = None,
        document_id: str | None = None,
        limit: int = 10,
    ) -> dict[str, Any]:
        payload: dict[str, Any] = {"query": query, "limit": limit}
        if course is not None:
            payload["course"] = course
        if unit is not None:
            payload["unit"] = unit
        if document_id is not None:
            payload["document_id"] = document_id
        return self._decode(self._client.post("/v1/materials/search", json=payload))

    @staticmethod
    def _decode(response: httpx.Response) -> dict[str, Any]:
        try:
            payload = response.json()
        except ValueError as error:
            raise MaterialApiError(
                "REMOTE_PROTOCOL_ERROR", "Material service returned non-JSON data."
            ) from error
        if response.is_error:
            raise MaterialApiError(
                str(payload.get("error_code", "REMOTE_HTTP_ERROR")),
                str(payload.get("message", "Material service request failed.")),
                str(payload["request_id"]) if payload.get("request_id") else None,
            )
        return dict(payload)


def _form_value(value: Any) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    return str(value)

