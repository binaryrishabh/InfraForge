import axios from "axios";
import type { Deployment } from "@shared/interface/Deployment.interface";
import type { WorkloadProfile } from "@shared/interface/WorkloadProfile.interface";
import { API_URL } from "../client/httpClient";

/* ------------------Deployment api calls--------------- */

// Create new deployment
export const createDeployment = async(infrastructureId: string, workloadProfile?: WorkloadProfile): Promise<Deployment> => {
  const response = await axios.post(`${API_URL}/deployments`, {
    infrastructureId,
    workloadProfile
  });
  console.log(response.data.createdDeployment.id);
  return response.data.createdDeployment;
}

// Fetch data of existing deployment
export const getSpecificDeployment = async(deploymentId: string): Promise<Deployment> => {
  const response = await axios.get(`${API_URL}/deployments/${deploymentId}`);
  return response.data.deployment;
}

// Adjust the live load target of a LIVE deployment (0..2 = 0%..200% of declared capacity)
export const setDeploymentLoad = async(deploymentId: string, targetLoadFraction: number): Promise<string> => {
  const response = await axios.post(`${API_URL}/deployments/${deploymentId}/load`, {
    targetLoadFraction
  });
  return response.data.message;
}

// Tear down a LIVE deployment — stops the simulation permanently
export const teardownDeployment = async(deploymentId: string): Promise<string> => {
  const response = await axios.post(`${API_URL}/deployments/${deploymentId}/teardown`);
  return response.data.message;
}

// Inject a chaos event into a LIVE deployment
export const injectChaos = async(deploymentId: string, type: string, resourceId: string): Promise<string> => {
  const response = await axios.post(`${API_URL}/deployments/${deploymentId}/chaos`, {
    type,
    resourceId
  });
  return response.data.message;
}

// Vertical scale — swap a resource's SKU on a LIVE deployment (the resource restarts during the swap)
export const scaleVertical = async(deploymentId: string, resourceId: string, skuId: string): Promise<string> => {
  const response = await axios.post(`${API_URL}/deployments/${deploymentId}/scale-vertical`, {
    resourceId,
    skuId
  });
  return response.data.message;
}

// Manual horizontal scale — nudge a VM pool's replica count up or down on a LIVE deployment
export const scalePool = async(deploymentId: string, lbId: string, delta: number): Promise<string> => {
  const response = await axios.post(`${API_URL}/deployments/${deploymentId}/scale-pool`, {
    lbId,
    delta
  });
  return response.data.message;
}