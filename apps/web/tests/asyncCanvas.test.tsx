import { test, expect } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AsyncSection } from "../src/features/canvas/components/inspector/AsyncSection";
import { DEFAULT_ASYNC_QUEUE_SETTINGS } from "@infraforge/domain/resource";

test("queue inspector renders absent measurements as Unknown with locked settings", () => {
  const html = renderToStaticMarkup(<AsyncSection resource={{ id: "queue", type: "Message Queue", x: 0, y: 0, asyncQueue: DEFAULT_ASYNC_QUEUE_SETTINGS }} disabled />);
  expect(html.match(/<dd>Unknown<\/dd>/g)).toHaveLength(10);
  expect(html).toContain("Oldest ready message age (seconds)");
  expect(html).toContain("disabled");
  expect(html).toContain("duplicate results");
  expect(html).not.toContain("[object Object]");
});

import { AsyncQueueReadings } from '../src/features/canvas/components/inspector/AsyncSection';
import { DEFAULT_ASYNC_WORKER_SETTINGS } from '@infraforge/domain/resource';
import { useCanvasStore } from '../src/features/canvas/store/canvasStore';
import { updateResource } from '../src/features/canvas/actions';
import { undo, redo } from '../src/features/canvas/history';

test('poison controls describe immediate nacks, overflow and deterministic finite sampling',()=>{
 const worker=renderToStaticMarkup(<AsyncSection resource={{id:'worker',type:'Virtual Machine',x:0,y:0,asyncWorker:DEFAULT_ASYNC_WORKER_SETTINGS}} disabled />);
 for(const text of ['Share of uploads that can never be processed','immediately nack','does not wait for lease expiry','run seed and upload identity','value="0"','disabled'])expect(worker).toContain(text);
 const queue=renderToStaticMarkup(<AsyncSection resource={{id:'queue',type:'Message Queue',x:0,y:0,asyncQueue:DEFAULT_ASYNC_QUEUE_SETTINGS}} disabled />);
 for(const text of ['Dead-letter list size','overflow is discarded and counted','Failed attempts (worker nacks sent)','Dead-letter overflow discards','CPU seconds spent on failed attempts'])expect(queue).toContain(text);
});

test('old revision and null failure readings render Unknown while observed zero stays zero',()=>{
 const base={published:0,completed:0,readyDepth:0,oldestReadyAgeSeconds:null,inFlight:0,redeliveries:0,deadLettered:0};
 const old=renderToStaticMarkup(<AsyncQueueReadings metrics={{version:1,...base}} />);
 expect(old.match(/<dd>Unknown<\/dd>/g)).toHaveLength(4);
 const unknown=renderToStaticMarkup(<AsyncQueueReadings metrics={{version:2,...base,failedAttempts:null,deadLetterOverflowDiscards:null,wastedCpuSeconds:null}} />);
 expect(unknown).toBe(old);
 const zero=renderToStaticMarkup(<AsyncQueueReadings metrics={{version:2,...base,failedAttempts:0,deadLetterOverflowDiscards:0,wastedCpuSeconds:0}} />);
 expect(zero.match(/<dd>Unknown<\/dd>/g)).toHaveLength(1);expect(zero.match(/<dd>0<\/dd>/g)).toHaveLength(9);
 expect(zero).not.toContain('[object Object]');
});

test('poison and dead-letter settings undo, redo and respect deployment/run locks',()=>{
 try {
  useCanvasStore.getState().clearCanvas();
  const worker={id:'worker',type:'Virtual Machine' as const,x:0,y:0,asyncWorker:{...DEFAULT_ASYNC_WORKER_SETTINGS}},queue={id:'queue',type:'Message Queue' as const,x:0,y:0,asyncQueue:{...DEFAULT_ASYNC_QUEUE_SETTINGS}};
  useCanvasStore.setState({resources:[worker,queue],liveLocked:false,isDeploying:false});
  updateResource('worker',{asyncWorker:{...worker.asyncWorker,badJobPercent:10}});
  updateResource('queue',{asyncQueue:{...queue.asyncQueue,deadLetterCapacity:2}});
  const changed=structuredClone(useCanvasStore.getState().resources);
  undo();expect(useCanvasStore.getState().resources[1]!.asyncQueue!.deadLetterCapacity).toBe(1000);
  undo();expect(useCanvasStore.getState().resources[0]!.asyncWorker!.badJobPercent).toBe(0);
  redo();redo();expect(useCanvasStore.getState().resources).toEqual(changed);
  for(const locks of [{liveLocked:true,isDeploying:false},{liveLocked:false,isDeploying:true}]){
   useCanvasStore.setState(locks);updateResource('worker',{asyncWorker:{...worker.asyncWorker,badJobPercent:50}});updateResource('queue',{asyncQueue:{...queue.asyncQueue,deadLetterCapacity:0}});expect(useCanvasStore.getState().resources).toEqual(changed);
  }
 } finally {useCanvasStore.getState().clearCanvas();useCanvasStore.setState({liveLocked:false,isDeploying:false});}
});
