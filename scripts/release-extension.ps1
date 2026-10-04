param(
  [string]$Version,
  [switch]$Help
)

$ErrorActionPreference = "Stop"
$repositoryRoot = Split-Path -Parent $PSScriptRoot
$manifestPath = Join-Path $repositoryRoot "apps/extension/manifest.json"
$packagePath = Join-Path $repositoryRoot "apps/extension/package.json"
$lockPath = Join-Path $repositoryRoot "package-lock.json"
$distributionPath = Join-Path $repositoryRoot "apps/extension/dist"
$archivePath = Join-Path $repositoryRoot "smartassistance-beta.zip"
$temporaryArchivePath = Join-Path $repositoryRoot "smartassistance-beta.next.zip"
$localEnvironmentPath = Join-Path $repositoryRoot ".env.release.local"
$utf8 = [System.Text.UTF8Encoding]::new($false)

if ($Help) {
  Write-Output "Usage: npm run release:extension [-- -Version 0.2.0]"
  Write-Output "Without -Version, the command increments the current extension patch version."
  exit 0
}

function Read-ZipEntry {
  param(
    [System.IO.Compression.ZipArchive]$Archive,
    [string]$Name
  )
  $entry = $Archive.Entries | Where-Object FullName -eq $Name
  if (-not $entry) { throw "Release archive is missing $Name at its root." }
  $reader = [System.IO.StreamReader]::new($entry.Open())
  try { return $reader.ReadToEnd() } finally { $reader.Dispose() }
}

function Import-ReleaseEnvironment {
  if (-not (Test-Path -LiteralPath $localEnvironmentPath)) { return }
  foreach ($line in Get-Content -LiteralPath $localEnvironmentPath) {
    if ($line -notmatch '^\s*(SMARTASSISTANCE_API_BASE_URL|SMARTASSISTANCE_BETA_API_TOKEN)\s*=\s*(.*)\s*$') {
      continue
    }
    $name = $Matches[1]
    $value = $Matches[2].Trim()
    if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
      $value = $value.Substring(1, $value.Length - 2)
    }
    if (-not [Environment]::GetEnvironmentVariable($name, "Process")) {
      [Environment]::SetEnvironmentVariable($name, $value, "Process")
    }
  }
}

function Recover-ReleaseEnvironment {
  if (-not (Test-Path -LiteralPath $archivePath)) {
    throw "Set the release environment variables, create .env.release.local, or keep the previous beta ZIP available."
  }
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $archive = [System.IO.Compression.ZipFile]::OpenRead($archivePath)
  try { $worker = Read-ZipEntry -Archive $archive -Name "service-worker.js" } finally { $archive.Dispose() }

  $urls = @(
    [regex]::Matches($worker, 'https://[A-Za-z0-9.-]+(?:/[A-Za-z0-9._~!$&''()*+,;=:@%-]*)?') |
      ForEach-Object Value |
      Sort-Object -Unique
  )
  $tokenMatch = [regex]::Match(
    $worker,
    'typeof token === "string" && token \? token : ("(?:[^"\\]|\\.)*")'
  )
  if ($urls.Count -ne 1 -or -not $tokenMatch.Success) {
    throw "Could not recover the hosted beta configuration from the previous package."
  }
  $env:SMARTASSISTANCE_API_BASE_URL = ([string]$urls[0]).TrimEnd('/')
  $env:SMARTASSISTANCE_BETA_API_TOKEN = $tokenMatch.Groups[1].Value | ConvertFrom-Json
}

function Assert-ChromeVersion {
  param([string]$Value)
  if ($Value -notmatch '^\d+(?:\.\d+){0,3}$') {
    throw "Chrome extension version must contain one to four dot-separated integers."
  }
  foreach ($component in $Value.Split('.')) {
    if ([int64]$component -gt 65535) { throw "Chrome extension version components must not exceed 65535." }
  }
}

function Compare-ChromeVersion {
  param([string]$Left, [string]$Right)
  $leftParts = @($Left.Split('.') | ForEach-Object { [int]$_ })
  $rightParts = @($Right.Split('.') | ForEach-Object { [int]$_ })
  for ($index = 0; $index -lt 4; $index += 1) {
    $leftValue = if ($index -lt $leftParts.Count) { $leftParts[$index] } else { 0 }
    $rightValue = if ($index -lt $rightParts.Count) { $rightParts[$index] } else { 0 }
    if ($leftValue -ne $rightValue) { return $leftValue.CompareTo($rightValue) }
  }
  return 0
}

function Replace-Version {
  param(
    [string]$Content,
    [string]$Pattern,
    [string]$NewVersion,
    [string]$Description
  )
  $matches = [regex]::Matches($Content, $Pattern)
  if ($matches.Count -ne 1) { throw "Expected one $Description version entry, found $($matches.Count)." }
  return [regex]::Replace(
    $Content,
    $Pattern,
    { param($match) $match.Groups[1].Value + '"' + $NewVersion + '"' },
    1
  )
}

Push-Location $repositoryRoot
$originalManifest = [IO.File]::ReadAllText($manifestPath)
$originalPackage = [IO.File]::ReadAllText($packagePath)
$originalLock = [IO.File]::ReadAllText($lockPath)
$versionsWritten = $false
try {
  Import-ReleaseEnvironment
  if (-not $env:SMARTASSISTANCE_API_BASE_URL -or -not $env:SMARTASSISTANCE_BETA_API_TOKEN) {
    Recover-ReleaseEnvironment
  }
  $apiUri = [Uri]$env:SMARTASSISTANCE_API_BASE_URL
  if ($apiUri.Scheme -ne "https" -or -not $apiUri.Host) { throw "The release API URL must use HTTPS." }
  if ($env:SMARTASSISTANCE_BETA_API_TOKEN.Length -gt 512) { throw "The beta token exceeds 512 characters." }

  $manifest = $originalManifest | ConvertFrom-Json
  $extensionPackage = $originalPackage | ConvertFrom-Json
  $lock = $originalLock | ConvertFrom-Json
  $currentVersion = [string]$manifest.version
  $lockedVersion = [string]$lock.packages.'apps/extension'.version
  if ($extensionPackage.version -ne $currentVersion -or $lockedVersion -ne $currentVersion) {
    throw "Manifest, extension package, and lockfile versions must match before release."
  }
  Assert-ChromeVersion $currentVersion
  if (-not $Version) {
    $parts = @($currentVersion.Split('.') | ForEach-Object { [int]$_ })
    if ($parts.Count -gt 3) { throw "Pass -Version explicitly when the current version has four components." }
    $parts[$parts.Count - 1] += 1
    $Version = $parts -join '.'
  }
  Assert-ChromeVersion $Version
  if ((Compare-ChromeVersion $Version $currentVersion) -le 0) {
    throw "Release version $Version must be higher than source version $currentVersion."
  }

  $nextManifest = Replace-Version $originalManifest '(?m)(^\s*"version"\s*:\s*)"[^"\r\n]+"' $Version "manifest"
  $nextPackage = Replace-Version $originalPackage '(?m)(^\s*"version"\s*:\s*)"[^"\r\n]+"' $Version "extension package"
  $nextLock = Replace-Version $originalLock '(?s)("apps/extension"\s*:\s*\{.*?"version"\s*:\s*)"[^"\r\n]+"' $Version "extension lockfile"
  [IO.File]::WriteAllText($manifestPath, $nextManifest, $utf8)
  [IO.File]::WriteAllText($packagePath, $nextPackage, $utf8)
  [IO.File]::WriteAllText($lockPath, $nextLock, $utf8)
  $versionsWritten = $true

  $releaseUrl = $env:SMARTASSISTANCE_API_BASE_URL
  $releaseToken = $env:SMARTASSISTANCE_BETA_API_TOKEN
  Remove-Item Env:SMARTASSISTANCE_API_BASE_URL -ErrorAction SilentlyContinue
  Remove-Item Env:SMARTASSISTANCE_BETA_API_TOKEN -ErrorAction SilentlyContinue
  & npm.cmd run check
  if ($LASTEXITCODE -ne 0) { throw "Validation failed with exit code $LASTEXITCODE." }

  $env:SMARTASSISTANCE_API_BASE_URL = $releaseUrl
  $env:SMARTASSISTANCE_BETA_API_TOKEN = $releaseToken
  & npm.cmd run build --workspace @smartassistance/extension
  if ($LASTEXITCODE -ne 0) { throw "Release build failed with exit code $LASTEXITCODE." }

  $builtManifest = Get-Content (Join-Path $distributionPath "manifest.json") -Raw | ConvertFrom-Json
  if ($builtManifest.version -ne $Version) { throw "Built manifest version does not match $Version." }
  $hostPermission = [string]$builtManifest.host_permissions[0]
  if (-not $hostPermission.StartsWith("$($apiUri.GetLeftPart([UriPartial]::Authority))/")) {
    throw "Built host permission does not match the release API origin."
  }
  Compress-Archive -Path (Join-Path $distributionPath "*") -DestinationPath $temporaryArchivePath -Force

  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $releaseArchive = [System.IO.Compression.ZipFile]::OpenRead($temporaryArchivePath)
  try {
    $archiveManifest = (Read-ZipEntry -Archive $releaseArchive -Name "manifest.json") | ConvertFrom-Json
    $archiveWorker = Read-ZipEntry -Archive $releaseArchive -Name "service-worker.js"
    $nestedEntries = @($releaseArchive.Entries | Where-Object FullName -match '^(dist|apps)/')
  } finally { $releaseArchive.Dispose() }
  if ($archiveManifest.version -ne $Version -or $nestedEntries.Count -ne 0) {
    throw "Release archive validation failed."
  }
  if ($archiveWorker.Contains("http://127.0.0.1:8787")) { throw "Release archive contains the local API URL." }
  Move-Item -LiteralPath $temporaryArchivePath -Destination $archivePath -Force
  $hash = (Get-FileHash $archivePath -Algorithm SHA256).Hash
  Write-Output "Chrome Web Store package ready: $archivePath"
  Write-Output "Version: $Version"
  Write-Output "SHA-256: $hash"
} catch {
  if ($versionsWritten) {
    [IO.File]::WriteAllText($manifestPath, $originalManifest, $utf8)
    [IO.File]::WriteAllText($packagePath, $originalPackage, $utf8)
    [IO.File]::WriteAllText($lockPath, $originalLock, $utf8)
  }
  throw
} finally {
  if (Test-Path -LiteralPath $temporaryArchivePath) {
    Remove-Item -LiteralPath $temporaryArchivePath -Force
  }
  Pop-Location
}
