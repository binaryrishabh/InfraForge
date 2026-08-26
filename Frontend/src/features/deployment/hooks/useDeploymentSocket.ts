import { useEffect, useState } from "react";
import { getSpecificDeployment } from "@/api/deployment.api";
import { Publish } from "@shared/enum/Publish.enum";
import { WebSocketMessage } from "@shared/enum/WebSocketMessage.enum";
import { DeploymentStatus, type DeploymentStatusType } from "@shared/enum/DeploymentStatus.enum";
import { DeploymentStageStatus } from "@shared/enum/DeploymentStageStatus.enum";
import { DeploymentTimelineEventNames } from "@shared/enum/DeploymentTimelineEventNames.enum";
import type { Deployment } from "@shared/types/Deployment.types";
import type { DeploymentStages } from "@shared/types/DeploymentStages.types";
import type { DeploymentTimeline } from "@shared/types/DeploymentTimeline.types";
import { useSimulationStore } from "@/features/monitoring/store/simulationStore";
import type { SimulationSnapshot } from "@shared/types/SimulationSnapshot.types";

type PipelineUIStatus = DeploymentStatusType | "Web Socket connection error";

const WS_URL = import.meta.env.VITE_WS_URL || "ws://localhost:3001";

export function useDeploymentSocket(deploymentId: string) {
    const [ deployment, setDeployment ] = useState<Deployment | null>(null);
    const [ status, setStatus ] = useState<PipelineUIStatus>(DeploymentStatus.PENDING);
    const [ completedStages, setCompletedStages ] = useState<string[]>([]);
    const [ timeline, setTimeline ] = useState<Array<DeploymentTimeline>>([]);

    useEffect(() => {
        useSimulationStore.getState().reset();
        let isClose = false; // Component unmounted cleanup the ws connection
        let isServerStateFailed = false; // Deployment done or failed, so stop reconnecting and close wx connection.
        let ws: WebSocket;
        let retries = 0;
        let reconnectTimeout: ReturnType<typeof setTimeout>;

        const connect = async () => {
            // i. First fetch current state from DB
            try {
                const fetchedDeployment: Deployment = await getSpecificDeployment(deploymentId);
                if(fetchedDeployment && !isClose) {
                    // Restore pipeline state from Database
                    setDeployment(fetchedDeployment);
                    setStatus(fetchedDeployment.status);
                    setCompletedStages(
                        (fetchedDeployment.stages || [])
                            .filter((stage: DeploymentStages) => stage.status === DeploymentStageStatus.COMPLETED)
                            .map((stage: DeploymentStages) => stage.name)
                    )
                    setTimeline(fetchedDeployment.timeline || []);

                    //If fetchedDeployment already in it's final stage or completely failed by the worker server, don't open ws connection
                    if(fetchedDeployment.status === DeploymentStatus.COMPLETED || fetchedDeployment.status === DeploymentStatus.FAILED || fetchedDeployment.status === DeploymentStatus.TORN_DOWN) {
                        isServerStateFailed = true;
                        return;
                    }
                }
            }
            catch (err) {
                console.log("Resync of deployment status from DB failed: "+ err);
            }

            // Check isClose before creating WebSocket
            if(isClose) {
                return;
            }

            // ii. Now open websoket for live updates
            ws = new WebSocket(WS_URL);

            ws.onopen = () => {
                if(!isClose) {
                    retries = 0; // set it to 0 so after each connection retry starts exponential from 2 sec.
                    ws.send(JSON.stringify({ type: WebSocketMessage.Subscribe, deploymentId }));
                }
            }

            ws.onmessage = (event) => {
                if (isClose) {
                    return;
                }
                const data = JSON.parse(event.data);
                switch (data.publishType) {
                    case Publish.publishChaosInjected:
                        setTimeline(prev => [...prev, {
                            event: DeploymentTimelineEventNames.ChaosInjected,
                            message: `${data.message}`,
                            timestamp: data.timestamp
                        }]);
                        break;
                    case Publish.publishOutboxFailed:
                        setStatus(DeploymentStatus.FAILED);
                        setTimeline(prev => [...prev, {
                            event: DeploymentTimelineEventNames.OutboxFailed,
                            message: data.message,
                            timestamp: data.timestamp
                        }]);
                        isServerStateFailed = true; // queue failed to push the deployment so no need to retry the ws connection
                        ws.close();
                        break;
                    case Publish.publishDeploymentStarted:
                        setStatus(DeploymentStatus.RUNNING);
                        setTimeline(prev => [...prev, {
                            event: DeploymentTimelineEventNames.DeploymentStarted,
                            message: data.message,
                            timestamp: data.timestamp
                        }]);
                        break;
                    case Publish.publishStageCompleted:
                        setCompletedStages(prev => [...prev, data.stageName]);
                        setTimeline(prev => [...prev, {
                            event: data.stageName,
                            message: data.message,
                            timestamp: data.timestamp
                        }]);
                        break;
                    case Publish.publishDeploymentCompleted:
                        setStatus(DeploymentStatus.COMPLETED);
                        setTimeline(prev => [...prev, {
                            event: DeploymentTimelineEventNames.DeploymentCompleted,
                            message: data.message,
                            timestamp: data.timestamp
                        }]);
                        isServerStateFailed = true; // The deplyment itself got completed so no need for retry the ws connection
                        ws.close();
                        break;
                    case Publish.publishDeploymentFailed:
                        setStatus(DeploymentStatus.FAILED);
                        setTimeline(prev => [...prev, {
                            event: DeploymentTimelineEventNames.DeploymentFailed,
                            message: data.message,
                            timestamp: data.timestamp
                        }]);
                        isServerStateFailed = true; // The deployment itself failed so no need to retry the ws connection
                        ws.close();
                        break;
                    case Publish.publishDeploymentLive:
                        setStatus(DeploymentStatus.LIVE);
                        setTimeline(prev => [...prev, {
                            event: DeploymentTimelineEventNames.DeploymentLive,
                            message: data.message,
                            timestamp: data.timestamp
                        }]);
                        break;
                    case Publish.publishDeploymentTornDown:
                        setStatus(DeploymentStatus.TORN_DOWN);
                        setTimeline(prev => [...prev, {
                            event: DeploymentTimelineEventNames.DeploymentTornDown,
                            message: data.message,
                            timestamp: data.timestamp
                        }]);
                        isServerStateFailed = true;
                        ws.close();
                        break;
                    case Publish.publishSimulationSnapshot:
                        useSimulationStore.getState().applySnapshot(data as SimulationSnapshot);
                        break;
                }
            }

            ws.onclose = () => {
                if(isClose || isServerStateFailed) { // If component unmonted or server itself failed completely we don't reconnect
                    return;
                }
                // The delay will increase exponentially i.e. 2, 4, 8, 16, then capped at 30...
                const delay = Math.min(30000, 1000 * 2 ** retries);
                retries++;
                reconnectTimeout = setTimeout(connect, delay);
            }

            ws.onerror = () => {
                if(!isClose) {
                    setStatus("Web Socket connection error");
                    ws.close();
                }
            }
        }

        connect();

        return () => {
            isClose = true;
            if(reconnectTimeout) {
                clearTimeout(reconnectTimeout);
            }
            if(ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
                ws.close();
            }
        }
    }, [deploymentId]);

    return { deployment, status, completedStages, timeline};
}