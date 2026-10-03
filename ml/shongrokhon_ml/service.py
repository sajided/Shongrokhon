"""Risk scoring microservice (testcase.md §2.3).

GET  /health  -> loaded model versions (no secrets, no auth)
POST /score   -> risk_score, anomaly_score, low_confidence, decision, model_version
                 Requires `Authorization: Bearer $ML_SERVICE_TOKEN`; only the `pay`
                 Edge Function holds the token (TC-P2-MLAPI-04).

The request carries numeric features only. No phone numbers, names or wallet
IDs reach this service, and logs hold only request_id, latency and decision
(TC-P2-MLAPI-09).
"""
from __future__ import annotations

import hmac
import logging
import os
import time
from contextlib import asynccontextmanager
from typing import Annotated, Optional

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, ConfigDict, Field

from .model import RiskModel

log = logging.getLogger("shongrokhon_ml")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

Num = Annotated[float, Field(strict=True, ge=0)]
OptNum = Optional[Annotated[float, Field(strict=True)]]


class ScoreRequest(BaseModel):
    """Feature names match shongrokhon_ml.features.FEATURES. Unknown keys are ignored
    and missing optional features fall back to training medians (TC-P2-XGB-08)."""

    model_config = ConfigDict(extra="ignore")

    request_id: Optional[str] = Field(default=None, max_length=64, pattern=r"^[A-Za-z0-9-]+$")
    amount: Annotated[float, Field(strict=True, gt=0)]
    log_amount: OptNum = None
    is_round_100: OptNum = None
    is_round_1000: OptNum = None
    hour_sin: OptNum = None
    hour_cos: OptNum = None
    is_night: OptNum = None
    payer_txn_count_90d: Optional[Num] = None
    payer_median_amount_90d: Optional[Num] = None
    amount_to_median: Optional[Num] = None
    payer_hour_share: Optional[Num] = None
    payer_cashout_count_30d: Optional[Num] = None
    payer_txn_count_1h: Optional[Num] = None
    payer_merchant_prior_count: Optional[Num] = None
    amount_to_merchant_median: Optional[Num] = None
    merchant_new_for_payer: Optional[Num] = None
    payer_merchant_count_10m: Optional[Num] = None
    merchant_distinct_payers_30d: Optional[Num] = None
    merchant_round_share_30d: Optional[Num] = None
    merchant_cashout_ratio_7d: Optional[Num] = None
    merchant_cashout_lag_min: Optional[Num] = None
    merchant_age_days: Optional[Num] = None


class ExplainRequest(ScoreRequest):
    """The stored features of a past score plus the model version that produced it."""

    model_version: str = Field(max_length=64)


class ExplainResponse(BaseModel):
    model_version: str
    risk_score: float
    margin: float
    base_value: float
    contributions: dict[str, float]
    features: dict[str, float]


class ScoreResponse(BaseModel):
    risk_score: float
    anomaly_score: float
    low_confidence: bool
    decision: str
    model_version: str


state: dict = {}


@asynccontextmanager
async def lifespan(app: FastAPI):
    # TC-P2-MLAPI-07: load and warm the models before accepting traffic.
    token = os.environ.get("ML_SERVICE_TOKEN", "")
    if len(token) < 16:
        raise RuntimeError("ML_SERVICE_TOKEN must be set (at least 16 characters)")
    state["token"] = token.encode()
    model = RiskModel()
    model.score([{"amount": 100.0}])
    state["model"] = model
    log.info("models loaded version=%s", model.version)
    yield


app = FastAPI(title="Shongrokhon risk scoring", lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
bearer = HTTPBearer(auto_error=False)


def require_token(creds: HTTPAuthorizationCredentials | None = Depends(bearer)) -> None:
    if creds is None or creds.scheme.lower() != "bearer" or not hmac.compare_digest(
        creds.credentials.encode(), state["token"]
    ):
        raise HTTPException(status_code=401, detail="UNAUTHORIZED")


@app.exception_handler(RequestValidationError)
async def validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
    # TC-P2-MLAPI-03: field-level errors only; never echo the submitted values.
    errors = [{"field": ".".join(str(p) for p in e["loc"] if p != "body"), "type": e["type"]} for e in exc.errors()]
    return JSONResponse(status_code=422, content={"code": "INVALID_REQUEST", "errors": errors})


@app.exception_handler(Exception)
async def unhandled(_: Request, exc: Exception) -> JSONResponse:
    log.error("unhandled error type=%s", type(exc).__name__)
    return JSONResponse(status_code=500, content={"code": "INTERNAL_ERROR"})


@app.get("/health")
def health() -> dict:
    model: RiskModel = state["model"]
    return {
        "status": "ok",
        "model_version": model.version,
        "training_date": model.metadata["training_date"],
        "models": {"xgboost": model.version, "isolation_forest": model.version},
    }


# async: scoring takes a few milliseconds of CPU, less than a threadpool hand-off costs.
@app.post("/score", response_model=ScoreResponse, dependencies=[Depends(require_token)])
async def score(req: ScoreRequest) -> ScoreResponse:
    started = time.perf_counter()
    model: RiskModel = state["model"]
    s = model.score([req.model_dump(exclude={"request_id"})])[0]
    log.info("score request_id=%s decision=%s latency_ms=%.2f", req.request_id or "-", s.decision,
             (time.perf_counter() - started) * 1000)
    return ScoreResponse(risk_score=s.risk_score, anomaly_score=s.anomaly_score, low_confidence=s.low_confidence,
                         decision=s.decision, model_version=model.version)


# TC-P4-INV-03/04: SHAP explanation of a stored score, for the investigation
# assistant. 409 when the score came from another model version: explaining it
# with this model would be wrong.
@app.post("/explain", response_model=ExplainResponse, dependencies=[Depends(require_token)])
async def explain(req: ExplainRequest) -> ExplainResponse:
    model: RiskModel = state["model"]
    if req.model_version != model.version:
        raise HTTPException(status_code=409, detail="MODEL_VERSION_MISMATCH")
    e = model.explain(req.model_dump(exclude={"request_id", "model_version"}))
    log.info("explain request_id=%s", req.request_id or "-")
    return ExplainResponse(model_version=model.version, risk_score=e.risk_score, margin=e.margin, base_value=e.base_value,
                           contributions=e.contributions, features=e.features)
