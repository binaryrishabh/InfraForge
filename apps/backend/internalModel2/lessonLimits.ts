// Software containment policy, never modeled cloud capacity or timing.
export const LESSON_SANDBOX = { version: "linux-container/1", memoryBytes: 536870912, nanoCpus: 1000000000,
  pids: 64, nofile: 128, cpuSeconds: 5, wallSeconds: 15, deadlineMs: 25000,
  lineBytes: 270336, outputBytes: 8650752, inputBytes: 786432 } as const;
export function lessonImage(env = process.env) {
  const image = env.MODEL2_LESSON_IMAGE;
  if (image !== undefined && !/^sha256:[a-f0-9]{64}$/.test(image)) throw Error("MODEL2_LESSON_IMAGE must pin a locally installed immutable image ID");
  return image ?? null;
}
