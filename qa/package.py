#!/usr/bin/env python3
"""Create a runtime-only WordPress plugin ZIP/TAR and SHA256 manifest."""
import hashlib,json,tarfile,zipfile
from pathlib import Path
root=Path(__file__).resolve().parents[1];out=root/'releases';out.mkdir(exist_ok=True)
files=[root/'portare-product-gallery.php',root/'uninstall.php',root/'LICENSE',root/'README.md',root/'readme.txt']
for directory in ['assets','includes','docs','migrations']:
 files.extend(p for p in (root/directory).rglob('*') if p.is_file())
manifest={str(p.relative_to(root)):hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(files)}
slug='portare-product-gallery'
with zipfile.ZipFile(out/(slug+'-0.1.1.zip'),'w',zipfile.ZIP_DEFLATED) as z:
 for p in files:z.write(p,str(Path(slug)/p.relative_to(root)))
with tarfile.open(out/(slug+'-0.1.1.tar.gz'),'w:gz') as t:
 for p in files:t.add(p,arcname=str(Path(slug)/p.relative_to(root)))
(out/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print('Packaged',len(files),'runtime/documentation files')
print(out/(slug+'-0.1.1.zip'))
