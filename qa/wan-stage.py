#!/usr/bin/env python3
"""Guarded staging transport. Never reads/executes Wan credentials or CLI.

Operations: inspect (read-only), backup (private local archive), runtime-source
(read immutable image files into deploy/wordpress), snapshot (protected content
hashes), deploy-plugin (requires --approve). No live site target is accepted.
"""
import argparse, base64, datetime, hashlib, io, json, os, pathlib, subprocess, tarfile
ROOT = pathlib.Path(__file__).resolve().parents[1]
CLI = pathlib.Path.home()/'.npm/_npx/79fa66f96c8fdacf/node_modules/@railway/cli/bin/railway'
PROJECT='66d5f189-f54a-4c5e-b07a-3c551d4fa44a'
ENV='1ce1855c-2ecd-424b-8069-6dc846604d62'
SERVICE='liveedge-web'
TARGET='https://portare.up.railway.app'
PRIVATE=pathlib.Path.home()/'.local/share/portare-backups/wan-20261103'
PLUGIN='/var/www/html/wp-content/plugins/portare-product-gallery'
WP='php /usr/local/bin/wp --path=/var/www/html --allow-root --skip-plugins --skip-themes'
RUNTIME={'railway-start.sh':'/usr/local/bin/railway-start.sh','wp-config.railway.php':'/opt/railway/wp-config.php','railway-health.php':'/opt/railway/railway-health.php','railway-media.php':'/opt/railway/railway-media.php','000-staging-isolation.php':'/opt/railway/000-staging-isolation.php','010-brizy-editor-lock.php':'/opt/railway/010-brizy-editor-lock.php','railway-brizy-media-hydration.php':'/opt/railway/railway-brizy-media-hydration.php','railway-action-scheduler.sh':'/opt/railway/railway-action-scheduler.sh','htaccess.railway':'/opt/railway/htaccess','runtime-config/httpd_config.conf':'/usr/local/lsws/conf/httpd_config.conf','runtime-config/docker.conf':'/usr/local/lsws/conf/templates/docker.conf'}
def remote(command, data=None):
 p=subprocess.run([str(CLI),'ssh','-p',PROJECT,'-e',ENV,'-s',SERVICE,'--',command],input=data,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=180)
 if p.returncode: raise RuntimeError('Railway SSH failed (output withheld; inspect locally): '+str(p.returncode))
 return p.stdout

def private_write(name,data):
 PRIVATE.mkdir(parents=True,exist_ok=True,mode=0o700);os.chmod(PRIVATE,0o700)
 p=PRIVATE/name
 fd=os.open(p,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
 with os.fdopen(fd,'wb') as f:f.write(data)
 return p

def guard():
 result=remote(WP+' option get home').decode().strip().splitlines()[-1]
 kind=remote(WP+' config get WP_ENVIRONMENT_TYPE').decode().strip().splitlines()[-1]
 if result!=TARGET or kind!='staging':raise RuntimeError('Staging identity mismatch; stopping')
 print('Verified staging:',result,kind)

def framed(command):
 raw=remote("printf '\nPPG_BEGIN\n'; "+command+" | base64 -w0; printf '\nPPG_END\n'")
 return base64.b64decode(raw.split(b'PPG_BEGIN\n',1)[1].split(b'\nPPG_END',1)[0],validate=True)

def main():
 a=argparse.ArgumentParser();a.add_argument('action',choices=['inspect','backup','runtime-source','snapshot','deploy-plugin']);a.add_argument('--approve',action='store_true');o=a.parse_args();guard()
 stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
 if o.action=='inspect':
  print(remote(WP+' plugin get portare-product-gallery --fields=name,status,version --format=json').decode())
  print(remote("printf 'Node: '; command -v node || true; printf 'ProcOpen: '; php -r 'echo function_exists(\"proc_open\")?\"yes\\n\":\"no\\n\";'").decode())
 elif o.action=='backup':
  data=framed('tar -czf - '+PLUGIN+' /usr/local/bin/railway-start.sh /opt/railway /var/www/html/wp-config.php /var/www/html/.railway-env.php /usr/local/lsws/conf/httpd_config.conf /usr/local/lsws/conf/templates/docker.conf')
  with tarfile.open(fileobj=io.BytesIO(data),mode='r:gz') as t: names=t.getnames()
  if not any('/portare-product-gallery/' in n for n in names):raise RuntimeError('Plugin absent from backup')
  p=private_write('installed-'+stamp+'.tgz',data)
  print('Private backup:',p,'bytes:',len(data),'sha256:',hashlib.sha256(data).hexdigest())
 elif o.action=='runtime-source':
  dest=ROOT/'deploy/wordpress';dest.mkdir(parents=True,exist_ok=True)
  for name,path in RUNTIME.items():
   data=framed('cat '+path)
   if b'<?php' not in data and name.endswith('.php'):raise RuntimeError('Invalid PHP source: '+name)
   p=dest/name;p.parent.mkdir(parents=True,exist_ok=True)
   if p.exists():raise RuntimeError('Refusing overwrite of '+str(p))
   p.write_bytes(data);print('Captured runtime:',name,hashlib.sha256(data).hexdigest())
 elif o.action=='snapshot':
  # Stable per-record authored content and metadata excluding edit heartbeat locks.
  code='''<?php
 global $wpdb;
 $ids=array(10440,11012,10966,11378);$out=array();
 foreach($ids as $id){$post=$wpdb->get_row($wpdb->prepare("SELECT ID,post_content,post_title,post_excerpt,post_status FROM {$wpdb->posts} WHERE ID=%d",$id),ARRAY_A);$meta=$wpdb->get_results($wpdb->prepare("SELECT meta_id,meta_key,meta_value FROM {$wpdb->postmeta} WHERE post_id=%d AND meta_key NOT IN ('_edit_lock','_edit_last') ORDER BY meta_id",$id),ARRAY_A);$out[$id]=array('post'=>hash('sha256',serialize($post)),'meta'=>array());foreach($meta as $row){$out[$id]['meta'][$row['meta_id']]=array('key'=>$row['meta_key'],'hash'=>hash('sha256',$row['meta_value']));}}
 echo 'PPG_SNAPSHOT:'.json_encode($out).PHP_EOL;
 '''
  path='/tmp/ppg-wan-snapshot.php'
  remote('cat > '+path,code.encode())
  try:raw=remote(WP+' eval-file '+path)
  finally:remote('rm -f '+path)
  line=raw.decode().split('PPG_SNAPSHOT:',1)[1].splitlines()[0];obj=json.loads(line)
  p=private_write('snapshot-'+stamp+'.json',json.dumps(obj,indent=2).encode());print('Protected snapshot:',p)
 elif o.action=='deploy-plugin':
  if not o.approve:raise RuntimeError('Explicit --approve required')
  archive=ROOT/'releases/portare-product-gallery-0.4.0.tar.gz'
  data=archive.read_bytes();digest=hashlib.sha256(data).hexdigest();tmp='/tmp/ppg-wan-candidate.tar.gz'
  remote('cat > '+tmp,data)
  got=remote('sha256sum '+tmp).decode()
  if digest not in got:raise RuntimeError('Uploaded archive hash mismatch')
  command="set -e; stage=$(mktemp -d /tmp/ppg-wan-stage.XXXXXX); trap 'rm -rf \"$stage\"' EXIT; tar -xzf "+tmp+" -C \"$stage\"; php -l \"$stage/portare-product-gallery/portare-product-gallery.php\"; for f in \"$stage\"/portare-product-gallery/includes/*.php; do php -l \"$f\" >/dev/null; done; cp -a \"$stage/portare-product-gallery/.\" "+PLUGIN+"/; chown -R nobody:nogroup "+PLUGIN+"; rm -f "+tmp
  remote(command)
  manifest=json.loads((ROOT/'releases/manifest.json').read_text())
  for name,expected in manifest.items():
   got=remote('sha256sum '+PLUGIN+'/'+name).decode()
   if expected not in got:raise RuntimeError('Installed hash mismatch: '+name)
  print('Installed and verified',len(manifest),'plugin files')
  print(remote(WP+' plugin get portare-product-gallery --fields=name,status,version --format=json').decode())
if __name__=='__main__': main()
