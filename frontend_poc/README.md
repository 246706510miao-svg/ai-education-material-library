# Minimal material-library POC

This command-line POC demonstrates upload, list and search without a model or RAG layer.

Configure the deployed service:

```powershell
$env:MATERIAL_SERVICE_BASE_URL = 'https://materials.for-fdd.xyz'
$env:MATERIAL_SERVICE_API_TOKEN = '<project token>'
```

Upload a local text PDF:

```powershell
uv run python -m frontend_poc.app upload 'D:\materials\multiple-integrals.pdf' --title '多重积分讲义' --source-name '课程资料整理'
```

List and search:

```powershell
uv run python -m frontend_poc.app list --course '高等数学' --unit '多重积分'
uv run python -m frontend_poc.app search 'Change the order' --course '高等数学' --unit '多重积分'
```

The POC prints stored identifiers or source chunks with their material title, source and PDF page range. It does not generate teaching answers.

