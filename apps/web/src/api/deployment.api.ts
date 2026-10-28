import { http as axios } from "../client/httpClient";
import type { Deployment } from "@infraforge/contracts/deployment";
import type { WorkloadProfile } from "@infraforge/domain/workload";
import type { Resource } from "@infraforge/domain/resource";
import type { ConnectionLine } from "@infraforge/domain/resource";
import { API_URL } from "../client/httpClient";
import type { RunAction } from "@infraforge/contracts/actions";
import { actInBrowser, browserRunFor, browserStopStatus, isBrowserStop, stopBrowserRun } from "@/features/model2Run/browserRuns";

// A Model 2 run executing in this browser takes its controls locally; everything else goes to the server.

export interface LiveDeploymentSummary {
  id: string;
  infrastructureId: string;
  infrastructureName: string;
  resourceCount: number;
  challengeId: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}

/* ------------------Deployment api calls--------------- */

// Fetch all currently LIVE deployments for the dashboard reattach card
export const getLiveDeployments = async (): Promise<LiveDeploymentSummary[]> => {
  const response = await axios.get(`${API_URL}/deployments/live`);
  return response.data.deployments;
}

// Create new deployment
export const createDeployment = async(infrastructureId: string, workloadProfile?: WorkloadProfile): Promise<Deployment> => {
  const response = await axios.post(`${API_URL}/deployments`, {
    infrastructureId,
    workloadProfile
  });
  return response.data.createdDeployment;
}

// Fetch data of existing deployment
export const getSpecificDeployment = async(deploymentId: string): Promise<Deployment> => {
  const response = await axios.get(`${API_URL}/deployments/${deploymentId}`);
  return response.data.deployment;
}

// Adjust the live load target of a LIVE deployment (0..2 = 0%..200% of declared capacity)
export const setDeploymentLoad = async(deploymentId: string, targetLoadFraction: number): Promise<string> => {
  if (browserRunFor(deploymentId)) return actInBrowser(deploymentId, { kind: "load", parameters: { targetLoadFraction } });
  const response = await axios.post(`${API_URL}/deployments/${deploymentId}/load`, {
    targetLoadFraction
  });
  return response.data.message;
}

// Tear down a LIVE deployment — stops the simulation permanently
export const teardownDeployment = async(deploymentId: string): Promise<RunAction> => {
  if (browserRunFor(deploymentId)) return stopBrowserRun(deploymentId);
  const response = await axios.post(`${API_URL}/deployments/${deploymentId}/teardown`);
  return response.data.action;
}

export const getRunAction = async (deploymentId: string, actionId: string): Promise<RunAction> => {
  if (isBrowserStop(actionId)) return browserStopStatus(deploymentId);
  const response = await axios.get(`${API_URL}/deployments/${deploymentId}/actions/${actionId}`);
  return response.data.action;
};

// Inject a chaos event into a LIVE deployment
export const injectChaos = async(deploymentId: string, type: string, resourceId: string): Promise<string> => {
  if (browserRunFor(deploymentId)) return actInBrowser(deploymentId, { kind: "chaos", parameters: { type: type as never, resourceId } });
  const response = await axios.post(`${API_URL}/deployments/${deploymentId}/chaos`, {
    type,
    resourceId
  });
  return response.data.message;
}

// Vertical scaling — swap a resource's SKU with realistic restart downtime
export const scaleVertical = async(deploymentId: string, resourceId: string, skuId: string): Promise<string> => {
  const response = await axios.post(`${API_URL}/deployments/${deploymentId}/scale-vertical`, {
    resourceId,
    skuId
  });
  return response.data.message;
}

// Manual horizontal scale — nudge a VM pool's replica count up or down on a LIVE deployment
export const scalePool = async(deploymentId: string, lbId: string, delta: number): Promise<string> => {
  if (browserRunFor(deploymentId)) return actInBrowser(deploymentId, { kind: "pool-scale", parameters: { lbId, delta: delta as 1 | -1 } });
  const response = await axios.post(`${API_URL}/deployments/${deploymentId}/scale-pool`, {
    lbId,
    delta
  });
  return response.data.message;
}

// Set the simulation speed of a LIVE deployment (0=pause, 1, 10, 60)
export const setDeploymentSpeed = async (deploymentId: string, speed: number): Promise<string> => {
  if (browserRunFor(deploymentId)) return actInBrowser(deploymentId, { kind: "speed", parameters: { speed: speed as 0 | 1 | 10 | 60 } });
  const response = await axios.post(`${API_URL}/deployments/${deploymentId}/speed`, { speed });
  return response.data.message;
};

// Push a live topology edit to the running simulator. The simulator reconciles
// reachability and pools without pausing; the saved infrastructure layout is
// untouched (that only changes on explicit Save/Update).
export const syncDeploymentTopology = async (
  deploymentId: string,
  resources: Resource[],
  connectionLines: ConnectionLine[],
  expectedRevision: number,
): Promise<number> => {
  const response = await axios.post(
    `${API_URL}/deployments/${deploymentId}/sync-topology`,
    { resources, connectionLines, expectedRevision }
  );
  return response.data.topologyRevision;
}
