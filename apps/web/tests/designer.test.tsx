import { afterEach, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { useCanvasStore } from "../src/features/canvas/store/canvasStore";
import { addResource, connectResources, deleteResource, nudgeResource, updateResource } from "../src/features/canvas/actions";
import { redo, undo } from "../src/features/canvas/history";
import { CanvasResourceItem } from "../src/features/canvas/components/CanvasResourceItem";
import { Inspector } from "../src/features/canvas/components/inspector/Inspector";

afterEach(() => useCanvasStore.getState().clearCanvas());
const state = () => useCanvasStore.getState();

test("placing, connecting, moving and removing resources are undoable and follow the connection rules", () => {
  const lb = addResource("Load Balancer", { x: 0, y: 0 })!;
  const vm = addResource("Virtual Machine", { x: 480, y: 0 })!;
  expect(state().resources).toHaveLength(2);
  expect(connectResources(vm.id, lb.id)).toBe(false);
  expect(connectResources(lb.id, vm.id)).toBe(true);
  expect(state().connectionLines[0]).toMatchObject({ sourceId: lb.id, targetId: vm.id, port: 80 });
  expect(connectResources(lb.id, vm.id)).toBe(false);
  undo();
  expect(state().connectionLines).toHaveLength(0);
  redo();
  expect(state().connectionLines).toHaveLength(1);
  nudgeResource(vm.id, 1, 0);
  expect(state().resources.find((r) => r.id === vm.id)?.x).toBe(504);
  deleteResource(vm.id);
  expect(state().resources).toHaveLength(1);
  expect(state().connectionLines).toHaveLength(0);
  undo();
  expect(state().resources).toHaveLength(2);
  expect(state().connectionLines).toHaveLength(1);
});

test("a locked challenge run cannot be edited through any action", () => {
  const vm = addResource("Virtual Machine", { x: 0, y: 0 })!;
  useCanvasStore.setState({ liveLocked: true });
  expect(addResource("Database", { x: 480, y: 0 })).toBeNull();
  updateResource(vm.id, { public: true });
  nudgeResource(vm.id, 1, 0);
  deleteResource(vm.id);
  expect(state().resources).toEqual([vm]);
});

test("nodes are keyboard operable and announce how to act on them", () => {
  const html = renderToStaticMarkup(<CanvasResourceItem resource={{ id: "vm1", name: "api", type: "Virtual Machine", x: 0, y: 0 }} />);
  expect(html).toContain('role="button"'); expect(html).toContain('tabindex="0"');
  expect(html).toContain("api, Virtual Machine. Arrow keys move, Delete removes, Enter inspects");
});

test("the inspector exposes what the security scan checks and describes autoscaling honestly", () => {
  const lb = { id: "lb", type: "Load Balancer" as const, x: 0, y: 0 };
  const html = renderToStaticMarkup(<Inspector resource={lb} />);
  expect(html).toContain("Publicly reachable"); expect(html).toContain("Encryption"); expect(html).toContain("Open ports");
  expect(html).toContain('role="switch"');
  expect(html).toContain("it does not start extra servers at launch");
  expect(html).toContain("After 5 seconds above the target CPU, one replica is added. It takes 60 seconds to come online.");
  // Server rendering reads the store's initial state, so the connection list is empty here.
  expect(html).toContain("Not connected yet.");
});

test("retry edits can be undone and redone and are locked during a run", () => {
  const lb = addResource("Load Balancer", {x:0,y:0})!;
  const retry = { enabled:true, maxAttempts:2, backoffMs:100, jitterRatio:0.2, maxConcurrentRetries:4, retryOn:["timeout" as const] };
  updateResource(lb.id,{retry});
  expect(state().resources[0]!.retry).toEqual(retry);
  undo(); expect(state().resources[0]!.retry).toBeUndefined();
  redo(); expect(state().resources[0]!.retry).toEqual(retry);
  useCanvasStore.setState({liveLocked:true});
  updateResource(lb.id,{retry:{enabled:false}});
  expect(state().resources[0]!.retry).toEqual(retry);
  useCanvasStore.setState({liveLocked:false,isDeploying:true});
  updateResource(lb.id,{retry:{enabled:false}});
  expect(state().resources[0]!.retry).toEqual(retry);
  useCanvasStore.setState({isDeploying:false});
});

test("retry inspector explains total attempts, failure groups and ambiguous writes", () => {
  const retry = { enabled:true, maxAttempts:2, backoffMs:100, jitterRatio:0.2, maxConcurrentRetries:4, retryOn:["timeout" as const] };
  const html=renderToStaticMarkup(<Inspector resource={{id:"lb",type:"Load Balancer",x:0,y:0,retry}} />);
  for(const text of ["Retry failed requests","Maximum attempts","Backoff","Jitter","Concurrent retry limit","Connection failure","Timeout","Overload","Backend failure","Writes with an unclear result are never retried"]) expect(html).toContain(text);
  const unknown=renderToStaticMarkup(<Inspector resource={{id:"lb",type:"Load Balancer",x:0,y:0,retry:{enabled:true}}} />);
  expect(unknown).toContain('placeholder="Unknown"');
  const vm=renderToStaticMarkup(<Inspector resource={{id:"app",type:"Virtual Machine",x:0,y:0}} />);
  expect(vm).not.toContain("Retry failed requests");
});

test("circuit breaker edits undo/redo, lock during live runs and describe the two learner settings", () => {
  const lb=addResource("Load Balancer",{x:0,y:0})!;
  const circuitBreaker={enabled:true,failureThreshold:3,cooldownMs:1000};
  updateResource(lb.id,{circuitBreaker}); expect(state().resources[0]!.circuitBreaker).toEqual(circuitBreaker);
  undo(); expect(state().resources[0]!.circuitBreaker).toBeUndefined(); redo(); expect(state().resources[0]!.circuitBreaker).toEqual(circuitBreaker);
  useCanvasStore.setState({liveLocked:true}); updateResource(lb.id,{circuitBreaker:{enabled:false}});
  expect(state().resources[0]!.circuitBreaker).toEqual(circuitBreaker); useCanvasStore.setState({liveLocked:false});
  const html=renderToStaticMarkup(<Inspector resource={{...lb,circuitBreaker}} />);
  for(const text of ["Circuit breaker","Open after N failures","Wait before testing again","one test request"]) expect(html).toContain(text);
});
