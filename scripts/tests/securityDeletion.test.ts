import { expect, test, afterEach } from "bun:test";
import type { Resource } from "@infraforge/domain/resource";
import { LayoutSchema } from "../../apps/backend/zod_schemas/layout.schema";
import { useCanvasStore } from "../../apps/web/src/features/canvas/store/canvasStore";
import { deleteResource, deleteConnection } from "../../apps/web/src/features/canvas/actions";
import { undo, redo } from "../../apps/web/src/features/canvas/history";

afterEach(()=>useCanvasStore.getState().clearCanvas());
const db:Resource={id:"db",type:"Database",x:0,y:0};
const fw:Resource={id:"fw",type:"Firewall",x:1000,y:0,firewallSettings:{version:1,default:"deny",rules:[{id:"block-db",priority:0,direction:"ingress",source:"any",destination:"db",fromPort:5432,toPort:5432,action:"deny"}]}};

test("deleting a scoped service keeps saves valid and restores rules with one undo",()=>{
  const app:Resource={id:"app",type:"Virtual Machine",x:500,y:0,listenerSettings:{version:1,ports:[80]}};
  const firewall:Resource={...fw,x:1000,firewallSettings:{...fw.firewallSettings!,rules:[...fw.firewallSettings!.rules,{...fw.firewallSettings!.rules[0]!,id:"source-db",source:"db",destination:"app"},{...fw.firewallSettings!.rules[0]!,id:"keep-app",destination:"app"}]}};
  const line={id:"app-db",sourceId:"app",targetId:"db",sourceType:"Virtual Machine",targetType:"Database",port:5432};
  useCanvasStore.setState({resources:[db,app,firewall],connectionLines:[line],currentLayoutSaved:true});
  deleteConnection(line.id);
  expect(useCanvasStore.getState().resources).toEqual([db,app,firewall]);
  undo();
  deleteResource("db");
  const saved=()=>({resources:useCanvasStore.getState().resources,connectionLines:useCanvasStore.getState().connectionLines});
  expect(LayoutSchema.safeParse(saved()).success).toBe(true);
  expect(saved().resources.find(r=>r.id === "fw")!.firewallSettings!.rules.map(r=>r.id)).toEqual(["keep-app"]);
  undo();expect(saved().resources.find(r=>r.id === "fw")!.firewallSettings).toEqual(firewall.firewallSettings);
  expect(saved().connectionLines).toEqual([line]);expect(useCanvasStore.getState().currentLayoutSaved).toBe(true);
  redo();expect(LayoutSchema.safeParse(saved()).success).toBe(true);
});

