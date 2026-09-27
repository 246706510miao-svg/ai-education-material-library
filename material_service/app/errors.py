class MaterialServiceError(Exception):
    """Base error carrying a stable machine-readable code."""

    error_code = "INTERNAL_ERROR"


class NotAPdfError(MaterialServiceError):
    error_code = "NOT_A_PDF"


class FileTooLargeError(MaterialServiceError):
    error_code = "FILE_TOO_LARGE"


class StorageUnavailableError(MaterialServiceError):
    error_code = "STORAGE_UNAVAILABLE"

