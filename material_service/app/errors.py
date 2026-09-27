class MaterialServiceError(Exception):
    """Base error carrying a stable machine-readable code."""

    error_code = "INTERNAL_ERROR"


class NotAPdfError(MaterialServiceError):
    error_code = "NOT_A_PDF"


class FileTooLargeError(MaterialServiceError):
    error_code = "FILE_TOO_LARGE"


class StorageUnavailableError(MaterialServiceError):
    error_code = "STORAGE_UNAVAILABLE"


class PdfCorruptedError(MaterialServiceError):
    error_code = "PDF_CORRUPTED"


class TooManyPagesError(MaterialServiceError):
    error_code = "TOO_MANY_PAGES"


class PdfTextNotExtractableError(MaterialServiceError):
    error_code = "PDF_TEXT_NOT_EXTRACTABLE"


class DatabaseUnavailableError(MaterialServiceError):
    error_code = "DATABASE_UNAVAILABLE"


class PdfProcessingTimeoutError(MaterialServiceError):
    error_code = "PDF_PROCESSING_TIMEOUT"


class UnauthorizedError(MaterialServiceError):
    error_code = "UNAUTHORIZED"


class InvalidArgumentError(MaterialServiceError):
    error_code = "INVALID_ARGUMENT"

