import { useEffect, useState } from "react";
import { toast } from "sonner";
import { getAllInfrastructure } from "@/api/infrastructure.api";
import type { Infrastructure } from "@shared/interface/Infrastructure.interface";
import type { Resource } from "@shared/interface/Resource.interface";
import type { ConnectionLine } from "@shared/interface/ConnectionLine.interface";
import type { UndoCanvasResourceAction } from "@shared/types/UndoCanvasResourceAction.types";

interface UseInfrastructureDropdownProps {
  isDeploying: boolean;
  setCurrentLayoutId: (id: string | null) => void;
  setCurrentLayoutName: (name: string | null) => void;
  setCanvasResources: (resources: Resource[]) => void;
  setConnectionLines: (lines: ConnectionLine[]) => void;
  setCurrentLayoutSaved: (saved: boolean) => void;
  setShowLayoutDropdown: (show: boolean) => void;
  setActiveDeploymentId: (id: string | null) => void;
  setIsDeploying: (deploying: boolean) => void;
  setSelectedResource: (id: string | null) => void;
  setUndoResourcesSnapshotStackTrace: (stack: UndoCanvasResourceAction[]) => void;
  setRedoResourcesSnapshotStackTrace: (stack: UndoCanvasResourceAction[]) => void;
}

export function useInfrastructureDropdown({
  isDeploying,
  setCurrentLayoutId,
  setCurrentLayoutName,
  setCanvasResources,
  setConnectionLines,
  setCurrentLayoutSaved,
  // setShowLayoutDropdown,
  setActiveDeploymentId,
  setIsDeploying,
  setSelectedResource,
  setUndoResourcesSnapshotStackTrace,
  setRedoResourcesSnapshotStackTrace,
}: UseInfrastructureDropdownProps) {
  /* ----------------------Topbar dropdown------------------- */
  const [showLayoutDropdownState, setShowLayoutDropdownState] = useState<boolean>(false);
  const [savedLayouts, setSavedLayouts] = useState<Array<Infrastructure>>([]);

  // fetch infrastructure to fill dropdown
  useEffect(() => {
    const fetchInfrastructures = async () => {
      try {
        const allInfrastructures = await getAllInfrastructure();
        setSavedLayouts(allInfrastructures);
      } catch (err) {
        console.log("fetchInfrastructures error: " + err);
      }
    };
    fetchInfrastructures();
  }, []);

  // Handle open close of infrastructure dropdown button
  const handleOpenCloseDropDownNameClick = async () => {
    setShowLayoutDropdownState(!showLayoutDropdownState);
  };

  // Select particular infrastrcture from dropdown lists
  const handleSelectLayout = (infrastructure: Infrastructure) => {
    if (isDeploying) {
      // Deployement already in process
      toast.warning("A deployment is in progress. Can't select");
      return;
    }

    setCurrentLayoutId(infrastructure.id);
    setCurrentLayoutName(infrastructure.name);
    setCanvasResources(infrastructure.layout.resources || []);
    setConnectionLines(infrastructure.layout.connectionLines || []);
    setCurrentLayoutSaved(true);
    setShowLayoutDropdownState(false);
    setActiveDeploymentId(null);
    setIsDeploying(false);
    setSelectedResource(null);
    setUndoResourcesSnapshotStackTrace([]);
    setRedoResourcesSnapshotStackTrace([]);
  };

  // close dropdown by clicking anywhere except the dropdown itself
  useEffect(() => {
    const handleClickOutsideRemoveDropdown = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (!target.closest(".dropdown-container")) {
        setShowLayoutDropdownState(false);
      }
    };

    if (showLayoutDropdownState) {
      // add event listener only if dropdown is open
      document.addEventListener("click", handleClickOutsideRemoveDropdown);
    }

    return () =>
      document.removeEventListener("click", handleClickOutsideRemoveDropdown);
  }, [showLayoutDropdownState]);

  return {
    showLayoutDropdown: showLayoutDropdownState,
    savedLayouts,
    handleOpenCloseDropDownNameClick,
    handleSelectLayout,
  };
}