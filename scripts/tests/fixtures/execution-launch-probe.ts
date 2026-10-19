import { executionDescriptor, repositoryRoot } from "../../../apps/backend/executionIdentity/descriptor";
import { verifyInstalled } from "../../../apps/backend/executionIdentity/installed";
verifyInstalled(executionDescriptor(), repositoryRoot);
console.log("verified");
