# Build-only wheel extraction: no pip or host site-packages are touched.
from pathlib import Path
import zipfile
root=Path(__file__).resolve().parents[1]/'artifacts'/'runtime-lock-build'
wheels=list(root.glob('uv-*-py3-none-win_amd64.whl'))
if len(wheels)!=1: raise RuntimeError('Expected one verified uv wheel')
dest=root/'uv-tool'
dest.mkdir(exist_ok=False)
with zipfile.ZipFile(wheels[0]) as archive:
    for entry in archive.infolist():
        parts=Path(entry.filename).parts
        if Path(entry.filename).is_absolute() or '..' in parts: raise RuntimeError('Unsafe build wheel path')
    archive.extractall(dest)
print(next(dest.rglob('uv.exe')))
