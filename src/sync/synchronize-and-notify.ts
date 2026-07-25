import type { SlackNotifier } from "../slack/notification.js";
import {
  synchronize,
  type SynchronizationDependencies,
  type SynchronizationRequest,
  type SynchronizationResult,
} from "./synchronization.js";

export interface SynchronizationNotificationDependencies extends SynchronizationDependencies {
  actionUrl?: string;
  notifier: SlackNotifier;
}

/**
 * 同期結果を保存した後にSlack DMを一度だけ試みる。
 * 通知と通知ステータスの更新に失敗しても、同期結果は変更せず呼び出し元へ成功結果を返す。
 */
export async function synchronizeAndNotify(
  request: SynchronizationRequest,
  dependencies: SynchronizationNotificationDependencies,
): Promise<SynchronizationResult> {
  let result: SynchronizationResult;
  try {
    result = await synchronize(request, dependencies);
  } catch (error) {
    await sendNotification(
      request,
      {
        errorSummary: "同期処理の実行に失敗しました",
        fetchedCount: 0,
        insertedCount: 0,
        period: { from: request.from, to: request.to },
        repositoryFailed: 0,
        repositorySucceeded: 0,
        repositoryTotal: 0,
        startedAt: dependencies.now?.() ?? new Date(),
        status: "failure",
        syncRunId: 0,
        updatedCount: 0,
      },
      dependencies,
    );
    throw error;
  }
  const notificationStatus = await sendNotification(request, result, dependencies);

  try {
    await dependencies.syncRunStore.updateNotificationStatus(result.syncRunId, notificationStatus);
  } catch {
    // 同期済みデータを保護するため、通知ステータス記録の失敗は同期結果へ影響させない。
  }

  return result;
}

async function sendNotification(
  request: SynchronizationRequest,
  result: SynchronizationResult,
  dependencies: SynchronizationNotificationDependencies,
): Promise<"failed" | "sent"> {
  try {
    await dependencies.notifier.send({
      actionUrl: dependencies.actionUrl,
      errorSummary: result.errorSummary,
      fetchedCount: result.fetchedCount,
      finishedAt: dependencies.now?.() ?? new Date(),
      insertedCount: result.insertedCount,
      period: result.period,
      rateLimitRemaining: result.rateLimitRemaining,
      repositoryFailed: result.repositoryFailed,
      repositorySucceeded: result.repositorySucceeded,
      repositoryTotal: result.repositoryTotal,
      startedAt: result.startedAt,
      status: result.status,
      syncMode: request.mode,
      triggerType: request.triggerType,
      updatedCount: result.updatedCount,
    });
    return "sent";
  } catch {
    return "failed";
  }
}
