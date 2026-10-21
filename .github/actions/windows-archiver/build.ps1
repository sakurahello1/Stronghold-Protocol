# CI-only: the system bsdtar 3.8.9 crashes on names outside the Windows code page.
# https://github.com/libarchive/libarchive/issues/3681
# https://github.com/libarchive/libarchive/pull/3696
# v3.8.10 was released before that fix: pin the merged fix itself, not a moving branch.
param([Parameter(Mandatory = $true)][string] $Destination)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$archiveCommit = '8c4d7d77d3b68701809ddfd3c1a8bf42ef42dfe3'
$archiveHash = '72c8155e13342210bc421f1a1e4b31c96ef502b128e127d2e9dab3722c4e48a0'
$zlibHash = '72af66d44fcc14c22013b46b814d5d2514673dda3d115e64b690c1ad636e7b17'
$buildRoot = Join-Path $env:RUNNER_TEMP ('sp-archiver-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $buildRoot | Out-Null

function Get-VerifiedSource([string] $Url, [string] $Name, [string] $Hash) {
    $download = Join-Path $buildRoot $Name
    Invoke-WebRequest -Uri $Url -OutFile $download
    if ((Get-FileHash -LiteralPath $download -Algorithm SHA256).Hash.ToLowerInvariant() -ne $Hash) {
        throw "SHA256 mismatch for $Name"
    }
    Expand-Archive -LiteralPath $download -DestinationPath $buildRoot
}

function Invoke-CMake([string[]] $Arguments) {
    & cmake @Arguments
    if ($LASTEXITCODE -ne 0) { throw "CMake failed ($LASTEXITCODE): $Arguments" }
}

Get-VerifiedSource "https://codeload.github.com/libarchive/libarchive/zip/$archiveCommit" 'libarchive.zip' $archiveHash
Get-VerifiedSource 'https://github.com/madler/zlib/releases/download/v1.3.1/zlib131.zip' 'zlib.zip' $zlibHash

$zlibSource = Join-Path $buildRoot 'zlib-1.3.1'
$zlibBuild = Join-Path $buildRoot 'zlib-build'
$zlibInstall = Join-Path $buildRoot 'zlib-install'
Invoke-CMake @('-S', $zlibSource, '-B', $zlibBuild, '-A', 'x64', "-DCMAKE_INSTALL_PREFIX=$zlibInstall", '-DZLIB_BUILD_EXAMPLES=OFF')
Invoke-CMake @('--build', $zlibBuild, '--config', 'Release', '--target', 'install', '--parallel', '4')

$archiveSource = Join-Path $buildRoot "libarchive-$archiveCommit"
$archiveBuild = Join-Path $buildRoot 'libarchive-build'
$zlibLibrary = Join-Path $zlibInstall 'lib/zlibstatic.lib'
if (!(Test-Path -LiteralPath $zlibLibrary -PathType Leaf)) { throw 'Pinned static zlib was not built' }
Invoke-CMake @(
    '-S', $archiveSource, '-B', $archiveBuild, '-A', 'x64',
    '-DBUILD_SHARED_LIBS=OFF', '-DENABLE_TAR=ON', '-DENABLE_TAR_SHARED=OFF',
    '-DENABLE_TEST=OFF', '-DENABLE_CPIO=OFF', '-DENABLE_CAT=OFF', '-DENABLE_UNZIP=OFF',
    '-DENABLE_ZLIB=ON', "-DZLIB_LIBRARY=$zlibLibrary", "-DZLIB_INCLUDE_DIR=$zlibInstall/include",
    '-DENABLE_BZip2=OFF', '-DENABLE_LZMA=OFF', '-DENABLE_LZO=OFF', '-DENABLE_LZ4=OFF', '-DENABLE_ZSTD=OFF',
    '-DENABLE_OPENSSL=OFF', '-DENABLE_MBEDTLS=OFF', '-DENABLE_NETTLE=OFF', '-DENABLE_LIBB2=OFF',
    '-DENABLE_LIBXML2=OFF', '-DENABLE_EXPAT=OFF', '-DENABLE_BSDXML=OFF', '-DENABLE_ICONV=OFF',
    '-DENABLE_PCREPOSIX=OFF', '-DENABLE_PCRE2POSIX=OFF', '-DENABLE_WERROR=OFF'
)
Invoke-CMake @('--build', $archiveBuild, '--config', 'Release', '--target', 'bsdtar', '--parallel', '4')

$builtTar = Join-Path $archiveBuild 'bin/Release/bsdtar.exe'
if (!(Test-Path -LiteralPath $builtTar -PathType Leaf)) { throw 'Pinned bsdtar.exe was not built' }
New-Item -ItemType Directory -Path $Destination -Force | Out-Null
Copy-Item -LiteralPath $builtTar -Destination (Join-Path $Destination 'tar.exe')
Write-Output "Built libarchive $archiveCommit with zlib 1.3.1; source SHA256 checks passed."
