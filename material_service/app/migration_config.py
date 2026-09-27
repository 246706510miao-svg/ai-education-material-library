from collections.abc import Mapping

from alembic.config import Config


def apply_database_url(config: Config, environ: Mapping[str, str]) -> None:
    """Let deployments override the development URL stored in alembic.ini."""
    database_url = environ.get("DATABASE_URL")
    if database_url:
        config.set_main_option("sqlalchemy.url", database_url.replace("%", "%%"))
