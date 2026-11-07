import { LEARNING_REGISTRY } from "../learning/registry";

const lesson = LEARNING_REGISTRY.findLesson("monitoring-loss-and-freshness");
if (!lesson) throw Error("Monitoring lesson is not registered");
console.log(JSON.stringify({lesson, progress: null, challenge: null}));
