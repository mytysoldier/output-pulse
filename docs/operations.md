# 運用設計

## 定期運用

- GitHub Actionsの **Synchronize GitHub activity** がJST 08:00、14:00、22:00に差分同期を実行する。cronは遅延する可能性があり、定刻実行を保証しない
- 手動実行では`incremental`、`range`、`full`を選択できる
- Actions履歴とSlack DMで、定期同期が少なくとも3回連続して成功していることを確認する。失敗時は障害対応の手順に従う
- Publicリポジトリのscheduled workflowは長期無活動で無効化される可能性があるため、成功DMが途切れた場合はWorkflowの有効状態と履歴を確認する

## Slack通知

- 成功・失敗を毎回DMする
- `SLACK_BOT_TOKEN`と`SLACK_USER_ID`をGitHub Actions Secretsへ設定する
- Slack Appには対象ユーザーへのDM送信に必要な`chat:write`権限を付与する
- 同期は`pnpm start`で実行する。`SYNC_TRIGGER_TYPE`へ`scheduled`または`manual`、`SYNC_MODE`へ`incremental`、`range`、`full`を指定する
- 期間指定では`SYNC_FROM`と`SYNC_TO`にISO 8601日時を指定する
- 通知が来ない場合はGitHub Actionsの有効状態と履歴を確認する
- Slack通知失敗は同期をRollbackせず、Workflowも失敗させない

## 障害対応

1. Actions履歴から対象の実行を開き、失敗工程を確認する。cron遅延・未実行が疑われる場合は、直近の定期実行とWorkflowの有効状態も確認する
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

- 本番Neon・Grafana Cloudの初期構成、Secret名、Role分離、Dashboard Importは[本番Neon・Grafana Cloudセットアップ手順](production-neon-grafana-setup.md)に従う
- Grafana CloudアカウントとNeon接続は手動設定する。Dashboardはログイン済みの個人利用者だけが閲覧する
- NeonではMigration用ユーザーでGrafana Cloud用の`LOGIN` Roleを作成し、`grafana_reader`を付与する。Grafana Cloudの接続先にはそのRoleのTLS接続文字列だけを入力する。
- データソースはPostgreSQLを選び、SSL modeを`require`にする。接続テスト後、`app` Schemaのテーブルへアクセスできないことと、`dashboard` Schemaの3 Viewを`SELECT`できることを確認する。
- [`grafana/dashboards/output-pulse.json`](../grafana/dashboards/output-pulse.json) をGrafanaへImportし、PostgreSQLデータソースを割り当てる。JSONには接続先、パスワード、リポジトリ識別情報を含めない。
- 外部共有リンクは発行しない。Grafana Cloudの組織へログインできる個人利用者だけがDashboardを閲覧する。
- 過去に外部共有を有効化していた場合は、Grafana CloudのDashboard共有設定で外部共有を無効化して共有リンクを無効にする。無効化後、以前の共有URLをログアウト状態で開き、閲覧できないことを確認する。
- 本番運用開始前に、30日表示の4数値、日別積み上げ、週別推移、完了Issue、最終同期状態をPCとスマートフォンで目視確認する。空状態と同期失敗状態も表示内容を確認する。
- JSONを更新した場合はExport結果を`grafana/dashboards/`へ反映し、秘密情報が含まれないことを確認する。

## ローカル開発

- Docker ComposeでPostgreSQLを起動する
- `.env.example`に変数名だけを記載する
- Migration、同期のdry-run、テストをローカルで実行できるようにする
- 本番Secretsや本番DBを通常のローカル開発に使用しない
