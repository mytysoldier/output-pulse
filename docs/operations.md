# 運用設計

## 定期運用

- GitHub ActionsをJST 08:00、14:00、22:00に実行する
- cronは遅延する可能性があり、定刻実行を保証しない
- Publicリポジトリのscheduled workflowは長期無活動で無効化される可能性があるため、成功DMが継続していることを運用者が確認する

## Slack通知

- 成功・失敗を毎回DMする
- 通知が来ない場合はGitHub Actionsの有効状態と履歴を確認する
- Slack通知失敗は同期をRollbackせず、Workflowも失敗させない

## 障害対応

1. Actions実行URLで失敗工程を確認する
2. GitHub API残量、Token期限、Neon接続、Slack App権限を確認する
3. 修正後に手動差分同期を実行する
4. データ欠落が疑われる場合は期間指定同期を実行する
5. 集計規則を変更した場合は全再同期またはView再計算を検討する

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
