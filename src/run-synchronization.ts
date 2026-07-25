import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { createSyncRunStore, type SyncMode, type SyncTriggerType } from "./db/sync-run-store.js";
import { createTargetStore } from "./db/target-store.js";
import { createGitHubCommitApi } from "./github/commits.js";
import { createGitHubCompletedIssueApi } from "./github/completed-issues.js";
import { createGitHubPullRequestApi } from "./github/pull-requests.js";
import {
  createGitHubClient,
  createGitHubRepositoryApi,
  loadSynchronizationTargets,
} from "./github/targets.js";
import { createSlackNotifier } from "./slack/notification.js";
import {
  createRepositoryTransactionRunner,
  type SynchronizationRequest,
} from "./sync/synchronization.js";
import { synchronizeAndNotify } from "./sync/synchronize-and-notify.js";

type Environment = NodeJS.ProcessEnv;

/** GitHub Actionsまたはローカル実行用の環境変数を、同期リクエストへ変換する。 */
export function createSynchronizationRequest(environment: Environment): SynchronizationRequest {
  const mode = environment.SYNC_MODE ?? "incremental";
  const triggerType = environment.SYNC_TRIGGER_TYPE ?? "manual";

  if (!isSyncMode(mode) || !isSyncTriggerType(triggerType)) {
    throw new Error("同期実行設定が不正です");
  }

  return {
    ...(environment.SYNC_FROM === undefined ? {} : { from: new Date(environment.SYNC_FROM) }),
    ...(environment.SYNC_TO === undefined ? {} : { to: new Date(environment.SYNC_TO) }),
    mode,
    triggerType,
  };
}

/** 環境変数のSecretsを使い、手動・定期同期のどちらにも使える本番実行入口を提供する。 */
export async function runSynchronizationFromEnvironment(
  environment: Environment = process.env,
): Promise<void> {
  const pool = new Pool({
    connectionString: requiredEnvironmentValue(environment, "DATABASE_URL"),
  });
  const database = drizzle({ client: pool });
  const githubClient = createGitHubClient(environment.GH_READ_TOKEN);
  const request = createSynchronizationRequest(environment);

  try {
    await synchronizeAndNotify(request, {
      actionUrl: createActionUrl(environment),
      commitApi: createGitHubCommitApi(githubClient),
      completedIssueApi: createGitHubCompletedIssueApi(githubClient),
      loadTargets: () =>
        loadSynchronizationTargets({
          api: createGitHubRepositoryApi(githubClient),
          store: createTargetStore(database),
        }),
      notifier: createSlackNotifier({
        botToken: requiredEnvironmentValue(environment, "SLACK_BOT_TOKEN"),
        userId: requiredEnvironmentValue(environment, "SLACK_USER_ID"),
      }),
      pullRequestApi: createGitHubPullRequestApi(githubClient),
      repositoryTransactions: createRepositoryTransactionRunner(database),
      syncRunStore: createSyncRunStore(database),
    });
  } finally {
    await pool.end();
  }
}

function createActionUrl(environment: Environment): string | undefined {
  const serverUrl = environment.GITHUB_SERVER_URL;
  const repository = environment.GITHUB_REPOSITORY;
  const runId = environment.GITHUB_RUN_ID;

  return serverUrl === "https://github.com" &&
    repository !== undefined &&
    /^[^/]+\/[^/]+$/.test(repository) &&
    runId !== undefined &&
    /^\d+$/.test(runId)
    ? `${serverUrl}/${repository}/actions/runs/${runId}`
    : undefined;
}

function isSyncMode(value: string): value is SyncMode {
  return value === "full" || value === "incremental" || value === "range";
}

function isSyncTriggerType(value: string): value is SyncTriggerType {
  return value === "manual" || value === "scheduled";
}

function requiredEnvironmentValue(environment: Environment, name: string): string {
  const value = environment[name]?.trim();
  if (value === undefined || value === "") {
    throw new Error("必要な実行設定が不足しています");
  }

  return value;
}
