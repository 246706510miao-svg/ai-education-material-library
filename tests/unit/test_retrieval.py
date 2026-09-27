from material_service.app.retrieval import reciprocal_rank_fusion


def test_rrf_rewards_chunks_present_in_both_rankings() -> None:
    """A chunk supported by lexical and semantic retrieval must outrank one-source hits."""
    result = reciprocal_rank_fusion(["a", "b"], ["b", "c"], k=60)

    assert result[0].chunk_id == "b"
    assert result[0].score > result[1].score


def test_rrf_tie_breaking_is_deterministic() -> None:
    """Identical component scores must not make pagination order unstable."""
    result = reciprocal_rank_fusion(["b", "a"], [], k=60)

    assert [item.chunk_id for item in result] == ["b", "a"]
