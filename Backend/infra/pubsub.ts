import { redis } from "./redis";
import type { OutboxPayload } from "@shared/types/OutboxPayload.types";
import type { SimulationSnapshot } from "@shared/types/SimulationSnapshot.types";
import { Publish } from "@shared/enum/Publish.enum";

/* ------------------------Publisher code--------------------- */
// These are publishers that the worker and outbox will call so that the client could be informed through web socket that what is going on behind at each step through subscribers.....

// 0. The pushing of chaos notification directly to client through specific channel to which client has subscribed via websocket...
export const publishChaosInjected = async(entry: { payload: OutboxPayload }) => {
    const outboxPayload = entry.payload;
    await redis.publish(
        `deployment:${outboxPayload.deploymentId}:updates`,
        JSON.stringify({
            deploymentId: outboxPayload.deploymentId,
            chaosType: outboxPayload.chaosType,
            resourceId: outboxPayload.resourceId,
            message: outboxPayload.message,
            publishType: Publish.publishChaosInjected,
            timestamp: new Date().toISOString()
        })
    )
}

// 1. The pushing of deployment inside the BullMQ failed
export const publishOutboxFailed = async (deploymentId: string, reason: string) => {
    await redis.publish(`deployment:${deploymentId}:updates`, JSON.stringify({
        deploymentId,
        publishType: Publish.publishOutboxFailed,
        message: reason,
        timestamp: new Date().toISOString()
    }))
}

// 2. Deployment started - the worker picked it up
export const publishDeploymentStarted = async(deploymentId: string, resourceCount: number) => {
    await redis.publish(`deployment:${deploymentId}:updates`, JSON.stringify({
        deploymentId,
        publishType: Publish.publishDeploymentStarted,
        status: "running",
        resourceCount,
        message: `Deployment started with ${resourceCount} resources`,
        timestamp: new Date().toISOString()
    }))
}

// 3. A stage of a particular deployment completed
export const publishStageCompleted = async (deploymentId: string, stageName: string, resourceCount: number, stateMessage: string) => {
    await redis.publish(`deployment:${deploymentId}:updates`, JSON.stringify({
        deploymentId,
        publishType: Publish.publishStageCompleted,
        stageName,
        message: stateMessage,
        timestamp: new Date().toISOString()
    }))
}

// 4. Deployment finished successfully - worked completed it's task
export const publishDeploymentCompleted = async(deploymentId: string) => {
    await redis.publish(`deployment:${deploymentId}:updates`, JSON.stringify({
        deploymentId,
        publishType: Publish.publishDeploymentCompleted,
        status: "completed",
        message: "All stages completed. Infrastructure is ready.",
        timestamp: new Date().toISOString()
    }))
}

// 5. Deployment failed during processing by worker
export const publishDeploymentFailed = async(deploymentId: string, reason: string) => {
    await redis.publish(`deployment:${deploymentId}:updates`, JSON.stringify({
        deploymentId,
        publishType: Publish.publishDeploymentFailed,
        status: "failed",
        message: reason,
        timestamp: new Date().toISOString()
    }))
}

// 6. Deployment went LIVE - all stages finished successfully and the deployment is now live
export const publishDeploymentLive = async(deploymentId: string, resourceCount: number) => {
    await redis.publish(`deployment:${deploymentId}:updates`, JSON.stringify({
        deploymentId,
        publishType: Publish.publishDeploymentLive,
        status: "live",
        resourceCount,
        message: `Deployment is live with ${resourceCount} resources`,
        timestamp: new Date().toISOString()
    }))
}

// 7. Batched simulation snapshot for a LIVE deployment - one message per deployment per second carrying metrics + logs + health
export const publishSimulationSnapshot = async(snapshot: SimulationSnapshot) => {
    await redis.publish(`deployment:${snapshot.deploymentId}:updates`, JSON.stringify({
        ...snapshot,
        publishType: Publish.publishSimulationSnapshot
    }))
}

/* ------------------------Subscriber code--------------------- */
// this is to where all websocket servers are listening to and listens when there deploymentId matches or the client that's wanting the deploymentId matches
export const subscribeToDeployment = async(deploymentId: string, callback: (event: any) => void) => { // this callback function is passed by the websocket server
    const subscriber = redis.duplicate(); // we are creating a new redis connection. Here redis connection by subscriber can only subscribe they won't be allowed to do any thing else that's why making new redis connection for each subscriptions. This is scaling so that subscribers don't block the publishing queing and chaching.
    await subscriber.subscribe(`deployment:${deploymentId}:updates`); // shouts for specific deploymentId and websocket subscribes to the particular one can listen and notify the subscribed clients.
    subscriber.on("message", (channel, message) => { // event listener. Fires every time a message arrives on the subscribed channel.
        const event = JSON.parse(message); // json string conversion to string
        callback(event); // passes the event to the WebSocket server, which forwards it to the frontend. Because this function has been passed by the websocket server itself. SO we call here it with the message event
    })
    return subscriber;
}