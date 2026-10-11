param([Parameter(Mandatory=$true)][string]$Directory,[Parameter(Mandatory=$true)][int]$TotalPages,[int]$CompletedTextPages=0)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null=[Windows.Storage.StorageFile, Windows.Storage, ContentType=WindowsRuntime]
$null=[Windows.Storage.Streams.IRandomAccessStream, Windows.Storage.Streams, ContentType=WindowsRuntime]
$null=[Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType=WindowsRuntime]
$null=[Windows.Graphics.Imaging.SoftwareBitmap, Windows.Graphics.Imaging, ContentType=WindowsRuntime]
$null=[Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType=WindowsRuntime]
$null=[Windows.Media.Ocr.OcrResult, Windows.Foundation, ContentType=WindowsRuntime]
$null=[Windows.Globalization.Language, Windows.Globalization, ContentType=WindowsRuntime]
$awaitMethod=([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.IsGenericMethodDefinition -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
function Await-WinRT($Operation,[Type]$Type) {
  $task=$awaitMethod.MakeGenericMethod($Type).Invoke($null,@($Operation))
  $task.Wait()
  return $task.Result
}
$engine=[Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage([Windows.Globalization.Language]::new('zh-Hans-CN'))
if($null -eq $engine){throw 'Chinese OCR unavailable'}
foreach($image in (Get-ChildItem -LiteralPath $Directory -Filter 'page-*.png' | Sort-Object Name)) {
  $checkpoint=Join-Path $Directory ($image.BaseName+'.json')
  if(Test-Path -LiteralPath $checkpoint){Remove-Item -LiteralPath $image.FullName;continue}
  $file=Await-WinRT ([Windows.Storage.StorageFile]::GetFileFromPathAsync($image.FullName)) ([Windows.Storage.StorageFile])
  $stream=Await-WinRT ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
  $bitmap=$null
  try {
    $decoder=Await-WinRT ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
    $bitmap=Await-WinRT ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
    $result=Await-WinRT ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
    $lines=@(foreach($line in $result.Lines) {
      @{text=$line.Text;words=@(foreach($word in $line.Words) {
        @{text=$word.Text;x=$word.BoundingRect.X;y=$word.BoundingRect.Y;width=$word.BoundingRect.Width;height=$word.BoundingRect.Height}
      })}
    })
    $temporary=$checkpoint+'.tmp'
    @{width=$bitmap.PixelWidth;height=$bitmap.PixelHeight;lines=$lines} | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $temporary -Encoding UTF8
    Move-Item -LiteralPath $temporary -Destination $checkpoint
  } finally {
    if($null -ne $bitmap){$bitmap.Dispose()}
    $stream.Dispose()
  }
  Remove-Item -LiteralPath $image.FullName
  @{completedPages=$CompletedTextPages+@(Get-ChildItem -LiteralPath $Directory -Filter 'page-*.json').Count;totalPages=$TotalPages} | ConvertTo-Json -Compress
}
