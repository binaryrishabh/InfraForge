import type { Resource } from "../interface/Resource.interface";
import type { ConnectionLine } from "../interface/ConnectionLine.interface";

// Set the state for undo/redo of resource elements on the canvas.
export type UndoCanvasResourceAction =
| { type: "delete"; resource: Resource; connectionLines: ConnectionLine[]; savedState: boolean }
| { type: "add"; resource: Resource; connectionLines: ConnectionLine[]; savedState: boolean }
| { type: "move"; resourceId: string; fromX: number; fromY: number; toX: number; toY: number; savedState: boolean }
| { type: "delete-connection"; connectionLine: ConnectionLine; savedState: boolean };