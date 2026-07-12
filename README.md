# Output Pulse

GitHub上の個人開発実績を定期収集し、Grafana Cloudで一般公開する個人用ダッシュボードです。

要件と技術設計は以下を参照してください。実装の進捗は[Roadmap Issue #3](https://github.com/mytysoldier/output-pulse/issues/3)で管理します。

- [要件定義](docs/requirements.md)
- [アーキテクチャ](docs/architecture.md)
- [データベース設計](docs/database-design.md)
- [同期仕様](docs/synchronization.md)
- [セキュリティ設計](docs/security.md)
- [運用設計](docs/operations.md)
- [DBマイグレーション手順](docs/database-migrations.md)

## 開発を始める

Node.js 22.14.0以上とpnpm 11.7.0以上を使用します。推奨バージョンは[`.node-version`](.node-version)を参照してください。

```bash
pnpm install
cp .env.example .env
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

`.env`には秘密情報を保存し、Gitへコミットしないでください。各環境変数の利用開始は後続Issueで実装します。

## 開発方針

AIエージェントを中心に、GitHub Issueでタスクを管理しながら個人開発を進めるためのテンプレートです。

このテンプレートは、以下のような進め方を前提にしています。

- まず企画・要件・技術設計をIssueで整理する
- 初期リリースで作ること、作らないことを明確にする
- 実装Issueを小さく分ける
- AIエージェントはIssue単位で実装する
- 実装後は検証、コミット、push、PR作成まで進める
- レビューコメント対応後は再レビューを依頼する

## 使い方

1. このリポジトリをテンプレートとして新しいリポジトリを作成する
2. `docs/planning-template.md` をコピーして、作りたいサービスの計画を書く
3. `.github/ISSUE_TEMPLATE/design.md` から設計Issueを作る
4. 設計Issueで初期リリースの範囲と技術方針を確定する
5. `.github/ISSUE_TEMPLATE/implementation.md` から実装Issueを小さく作る
6. AIエージェントにIssue単位で実装を依頼する

## 推奨AI開発フロー

- Codexを実装、テスト、Git操作、PR作成の主担当にする
- GitHub Actionsでlint、型チェック、テスト、buildを必須確認にする
- CodexのPRレビューをすべてのPRで使い、GitHub Actionsと人間の確認を補完する
- GeminiやAntigravityは、別解の検討、資料・画像を含む調査、UI案の比較などの補助に使う
- 複数のAIエージェントで同じブランチを同時に編集しない

GeminiやAntigravityを使う場合も、実装の最終責任とPR作成はCodexに集約すると、変更の経緯とレビュー対象を追いやすくなります。

## AI向けルール

AIエージェント向けの作業ルールは [AGENTS.md](AGENTS.md) にまとめています。

Codexを含むAIコーディングエージェントには、まず `AGENTS.md` と対象Issueを読ませてから作業させてください。

## 基本方針

個人開発では、完成度よりも公開できる初期リリースを優先します。

AIには大きな曖昧な依頼を渡さず、Issueごとに目的、実装範囲、受け入れ条件、スコープ外を明記します。これにより、AIが勝手に機能を増やしたり、技術スタックを変更したりすることを防ぎます。
