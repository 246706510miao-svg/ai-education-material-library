from collections.abc import Iterator
from contextlib import contextmanager

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from material_service.app.config import Settings, get_settings


class Base(DeclarativeBase):
    """Declarative base shared by models and Alembic."""


def build_session_factory(settings: Settings | None = None) -> sessionmaker[Session]:
    active_settings = settings or get_settings()
    engine = create_engine(active_settings.database_url.get_secret_value(), pool_pre_ping=True)
    return sessionmaker(bind=engine, expire_on_commit=False)


@contextmanager
def session_scope(factory: sessionmaker[Session]) -> Iterator[Session]:
    session = factory()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()

