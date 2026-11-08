// Isolated effect lifecycle seam; the real store, actions and persistence hook run.
// This does not claim browser scheduling or keyboard automation.
import assert from "node:assert/strict";
import { mock } from "bun:test";
import * as React from "react";
import { useCanvasStore } from "../../src/features/canvas/store/canvasStore";
import { updateResource } from "../../src/features/canvas/actions";
import { draftKey } from "../../src/features/auth/drafts";
const effects: Array<() => (() => void) | void> = [];
const cleanups: Array<() => void> = [];
mock.module("react", () => ({...React, useEffect: (effect: () => (() => void) | void) => { effects.push(effect); }}));
const owner = {user: {id: "pool-owner"}};
mock.module("../../src/features/auth/store/auth.store", () => ({useAuthStore: Object.assign((select: (state: typeof owner) => unknown) => select(owner), {getState: () => owner})}));
const values = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {configurable: true, value: {
 getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); },
}});
const { useCanvasPersistence } = await import("../../src/features/canvas/hooks/useCanvasPersistence");
function mount(hook: () => void) { hook(); for (const effect of effects.splice(0)) { const cleanup = effect(); if (cleanup) cleanups.push(cleanup); } }
function unmount() { for (const cleanup of cleanups.splice(0)) cleanup(); }
for (const value of [1, 2, 512, undefined]) {
 useCanvasStore.getState().clearCanvas(); useCanvasStore.getState().setIsInitialized(true);
 useCanvasStore.getState().loadLayout([{id: "db", type: "Database", x: 0, y: 0}], [], "layout", "Pool");
 mount(useCanvasPersistence); updateResource("db", {dbPoolMaxConnections: value});
 // Trigger persistence for the absence case too, where the resource edit is a no-op.
 useCanvasStore.getState().setCurrentLayoutSaved(false);
 await new Promise(resolve => setTimeout(resolve, 350)); unmount();
 const saved = JSON.parse(values.get(draftKey(owner.user.id))!) as {canvasResources: Array<{dbPoolMaxConnections?: number}>};
 assert.equal(saved.canvasResources[0]!.dbPoolMaxConnections, value);
 if (value === undefined) assert.equal("dbPoolMaxConnections" in saved.canvasResources[0]!, false);
 useCanvasStore.getState().clearCanvas(); useCanvasStore.getState().setIsInitialized(false);
 mount(useCanvasPersistence); assert.equal(useCanvasStore.getState().resources[0]!.dbPoolMaxConnections, value); unmount();
}
console.log("pool draft persistence and reload passed");
