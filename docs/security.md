# セキュリティ設計

## 公開境界

一般公開する情報は集計値、完了Issueタイトル・日時、最終同期状態だけとする。リポジトリ名、リポジトリID、GitHub URL、本文、コメント、差分、コミットメッセージは公開しない。

## GitHub認証

Fine-grained Personal Access Tokenを使用する。

- Resource owner: `mytysoldier`
- Repository access: All repositories
- Metadata: Read
- Contents: Read
- Issues: Read
- Pull requests: Read

実装時に各API endpointの必要権限を検証し、不要なWrite権限は付与しない。TokenはGitHub Actions Secret `GH_READ_TOKEN`へ保存する。

## Slack認証

個人Slack WorkspaceへSlack Appをインストールし、DM送信に必要な最小Scopeだけを付与する。Bot Tokenと送信先IDはGitHub Actions Secretsへ保存する。

## PostgreSQL権限

- Migration用ユーザー: DDLと権限設定に使用
- Collector用ユーザー: 内部Schemaへの必要最小限の読み書き
- Grafana用ユーザー: 公開Viewへの`SELECT`のみ

Grafana用ユーザーには内部Schemaの`USAGE`、テーブル参照、DDL、DML権限を与えない。接続はTLSを必須とする。

## Secrets

- `.env`をGit管理しない
- Tokenや接続文字列をDBへ保存しない
- Secretsをログ、例外、Slackへ含めない
- エラー本文を外部通知する前に機密値とリポジトリ名を除去する
- ActionsではSecret maskingへ依存せず、アプリケーション側でも出力を避ける

## Grafana Cloud

- Neonへは専用読み取りユーザーで接続する
- 外部共有Dashboardは公開用Viewだけを参照する
- 自由入力のSQLやリポジトリ単位の変数を公開しない
- 公開前にDashboard JSONと表示内容を目視確認する
- 大量アクセス対策はMVP対象外だが、DB使用量を観測して将来キャッシュ等を検討する
