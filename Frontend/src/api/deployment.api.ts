import axios from "axios";
import type { Deployment } from "@shared/types/Deployment.types";
import type { WorkloadProfile } from "@shared/types/WorkloadProfile.types";
import { API_URL } from "./httpClient";

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