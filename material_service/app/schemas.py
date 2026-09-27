from pydantic import BaseModel, ConfigDict, Field


class IngestMetadata(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    title: str = Field(min_length=1, max_length=255)
    school: str = Field(min_length=1, max_length=255)
    major: str = Field(min_length=1, max_length=255)
    course: str = Field(min_length=1, max_length=100)
    unit: str = Field(min_length=1, max_length=100)
    material_type: str = Field(min_length=1, max_length=50)
    source_name: str | None = Field(default=None, max_length=255)
    author: str | None = Field(default=None, max_length=255)
    publication_year: int | None = Field(default=None, ge=1000, le=9999)
    description: str | None = None
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
    retrieval_modes: list[str] = Field(default_factory=lambda: ["lexical", "semantic"])
    warning_code: str | None = None
    download_url: str | None = None


class PossibleDuplicate(BaseModel):
    document_id: str
    title: str
    download_url: str


class PrepareUploadResult(BaseModel):
    status: str
    intent_id: str | None = None
    upload_url: str | None = None
    expires_in_seconds: int | None = None
    confirmation_id: str | None = None
    possible_duplicates: list[PossibleDuplicate] = Field(default_factory=list)


class MaterialItem(BaseModel):
    document_id: str
    title: str
    school: str
    major: str
    course: str
    unit: str
    material_type: str
    source_name: str | None
    page_count: int
    chunk_count: int


class MaterialPage(BaseModel):
    status: str = "success"
    items: list[MaterialItem]
    next_cursor: str | None = None


class SearchRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    query: str = Field(min_length=1)
    course: str | None = Field(default=None, max_length=100)
    unit: str | None = Field(default=None, max_length=100)
    document_id: str | None = Field(default=None, max_length=40)
    limit: int = Field(default=10, gt=0)


class SearchItem(BaseModel):
    chunk_id: str
    text: str
    document_id: str
    document_title: str
    page_start: int
    page_end: int
    source_name: str | None
    material_type: str
    quality_flags: list[str]
    score: float
    score_type: str = "full_text_rank"


class SearchResponse(BaseModel):
    status: str
    items: list[SearchItem]

