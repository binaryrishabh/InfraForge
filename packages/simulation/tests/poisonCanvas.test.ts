import { test, expect } from 'bun:test';
import { design, prepare, hash } from './asyncCanvas.fixture';
import { contractFromDesign } from '../src/model2/product/fromDesign';
import { compileProduct } from '../src/model2/product/compiler';
import { withRunLength } from '../src/model2/product/runContract';
import { createProductModel2 } from '../src/model2/product/run';

function compile(share?: number) {
 const d=design(true,3.5);if(share!==undefined)d.resources.find(r=>r.id==='worker')!.asyncWorker!.badJobPercent=share;
 const a=prepare(d),c=compileProduct(d,withRunLength(a.contract,35,'async-proof'));if(!c.ok)throw Error(JSON.stringify(c));
 return {d,a,compiled:c.value};
}

test('absent poison settings retain pre-edit slice 1 bytes and explicit zero changes only authored provenance',()=>{
 const old=compile(),zero=compile(0);
 const run=(c:typeof old.compiled)=>{const r=createProductModel2(c);r.advanceTo(35000000);return r.evidence();};
 expect({contract:hash(old.a.contract),compiled:hash(old.compiled),assumptions:hash(old.a.assumptions),evidence:hash(run(old.compiled))}).toEqual({contract:'ebb8d4e2ecc8fd8e2fe26dc90829ecceb36db3f6e6a278550a17718294ae2aad',compiled:'aa036942b9ce49c1b50c92f852757301c7a73496b8aaa57d1715d95cbe450102',assumptions:'fde40806e9d0323e26c114c1bfa80166dd32ac18143f4be8be149f64c85aad03',evidence:'140a1de603d9fac509eb07ae419959cac6fbb438d5b38538a0365ced828ddab5'});
 const baseline=run(old.compiled),explicit=run(zero.compiled);
 expect(explicit.provenance.ledger.filter(r=>r.id==='worker.asyncWorker.badJobPercent')).toHaveLength(1);
 expect({...explicit,provenance:{...explicit.provenance,ledger:explicit.provenance.ledger.filter(r=>r.id!=='worker.asyncWorker.badJobPercent')}}).toEqual(baseline);
});

test('poison share selects bounded publisher root keys deterministically from seed and identity',()=>{
 const a=compile(10),b=compile(10),low=compile(5),all=compile(100);
 const keys=(c:typeof a)=>{const w=c.compiled.input.resources.find(r=>r.kind==='async-worker')!;if(w.kind!=='async-worker')throw Error();return w.poisonKeys;};
 expect(keys(a).length).toBeGreaterThan(0);expect(keys(a)).toEqual(keys(b));expect(keys(low).every(k=>keys(a).includes(k))).toBe(true);expect(keys(all)).toHaveLength(123);
 expect(keys(a).every(k=>JSON.parse(k)[0]==='root')).toBe(true);
 expect(a.a.contract.ledger.find(r=>r.id==='worker.asyncWorker.badJobPercent')!.provenance[0]!.source).toBe('saved-design:worker.asyncWorker.badJobPercent');
 const changed=compileProduct(a.d,{...a.a.contract,seed:'other-seed'});expect(changed.ok).toBe(true);if(changed.ok)expect(changed.value.input.resources.find(r=>r.kind==='async-worker')).not.toEqual(a.compiled.input.resources.find(r=>r.kind==='async-worker'));
});

test('optional poison settings validate without injecting into earlier designs and retain DLQ provenance',()=>{
 for(const share of [-1,101,0.5,NaN,Infinity]) {const d=design();d.resources.find(r=>r.id==='worker')!.asyncWorker!.badJobPercent=share;expect('refused' in contractFromDesign(d)).toBe(true);}
 for(const capacity of [-1,1001,1.5,NaN]) {const d=design();d.resources.find(r=>r.id==='queue')!.asyncQueue!.deadLetterCapacity=capacity;expect('refused' in contractFromDesign(d)).toBe(true);}
 const d=design();d.resources.find(r=>r.id==='queue')!.asyncQueue!.deadLetterCapacity=0;
 expect(prepare(d).compiled.semantic.numericOrigins.some(r=>r.origin==='user-authored' && r.sources.includes('saved-design:queue.asyncQueue.deadLetterCapacity'))).toBe(true);
 const a=compile(10);a.a.contract.nodes.worker!.asyncBadJobPercent=undefined;expect(compileProduct(a.d,a.a.contract).ok).toBe(false);
});
