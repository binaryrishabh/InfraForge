import { useEffect } from "react";
import { toast } from "sonner";
import { getAllInfrastructure } from "@/api/infrastructure.api";
import { useCanvasStore } from "../store/canvasStore";
import type { Infrastructure } from "@shared/interface/Infrastructure.interface";

export function useInfrastructureDropdown() {
  const showLayoutDropdown = useCanvasStore((s) => s.showLayoutDropdown);

  useEffect(() => {
    const fetchInfrastructures = async () => {
      try {
        const allInfrastructures = await getAllInfrastructure();
        useCanvasStore.getState().setSavedLayouts(allInfrastructures);
      } catch (err) {
        console.log("fetchInfrastructures error: " + err);
      }
    };
    fetchInfrastructures();
  }, []);

  const handleOpenCloseDropDownNameClick = () => {
    useCanvasStore.getState().setShowLayoutDropdown(!showLayoutDropdown);
  };

  const handleSelectLayout = (infrastructure: Infrastructure) => {
    const store = useCanvasStore.getState();
    if (store.isDeploying) {
      toast.warning("A deployment is in progress. Can't select");
      return;
    }
    store.setCurrentLayoutId(infrastructure.id);
    store.setCurrentLayoutName(infrastructure.name);
    store.setResources(infrastructure.layout.resources || []);
    store.setConnectionLines(infrastructure.layout.connectionLines || []);
    store.setCurrentLayoutSaved(true);
    store.setShowLayoutDropdown(false);
    store.setActiveDeploymentId(null);
    store.setIsDeploying(false);
    store.setSelectedResourceId(null);
    store.setUndoStack([]);
    store.setRedoStack([]);
  };

  useEffect(() => {
    const handleClickOutsideRemoveDropdown = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (!target.closest(".dropdown-container")) {
        useCanvasStore.getState().setShowLayoutDropdown(false);
      }
    };
    if (showLayoutDropdown) {
      document.addEventListener("click", handleClickOutsideRemoveDropdown);
    }
    return () => document.removeEventListener("click", handleClickOutsideRemoveDropdown);
  }, [showLayoutDropdown]);

  return { handleOpenCloseDropDownNameClick, handleSelectLayout };
}