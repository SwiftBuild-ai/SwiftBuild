class ServiceError(Exception):
    def __init__(self, status, message, code='PROJECT_ERROR'):
        super().__init__(message)
        self.status, self.code, self.message = status, code, message


def conflict():
    return ServiceError(
        409,
        'Project changed. Preserve your work before reopening the current revision.',
        'REVISION_CONFLICT',
    )
