# DBマイグレーション手順

## 方針

- Drizzle ORMのSchemaを正とする
- Drizzle KitでMigration SQLを生成し、必ずGit管理する
- 生成SQLをPRで確認してから適用する
- 定期同期WorkflowではMigrationを実行しない
- 本番適用は専用の手動GitHub Actions Workflowで行う

## Schema変更

1. `src/db/schema/`のDrizzle Schemaを変更する
2. 必要に応じて公開View、DB Role、GrantのカスタムSQLを追加する
3. Migration SQLを生成する

```bash
pnpm db:generate
```

4. 生成SQLをレビューする
5. ローカルPostgreSQLへ適用する

```bash
docker compose up -d postgres
pnpm db:migrate
```

6. 型チェック、テストを実行する

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

`pnpm db:generate`はSchemaとの差分からMigration SQLを生成する。`pnpm db:check`はMigration履歴とSchemaの整合性を確認する。`pnpm db:migrate`は`.env`の`DATABASE_MIGRATION_URL`を優先し、未設定時は`DATABASE_URL`へ初期Migrationを適用する。`app` Schemaの作成など、Drizzleが自動生成しないSQLはMigrationファイルへ明示的に追加する。

## SQLレビュー観点

- 意図しないDROP、TRUNCATE、データ消失がない
- NOT NULL追加時に既存行を処理できる
- 一意制約とUpsert条件が一致する
- 日時列が`timestamp with time zone`である
- 必要なインデックスがある
- 公開Viewにリポジトリ識別情報や秘密情報がない
- Grafanaユーザーの権限が`SELECT`に限定される
- Migrationがトランザクション内で安全に実行できる

## 本番適用

1. Migrationを含むPRをmainへマージする
2. `Database Migration` Workflowを手動実行する
3. GitHub Environmentの承認を行う
4. `DATABASE_MIGRATION_URL`を使って未適用Migrationを適用する
5. Migration履歴と公開Viewを検証する
6. 成功／失敗をSlack DMへ通知する

Migration用接続文字列はGitHub Actions Environment Secretへ保存し、Collector用・Grafana用接続情報と分離する。

## 失敗時

- 自動再試行しない
- Actionsログで適用済みMigrationを確認する
- 原因を修正する新しいMigrationを作成する
- 適用済みMigrationファイルを後から書き換えない
- 本番Rollbackは原則として前進修正とし、データ損失を伴う操作は明示的な承認を必要とする

## View変更

公開Viewの列名や型を維持する変更はGrafanaへ自動反映される。列名や意味を変更する場合は、Grafana Dashboard JSONの変更と同じIssue／PRで扱う。
