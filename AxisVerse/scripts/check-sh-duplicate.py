"""Check and repair scope-aware duplicate documents without changing stored files."""
import ast
from pathlib import Path
import shutil
import sys
import time
from material_service.app.models import Document, DocumentVersion

repository = Path('/app/material_service/app/repositories.py')
service = Path('/app/material_service/app/services.py')

def check(source):
    function = next(n for n in ast.parse(source).body if isinstance(n, ast.FunctionDef) and n.name == 'find_document_by_file')
    class Result:
        def one_or_none(self): return None
    class Session:
        def execute(self, query):
            values = query.compile().params.values()
            assert all(v in values for v in ['School','Major','Course','exam'])
            return Result()
    from sqlalchemy import select
    namespace = {'select': select, 'Document': Document, 'DocumentVersion': DocumentVersion}
    module = ast.Module(body=[ast.ImportFrom(module='__future__',names=[ast.alias(name='annotations')],level=0),function],type_ignores=[])
    exec(compile(ast.fix_missing_locations(module),'<scope-dedup-test>','exec'),namespace)
    namespace['find_document_by_file'](Session(),'same-file',school='School',major='Major',course='Course',material_type='exam')

if '--apply' in sys.argv:
    source = repository.read_text()
    old = 'session: Session, file_id: str\n) -> tuple[Document, DocumentVersion] | None:'
    if old in source:
        updated = source.replace(old,'session: Session, file_id: str, *, school: str, major: str, course: str, material_type: str\n) -> tuple[Document, DocumentVersion] | None:')
        updated = updated.replace('.where(DocumentVersion.file_id == file_id)', '.where(DocumentVersion.file_id == file_id, Document.school == school, Document.major == major, Document.course == course, Document.material_type == material_type)')
        check(updated)
        text = service.read_text()
        text = text.replace('self._existing_file_result(run_id, stored, started)', 'self._existing_file_result(run_id, stored, started, metadata)')
        text = text.replace('self, run_id: str, stored: StoredFilePayload, started: float\n', 'self, run_id: str, stored: StoredFilePayload, started: float, metadata: IngestMetadata\n')
        text = text.replace('find_document_by_file(session, stored_file.id)', 'find_document_by_file(session, stored_file.id, school=metadata.school, major=metadata.major, course=metadata.course, material_type=metadata.material_type)')
        compile(text, str(service), 'exec')
        for path,value in [(repository,updated),(service,text)]:
            shutil.copy2(path,path.with_suffix(f'.py.backup-{int(time.time())}'))
            path.write_text(value)
check(repository.read_text())
print('PASS: duplicate document lookup includes school, major, course and material type')
