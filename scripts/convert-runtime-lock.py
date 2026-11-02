# Convert build-only pylock manifests into the plugin's audited artifact lock.
from pathlib import Path
from urllib.parse import urlparse,unquote
import json,tomllib,urllib.request,sys
root=Path(__file__).resolve().parents[1]
build=root/'artifacts'/'runtime-lock-build'
out=root/'resources'/'runtime-lock.json'
if out.exists(): raise RuntimeError('Existing runtime resource lock must be reviewed before replacing')

def metadata(url):
    with urllib.request.urlopen(url,timeout=30) as r: return json.load(r)

def asset(item,name=None,version=None):
    result={'filename':unquote(Path(urlparse(item['url']).path).name),'url':item['url'],'size':item['size'],'sha256':item.get('hashes',item.get('digests',{}))['sha256']}
    if name: result={'name':name,'version':version,**result}
    return result

lock={'schemaVersion':1,'platform':'win32','arch':'x64','pymobiledevice3':'11.45.0',
'fallback':{'version':'3.13.18','archive':{'filename':'cpython-3.13.18+20261026-x86_64-pc-windows-msvc-install_only_stripped.tar.gz','url':'https://github.com/astral-sh/python-build-standalone/releases/download/20261026/cpython-3.13.18%2B20261026-x86_64-pc-windows-msvc-install_only_stripped.tar.gz','size':22023022,'sha256':'7369f7a35f261222a6ac8b3a87c1c88eeebee8af945d85346202591a64038dd3'},'rootDir':'python','executable':'python/python.exe'},
'environments':{}}
summary=[]
for minor in [9,10,11,12,13,14]:
    abi='cp3'+str(minor)
    file=build/f'pylock.{abi}.toml'
    if not file.exists(): continue
    data=tomllib.loads(file.read_text(encoding='utf8'))
    wheels=[]
    for package in data['packages']:
        options=package.get('wheels',[])
        if not options: raise RuntimeError('No binary wheel for '+package['name'])
        # uv has already filtered for target tags; prefer the smallest matching pure wheel when present.
        pure=[x for x in options if x['url'].endswith('-none-any.whl')]
        chosen=min(pure or options,key=lambda x:x['size'])
        wheels.append(asset(chosen,package['name'],package['version']))
    pip_version='25.3' if minor==9 else '26.2.2'
    pm=metadata('https://pypi.org/pypi/pip/'+pip_version+'/json')
    pip=asset(next(x for x in pm['urls'] if x['filename'].endswith('-py3-none-any.whl')),'pip',pip_version)
    env={'python':'3.'+str(minor),'pip':pip,'wheels':wheels,'requirements':[f"{x['name']}=={x['version']} --hash=sha256:{x['sha256']}" for x in wheels]}
    lock['environments'][abi]=env
    summary.append({'abi':abi,'packages':len(wheels),'downloadBytes':sum(x['size'] for x in wheels)+pip['size']})
if 'cp313' not in lock['environments']: raise RuntimeError('Missing fallback ABI')
out.parent.mkdir(parents=True,exist_ok=True)
out.write_text(json.dumps(lock,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
(build/'lock-summary.json').write_text(json.dumps(summary,indent=2),encoding='utf8')
print(json.dumps(summary,indent=2))
