// Trusted, offline derivative-image fixture. Never installed in a release.
// Every workload is finite even if the enforcement being tested is broken.
export const stressFixture = String.raw`
import {readFileSync,writeFileSync,openSync,closeSync,readdirSync} from 'node:fs';
import {createInterface} from 'node:readline';
const cgroup=n=>readFileSync('/sys/fs/cgroup/'+n,'utf8').trim();
const send=v=>process.stdout.write(JSON.stringify(v)+'\n');
send({kind:'ready',source:'FIXTURE_SOURCE',enforcement:{memory:cgroup('memory.max'),swap:cgroup('memory.swap.max'),
 cpu:cgroup('cpu.max'),pids:cgroup('pids.max'),uid:process.getuid(),gid:process.getgid(),
 limits:readFileSync('/proc/self/limits','utf8'),status:readFileSync('/proc/self/status','utf8')}});
const lines=createInterface({input:process.stdin})[Symbol.asyncIterator]();
await lines.next();const input=JSON.parse((await lines.next()).value);
const counters=()=>Object.fromEntries(cgroup('cpu.stat').split('\n').map(s=>s.split(/\s+/)).map(([k,v])=>[k,Number(v)]));
let value={};
if(input.probe==='controls'){
 const files=[];let fdDenied=false,readonly=false;
 try{writeFileSync('/app/forbidden','x')}catch(e){readonly=e.code==='EROFS'}
 try{for(let i=0;i<160;i++)files.push(openSync('/tmp/fd-'+i,'w'))}catch(e){fdDenied=e.code==='EMFILE'}
 files.forEach(closeSync);
 value={fdDenied,files:files.length,readonly,interfaces:readdirSync('/sys/class/net').sort()};
}
if(input.probe==='pids'){
 const children=[];let denied=false;
 try{for(let i=0;i<80;i++)children.push(Bun.spawn(['/bin/sleep','5'],{stdin:'ignore',stdout:'ignore',stderr:'ignore'}))}
 catch(e){denied=/EAGAIN|temporarily unavailable/i.test(String(e))}
 value={denied,count:children.length,events:cgroup('pids.events')};
 for(const c of children)c.kill('SIGKILL');await Promise.all(children.map(c=>c.exited));
}
if(input.probe==='quota'){const before=counters(),start=Date.now();while(Date.now()-start<4000)Math.sqrt(Math.random());value={before,after:counters(),elapsedMs:Date.now()-start};}
if(input.probe==='cpu'){const start=Date.now();while(Date.now()-start<70000)Math.sqrt(Math.random());}
if(input.probe==='memory'){const blocks=[];for(let i=0;i<20;i++)blocks.push(new Uint8Array(64*1024*1024).fill(7));await Bun.sleep(1000);}
if(input.probe==='wall')await Bun.sleep(70000);
if(input.probe==='output'){for(let i=0;i<40;i++)process.stdout.write('x'.repeat(1024*1024));await Bun.sleep(1000);}
send({kind:'probe',value});send({kind:'done'});process.exit(0);
`;
