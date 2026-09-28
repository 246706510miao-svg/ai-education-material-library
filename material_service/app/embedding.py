from collections.abc import Callable, Iterable, Sequence
from math import isfinite
from pathlib import Path
from typing import Any, Protocol

from material_service.app.errors import EmbeddingUnavailableError


class EmbeddingProvider(Protocol):
    model_name: str

    def embed_texts(self, texts: list[str]) -> list[list[float]]: ...


class _EmbeddingModel(Protocol):
    def embed(self, texts: list[str], *, batch_size: int) -> Iterable[Sequence[float]]: ...


def _default_model_factory(model_name: str, cache_dir: Path) -> _EmbeddingModel:
    from fastembed import TextEmbedding

    return TextEmbedding(model_name=model_name, cache_dir=str(cache_dir))


class FastEmbedProvider:
    """Lazy, process-scoped FastEmbed adapter with strict vector validation."""

    def __init__(
        self,
        *,
        model_name: str,
        dimension: int,
        batch_size: int,
        cache_dir: Path = Path("/data/models"),
        model_factory: Callable[[str, Path], _EmbeddingModel] = _default_model_factory,
    ) -> None:
        self.model_name = model_name
        self.dimension = dimension
        self.batch_size = batch_size
        self.cache_dir = cache_dir
        self._model_factory = model_factory
        self._model: _EmbeddingModel | None = None

    def _load_model(self) -> _EmbeddingModel:
        if self._model is None:
            self._model = self._model_factory(self.model_name, self.cache_dir)
        return self._model

    def embed_texts(self, texts: list[str]) -> list[list[float]]:
        if not texts:
            return []
        try:
            vectors = [
                [float(value) for value in vector]
                for vector in self._load_model().embed(texts, batch_size=self.batch_size)
            ]
        except Exception as error:
            raise EmbeddingUnavailableError("The embedding model is unavailable.") from error
        if len(vectors) != len(texts):
            raise EmbeddingUnavailableError("The embedding model returned the wrong batch size.")
        if any(
            len(vector) != self.dimension or not all(isfinite(value) for value in vector)
            for vector in vectors
        ):
            raise EmbeddingUnavailableError("The embedding model returned an invalid vector.")
        return vectors


def build_embedding_text(document: Any, chunk: Any) -> str:
    """Prefix raw chunk content with retrieval-only scope metadata."""

    fields = (
        ("school", document.school),
        ("major", document.major),
        ("course", document.course),
        ("unit", document.unit),
        ("material_type", document.material_type),
        ("title", document.title),
    )
    prefix = "\n".join(f"{name}: {value}" for name, value in fields)
    headings = " > ".join(chunk.heading_path or [])
    if headings:
        prefix = f"{prefix}\nheading: {headings}"
    return f"{prefix}\n\n{chunk.text}"
