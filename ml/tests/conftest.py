import os

import pytest

os.environ.setdefault("ML_SERVICE_TOKEN", "test-token-0123456789abcdef")


@pytest.fixture(scope="session")
def dataset():
    from shongrokhon_ml.dataset import build

    return build()


@pytest.fixture(scope="session")
def model():
    from shongrokhon_ml.model import RiskModel

    return RiskModel()


@pytest.fixture(scope="session")
def client():
    from fastapi.testclient import TestClient

    from shongrokhon_ml.service import app

    with TestClient(app) as c:
        yield c


@pytest.fixture
def auth():
    return {"Authorization": f"Bearer {os.environ['ML_SERVICE_TOKEN']}"}
