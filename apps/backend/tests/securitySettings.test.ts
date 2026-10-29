import { expect, test } from "bun:test";
import { LayoutSchema, LiveTopologySchema } from "../zod_schemas/layout.schema";

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
  }
});
