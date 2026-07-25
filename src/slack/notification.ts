import type { SyncMode, SyncRunStatus, SyncTriggerType } from "../db/sync-run-store.js";

const SLACK_CHAT_POST_MESSAGE_URL = "https://slack.com/api/chat.postMessage";

export interface SynchronizationNotification {
  actionUrl?: string;
  errorSummary?: string;
  fetchedCount: number;
  finishedAt: Date;
  insertedCount: number;
  period: { from?: Date; to?: Date };
  rateLimitRemaining?: number;
  repositoryFailed: number;
  repositorySucceeded: number;
  repositoryTotal: number;
  startedAt: Date;
  status: Exclude<SyncRunStatus, "running">;
  syncMode: SyncMode;
  triggerType: SyncTriggerType;
  updatedCount: number;
}

export interface SlackNotifier {
  send(notification: SynchronizationNotification): Promise<void>;
}

export interface SlackNotifierConfig {
  botToken: string;
  userId: string;
}

/** Slackの個人DMへ、同期結果だけを送る通知クライアントを作成する。 */
export function createSlackNotifier(config: SlackNotifierConfig): SlackNotifier {
  return {
    async send(notification) {
      const response = await fetch(SLACK_CHAT_POST_MESSAGE_URL, {
        body: JSON.stringify({
          channel: config.userId,
          text: formatSynchronizationNotification(notification),
        }),
        headers: {
          Authorization: `Bearer ${config.botToken}`,
          "Content-Type": "application/json; charset=utf-8",
        },
        method: "POST",
      });

      if (!response.ok) {
        throw new Error("Slack通知の送信に失敗しました");
      }

      const body: unknown = await response.json();
      if (!isSlackSuccessResponse(body)) {
        throw new Error("Slack通知の送信に失敗しました");
      }
    },
  };
}

/** 同期結果から、リポジトリ名・Secretsを含まないSlack本文を組み立てる。 */
export function formatSynchronizationNotification(
  notification: SynchronizationNotification,
): string {
  return [
    `同期結果: ${toStatusLabel(notification.status)}`,
    `実行: ${toTriggerLabel(notification.triggerType)} / ${toModeLabel(notification.syncMode)}`,
    `開始: ${formatDate(notification.startedAt)}`,
    `終了: ${formatDate(notification.finishedAt)}`,
    `対象期間: ${formatPeriod(notification.period)}`,
    `リポジトリ: 対象 ${notification.repositoryTotal} / 成功 ${notification.repositorySucceeded} / 失敗 ${notification.repositoryFailed}`,
    `件数: 取得 ${notification.fetchedCount} / 新規 ${notification.insertedCount} / 更新 ${notification.updatedCount}`,
    `GitHub API残量: ${notification.rateLimitRemaining ?? "取得不可"}`,
    ...(notification.errorSummary === undefined
      ? []
      : [`エラー概要: ${notification.errorSummary}`]),
    `Actions: ${toSafeActionUrl(notification.actionUrl) ?? "利用不可"}`,
  ].join("\n");
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "medium",
    timeStyle: "medium",
    timeZone: "Asia/Tokyo",
  }).format(date);
}

function formatPeriod(period: { from?: Date; to?: Date }): string {
  if (period.from === undefined && period.to === undefined) {
    return "全期間";
  }

  return `${period.from === undefined ? "開始未指定" : formatDate(period.from)} 〜 ${
    period.to === undefined ? "終了未指定" : formatDate(period.to)
  }`;
}

function isSlackSuccessResponse(value: unknown): value is { ok: true } {
  return typeof value === "object" && value !== null && "ok" in value && value.ok === true;
}

function toModeLabel(mode: SyncMode): string {
  return { full: "全再同期", incremental: "差分同期", range: "期間指定同期" }[mode];
}

function toSafeActionUrl(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      url.hostname === "github.com" &&
      url.port === "" &&
      url.username === "" &&
      url.password === "" &&
      url.search === "" &&
      url.hash === "" &&
      /^\/[^/]+\/[^/]+\/actions\/runs\/\d+$/.test(url.pathname)
      ? url.toString()
      : undefined;
  } catch {
    return undefined;
  }
}

function toStatusLabel(status: Exclude<SyncRunStatus, "running">): string {
  return { failure: "失敗", partial_failure: "一部失敗", success: "成功" }[status];
}

function toTriggerLabel(triggerType: SyncTriggerType): string {
  return { manual: "手動", scheduled: "定期" }[triggerType];
}
