import "dotenv/config";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { runSynchronizationFromEnvironment } from "./run-synchronization.js";

export interface ApplicationInfo {
  name: "output-pulse";
  runtime: "node";
}

export function createApplicationInfo(): ApplicationInfo {
  return {
    name: "output-pulse",
    runtime: "node",
  };
}

if (isDirectExecution()) {
  void runSynchronizationFromEnvironment().catch(() => {
    console.error("同期処理に失敗しました");
    process.exitCode = 1;
  });
}

function isDirectExecution(): boolean {
  const entrypoint = process.argv[1];
  return entrypoint !== undefined && pathToFileURL(resolve(entrypoint)).href === import.meta.url;
}
