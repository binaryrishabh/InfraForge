import { test, expect } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { FlowSection } from "../src/features/canvas/components/inspector/FlowSection";
import { useCanvasStore } from "../src/features/canvas/store/canvasStore";
import { updateResource } from "../src/features/canvas/actions";
import { undo, redo } from "../src/features/canvas/history";
import type { Resource } from "@infraforge/domain/resource";
import { validateConnection } from "@infraforge/domain/validation";
test("flow editor renders connected services, thresholds and missing-edge validation under run lock",()=>{
  const resource:Resource={id:"app",type:"Virtual Machine",x:0,y:0,applicationFlow:{schema:"application-flow/1",operations:{read:{steps:[{id:"parallel",kind:"parallel",wait:2,branches:[{id:"inventory",kind:"call",edge:"inventory-edge"},{id:"pricing",kind:"call",edge:"missing"}]}]}}}};
  useCanvasStore.setState({resources:[resource,{id:"inventory",type:"Virtual Machine",x:1,y:1}],connectionLines:[{id:"inventory-edge",sourceId:"app",targetId:"inventory",sourceType:"Virtual Machine",targetType:"Virtual Machine",port:80}]});
  const html=renderToStaticMarkup(<FlowSection resource={resource} disabled/>);
  expect(html).toContain("disabled");expect(html).toContain("thread-per-request: worker held while waiting");
  expect(html).toContain("inventory-edge");expect(html).toContain("Missing edge: missing");expect(html).toContain("Required responses");expect(html).not.toContain("[object Object]");
});
test("canvas can connect VM services and flow patches participate in undo/redo and run locking",()=>{
  expect(validateConnection("Virtual Machine","Virtual Machine").valid).toBe(true);expect(validateConnection("Virtual Machine","Load Balancer").valid).toBe(true);
  const resource:Resource={id:"app",type:"Virtual Machine",x:0,y:0};
  useCanvasStore.setState({resources:[resource],undoStack:[],redoStack:[],liveLocked:false,isDeploying:false});
  const applicationFlow:Resource["applicationFlow"]={schema:"application-flow/1",operations:{read:{steps:[{id:"cpu",kind:"compute"}]}}};
  updateResource("app",{applicationFlow});expect(useCanvasStore.getState().resources[0]!.applicationFlow).toEqual(applicationFlow);
  undo();expect(useCanvasStore.getState().resources[0]!.applicationFlow).toBeUndefined();redo();expect(useCanvasStore.getState().resources[0]!.applicationFlow).toEqual(applicationFlow);
  useCanvasStore.setState({liveLocked:true});updateResource("app",{applicationFlow:undefined});expect(useCanvasStore.getState().resources[0]!.applicationFlow).toEqual(applicationFlow);
  useCanvasStore.setState({liveLocked:false});
});
