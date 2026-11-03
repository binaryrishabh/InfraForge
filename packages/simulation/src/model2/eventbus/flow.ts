import type { PublisherConfig } from "../async/contracts";
import type { SavedProductDesign, ProductContract, EdgeContract } from "../product/contracts";
import type { Resource, ConnectionLine } from "@infraforge/domain/resource";

export function validateBusPublish(design: SavedProductDesign, contract: ProductContract, source: Resource, bus: Resource, drawn: ConnectionLine | undefined, binding: EdgeContract | undefined, publisher: PublisherConfig | undefined) {
  const outputs = (id: string) => design.connections.filter(e => e.sourceId === id).map(e => design.resources.find(r => r.id === e.targetId)!);
  const stores = outputs(source.id).filter(r => r.type === "Object Storage");
  const queues = outputs(bus.id);
  if (source.applicationFlow?.schema !== "application-flow/3" || contract.applicationFlowProfile !== "application-flow/3" || contract.caller.entry !== `$${source.id}` || source.autoscaling?.enabled || source.asyncWorker?.enabled || !drawn || binding?.purpose !== "consumer" || binding.sourceRole !== "publisher" || binding.targetRole !== contract.nodes[bus.id]?.primary || publisher?.kind !== "async-publisher" || publisher.broker !== bus.id || stores.length !== 1 || publisher.store !== stores[0]!.id || queues.length < 1 || queues.length > 16 || queues.some(q => q.type !== "Message Queue" || !q.asyncQueue?.enabled || outputs(q.id).filter(w => w.asyncWorker?.enabled).length !== 1 || outputs(q.id).filter(w => w.asyncWorker?.enabled).some(w => !outputs(w.id).some(s => s.id === stores[0]!.id)))) throw Error("Event Bus publish requires its fixed producer, queues, workers and shared upload store");
}
