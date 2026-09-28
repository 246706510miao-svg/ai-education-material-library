import json
from dataclasses import asdict, dataclass
from pathlib import Path


@dataclass(frozen=True, slots=True)
class EvaluationCase:
    question: str
    expected_document_id: str | None
    expected_page_start: int | None
    expected_page_end: int | None
    answerable: bool


@dataclass(frozen=True, slots=True)
class SearchHit:
    document_id: str
    page_start: int
    page_end: int
    latency_ms: float


@dataclass(frozen=True, slots=True)
class Metrics:
    model_name: str
    case_count: int
    top1_accuracy: float
    top5_accuracy: float
    mrr: float
    no_answer_precision: float
    no_answer_recall: float
    latency_p50_ms: float
    latency_p95_ms: float


def _matches(case: EvaluationCase, hit: SearchHit) -> bool:
    return (
        case.expected_document_id == hit.document_id
        and case.expected_page_start is not None
        and case.expected_page_end is not None
        and hit.page_start <= case.expected_page_end
        and hit.page_end >= case.expected_page_start
    )


def _percentile(values: list[float], fraction: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    index = round((len(ordered) - 1) * fraction)
    return ordered[index]


def score_cases(
    cases: list[EvaluationCase], results: list[list[SearchHit]], *, model_name: str
) -> Metrics:
    if len(cases) != len(results):
        raise ValueError("cases and results must have the same length")
    answerable = [
        (case, hits)
        for case, hits in zip(cases, results, strict=True)
        if case.answerable
    ]
    ranks = [
        next((index for index, hit in enumerate(hits, 1) if _matches(case, hit)), None)
        for case, hits in answerable
    ]
    denominator = len(answerable) or 1
    predicted_no_answer = sum(not hits for hits in results)
    correct_no_answer = sum(
        not case.answerable and not hits for case, hits in zip(cases, results, strict=True)
    )
    actual_no_answer = sum(not case.answerable for case in cases)
    latencies = [hit.latency_ms for hits in results for hit in hits[:1]]
    return Metrics(
        model_name=model_name,
        case_count=len(cases),
        top1_accuracy=sum(rank == 1 for rank in ranks) / denominator,
        top5_accuracy=sum(rank is not None and rank <= 5 for rank in ranks) / denominator,
        mrr=sum(0.0 if rank is None else 1 / rank for rank in ranks) / denominator,
        no_answer_precision=correct_no_answer / predicted_no_answer if predicted_no_answer else 0.0,
        no_answer_recall=correct_no_answer / actual_no_answer if actual_no_answer else 0.0,
        latency_p50_ms=_percentile(latencies, 0.5),
        latency_p95_ms=_percentile(latencies, 0.95),
    )


def load_cases(path: Path) -> list[EvaluationCase]:
    cases = []
    required = {
        "question",
        "expected_document_id",
        "expected_page_start",
        "expected_page_end",
        "answerable",
    }
    for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip():
            continue
        value = json.loads(line)
        if not required <= value.keys():
            raise ValueError(f"line {line_number} is missing required fields")
        cases.append(EvaluationCase(**{key: value[key] for key in required}))
    return cases


def metrics_json(metrics: Metrics) -> str:
    return json.dumps(asdict(metrics), ensure_ascii=False, indent=2)
