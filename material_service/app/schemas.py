from pydantic import BaseModel, ConfigDict, Field


class IngestMetadata(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    title: str = Field(min_length=1, max_length=255)
    course: str = Field(min_length=1, max_length=100)
    unit: str = Field(min_length=1, max_length=100)
    source_name: str = Field(min_length=1, max_length=255)
    source_type: str = Field(min_length=1, max_length=50)
    author: str | None = Field(default=None, max_length=255)
    publication_year: int | None = Field(default=None, ge=1000, le=9999)
    description: str | None = None
    applicable_school: str | None = Field(default=None, max_length=255)
    is_official_source: bool = False


class IngestResult(BaseModel):
    model_config = ConfigDict(frozen=True)

    status: str = "success"
    document_id: str
    document_version_id: str
    file_id: str
    page_count: int
    chunk_count: int
    duplicate_file: bool
    searchable: bool

