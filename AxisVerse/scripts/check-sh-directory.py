"""Regression check and narrow repair for the deployed HTTP directory filters."""
import ast
from pathlib import Path
import shutil
import sys
import time

path = Path('/app/material_service/app/api.py')
source = path.read_text()

def check(text):
    tree = ast.parse(text)
    function = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'list_materials')
    function.decorator_list = []
    calls = []
    class Service:
        def list_materials(self, **kwargs):
            calls.append(kwargs)
            return kwargs
    namespace = {'get_service': lambda request: Service()}
    module = ast.Module(body=[ast.ImportFrom(module='__future__', names=[ast.alias(name='annotations')], level=0), function], type_ignores=[])
    exec(compile(ast.fix_missing_locations(module), '<directory-regression>', 'exec'), namespace)
    namespace['list_materials'](None, school='School', major='Major', material_type='exam', course='Calculus', limit=5)
    assert calls[0]['school'] == 'School' and calls[0]['major'] == 'Major' and calls[0]['material_type'] == 'exam'

if '--apply' in sys.argv:
    if 'school: str | None' not in source[source.index('def list_materials('):source.index('@protected.post("/materials/search"')]:
        old = 'def list_materials(\n    request: Request,\n'
        new = old + '    school: str | None = None,\n    major: str | None = None,\n    material_type: str | None = None,\n'
        assert source.count(old) == 1
        updated = source.replace(old, new).replace('return get_service(request).list_materials(\n', 'return get_service(request).list_materials(\n        school=school,\n        major=major,\n        material_type=material_type,\n')
        check(updated)
        shutil.copy2(path, path.with_suffix(f'.py.backup-{int(time.time())}'))
        path.write_text(updated)
check(path.read_text())
print('PASS: HTTP directory forwards school, major and material_type filters')
