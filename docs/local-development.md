# ローカル開発手順

## 必要な環境

Node.js 24.18.0以上とpnpm 11.7.0以上を使用する。asdfでは[`.tool-versions`](../.tool-versions)、その他のNode.jsバージョン管理ツールでは[`.node-version`](../.node-version)を参照する。

asdfを使用する場合は、リポジトリ直下でNode.jsをインストールする。

```bash
asdf install
```

pnpmはCorepackで管理する。初回だけ次を実行する。

```bash
corepack enable
```

asdfを使用する場合は、Corepackの有効化後にshimを再生成する。

```bash
asdf reshim nodejs 24.18.0
```

Node.jsとpnpmのバージョンを確認する。

```bash
node --version
pnpm --version
```

`node --version`が`v24.18.0`、`pnpm --version`が`11.7.0`以上であることを確認してから、依存パッケージをインストールする。

```bash
pnpm install
cp .env.example .env
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

`.env`にはローカル開発用の秘密情報だけを保存し、Gitへコミットしない。本番の値はGitHub Actions Secretsで管理する。

## ローカルPostgreSQL

Docker Desktopなど、Docker Compose v2を利用できる環境が必要。本番Neonへの接続は不要である。

`.env`を用意したうえで、開発用PostgreSQLを起動する。

```bash
cp .env.example .env
docker compose up -d postgres
```

起動完了はhealthcheckで確認できる。

```bash
docker compose ps
docker compose exec postgres pg_isready -U output_pulse -d output_pulse
```

ローカルからの接続は、次のコマンドで確認する。

```bash
docker compose exec postgres psql -U output_pulse -d output_pulse -c 'SELECT current_database(), current_user;'
```

停止してもデータは名前付きVolumeに保持される。再開する場合は、再度`docker compose up -d postgres`を実行する。

```bash
docker compose stop postgres
```

ローカルデータを完全に初期化する必要がある場合だけ、次を実行する。この操作はVolume内のデータを削除する。

```bash
docker compose down -v
```
