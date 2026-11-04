'use strict';
// Real process-boundary tests. All children are tiny local synthetic scripts;
// the installed Wan CLI, credentials and provider network are never used.
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const {spawn,execFileSync}=require('node:child_process');const {runCli}=require('../runtime/wan-runner.cjs');
function fixture(source){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ppg-process-'));const file=path.join(dir,'synthetic.cjs');fs.writeFileSync(file,source);return {dir,file,close(){fs.rmSync(dir,{recursive:true,force:true});}};}
function gone(pid){try{process.kill(pid,0);return false;}catch(e){if(e.code==='ESRCH')return true;throw e;}}
test('real owned child is killed and reaped on timeout',{timeout:10000},async()=>{
 const f=fixture("process.on('SIGTERM',()=>{});process.stdout.write(String(process.pid));setInterval(()=>{},1000);");
 try{const r=await runCli([],{cli:f.file,timeoutMs:400,env:{}});assert.equal(r.timedOut,true);const pid=Number(r.stdout);assert(pid>0);assert.equal(gone(pid),true);}finally{f.close();}
});
test('runner termination cancels its real owned detached child and removes handlers',{timeout:10000},async()=>{
 const f=fixture("process.stdout.write(String(process.pid));setInterval(()=>{},1000);");const before=process.listenerCount('SIGTERM');const started=Date.now();
 try{const r=await runCli([],{cli:f.file,timeoutMs:5000,env:{},spawnFn(...args){const child=spawn(...args);child.stdout.once('data',()=>setImmediate(()=>process.emit('SIGTERM')));return child;}});assert.equal(r.timedOut,true);assert.equal(gone(Number(r.stdout)),true);assert.equal(process.listenerCount('SIGTERM'),before);assert(Date.now()-started<2000,'cancellation must not wait for the 5-second CLI timeout');}finally{f.close();}
});
test('real stdout and stderr drain together without a pipe-capacity deadlock',{timeout:10000},async()=>{
 const f=fixture("process.stderr.write('e'.repeat(100000),()=>process.stdout.write('DONE'));");
 try{const r=await runCli([],{cli:f.file,timeoutMs:5000,env:{}});assert.equal(r.timedOut,false);assert.equal(r.stdout,'DONE');assert.equal(r.stderr.length,100000);}finally{f.close();}
});
test('PHP concurrently drains synthetic pipes and bounds process reap',{timeout:10000},()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ppg-php-process-'));const file=path.join(dir,'test.php');
 fs.writeFileSync(file,`<?php
 define('ABSPATH', __DIR__.'/');require $argv[1];
 $drain=new ReflectionMethod('PPG_Wan','drain_both');$close=new ReflectionMethod('PPG_Wan','close_owned_process');
 if(PHP_VERSION_ID<80100){$drain->setAccessible(true);$close->setAccessible(true);}
 $spec=array(0=>array('pipe','r'),1=>array('pipe','w'),2=>array('pipe','w'));
 $p=proc_open(array(PHP_BINARY,'-r','fwrite(STDERR,str_repeat("e",100000));fwrite(STDOUT,"DONE");'),$spec,$pipes);fclose($pipes[0]);
 $r=$drain->invoke(null,$pipes,100,150000,3);$close->invoke(null,$p,false);
 if($r['timed_out']||$r['stdout']!=='DONE'||strlen($r['stderr'])!==100000){throw new Exception('pipe drain failed');}
 $p=proc_open(array(PHP_BINARY,'-r','fclose(STDOUT);fclose(STDERR);sleep(20);'),$spec,$pipes);foreach($pipes as $pipe){fclose($pipe);}
 $start=microtime(true);$close->invoke(null,$p,false);if(microtime(true)-$start>3){throw new Exception('reap unbounded');}
 echo 'PASS synthetic PHP process boundaries';
 `);
 try{assert.match(execFileSync('php',[file,path.join(__dirname,'../includes/class-ppg-wan.php')],{encoding:'utf8',timeout:8000}),/PASS synthetic PHP/);}finally{fs.rmSync(dir,{recursive:true,force:true});}
});
