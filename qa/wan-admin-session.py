#!/usr/bin/env python3
"""Run read-only staging UI QA with a new 15-minute session; revoke only it.
No passwords, credential prints, Wan execution, paid generation or product saves.
Requires the reviewed candidate to be deployed separately first.
"""
import hashlib,importlib.util,json,os,pathlib,subprocess,tempfile
ROOT=pathlib.Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('wan_stage',ROOT/'qa/wan-stage.py')
if spec is None or spec.loader is None:
 raise RuntimeError('Cannot load guarded staging transport')
stage=importlib.util.module_from_spec(spec)
spec.loader.exec_module(stage)

def evaluate(code):
 remote='/tmp/ppg-wan-admin-session-qa.php';data=code.encode()
 stage.remote('umask 077; cat > '+remote,data)
 try:
  if hashlib.sha256(data).hexdigest() not in stage.remote('sha256sum '+remote).decode():raise RuntimeError('Session helper upload mismatch')
  raw=stage.remote(stage.WP+' eval-file '+remote).decode()
  return json.loads(raw.split('PPG_SESSION_RESULT:',1)[1].splitlines()[0])
 finally:stage.remote('rm -f '+remote)

def main():
 stage.guard()
 session=evaluate('''<?php
 if(home_url()!=='https://portare.up.railway.app'||wp_get_environment_type()!=='staging'){throw new RuntimeException('Wrong site');}
 global $wpdb;
 $count=(int)$wpdb->get_var($wpdb->prepare("SELECT COUNT(*) FROM {$wpdb->options} WHERE option_name LIKE %s",$wpdb->esc_like('_ppg_ai_job_').'%'));
 if($count!==0){throw new RuntimeException('Existing Wan jobs: refuse automatic status polling during agent QA');}
 $ids=get_users(array('role'=>'administrator','number'=>1,'fields'=>'ID','orderby'=>'ID','order'=>'ASC'));
 if(!$ids){throw new RuntimeException('No staging administrator');}
 $uid=(int)$ids[0];$expires=time()+900;$manager=WP_Session_Tokens::get_instance($uid);$token=$manager->create($expires);
 if(!$manager->get($token)){throw new RuntimeException('Session creation read-back failed');}
 $cookies=array();foreach(array(SECURE_AUTH_COOKIE=>'secure_auth',LOGGED_IN_COOKIE=>'logged_in') as $name=>$scheme){$cookies[]=array('name'=>$name,'value'=>wp_generate_auth_cookie($uid,$expires,$scheme,$token),'url'=>'https://portare.up.railway.app/','httpOnly'=>true,'secure'=>true,'sameSite'=>'Lax');}
 echo 'PPG_SESSION_RESULT:'.json_encode(array('uid'=>$uid,'token'=>$token,'cookies'=>$cookies)).PHP_EOL;
 ''')
 out=pathlib.Path(tempfile.mkdtemp(prefix='ppg-wan-staging-',dir=os.environ.get('TMPDIR',str(pathlib.Path.home()/'.hermes/cache/scratch'))));os.chmod(out,0o700)
 cookies=out/'session.cookies.json'
 try:
  fd=os.open(cookies,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
  with os.fdopen(fd,'w') as f:json.dump(session['cookies'],f)
  env=dict(os.environ,PPG_WAN_RESULTS=str(out),PPG_COOKIE_FILE=str(cookies))
  result=subprocess.run(['node',str(ROOT/'tests/wan-staging.browser.cjs')],cwd=ROOT,env=env,timeout=180)
  if result.returncode:raise RuntimeError('Staging browser verification failed')
  print('Private staging evidence:',out)
 finally:
  cookies.unlink(missing_ok=True)
  # This is our newly created token, never another operator's session.
  payload=json.dumps({'uid':session['uid'],'token':session['token']})
  import base64
  encoded=base64.b64encode(payload.encode()).decode()
  revoked=evaluate("<?php $v=json_decode(base64_decode('"+encoded+"'),true);$m=WP_Session_Tokens::get_instance((int)$v['uid']);$m->destroy($v['token']);echo 'PPG_SESSION_RESULT:'.json_encode(array('revoked'=>!$m->get($v['token']))).PHP_EOL;")
  if not revoked.get('revoked'):raise RuntimeError('QA session revocation was not verified')
  print('Exact temporary QA session revoked and verified')
if __name__=='__main__':main()
