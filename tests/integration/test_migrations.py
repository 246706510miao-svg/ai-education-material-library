from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import Engine, inspect

EXPECTED_TABLES = {
    "api_clients",
    "document_chunks",
    "document_versions",
    "documents",
    "ingestion_runs",
    "stored_files",
}


def alembic_config(postgres_url: str) -> Config:
    config = Config(str(Path(__file__).parents[2] / "alembic.ini"))
    config.set_main_option("sqlalchemy.url", postgres_url.replace("%", "%%"))
    return config


def test_initial_migration_creates_all_material_tables(
    postgres_url: str, postgres_engine: Engine
) -> None:
    """Removing a required table from the migration must break the schema contract."""
    config = alembic_config(postgres_url)

    command.upgrade(config, "head")

    assert EXPECTED_TABLES <= set(inspect(postgres_engine).get_table_names())


def test_migration_can_downgrade_and_upgrade_again(
    postgres_url: str, postgres_engine: Engine
) -> None:
    """A non-reversible migration must be caught before deployment rollback is needed."""
    config = alembic_config(postgres_url)
    command.upgrade(config, "head")

    command.downgrade(config, "base")
    assert EXPECTED_TABLES.isdisjoint(inspect(postgres_engine).get_table_names())

    command.upgrade(config, "head")
    assert EXPECTED_TABLES <= set(inspect(postgres_engine).get_table_names())

