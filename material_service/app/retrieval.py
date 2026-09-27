import base64
import hashlib
import json
from dataclasses import dataclass
from typing import Any

from material_service.app.errors import InvalidArgumentError


@dataclass(frozen=True, slots=True)
class FusionScore:
    chunk_id: str
    score: float
    lexical_rank: int | None
    vector_rank: int | None


def reciprocal_rank_fusion(
    lexical_ids: list[str], vector_ids: list[str], *, k: int = 60
) -> list[FusionScore]:
    """Fuse ranked chunk IDs with stable first-seen tie breaking."""

    positions: dict[str, list[int | None]] = {}
    first_seen: dict[str, int] = {}
    for source_index, ranking in enumerate((lexical_ids, vector_ids)):
        for rank, chunk_id in enumerate(ranking, start=1):
            first_seen.setdefault(chunk_id, len(first_seen))
            positions.setdefault(chunk_id, [None, None])[source_index] = rank
    result = [
        FusionScore(
            chunk_id=chunk_id,
            score=sum(1 / (k + rank) for rank in ranks if rank is not None),
            lexical_rank=ranks[0],
            vector_rank=ranks[1],
        )
        for chunk_id, ranks in positions.items()
    ]
    return sorted(result, key=lambda item: (-item.score, first_seen[item.chunk_id], item.chunk_id))


def query_fingerprint(values: dict[str, Any]) -> str:
    body = json.dumps(values, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(body.encode("utf-8")).hexdigest()[:24]


def encode_cursor(offset: int, fingerprint: str) -> str:
    body = json.dumps({"offset": offset, "fingerprint": fingerprint}, separators=(",", ":"))
    return base64.urlsafe_b64encode(body.encode()).decode().rstrip("=")


def decode_cursor(cursor: str | None, fingerprint: str) -> int:
    if cursor is None:
        return 0
    try:
        body = base64.urlsafe_b64decode(cursor + "=" * (-len(cursor) % 4))
        value = json.loads(body)
        if value["fingerprint"] != fingerprint or int(value["offset"]) < 0:
            raise ValueError
        return int(value["offset"])
    except (KeyError, TypeError, ValueError, json.JSONDecodeError) as error:
        raise InvalidArgumentError("The search cursor does not match this query.") from error
