import { expect, test } from "bun:test";
import { EventKernel } from "../src/model2/time";
import { apiGateway } from "../src/model2/gateway/run";
import { gatewayQuotaBuckets } from "../src/model2/gateway/quota";
import type { GatewayConfig, GatewayReply } from "../src/model2/gateway/contracts";
import type { Invocation } from "../src/model2/workload/contracts";
import { prepare, design } from "./asyncCanvas.fixture";

function config(scope: "shared" | "per-route"): GatewayConfig {
  const broker=prepare(design()).compiled.input.resources.find(r=>r.kind==="delivery-queue")!;
  if(broker.kind!=="delivery-queue")throw Error("queue");
  const q=<U extends "count" | "us" | "bytes">(value:number,unit:U)=>({kind:"known" as const,value,unit,provenance:["test"]});
  return {...broker,id:"gateway",kind:"api-gateway",profile:"exact-route-gateway/1",quota:{profile:"gateway-quota/1",scope},demands:{route:broker.demands.publish!},
    maxRequestBytes:q(100,"bytes"),requestEnvelopeBytes:q(0,"bytes"),maxInFlight:q(10,"count"),upstreamTimeout:q(1000,"us"),
    routes:[{id:"read",target:"readApp",path:"/read",method:"GET",burst:q(1,"count"),refillEvery:q(1000,"us")},
      {id:"write",target:"writeApp",path:"/write",method:"POST",burst:q(1,"count"),refillEvery:q(1000,"us")}]};
}
test("shared quota has one conserved credit, refills at integer boundaries and cannot bank excess idle refill",()=>{
  const clock=new EventKernel(100),buckets=gatewayQuotaBuckets(config("shared"),clock);
  expect(buckets.take(0)).toBe(true);expect(buckets.take(1)).toBe(false);
  clock.advanceTo(999);expect(buckets.take(1)).toBe(false);
  clock.advanceTo(1000);expect(buckets.take(1)).toBe(true);expect(buckets.take(0)).toBe(false);
  clock.advanceTo(10000);expect(buckets.reading(0).tokens).toBe(1);expect(buckets.reading(1).tokens).toBe(1);
  buckets.reading(0).tokens=999;expect(buckets.take(0)).toBe(true);expect(buckets.take(1)).toBe(false);
  expect([0,1].map(i=>buckets.reading(i))).toMatchObject([{received:3,admitted:2,rejected:1},{received:4,admitted:1,rejected:3}]);
});
test("cancelling an admitted shared request does not refund its credit to another route",()=>{
  const clock=new EventKernel(10000),gateway=apiGateway(config("shared"),clock,()=>({admitted:true,state:()=>"waiting",cancel:()=>"unsupported"}));
  const send=(id:string,operation:"read"|"write")=>{
    const work:Invocation={rootId:id,callId:id,attempt:1,offeredAt:clock.now,operation};
    const receipt=gateway.accept(work,()=>{});return {receipt,work};
  };
  const read=send("a","read");expect(read.receipt.admitted).toBe(true);expect(read.receipt.cancel()).toBe("cancelled");
  const write=send("b","write");expect(write.receipt.admitted).toBe(false);expect((write.work.message!.response as GatewayReply).status).toBe(429);
  expect(gateway.readings()).toMatchObject({cancelled:1,throttled:1,routes:[{admitted:1,outcomes:{cancelled:1}},{rejected:1}]});
  clock.advanceTo(1000);expect(send("c","write").receipt.admitted).toBe(true);
});
