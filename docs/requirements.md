# Output Pulse MVP 要件定義

## 結論

MVPでは、`mytysoldier`個人アカウント配下のGitHub活動を1日3回収集し、Neon PostgreSQLへ無期限保存して、Grafana Cloudの外部共有ダッシュボードで一般公開する。

## 目的

- PR、コミット、完了Issueの実績を期間別に把握する
- 何件実施したか、何を完了したかをグラフィカルに振り返る
- Privateリポジトリを集計しつつ、リポジトリ情報を公開しない
- サーバーを常時運用せず、無料枠中心で継続運用する

## 想定ユーザー

- データ所有者・運用者: `mytysoldier`
- 閲覧者: インターネット上の一般ユーザー

## 対象リポジトリ

- ownerが`mytysoldier`のPublic／Privateリポジトリ
- 新規リポジトリは自動追加する
- Organization、Fork、Archivedリポジトリは除外する

## 集計指標

### コミット

- 対象リポジトリのデフォルトブランチへ到達したコミット
- authorが有効なtracked actorであること
- 日付は`committed_at`をJSTへ変換して判定する
- マージコミットを含む
- AIも原則として`mytysoldier`のGit authorを使用する

### Pull Request

- authorが有効なtracked actorであるPRの作成数
- authorが有効なtracked actorであるPRのマージ数
- 他人が作成し、`mytysoldier`がマージしたPRは対象外とする
- PRマージ自体は完了タスクとして数えない

### 完了Issue

Closed Issueのうち、次のいずれかを満たすものを1件として数える。

- 作成者が有効なtracked actor
- GitHubが有効なtracked actorのPRによってCloseされたと判定したIssue

Assigneeは判定に使用しない。再オープン後に再Closeされても追加計上せず、最初のClose日時を保持する。タイトル変更は同期し、GitHub上から削除されても過去実績を保持する。

## tracked actor

- 初期値は`mytysoldier`
- 将来Botアカウントを追加できる
- 登録Botはコミット、PR、Issueの全指標で対象とする
- Dependabot等を自動登録しない

## ダッシュボード

- 過去30日のコミット、作成PR、マージPR、完了Issueの数値カード
- 前30日との増減率
- 日別の積み上げ棒グラフ
- 週別推移
- 完了Issueのタイトルと完了日時
- 最終データ更新日時と最終同期ステータス
- 期間は7日、30日、90日、今年、全期間等へ変更可能にする
- PCとスマートフォンで主要情報を確認できる

リポジトリ名、GitHubへの詳細リンク、Issue本文、PR本文、コメント、コード差分、コミットメッセージは表示しない。

## データ更新と通知

- JST 08:00、14:00、22:00にGitHub Actionsで実行する
- 初回は過去30日を取得する
- 通常同期は48時間の重複期間を再取得する
- 手動で通常差分、期間指定、全再同期を実行できる
- 定期・手動を問わず、成功／失敗を個人Slack WorkspaceへDMする

## 非機能要件

- 同じ同期を複数回実行しても重複計上しない
- 1リポジトリが失敗しても後続リポジトリを処理する
- API・DBエラーで既存データを破壊しない
- 秘密情報をログ、DB、Grafana、Slackへ出さない
- GrafanaからDBへの書き込みを禁止する
- lint、型チェック、テスト、buildを通す

## MVPで作らないもの

- ログイン、複数ユーザー、Organization対応
- GitHub外のタスク管理、AI要約
- 独自Web UI、VPS、Terraform
- 課金、広告SDK、解析SDK
- 大量アクセス対策、キャッシュ、Materialized View
- 独自ドメイン
