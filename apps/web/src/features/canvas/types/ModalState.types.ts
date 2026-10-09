export type ModalState =
  | null
  | { type: "save" }
  | { type: "update" }
  | { 
      type: "confirm-new"; 
      title: string; 
      description: string; 
      confirmLabel: string; 
      warnings: Array<{ icon: "danger" | "warning"; text: string }> 
    }
  | { type: "confirm-deploy" }
  | { type: "delete" };