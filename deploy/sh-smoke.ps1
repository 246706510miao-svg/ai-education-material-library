param(
    [Parameter(Mandatory = $true)]
    [string]$BaseUrl,

    [Parameter(Mandatory = $true)]
    [string]$ApiToken,

    [Parameter(Mandatory = $true)]
    [string]$PdfPath
)

$ErrorActionPreference = 'Stop'
$headers = @{ Authorization = "Bearer $ApiToken" }

$health = Invoke-RestMethod -Uri "$BaseUrl/health" -Method Get
if ($health.status -ne 'ok') {
    throw "Unexpected health response: $($health | ConvertTo-Json -Compress)"
}

$form = @{
    file = Get-Item -LiteralPath $PdfPath
    title = '多重积分讲义'
    course = '高等数学'
    unit = '多重积分'
    source_name = 'POC smoke test'
    source_type = 'course_material'
    idempotency_key = [guid]::NewGuid().ToString()
}
$upload = Invoke-RestMethod -Uri "$BaseUrl/v1/materials/ingest" -Method Post -Headers $headers -Form $form

$searchBody = @{ query = 'integral'; limit = 10 } | ConvertTo-Json
$search = Invoke-RestMethod -Uri "$BaseUrl/v1/materials/search" -Method Post -Headers $headers -ContentType 'application/json' -Body $searchBody

[pscustomobject]@{
    health = $health.status
    document_id = $upload.document_id
    page_count = $upload.page_count
    chunk_count = $upload.chunk_count
    search_status = $search.status
    search_items = $search.items.Count
} | ConvertTo-Json

