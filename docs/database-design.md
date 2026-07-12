# データベース設計

## 方針

- PostgreSQLを使用し、イベントデータを無期限保存する
- GitHub IDまたはSHAを一意キーにして冪等にUpsertする
- Grafanaはイベントデータを公開用View経由で都度SQL集計する
- MVPでは日別集計テーブルやMaterialized Viewを作らない

## Schema境界

- `app`: 収集処理が利用する内部テーブル
- `dashboard`: Grafanaへ公開するView
- Grafana専用ユーザーには`dashboard` SchemaのViewへの`SELECT`のみを許可する

## テーブル

### `app.tracked_actors`

| 列 | 内容 |
| --- | --- |
| github_user_id | GitHubの不変ID、一意キー |
| github_login | ログイン名 |
| actor_type | `user`または`bot` |
| enabled | 集計対象か |
| created_at / updated_at | 管理日時 |

### `app.repositories`

| 列 | 内容 |
| --- | --- |
| github_repository_id | GitHubの不変ID、一意キー |
| owner_github_user_id | ownerのGitHub ID |
| visibility | Public／Private |
| default_branch | デフォルトブランチ |
| is_fork / is_archived | 除外判定 |
| enabled | 同期対象か |
| last_synced_at | 最終成功日時 |

リポジトリ名は原則保存しない。APIアクセスに必要で保存が不可避な場合は内部Schemaに限定し、公開View、ログ、Slackへ出さない。

### `app.commits`

| 列 | 内容 |
| --- | --- |
| repository_id + sha | 複合一意キー |
| author_github_user_id | author |
| committed_at | 集計日時 |
| first_seen_at / last_seen_at | 同期監査日時 |

コミットメッセージ、差分、ファイル情報は保存しない。

### `app.pull_requests`

| 列 | 内容 |
| --- | --- |
| github_node_id | 一意キー |
| repository_id / number | 内部識別子 |
| author_github_user_id | author |
| created_at / merged_at | 集計日時 |
| state | 現在状態 |
| first_seen_at / last_seen_at | 同期監査日時 |

タイトル、本文、URLは保存しない。

### `app.completed_issues`

| 列 | 内容 |
| --- | --- |
| github_node_id | 一意キー |
| repository_id / number | 内部識別子 |
| title | 公開する最新タイトル |
| first_closed_at | 最初のClose日時 |
| matched_by_author | actor作成条件 |
| matched_by_closing_pr | actor PR条件 |
| visibility | Public／Private |
| last_seen_at | 最終確認日時 |

再Close時も`first_closed_at`を更新しない。複数条件を満たしても1行とする。GitHubから削除された可能性があっても自動削除しない。

### `app.sync_runs`

| 列 | 内容 |
| --- | --- |
| id | 実行ID |
| trigger_type / sync_mode | 定期・手動、差分・期間・全件 |
| started_at / finished_at | 実行日時 |
| status | success／partial_failure／failure |
| requested_from / requested_to | 対象期間 |
| repository_total / succeeded / failed | リポジトリ結果 |
| fetched / inserted / updated | 集計件数 |
| github_rate_limit_remaining | API残量 |
| error_summary | 機密情報を除いた概要 |
| notification_status | Slack通知結果 |

## 公開View

- `dashboard.daily_metrics`: JST日別の4指標
- `dashboard.completed_issues`: Issueタイトルと完了日時
- `dashboard.sync_status`: 最終同期状態

ViewはリポジトリID、リポジトリ名、GitHub URL、秘密情報を返さない。

## インデックス

- commits: `committed_at`, `author_github_user_id`
- pull_requests: `created_at`, `merged_at`, `author_github_user_id`
- completed_issues: `first_closed_at`
- sync_runs: `started_at`, `status`

データ量が増えて遅延した場合のみ、インデックス調整、Materialized View、日別集計テーブルの順に検討する。
