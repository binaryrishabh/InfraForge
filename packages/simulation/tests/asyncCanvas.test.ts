import { test, expect } from 'bun:test';
import { design, prepare, hash } from './asyncCanvas.fixture';
import { createProductModel2 } from '../src/model2/product/run';
import { contractFromDesign } from '../src/model2/product/fromDesign';
test('existing queue contract, compiled input, assumptions and evidence retain pinned bytes',()=>{
 const a=prepare(design(false));const r=createProductModel2(a.compiled);r.advanceTo(10000000);
 expect({contract:hash(a.contract),compiled:hash(a.compiled),assumptions:hash(a.assumptions),evidence:hash(r.evidence())}).toEqual({contract:'7f91fddd4dd760a224607471d6ca343c22dfccc7f328e2dc6d9e700400b177ca',compiled:'24dff1955f8880e7553364bdac45086a58a541b51bb473bfdd8303723e5e946b',assumptions:'a34ebfbdb61243f406ebc7e95c39274e2994fddaba4eb4786164abf887d67dc2',evidence:'c3c014add9ab8b4b7ba78f2a78fe9d83501dda0ed4811394afad79da0137032e'});
});
test('canvas binds one publish to each served arrival and worker reads, writes and acknowledges',()=>{
 const a=prepare(design(true,1));const r=createProductModel2(a.compiled);r.advanceTo(10000000);const e=r.evidence();
 expect(e.asynchronous.brokers[0]!.accepted).toBe(10);
 expect(e.asynchronous.workers[0]!.acknowledged).toBe(10);
 expect(e.asynchronous.publishers[0]!.uploaded).toBe(10);
 expect(e.asynchronous.workers[0]!.effects).toBe(10);
 expect(e).toEqual((()=>{const b=createProductModel2(a.compiled);b.advanceTo(10000000);return b.evidence();})());
});
test('missing storage and incomplete authored settings are refused clearly',()=>{
 const d=design();d.connections=d.connections.filter(e=>e.targetId!=='store');
 const a=contractFromDesign(d);expect('refused' in a && a.refused.some(r=>r.message.includes('Object Storage'))).toBe(true);
 const b=design();b.resources.find(r=>r.id==='worker')!.asyncWorker!.prefetch=undefined;
 expect('refused' in contractFromDesign(b)).toBe(true);
});
