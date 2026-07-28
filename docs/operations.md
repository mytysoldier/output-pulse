# 運用設計

## 定期運用

- 現在は本番Secretsと外部サービスの設定前のため、定期同期を停止している
- 同期はGitHub Actionsの **Synchronize GitHub activity** から手動実行する
- 本番運用を開始する際は、JST 08:00、14:00、22:00のscheduleをWorkflowへ復元する。cronは遅延する可能性があり、定刻実行を保証しない
- Publicリポジトリのscheduled workflowは長期無活動で無効化される可能性があるため、定期運用開始後は成功DMが継続していることを確認する

## Slack通知

- 成功・失敗を毎回DMする
- `SLACK_BOT_TOKEN`と`SLACK_USER_ID`をGitHub Actions Secretsへ設定する
- Slack Appには対象ユーザーへのDM送信に必要な`chat:write`権限を付与する
- 同期は`pnpm start`で実行する。`SYNC_TRIGGER_TYPE`へ`scheduled`または`manual`、`SYNC_MODE`へ`incremental`、`range`、`full`を指定する
- 期間指定では`SYNC_FROM`と`SYNC_TO`にISO 8601日時を指定する
- 通知が来ない場合はGitHub Actionsの有効状態と履歴を確認する
- Slack通知失敗は同期をRollbackせず、Workflowも失敗させない

## 障害対応

1. Actions実行URLで失敗工程を確認する
2. GitHub API残量、Token期限、Neon接続、Slack App権限を確認する
3. 修正後に手動差分同期を実行する
4. データ欠落が疑われる場合は期間指定同期を実行する
5. 集計規則を変更した場合は全再同期またはView再計算を検討する

## 本番DB Migration

- `Database Migration` Workflowは手動実行専用で、mainのレビュー済みMigrationだけを対象にする
- `production` Environmentへ承認ルールを設定し、`DATABASE_MIGRATION_URL`はEnvironment Secretとして保存する
- WorkflowはDrizzleのMigration履歴を確認してから未適用Migrationだけを適用する
- 同じMigrationを再実行しても、適用済みのMigrationは再実行されない
- 失敗時は自動再試行やRollbackをせず、Actionsログで適用済みMigrationを確認して前進修正用の新規Migrationを作成する
- Migration成功・失敗はSlack DMで確認する。Slack通知だけの失敗はMigration失敗として扱わない

## データ保持と容量

- イベントデータは無期限保存する
- Issue等がGitHubから削除されても過去実績として保持する
- Neon無料枠の使用量を定期確認する
- 使用率が80%に近づいたら、不要な同期監査データの保持期間、上位プラン、移行先を検討する
- 実績イベントはユーザーの判断なく削除しない

## Grafana設定

- Grafana Cloudアカウント、Neon接続、外部共有は手動設定する
- DashboardはGrafana UIで作成し、PC・スマートフォンで目視確認する
- 完成後のJSONをリポジトリへExportして変更履歴を管理する
- Dashboard JSONに接続パスワード等の秘密情報がないことを確認する

## ローカル開発

- Docker ComposeでPostgreSQLを起動する
- `.env.example`に変数名だけを記載する
- Migration、同期のdry-run、テストをローカルで実行できるようにする
- 本番Secretsや本番DBを通常のローカル開発に使用しない
