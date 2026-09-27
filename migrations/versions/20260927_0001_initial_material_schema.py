"""Create the initial shared material schema.

Revision ID: 20260927_0001
Revises:
Create Date: 2026-09-27
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20260927_0001"
down_revision: str | Sequence[str] | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "stored_files",
        sa.Column("id", sa.String(length=40), nullable=False),
        sa.Column("sha256", sa.String(length=64), nullable=False),
        sa.Column("original_name", sa.String(length=255), nullable=False),
        sa.Column("storage_key", sa.String(length=255), nullable=False),
        sa.Column("size_bytes", sa.BigInteger(), nullable=False),
        sa.Column("mime_type", sa.String(length=100), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("size_bytes > 0", name="ck_stored_files_size_positive"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("sha256"),
        sa.UniqueConstraint("storage_key"),
    )
    op.create_table(
        "documents",
        sa.Column("id", sa.String(length=40), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("course", sa.String(length=100), nullable=False),
        sa.Column("unit", sa.String(length=100), nullable=False),
        sa.Column("source_name", sa.String(length=255), nullable=False),
        sa.Column("source_type", sa.String(length=50), nullable=False),
        sa.Column("author", sa.String(length=255), nullable=True),
        sa.Column("publication_year", sa.Integer(), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("applicable_school", sa.String(length=255), nullable=True),
        sa.Column("is_official_source", sa.Boolean(), nullable=False),
        sa.Column("current_version_id", sa.String(length=40), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "publication_year IS NULL OR publication_year BETWEEN 1000 AND 9999",
            name="ck_documents_publication_year",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_documents_course", "documents", ["course"])
    op.create_index("ix_documents_unit", "documents", ["unit"])
    op.create_index("ix_documents_scope", "documents", ["course", "unit"])
    op.create_table(
        "document_versions",
        sa.Column("id", sa.String(length=40), nullable=False),
        sa.Column("document_id", sa.String(length=40), nullable=False),
        sa.Column("file_id", sa.String(length=40), nullable=False),
        sa.Column("version_number", sa.Integer(), nullable=False),
        sa.Column("processing_status", sa.String(length=30), nullable=False),
        sa.Column("publication_status", sa.String(length=30), nullable=False),
        sa.Column("searchable", sa.Boolean(), nullable=False),
        sa.Column("parser_version", sa.String(length=100), nullable=False),
        sa.Column("page_count", sa.Integer(), nullable=False),
        sa.Column("chunk_count", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "chunk_count >= 0", name="ck_document_versions_chunks_nonnegative"
        ),
        sa.CheckConstraint("page_count > 0", name="ck_document_versions_pages_positive"),
        sa.CheckConstraint(
            "version_number > 0", name="ck_document_versions_number_positive"
        ),
        sa.ForeignKeyConstraint(["document_id"], ["documents.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["file_id"], ["stored_files.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "document_id", "version_number", name="uq_document_versions_document_number"
        ),
    )
    op.create_index("ix_document_versions_searchable", "document_versions", ["searchable"])
    op.create_foreign_key(
        "fk_documents_current_version",
        "documents",
        "document_versions",
        ["current_version_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_table(
        "document_chunks",
        sa.Column("id", sa.String(length=40), nullable=False),
        sa.Column("document_version_id", sa.String(length=40), nullable=False),
        sa.Column("chunk_index", sa.Integer(), nullable=False),
        sa.Column("page_start", sa.Integer(), nullable=False),
        sa.Column("page_end", sa.Integer(), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("heading_path", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("content_type", sa.String(length=30), nullable=False),
        sa.Column("text_quality", sa.String(length=30), nullable=False),
        sa.Column("formula_status", sa.String(length=30), nullable=False),
        sa.Column("has_figure", sa.Boolean(), nullable=False),
        sa.Column(
            "quality_flags",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'[]'::jsonb"),
            nullable=False,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "chunk_index >= 0", name="ck_document_chunks_index_nonnegative"
        ),
        sa.CheckConstraint(
            "page_end >= page_start", name="ck_document_chunks_page_order"
        ),
        sa.CheckConstraint(
            "page_start > 0", name="ck_document_chunks_page_start_positive"
        ),
        sa.ForeignKeyConstraint(
            ["document_version_id"], ["document_versions.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "document_version_id", "chunk_index", name="uq_document_chunks_version_index"
        ),
    )
    op.create_index(
        "ix_document_chunks_version_quality",
        "document_chunks",
        ["document_version_id", "text_quality"],
    )
    op.create_index(
        "ix_document_chunks_text_fts",
        "document_chunks",
        [sa.text("to_tsvector('simple', text)")],
        postgresql_using="gin",
    )
    op.create_table(
        "ingestion_runs",
        sa.Column("id", sa.String(length=40), nullable=False),
        sa.Column("idempotency_key", sa.String(length=100), nullable=False),
        sa.Column("file_id", sa.String(length=40), nullable=True),
        sa.Column("document_id", sa.String(length=40), nullable=True),
        sa.Column("status", sa.String(length=30), nullable=False),
        sa.Column("stage", sa.String(length=50), nullable=False),
        sa.Column("error_code", sa.String(length=100), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("duration_ms", sa.BigInteger(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "duration_ms IS NULL OR duration_ms >= 0",
            name="ck_ingestion_runs_duration_nonnegative",
        ),
        sa.ForeignKeyConstraint(["document_id"], ["documents.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["file_id"], ["stored_files.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("idempotency_key"),
    )
    op.create_table(
        "api_clients",
        sa.Column("id", sa.String(length=40), nullable=False),
        sa.Column("client_name", sa.String(length=100), nullable=False),
        sa.Column("token_hash", sa.String(length=255), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("client_name"),
    )


def downgrade() -> None:
    op.drop_table("api_clients")
    op.drop_table("ingestion_runs")
    op.drop_index("ix_document_chunks_text_fts", table_name="document_chunks")
    op.drop_index("ix_document_chunks_version_quality", table_name="document_chunks")
    op.drop_table("document_chunks")
    op.drop_constraint("fk_documents_current_version", "documents", type_="foreignkey")
    op.drop_index("ix_document_versions_searchable", table_name="document_versions")
    op.drop_table("document_versions")
    op.drop_index("ix_documents_scope", table_name="documents")
    op.drop_index("ix_documents_unit", table_name="documents")
    op.drop_index("ix_documents_course", table_name="documents")
    op.drop_table("documents")
    op.drop_table("stored_files")

