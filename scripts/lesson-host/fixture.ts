// Trusted test-only entrypoint, copied into a derivative of the approved image.
// Every stress loop is finite even if a kernel limit is unexpectedly ineffective.
export const fixture = `import { sandboxReady } from './sandboxHandshake';
import {createInterface} from 'node:readline';
import {readFileSync,writeFileSync,openSync,chmodSync,readdirSync,statfsSync} from 'node:fs';
const lines=createInterface({input:process.stdin})[Symbol.asyncIterator]();
const request=JSON.parse((await lines.next()).value);
const send=(value)=>process.stdout.write(JSON.stringify(value)+'\\n');
send(sandboxReady());
if(request.fixture!=='wall'){send({kind:'probe-ready'});if(JSON.parse((await lines.next()).value).continue!==true)process.exit(1);}
const read=(file)=>readFileSync('/sys/fs/cgroup/'+file,'utf8').trim();
const counters=()=>Object.fromEntries(read('cpu.stat').split('\\n').map(s=>s.split(/\\s+/)).map(([k,v])=>[k,Number(v)]));
if(request.fixture==='cpu'){const end=Date.now()+12000;while(Date.now()<end)Math.sqrt(Math.random());}
if(request.fixture==='memory'){const blocks=[];for(let i=0;i<10;i++)blocks.push(new Uint8Array(64*1024*1024).fill(7));await Bun.sleep(1000);}
if(request.fixture==='wall')await Bun.sleep(60000);
if(request.fixture==='quota'){
 const before=counters(),start=Date.now(),children=[];
 try{for(let i=0;i<2;i++)children.push(Bun.spawn([process.execPath,'-e','const end=Date.now()+8000;while(Date.now()<end)Math.sqrt(Math.random());'],{stdin:'ignore',stdout:'ignore',stderr:'ignore'}));await Bun.sleep(4000);}
 finally{for(const c of children)c.kill('SIGKILL');await Promise.all(children.map(c=>c.exited));}
 send({kind:'controls',value:{before,after:counters(),elapsedMs:Date.now()-start}});
}
if(request.fixture==='pids'){
 const children=[];let denied=false;
 try{for(let i=0;i<80;i++)children.push(Bun.spawn(['/bin/sleep','10'],{stdin:'ignore',stdout:'ignore',stderr:'ignore'}));}
 catch(e){denied=/EAGAIN|temporarily unavailable/i.test(String(e));}
 const count=children.length;for(const c of children)c.kill('SIGKILL');await Promise.all(children.map(c=>c.exited));
 send({kind:'controls',value:{denied,count}});
}
if(request.fixture==='controls'){
 let readonly=false,files=0,fdDenied=false;try{writeFileSync('/app/forbidden','x')}catch(e){readonly=e.code==='EROFS'}
 writeFileSync('/tmp/exec-probe','#!/bin/sh\\nexit 0\\n');chmodSync('/tmp/exec-probe',0o700);
 let noexec=false;try{const p=Bun.spawn(['/tmp/exec-probe'],{stdin:'ignore',stdout:'ignore',stderr:'ignore'});await p.exited;}catch(e){noexec=/EACCES|Permission denied/i.test(String(e))}
 const fs=statfsSync('/tmp'),status=readFileSync('/proc/self/status','utf8');
 const value={readonly,noexec,uid:process.getuid(),gid:process.getgid(),tmpType:fs.type,tmpBytes:fs.blocks*fs.bsize,
  interfaces:readdirSync('/sys/class/net').sort(),capabilities:/^CapEff:\\s+0+$/m.test(status),noNewPrivileges:/^NoNewPrivs:\\s+1$/m.test(status)};
 try{for(;files<160;files++)openSync('/tmp/fd-'+files,'w')}catch(e){fdDenied=e.code==='EMFILE'}
 send({kind:'controls',value:{...value,files,fdDenied}});
}
send({kind:'done'});process.exit(0);
`;
