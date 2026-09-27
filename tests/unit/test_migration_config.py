from alembic.config import Config

from material_service.app.migration_config import apply_database_url


def test_database_url_environment_overrides_alembic_ini() -> None:
    config = Config()
    config.set_main_option("sqlalchemy.url", "postgresql://localhost/default")

    apply_database_url(
        config,
        {"DATABASE_URL": "postgresql+psycopg://material:secret@postgres:5432/materials"},
    )

    assert config.get_main_option("sqlalchemy.url") == (
        "postgresql+psycopg://material:secret@postgres:5432/materials"
    )


def test_missing_database_url_preserves_alembic_ini() -> None:
    config = Config()
    config.set_main_option("sqlalchemy.url", "postgresql://localhost/default")

    apply_database_url(config, {})

    assert config.get_main_option("sqlalchemy.url") == "postgresql://localhost/default"
