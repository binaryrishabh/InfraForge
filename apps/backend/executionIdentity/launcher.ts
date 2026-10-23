import { verifyLaunch } from "./launch";
verifyLaunch();
await import("../internalModel2/identity");
switch (process.argv[2]) {
  case "api": await import("../index"); break;
  case "worker": await import("../worker"); break;
  case "ws": await import("../ws-server"); break;
  case "verifier": await import("../firstStack/verifierHost"); break;
  default: throw Error("Expected execution host: api, worker, ws or verifier");
}
