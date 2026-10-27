import { createRunHost } from "./host";
import type { FromWorker, ToWorker } from "./protocol";

// The worker side of a browser run: all simulation work happens here, off the page's main thread.
const host = createRunHost((message: FromWorker) => postMessage(message));
onmessage = (event: MessageEvent<ToWorker>) => host.handle(event.data);
