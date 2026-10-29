import { expect, test } from "bun:test";
import { LayoutSchema, LiveTopologySchema } from "../zod_schemas/layout.schema";
import { configuration, fields } from "../comparison/design";

test("layout and live topology validate security ownership, versions, ports and canvas scopes", () => {
  const db = { id: "db", type: "Database", x: 0, y: 0, listenerSettings: {version:1,ports:[]} };
  const firewall = { id: "fw", type: "Firewall", x: 0, y: 0, firewallSettings: {version:1,default:"deny",rules:[{id:"deny",priority:0,direction:"ingress",source:"any",destination:"db",fromPort:1,toPort:65535,action:"deny"}]} };
  for (const schema of [LayoutSchema, LiveTopologySchema]) {
    const base = {resources:[db,firewall],connectionLines:[]};
    expect(schema.safeParse(base).success).toBe(true);
    for (const patch of [{version:2,ports:[]},{version:1,ports:[1,1]},{version:1,ports:[65536]},{version:1,ports:[],extra:true}]) expect(schema.safeParse({...base,resources:[{...db,listenerSettings:patch}]}).success).toBe(false);
    expect(schema.safeParse({...base,resources:[{...db,firewallSettings:firewall.firewallSettings}]}).success).toBe(false);
    const bad = structuredClone(firewall); bad.firewallSettings.rules[0]!.destination = "missing";
    expect(schema.safeParse({...base,resources:[db,bad]}).success).toBe(false);
    const good=firewall.firewallSettings.rules[0]!;
    for(const rules of [[good,good],[{...good,priority:-1}],[{...good,direction:"both"}],[{...good,source:"fw"}],[{...good,fromPort:0}],[{...good,fromPort:6000,toPort:5000}],[{...good,action:"drop"}],[{...good,id:""}],[{...good,extra:true}],Array.from({length:33},(_,i)=>({...good,id:`rule-${i}`}))])expect(schema.safeParse({...base,resources:[db,{...firewall,firewallSettings:{...firewall.firewallSettings,rules}}]}).success).toBe(false);
  }
});

test("design comparison retains explicit empty listeners and ordered firewall settings",()=>{
  const base={id:"db",type:"Database" as const,x:0,y:0};
  const listenerSettings={version:1 as const,ports:[]};
  expect(fields(configuration(base),configuration({...base,listenerSettings}))).toEqual([{field:"listenerSettings",earlier:null,later:listenerSettings}]);
  const fw={...base,type:"Firewall" as const}, firewallSettings={version:1 as const,default:"deny" as const,rules:[]};
  expect(fields(configuration(fw),configuration({...fw,firewallSettings}))).toEqual([{field:"firewallSettings",earlier:null,later:firewallSettings}]);
});
