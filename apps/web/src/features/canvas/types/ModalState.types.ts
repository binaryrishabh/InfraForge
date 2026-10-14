export type ModalState =
  | null
  | { type: "save" }
  | { type: "rename" }
  | { type: "confirm-new"; title: string; description: string; confirmLabel: string; warnings: string[] }
  | { type: "confirm-deploy" }
  | { type: "attempt" }
  | { type: "delete" };
