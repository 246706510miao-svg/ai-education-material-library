"""Add shared scope and vector retrieval schema.

Revision ID: 20260927_0002
Revises: 20260927_0001
Create Date: 2026-09-27
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from pgvector.sqlalchemy import Vector

revision: str = "20260927_0002"
down_revision: str | Sequence[str] | None = "20260927_0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # This project is still a POC. Existing material rows are intentionally discarded
    # before required scope fields and the one-version invariant are introduced.
    op.execute("DELETE FROM ingestion_runs")
    op.execute("DELETE FROM document_chunks")
    op.execute("UPDATE documents SET current_version_id = NULL")
    op.execute("DELETE FROM document_versions")
    op.execute("DELETE FROM documents")
    op.execute("DELETE FROM stored_files")

    op.execute("CREATE EXTENSION IF NOT EXISTS vector")

    op.drop_index("ix_documents_scope", table_name="documents")
    op.drop_index("ix_documents_course", table_name="documents")
    op.drop_index("ix_documents_unit", table_name="documents")
    op.alter_column("documents", "applicable_school", new_column_name="school")
    op.alter_column("documents", "school", existing_type=sa.String(255), nullable=False)
    op.alter_column("documents", "source_type", new_column_name="material_type")
    op.alter_column("documents", "source_name", existing_type=sa.String(255), nullable=True)
    op.add_column("documents", sa.Column("major", sa.String(255), nullable=False))
    op.create_index("ix_documents_school", "documents", ["school"])
    op.create_index("ix_documents_major", "documents", ["major"])
    op.create_index("ix_documents_course", "documents", ["course"])
    op.create_index("ix_documents_unit", "documents", ["unit"])
    op.create_index("ix_documents_material_type", "documents", ["material_type"])
    op.create_index(
        "ix_documents_scope",
        "documents",
        ["school", "major", "course", "unit", "material_type"],
    )

    op.create_unique_constraint(
        "uq_document_versions_document", "document_versions", ["document_id"]
    )

    op.add_column("document_chunks", sa.Column("embedding", Vector(384), nullable=True))
    op.add_column(
        "document_chunks", sa.Column("embedding_model", sa.String(255), nullable=True)
    )
    op.add_column(
        "document_chunks", sa.Column("embedding_version", sa.String(100), nullable=True)
    )
    op.create_index(
        "ix_document_chunks_embedding_hnsw",
        "document_chunks",
        ["embedding"],
        postgresql_using="hnsw",
        postgresql_ops={"embedding": "vector_cosine_ops"},
    )


def downgrade() -> None:
    op.drop_index("ix_document_chunks_embedding_hnsw", table_name="document_chunks")
    op.drop_column("document_chunks", "embedding_version")
    op.drop_column("document_chunks", "embedding_model")
    op.drop_column("document_chunks", "embedding")
    op.drop_constraint(
        "uq_document_versions_document", "document_versions", type_="unique"
    )

    op.drop_index("ix_documents_scope", table_name="documents")
    op.drop_index("ix_documents_material_type", table_name="documents")
    op.drop_index("ix_documents_unit", table_name="documents")
    op.drop_index("ix_documents_course", table_name="documents")
    op.drop_index("ix_documents_major", table_name="documents")
    op.drop_index("ix_documents_school", table_name="documents")
    op.drop_column("documents", "major")
    op.alter_column("documents", "source_name", existing_type=sa.String(255), nullable=False)
    op.alter_column("documents", "material_type", new_column_name="source_type")
    op.alter_column("documents", "school", existing_type=sa.String(255), nullable=True)
    op.alter_column("documents", "school", new_column_name="applicable_school")
    op.create_index("ix_documents_course", "documents", ["course"])
    op.create_index("ix_documents_unit", "documents", ["unit"])
    op.create_index("ix_documents_scope", "documents", ["course", "unit"])
    op.execute("DROP EXTENSION IF EXISTS vector")
