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

$metadata = @{
    title = '多重积分讲义'
    school = '南京理工大学'
    major = '计算机科学与技术'
    course = '高等数学'
    unit = '多重积分'
    material_type = 'course_material'
    source_name = 'POC smoke test'
} | ConvertTo-Json
$prepared = Invoke-RestMethod -Uri "$BaseUrl/v1/materials/uploads/prepare" -Method Post -Headers $headers -ContentType 'application/json' -Body $metadata
if ($prepared.status -ne 'ready') {
    throw "Upload requires confirmation or failed: $($prepared | ConvertTo-Json -Compress)"
}
$upload = Invoke-RestMethod -Uri "$BaseUrl$($prepared.upload_url)" -Method Put -InFile $PdfPath -ContentType 'application/pdf' -Headers @{ 'X-Filename' = (Split-Path -Leaf $PdfPath) }

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

