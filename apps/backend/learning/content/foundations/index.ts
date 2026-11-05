import type { LearningLesson } from "@infraforge/contracts/learning";
import { lesson as request } from "./lessons/what-is-a-request";
import { lesson as roles } from "./lessons/client-and-server";
import { lesson as dns } from "./lessons/dns-resolution";
import { lesson as routing } from "./lessons/request-routing";
import { lesson as vm } from "./lessons/virtual-machines";
import { lesson as database } from "./lessons/database-read-and-write";
import { lesson as journey } from "./lessons/request-journey";
import { lesson as timing } from "./lessons/response-time-and-throughput";
import { lesson as pressure } from "./lessons/more-users-more-pressure";
import { lesson as bottleneck } from "./lessons/first-bottleneck";

import { firstRunsLessons } from "./first-runs";

export { track } from "./track";
export const lessons: readonly LearningLesson[] = [request, roles, dns, routing, vm, database, journey, timing, pressure, bottleneck, ...firstRunsLessons];
