from types import SimpleNamespace

import pytest

from material_service.app.embedding import FastEmbedProvider, build_embedding_text
from material_service.app.errors import EmbeddingUnavailableError


class FakeModel:
    def __init__(self) -> None:
        self.calls = 0

    def embed(self, texts: list[str], *, batch_size: int):
        self.calls += 1
        assert batch_size == 2
        return ([float(index), 0.5, 1.0] for index, _text in enumerate(texts))


def test_embedding_text_prefixes_scope_without_mutating_raw_chunk() -> None:
    """Removing scope metadata from embedding input would weaken cross-course retrieval."""
    document = SimpleNamespace(
        school="南京理工大学",
        major="计算机科学与技术",
        course="高等数学",
        unit="多重积分",
        material_type="textbook",
        title="高等数学教材",
    )
    chunk = SimpleNamespace(text="原始正文", heading_path=["第八章"])

    value = build_embedding_text(document, chunk)

    assert "南京理工大学" in value
    assert "多重积分" in value
    assert value.endswith("原始正文")
    assert chunk.text == "原始正文"


def test_provider_loads_once_and_returns_validated_vectors() -> None:
    """Repeated batches must reuse one model and preserve the configured vector dimension."""
    model = FakeModel()
    factory_calls = 0

    def factory(_model_name: str) -> FakeModel:
        nonlocal factory_calls
        factory_calls += 1
        return model

    provider = FastEmbedProvider(
        model_name="test-model",
        dimension=3,
        batch_size=2,
        model_factory=factory,
    )

    assert provider.embed_texts(["a", "b"]) == [[0.0, 0.5, 1.0], [1.0, 0.5, 1.0]]
    assert provider.embed_texts(["c"]) == [[0.0, 0.5, 1.0]]
    assert factory_calls == 1
    assert model.calls == 2


def test_provider_maps_wrong_dimension_to_stable_error() -> None:
    """A changed model dimension must fail before incompatible vectors reach PostgreSQL."""

    class WrongDimensionModel:
        def embed(self, texts: list[str], *, batch_size: int):
            del texts, batch_size
            return iter([[1.0, 2.0]])

    provider = FastEmbedProvider(
        model_name="wrong-model",
        dimension=3,
        batch_size=2,
        model_factory=lambda _name: WrongDimensionModel(),
    )

    with pytest.raises(EmbeddingUnavailableError):
        provider.embed_texts(["content"])
