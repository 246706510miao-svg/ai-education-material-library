from evaluation.run import EvaluationCase, SearchHit, score_cases


def test_metrics_count_expected_page_in_top_five() -> None:
    """A traceable hit on an expected page must count toward Top-1 and Top-5."""
    cases = [EvaluationCase("q", "doc_1", 3, 4, True)]
    results = [[SearchHit("doc_1", 3, 3, 12.0)]]

    metrics = score_cases(cases, results, model_name="candidate")

    assert metrics.top1_accuracy == 1.0
    assert metrics.top5_accuracy == 1.0
    assert metrics.mrr == 1.0


def test_metrics_score_no_answer_precision_and_recall() -> None:
    """Returning no hits for an unanswerable case must be visible as correct abstention."""
    cases = [
        EvaluationCase("unknown", None, None, None, False),
        EvaluationCase("known", "doc_1", 1, 1, True),
    ]
    results = [[], []]

    metrics = score_cases(cases, results, model_name="candidate")

    assert metrics.no_answer_precision == 0.5
    assert metrics.no_answer_recall == 1.0
