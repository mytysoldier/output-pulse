# 開発ガイド

## 開発方針

Output Pulseは、GitHub Issueを作業単位として個人開発を進める。完成度よりも、動作して継続運用できる小さな変更を優先する。

- 企画・要件・技術設計をIssueで整理する
- 初期リリースで作ること、作らないことを明確にする
- 実装Issueを小さく分ける
- 実装後は検証、コミット、push、PR作成まで進める
- レビューコメントに対応した後は再レビューを依頼する

作業ルールの詳細は[AGENTS.md](../AGENTS.md)を参照する。

## AIエージェントの使い方

- Codexを実装、テスト、Git操作、PR作成の主担当にする
- GitHub Actionsでlint、型チェック、テスト、buildを確認する
- CodexのPRレビューを使い、GitHub Actionsと人間の確認を補完する
- GeminiやAntigravityは、別解の検討、資料・画像を含む調査、UI案の比較などの補助に使う
- 複数のAIエージェントで同じブランチを同時に編集しない

GeminiやAntigravityを使う場合も、実装の最終責任とPR作成はCodexに集約する。変更の経緯とレビュー対象を追いやすくするためである。

## 新しいプロジェクトへ展開する場合

このリポジトリをテンプレートとして使う場合は、次の順で進める。

1. リポジトリをテンプレートとして新規作成する
2. [計画テンプレート](planning-template.md)をコピーし、作りたいサービスの計画を書く
3. `.github/ISSUE_TEMPLATE/design.md`から設計Issueを作る
4. 設計Issueで初期リリースの範囲と技術方針を確定する
5. `.github/ISSUE_TEMPLATE/implementation.md`から実装Issueを小さく作る
6. AIエージェントにIssue単位で実装を依頼する
