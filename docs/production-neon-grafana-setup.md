# 本番Neon・Grafana Cloudセットアップ手順

## 目的

Output Pulseの本番PostgreSQLとGrafana Cloudダッシュボードを、安全な権限分離で構成する。

この手順には接続文字列、パスワード、Token、公開URLを記載しない。これらの値はGitHub Secrets、Grafana Cloud、または承認済みの秘密情報管理手段だけで管理する。

## 構成

| 用途 | 接続先Role | 権限 | 保管先 |
| --- | --- | --- | --- |
| Migration | Neonの初期管理Role | DDL、Role、Grant | `production` Environment Secret `DATABASE_MIGRATION_URL` |
| Collector | Collector専用Role | `app` Schemaへの最小限の読み書き | Repository Secret `COLLECTOR_DATABASE_URL` |
| Grafana Cloud | `grafana_cloud` | `dashboard` Schemaの公開ViewへのSELECTだけ | Grafana Cloudデータソース。接続情報の管理場所は `production` Environment Secret `GRAFANA_DATABASE_URL` として記録する |

Grafana用の接続情報は同期Workflowから利用しない。`GRAFANA_DATABASE_URL`は、接続情報の保管場所をリポジトリから追跡するためのSecret名であり、接続文字列やパスワード自体をREADME、Issue、Dashboard JSONへ記載してはならない。

## Neonプロジェクト

1. Neon ConsoleでPostgreSQLプロジェクトを作成する。プロジェクト名は`output-pulse`を使用する。
2. `production`ブランチ、Primary Compute、`neondb`データベースを使用する。
3. **Connect**画面で、MigrationとGrafanaの接続文字列はConnection poolingをOFFにしたDirect connectionを選ぶ。
4. 接続文字列はTLSを必須とし、`sslmode=require`を維持する。

## 本番Migration

1. GitHub Repository Settingsで`production` Environmentを作成する。
2. Environment Secret `DATABASE_MIGRATION_URL`へ、Neonの初期管理RoleによるDirect connectionを登録する。
3. GitHub Actionsの**Database Migration**を`main`から手動実行する。
4. 実行結果が成功したことを確認する。

Migrationは`app` Schema、`dashboard` Schema、公開View、`grafana_reader` Roleを作成する。Migrationは未適用分だけを実行するため、成功済みのMigrationを再適用しない。

## Collector専用Roleと初回同期

同期Workflowには、Migration用・Grafana用とは別のCollector専用LOGIN Roleを使用する。パスワードをSQL Editor履歴へ残さないため、Neon Consoleの**Tables**画面で**Create role**を選び、`output_pulse_collector`を作成する。パスワードはConsoleで生成・保存し、SQL Editorへ入力しない。

Consoleで作成したRoleには`neon_superuser`が付与されるため、作成直後にNeonの**SQL Editor**でMigration用Roleを使い、次の権限設定を実行する。既存のCollector Roleを移行する場合も同じSQLを実行する。パスワード、接続文字列、TokenはGit、Issue、チャットへ残さない。

```sql
REVOKE neon_superuser FROM output_pulse_collector;

ALTER ROLE output_pulse_collector
  LOGIN
  NOSUPERUSER
  NOCREATEDB
  NOCREATEROLE
  NOINHERIT
  NOREPLICATION
  NOBYPASSRLS;

REVOKE ALL PRIVILEGES ON SCHEMA app FROM output_pulse_collector;
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA app FROM output_pulse_collector;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA app FROM output_pulse_collector;

GRANT USAGE ON SCHEMA app TO output_pulse_collector;
GRANT SELECT ON app.tracked_actors TO output_pulse_collector;
GRANT SELECT, INSERT, UPDATE ON app.repositories TO output_pulse_collector;
GRANT SELECT, INSERT, UPDATE ON app.commits TO output_pulse_collector;
GRANT SELECT, INSERT, UPDATE ON app.pull_requests TO output_pulse_collector;
GRANT INSERT ON app.pull_request_events TO output_pulse_collector;
GRANT SELECT, INSERT, UPDATE ON app.completed_issues TO output_pulse_collector;
GRANT SELECT, INSERT, UPDATE ON app.sync_runs TO output_pulse_collector;
GRANT USAGE, SELECT ON SEQUENCE app.sync_runs_id_seq TO output_pulse_collector;
```

権限設定後、Neonの**Connect**画面で`output_pulse_collector`を選び、TLS接続文字列を取得する。`sslmode=require`を維持する。

GitHub ActionsのRepository Secretsへ、次を登録する。同期Workflowは`production` Environmentを参照しないため、CollectorとSlackの値はEnvironment SecretではなくRepository Secretに保存する。

| Secret | 用途 |
| --- | --- |
| `GH_READ_TOKEN` | Resource ownerを`mytysoldier`、Repository accessを**All repositories**に設定し、Metadata、Contents、Issues、Pull requestsのReadだけを持つFine-grained PAT |
| `COLLECTOR_DATABASE_URL` | `output_pulse_collector`のTLS接続文字列 |
| `SLACK_BOT_TOKEN` | 同期結果通知用のSlack Bot Token |
| `SLACK_USER_ID` | 通知先SlackユーザーID |

初回同期の前に、Neon SQL Editorで初期tracked actorを登録する。GitHubのログイン名ではなく、不変のGitHubユーザーIDを主キーとして使用する。

```sql
INSERT INTO app.tracked_actors (
  github_user_id,
  github_login,
  actor_type,
  enabled
)
VALUES (36390056, 'mytysoldier', 'user', true)
ON CONFLICT (github_user_id) DO UPDATE
SET
  github_login = EXCLUDED.github_login,
  actor_type = EXCLUDED.actor_type,
  enabled = EXCLUDED.enabled,
  updated_at = now();
```

登録後、GitHub Actionsの**Synchronize GitHub activity**を`main`から手動実行し、`incremental`を選択する。actor未登録のまま初回同期を実行済みの場合は、初回対象の過去30日を指定した`range`同期を1回実行して補正する。成功後は、Neon SQL Editorで`app.sync_runs`と各活動テーブルへの記録を確認する。同期ログやSlack通知にはSecrets・接続文字列・収集対象のPrivateリポジトリ名を出力しない。

## Grafana専用Role

Neonの**SQL Editor**で、強力な固有パスワードを使ってGrafana専用のログインRoleを作成する。パスワード文字列はSQL履歴、Git、Issue、チャットへ残さない。

```sql
CREATE ROLE grafana_cloud LOGIN PASSWORD '強力な固有パスワード';

GRANT grafana_reader TO grafana_cloud;
```

`grafana_reader`はMigrationで作成され、`dashboard.daily_metrics`、`dashboard.completed_issues`、`dashboard.sync_status`へのSELECTだけを持つ。`grafana_cloud`には`app` Schemaの参照、DDL、DMLを付与しない。

Role作成後、Neonの**Connect**画面でRoleを`grafana_cloud`へ切り替え、Connection poolingをOFFにしたDirect connectionを取得する。接続文字列は必要に応じて`production` Environment Secret `GRAFANA_DATABASE_URL`へ保存する。

## Grafana CloudデータソースとDashboard

1. Grafana Cloudで**Connections → Data sources → Add new data source → PostgreSQL**を開く。
2. NeonのGrafana専用Direct connectionから、Host URL、Database name、User、Passwordを入力する。
3. TLS/SSL modeは`require`にする。
4. **Save & test**で接続成功を確認する。
5. **Dashboards → New → Import**から[`grafana/dashboards/output-pulse.json`](../grafana/dashboards/output-pulse.json)をImportする。
6. `DS_POSTGRES`が表示される場合は、作成したPostgreSQLデータソースを選ぶ。データソースが1件だけの場合は自動選択される。

初回同期前は、数値カードが0、日別・週別パネルがNo dataと表示される。これは正常な空状態である。

## 公開前の確認

外部共有を有効化する前に、次を確認する。

- #41の手動同期が成功し、Grafanaの4指標がDB集計値と一致する
- 完了Issue、最終同期日時、同期ステータスが正しく表示される
- リポジトリ名、ID、URL、接続情報、Tokenが表示されない
- PCとスマートフォンで主要情報が読める
- Grafana Cloudの外部共有で、ダッシュボード変数を含むパネルが想定どおり表示される

外部共有URLは誰でも閲覧できる可能性があるため、README、Issue、Dashboard JSON、Actionsログへ保存しない。公開は#16の受け入れ条件を再確認してから行う。

## 定期同期の確認

同期WorkflowはJST 08:00、14:00、22:00に実行される。schedule復元後はActions履歴とSlack DMで少なくとも3回の成功を確認し、`app.sync_runs`で重複保存がないことを確認する。cronは遅延する可能性があるため、定刻どおりに開始されない場合でも、直近の実行履歴を基準に確認する。
