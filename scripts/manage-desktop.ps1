[CmdletBinding()]
param(
  [ValidateSet('install','remove','list')][string]$Action='list',
  [string]$Archive,
  [string]$DesktopExe=(Join-Path $env:LOCALAPPDATA 'Programs\DeepSeek Harness\DeepSeek Harness.exe'),
  [switch]$CheckOnly
)
$previousErrorAction=$ErrorActionPreference
$ErrorActionPreference='Stop'
$previous=$env:ELECTRON_RUN_AS_NODE
try{
  if($CheckOnly -and $Action -ne 'install'){throw '-CheckOnly is supported only with -Action install.'}
  $projectRoot=Split-Path -Parent $PSScriptRoot
  $manifestPath=Join-Path $projectRoot 'package.json'
  $manifest=Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
  $packageName=[string]$manifest.name
  $packageVersion=[string]$manifest.version
  if($packageName -notmatch '^(?:@[a-z0-9][a-z0-9._~-]*/)?[a-z0-9][a-z0-9._~-]*$'){throw 'Invalid package name in local manifest.'}
  if($packageVersion -notmatch '^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$'){throw 'Invalid package version in local manifest.'}
  if($Action -eq 'install'){
    if(-not $Archive){
      $archiveName=($packageName -replace '^@','' -replace '/','-')+'-'+$packageVersion+'.tgz'
      $Archive=Join-Path (Join-Path $projectRoot 'artifacts') $archiveName
    }
    if(-not(Test-Path -LiteralPath $Archive -PathType Leaf)){
      throw ('Package archive not found: '+$Archive+'. Build and pack '+$packageName+'@'+$packageVersion+', or pass -Archive with an explicit current package. Older archives are never selected automatically.')
    }
    $file=Get-Item -LiteralPath $Archive -ErrorAction Stop
    if($file.PSIsContainer -or $file.Extension -ne '.tgz'){throw 'Pass the local packaged tgz, not an unverified registry package.'}
    $verify=Join-Path $PSScriptRoot 'verify-package.mjs'
    if(-not(Test-Path -LiteralPath $verify -PathType Leaf)){throw 'Missing packaged archive validator: scripts/verify-package.mjs.'}
  }
  if(-not(Test-Path -LiteralPath $DesktopExe -PathType Leaf)){throw 'Desktop executable not found; pass the confirmed running installation.'}
  $installDir=Split-Path -Parent $DesktopExe
  $cli=Join-Path $installDir 'resources\app.asar\dsh\node_modules\@deepseek-ai\dsh-desktop-host\lib\cli.js'
  $env:ELECTRON_RUN_AS_NODE='1'
  $arguments=@($cli,'plugin','--profile','desktop')
  if($Action -eq 'install'){
    # The Desktop Node carrier runs a read-only validator before the official CLI.
    # Explicit -Archive changes the location, never the required current identity.
    & $DesktopExe $verify '--check-only' $file.FullName | Out-Host
    $verifyCode=$LASTEXITCODE
    if($null -eq $verifyCode -or $verifyCode -ne 0){throw 'Archive preflight failed; Desktop installation was not attempted.'}
    if($CheckOnly){return}
    $arguments+=@('add',$file.FullName,'--ignore-scripts')
  }elseif($Action -eq 'remove'){$arguments+=@('remove',$packageName)}
  else{$arguments+=@('list','--depth=0')}
  # Only the official Desktop CLI may mutate the protected profile.
  & $DesktopExe @arguments | Out-Host
  $code=$LASTEXITCODE
  if($null -eq $code){throw 'Desktop CLI process exit was not observed; inspect installation before retry.'}
  if($code -ne 0){throw ('Desktop plugin manager exited '+$code)}
}finally{
  $env:ELECTRON_RUN_AS_NODE=$previous
  $ErrorActionPreference=$previousErrorAction
}
