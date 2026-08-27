import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { toast } from "sonner";
import { useDeploymentSocket } from "@/features/deployment/hooks/useDeploymentSocket";
import {
  getDeploymentsOfInfrastructure,
  getSpecificInfrastructure,
} from "@/api/infrastructure.api";
import { teardownDeployment } from "@/api/deployment.api";
import { DeploymentStatus } from "@shared/enum/DeploymentStatus.enum";
import { ReadOnlyCanvas } from "./ReadOnlyCanvas";
import { LiveLogsPanel } from "./LiveLogsPanel";
import { LoadControlPanel } from "./LoadControlPanel";
import { ChaosControlPanel } from "./ChaosControlPanel";
import { ConfirmModal } from "@/components/UI/ConfirmModal";
import { CostBreakdownPanel } from "./panels/CostBreakdownPanel";
import { SecurityIssuesPanel } from "./panels/SecurityIssuesPanel";
import { TimelinePanel } from "./panels/TimelinePanel";
import { PastDeploymentsPanel } from "./panels/PastDeploymentsPanel";
import type { Infrastructure } from "@shared/interface/Infrastructure.interface";
import type { Resource } from "@shared/interface/Resource.interface";
import type { ConnectionLine } from "@shared/interface/ConnectionLine.interface";
import type { Deployment } from "@shared/interface/Deployment.interface";

export function MonitoringDashboard() {
  const { deploymentId } = useParams<{ deploymentId: string }>();
  const { deployment, status, timeline } = useDeploymentSocket(deploymentId!);
  const [infrastructure, setInfrastructure] = useState<Infrastructure | null>(
    null,
  ); // Infrastructure becuase deloyment doesn't have resources it only has resourceCount and here we need resources.
  const [pastDeployments, setPastDeployments] = useState<Deployment[]>([]);
  const [showTeardownConfirm, setShowTeardownConfirm] = useState(false);
  const [teardownLoading, setTeardownLoading] = useState(false);

  useEffect(() => {
    const getInfrastructureAndDeployments = async () => {
      if (deployment?.infrastructureId) {
        const Infrastructure = await getSpecificInfrastructure(
          deployment?.infrastructureId,
        );
        setInfrastructure(Infrastructure);
        const deployments = await getDeploymentsOfInfrastructure(
          deployment?.infrastructureId,
        );
        setPastDeployments(deployments);
      }
    };
    getInfrastructureAndDeployments();
  }, [deployment?.infrastructureId]);

  if (!deployment || !infrastructure) {
    return (
      <div className="h-screen bg-[#0f1117] text-white flex items-center justify-center">
        Loading...
      </div>
    );
  }

  const resources: Resource[] = infrastructure.layout.resources || [];
  const connectionLines: ConnectionLine[] =
    infrastructure.layout.connectionLines || [];

  return (
    <div className="h-screen bg-[#0f1117] text-white flex flex-col">
      {/* Header */}
      <div className="h-12 bg-gray-950 border-b border-gray-800 flex items-center justify-between px-4 shrink-0">
        <h1 className="text-sm font-semibold">InfraForge - Monitoring</h1>
        <div className="flex items-center gap-3">
          <span
            className={`text-xs ${
              status === DeploymentStatus.COMPLETED
                ? "text-green-400"
                : status === DeploymentStatus.LIVE
                  ? "text-emerald-400"
                  : status === DeploymentStatus.FAILED
                    ? "text-red-400"
                    : status === DeploymentStatus.RUNNING
                      ? "text-blue-400"
                      : status === DeploymentStatus.TORN_DOWN
                        ? "text-gray-500"
                        : "text-gray-400"
            }`}
          >
            {status}
          </span>
          {status === DeploymentStatus.LIVE && (
            <button
              onClick={() => setShowTeardownConfirm(true)}
              className="h-7 px-3 rounded-lg bg-[rgba(240,86,74,0.10)] border border-[rgba(240,86,74,0.35)] text-[12px] font-medium text-[#F0564A] hover:bg-[rgba(240,86,74,0.18)] transition-colors duration-150"
            >
              Tear down
            </button>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 flex overflow-hidden">
        {/* Diagram - min area */}
        <div className="flex-1 p-4">
          <ReadOnlyCanvas
            resources={resources}
            connectionLines={connectionLines}
          />
        </div>

        {/* Side panels */}
        <div className="w-80 border-l border-gray-800 overflow-y-auto p-4 space-y-4">
          <LoadControlPanel deploymentId={deploymentId!} status={status} />
          <ChaosControlPanel deploymentId={deploymentId!} status={status} resources={resources} />
          <CostBreakdownPanel deployment={deployment} />
          <SecurityIssuesPanel deployment={deployment} />
          <TimelinePanel timeline={timeline} />
          <LiveLogsPanel />
          <PastDeploymentsPanel pastDeployments={pastDeployments} />
        </div>
      </div>

      {showTeardownConfirm && (
        <ConfirmModal
          open={true}
          onOpenChange={(open) => {
            if (!open && !teardownLoading) setShowTeardownConfirm(false);
          }}
          title="Tear down environment?"
          description="This stops the simulation permanently for this deployment. The canvas snapshot and deployment history remain."
          consequences={[
            {
              icon: "danger",
              text: "The live simulation will stop and cannot be resumed.",
            },
          ]}
          confirmLabel="Tear down"
          intent="danger"
          loading={teardownLoading}
          onConfirm={async () => {
            setTeardownLoading(true);
            try {
              await teardownDeployment(deploymentId!);
              setShowTeardownConfirm(false);
              toast.success("Environment torn down");
            } catch {
              toast.error("Failed to tear down");
            } finally {
              setTeardownLoading(false);
            }
          }}
        />
      )}
    </div>
  );
}