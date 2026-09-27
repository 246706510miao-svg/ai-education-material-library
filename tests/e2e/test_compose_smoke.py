import json
import os
import subprocess
from pathlib import Path

PROJECT_ROOT = Path(__file__).parents[2]
COMPOSE_FILE = PROJECT_ROOT / "deploy" / "compose.yaml"


def compose_config() -> dict:
    environment = os.environ.copy()
    environment.update(
        {
            "POSTGRES_DB": "materials",
            "POSTGRES_USER": "material",
            "POSTGRES_PASSWORD": "test-database-password",
            "MATERIAL_SERVICE_API_TOKEN": "test-api-token",
        }
    )
    completed = subprocess.run(
        [
            "docker",
            "compose",
            "-f",
            str(COMPOSE_FILE),
            "config",
            "--format",
            "json",
        ],
        cwd=PROJECT_ROOT,
        env=environment,
        check=True,
        capture_output=True,
        text=True,
    )
    return json.loads(completed.stdout)


def test_compose_keeps_database_and_service_off_public_ports() -> None:
    """Packaging must not bypass Caddy or expose PostgreSQL to the public host."""
    config = compose_config()

    assert "ports" not in config["services"]["postgres"]
    assert "ports" not in config["services"]["material-service"]


def test_compose_declares_both_required_persistent_volumes() -> None:
    """Container recreation must preserve both database state and original PDFs."""
    config = compose_config()

    assert {"postgres_data", "material_files"} <= set(config["volumes"])
    postgres_targets = {
        mount["target"] for mount in config["services"]["postgres"]["volumes"]
    }
    service_targets = {
        mount["target"] for mount in config["services"]["material-service"]["volumes"]
    }
    assert "/var/lib/postgresql/data" in postgres_targets
    assert "/data/materials" in service_targets


def test_compose_injects_secrets_and_waits_for_database_health() -> None:
    """Deployment must consume runtime secrets and wait for a ready PostgreSQL."""
    config = compose_config()
    postgres_environment = config["services"]["postgres"]["environment"]
    service = config["services"]["material-service"]

    assert postgres_environment["POSTGRES_PASSWORD"] == "test-database-password"
    assert service["environment"]["MATERIAL_SERVICE_API_TOKEN"] == "test-api-token"
    assert service["depends_on"]["postgres"]["condition"] == "service_healthy"
    assert service["networks"].keys() >= {"default", "material_proxy"}

