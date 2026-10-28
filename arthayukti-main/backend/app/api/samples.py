import json
from pathlib import Path

from fastapi import APIRouter

from app.api.common import ERROR_RESPONSES
from app.errors import ApiError
from app.schemas.requests import SampleDetail, SampleSummary

router = APIRouter(tags=["samples"])

# backend/app/api/samples.py -> repository root is three levels above this folder
SAMPLES_DIR = Path(__file__).resolve().parents[3] / "contracts" / "samples"


def _load_all() -> dict[str, SampleDetail]:
    samples: dict[str, SampleDetail] = {}
    for path in sorted(SAMPLES_DIR.glob("*.json")):
        sample = SampleDetail.model_validate(json.loads(path.read_text(encoding="utf-8")))
        samples[sample.id] = sample
    return samples


@router.get("/samples", response_model=list[SampleSummary])
def list_samples() -> list[SampleSummary]:
    return [
        SampleSummary(id=s.id, name=s.name, description=s.description) for s in _load_all().values()
    ]


@router.get("/samples/{sample_id}", response_model=SampleDetail, responses=ERROR_RESPONSES)
def get_sample(sample_id: str) -> SampleDetail:
    sample = _load_all().get(sample_id)
    if sample is None:
        raise ApiError(404, "not_found", f"No sample named {sample_id!r}.")
    return sample
