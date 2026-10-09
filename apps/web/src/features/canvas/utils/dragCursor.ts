const DRAGGING_BODY_CLASS = "infraforge-dragging";

/* Toggles a body-level grabbing cursor that overrides every element cursor
   while a drag (node move, canvas pan, or palette drag) is in flight.
   Pointer capture keeps events flowing, but the visible cursor follows the
   element under the pointer — this class guarantees "grabbing" everywhere. */
export function setGlobalDragCursor(active: boolean): void {
  document.body.classList.toggle(DRAGGING_BODY_CLASS, active);
}