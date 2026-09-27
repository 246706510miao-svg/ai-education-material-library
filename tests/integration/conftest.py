from collections.abc import Iterator

import pytest
from sqlalchemy import Engine, create_engine
from testcontainers.community.postgres import PostgresContainer


@pytest.fixture(scope="session")
def postgres_url() -> Iterator[str]:
    with PostgresContainer("postgres:16-alpine", driver="psycopg") as postgres:
        yield postgres.get_connection_url()


@pytest.fixture
def postgres_engine(postgres_url: str) -> Iterator[Engine]:
    engine = create_engine(postgres_url)
    try:
        yield engine
    finally:
        engine.dispose()

