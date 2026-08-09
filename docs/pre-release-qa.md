# 公開前横断QA記録

この記録は [#17](https://github.com/mytysoldier/output-pulse/issues/17) の公開前確認に使用する。Secrets、接続文字列、Privateリポジトリ名、Grafana外部共有URLは記載しない。

## 実施状況

| 確認項目 | 状態 | 根拠・確認方法 |
| --- | --- | --- |
| 実装Issueの完了状態 | 確認済み | GitHub上で #1、#4〜#16、#40 が `CLOSED` であることを確認する。 |
| コード品質 | 確認済み | `pnpm format:check`、`pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build` を実行する。 |
| 4指標・公開Viewの定義 | 自動確認済み | `tests/dashboard-views-migration.test.ts` と `tests/grafana-dashboard.test.ts` でJST集計、公開View限定、4指標、公開対象外の列を確認する。 |
| 冪等性・部分失敗継続 | 自動確認済み | `tests/synchronization.test.ts` と `tests/pull-request-events-migration.test.ts` で48時間重複取得、Upsert、リポジトリ単位のRollbackと継続を確認する。 |
| 対象リポジトリの除外 | 自動確認済み | `tests/github-targets.test.ts` でOrganization、Fork、Archivedの除外とPublic／Privateの収集対象化を確認する。 |
| Slack失敗の独立性 | 自動確認済み | `tests/synchronization.test.ts` でSlack通知失敗時にも同期結果を維持することを確認する。 |
| Grafana Roleの書き込み禁止 | 自動確認済み | `tests/dashboard-views-migration.test.ts` で`grafana_reader`へ公開Viewの`SELECT`だけを付与するMigrationを確認する。 |
| Actions定期同期・Slack DM | 要運用確認 | schedule再開後の成功実行3回と各DMをActions履歴・Slackで確認する。 |
| GitHub・DB・Grafanaの実測照合 | 要運用確認 | 下記の代表サンプル照合を本番の読み取り専用画面で行う。 |
| 公開表示のPC／スマートフォン確認 | 要運用確認 | Grafana Cloudの外部共有URLをブラウザで開き、主要表示と空・失敗状態を確認する。 |

`要運用確認` の項目が完了するまで、#17 と #18 を完了扱いにしない。

## 代表サンプルの照合手順

1. 直近30日から、コミット・作成PR・マージPR・完了Issueをそれぞれ少なくとも1件含む期間を選ぶ。
2. GitHubの各対象イベント数、`dashboard.daily_metrics`の4指標、Grafanaの4枚の数値カードを同じJST期間で照合する。
3. 同じ期間の`range`同期を2回実行し、`app.commits`、`app.pull_request_events`、`app.completed_issues`と公開Viewの集計値が増えないことを確認する。
4. 1リポジトリで取得エラーが起きる条件を安全な検証環境で作り、他リポジトリの結果が保存され、実行結果が`partial_failure`になることを確認する。本番の有効データを削除・改変しない。
5. Actions履歴でJST 08:00、14:00、22:00の定期同期が3回成功したことを確認し、Slack DMと`app.sync_runs`の通知状態を照合する。cron遅延時は開始時刻ではなく実行履歴を基準にする。

## セキュリティ確認

- Grafanaの公開画面・Dashboard JSON・Actionsログ・Slack DMに、リポジトリ名、リポジトリID、GitHub URL、Token、接続文字列、エラー詳細が出ないことを確認する。
- Grafana専用Roleで`dashboard` Schemaの公開Viewを`SELECT`でき、`app` Schemaの参照およびDDL・DMLが拒否されることを確認する。
- GitHub TokenはRead権限だけ、Collector接続は専用Role、Migration接続は`production` Environment Secretで管理されていることを確認する。

## 判定記録

| 実施日 | 実施者 | 結果 | 備考 |
| --- | --- | --- | --- |
|  |  |  |  |

すべての要運用確認が成功し、重大な未解決事項がないことを確認したら、この表へ結果を追記し、#17 をCloseする。
