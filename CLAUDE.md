# Receipt Purikura - バックエンド

## プロジェクト概要

サーマルレシートプリンターを使った白黒レトロプリクラサービスのバックエンド。
AWS 19サービスを駆使したオーバーアーキテクチャなハッカソン出展作品。

- **リポジトリ**: hackz-megalo-back
- **チーム**: 2名（A: フロント+CDK, B: バックエンドLambda）
- **開発期間**: 14日間（〜2026-03-16）

## テックスタック

| カテゴリ | 技術 |
|---------|------|
| ランタイム | Node.js 20 (TypeScript), ARM64 (Graviton2) |
| 画像処理 | sharp |
| QRコード | qrcode (npm) |
| バリデーション | zod |
| IaC | AWS CDK 2.x (TypeScript) |
| テスト | Vitest + @vitest/coverage-v8 |
| リント | ESLint 10 + Prettier 3.8 |

## ディレクトリ構成

```
back/
├── src/                        # Lambda コード
│   ├── functions/              # Lambda ハンドラ (19関数)
│   │   ├── session-create/     # セッション作成 + Presigned URL
│   │   ├── session-get/        # セッション情報取得
│   │   ├── process-start/      # Step Functions 起動
│   │   ├── ws-connect/         # WebSocket 接続
│   │   ├── ws-disconnect/      # WebSocket 切断
│   │   ├── ws-subscribe/       # セッション購読
│   │   ├── ws-join-room/       # ルーム参加
│   │   ├── ws-webrtc-offer/    # SDP Offer 中継
│   │   ├── ws-webrtc-answer/   # SDP Answer 中継
│   │   ├── ws-webrtc-ice/      # ICE Candidate 中継
│   │   ├── ws-shooting-sync/   # 撮影同期イベント中継
│   │   ├── face-detection/     # Rekognition 顔検出
│   │   ├── filter-apply/       # sharp / Stability AI フィルター
│   │   ├── collage-generate/   # 2x2 コラージュ生成
│   │   ├── caption-generate/   # Bedrock キャプション + Comprehend
│   │   ├── print-prepare/      # ディザリング + QR + レイアウト
│   │   ├── yaji-comment-fast/  # Rekognition → テンプレートコメント
│   │   ├── yaji-comment-deep/  # Bedrock Haiku マルチモーダル
│   │   └── stats-update/       # DynamoDB Streams → 統計更新
│   ├── lib/                    # 共通ライブラリ (TODO)
│   └── utils/                  # ユーティリティ (TODO)
├── cdk/                        # CDK IaC
│   ├── bin/app.ts              # スタックエントリポイント
│   └── lib/
│       ├── app-stack.ts        # メインスタック (IAM, Outputs)
│       ├── github-oidc-stack.ts # GitHub Actions OIDC
│       └── constructs/
│           ├── storage.ts      # S3 + DynamoDB
│           ├── api.ts          # REST API + WebSocket + Lambda
│           ├── pipeline.ts     # Step Functions Express
│           └── realtime.ts     # IoT Core
├── docs/                       # ドキュメント
│   ├── requirements.md         # 全体要件定義書 (front と共通)
│   ├── screen-transition.md    # 画面遷移図 (front と共通)
│   ├── infrastructure.md       # インフラ要件 (front と共通)
│   ├── architecture.md         # バックエンドアーキテクチャ
│   ├── api.md                  # API 仕様書
│   ├── cdk-design.md           # CDK スタック設計
│   ├── step-functions.md       # Step Functions ワークフロー設計
│   └── tasks.md                # 実装タスク分解 (Stage 1-5)
└── package.json
```

## 開発コマンド

```bash
# 開発
npm run lint          # ESLint
npm run lint:fix      # ESLint 自動修正
npm run type-check    # tsc --noEmit
npm run test          # Vitest
npm run build         # tsc

# CDK
cd cdk
npx cdk synth         # CloudFormation テンプレート生成
npx cdk diff          # 差分確認
npx cdk deploy --all  # デプロイ
```

## Git ワークフロー

- **main**: 本番ブランチ（develop からの PR マージのみ）
- **develop**: 開発統合ブランチ
- **feat/xxx**: 機能ブランチ（develop から切って develop に PR）

```
feat/xxx → develop → main
```

### コミット・プッシュ・PR の粒度

**1 Lambda 関数（API）ごとに 1 ブランチ・1 PR** を原則とする。

- 機能ブランチ名: `feat/<関数名>` (例: `feat/session-create`, `feat/filter-apply`)
- 共通ライブラリのみの変更: `feat/common-libs`, `feat/validation` 等
- コミットは関数内でも細かく分ける（テスト追加 → 実装 → リファクタ）
- PR は **1 関数の実装が完了したら即作成・マージ**。複数関数をまとめない
- PR 作成前に `npm run lint && npm run type-check && npm run test` を通すこと

```
例: session-create の実装フロー
1. git checkout -b feat/session-create develop
2. コミット: "test: session-create のテスト追加"
3. コミット: "feat: session-create Lambda 実装"
4. git push -u origin feat/session-create
5. PR 作成 (feat/session-create → develop)
6. マージ後、次の関数へ
```

### コミットメッセージ

```
<type>: <description>

types: feat, fix, refactor, docs, test, chore, perf, ci
```

### CI/CD (.github/workflows/ci.yml)

1. **Lint** → 2. **Type Check** → 3. **Test** → 4. **Build** → 5. **Deploy** (main のみ)

## デプロイ済みリソース (dev)

| リソース | エンドポイント |
|---------|-------------|
| REST API | `https://j9q5u6tn5k.execute-api.ap-northeast-1.amazonaws.com/dev/` |
| WebSocket | `wss://hzlbshsl5c.execute-api.ap-northeast-1.amazonaws.com/dev` |
| S3 | `receipt-purikura-dev` |
| DynamoDB | `receipt-purikura-sessions-dev`, `receipt-purikura-connections-dev` |

## 実装状況

### インフラ (CDK) ✅ デプロイ済み

S3, DynamoDB, API Gateway (REST + WebSocket), Lambda 19関数 (スタブ), Step Functions Express, IoT Core

### Lambda 実装 🔲 Stage 1 (MVP) から順に実装

`docs/tasks.md` の Stage 1-5 に従って実装する。

| Stage | 目標 | 内容 |
|-------|------|------|
| **1 (MVP)** | Day 5 | session-create, filter-apply, collage-generate, print-prepare, IoT印刷 |
| **2** | Day 7 | WebSocket + WebRTC シグナリング + 撮影同期 |
| **3** | Day 9 | 顔検出 + キャプション + 感情分析 + やじコメント |
| **3.5** | Day 10 | AI スタイル変換 (Stability AI) |
| **4** | Day 11 | CloudFront + SNS |
| **5** | Day 13 | AppSync + DynamoDB Streams + 監視 |

### 注意事項

- Lambda メモリは現在 3008MB（アカウントデフォルト上限）。本番前に Service Quotas 申請で 10GB に引き上げ
- Provisioned Concurrency は dev では無効。本番時に filter-apply, collage-generate, print-prepare の 3 関数で有効化
- 印刷方式: IoT Core MQTT + WebUSB（推奨）、SQS + python-escpos（フォールバック）

## ドキュメントの管理方針

- `requirements.md`, `screen-transition.md`, `infrastructure.md`, `plans/` は **front リポと同一内容**
- バックエンド固有のドキュメント (`architecture.md`, `api.md`, `cdk-design.md`, `step-functions.md`, `tasks.md`) はこのリポのみ
- 共通ドキュメントを更新したら、もう一方のリポにもコピーすること

## MCP サーバー

このプロジェクトで活用する MCP サーバー:

| MCP | 用途 |
|-----|------|
| **context7** | ライブラリの最新ドキュメント取得（aws-cdk-lib, sharp, zod 等） |
| **brave-search** | 技術調査、AWS サービスの仕様確認 |
| **chrome-devtools** | フロント連携時のデバッグ、API レスポンス確認 |
| **figma** | UI デザイン確認（フロント連携時） |

### context7 の使い方

```
# ライブラリドキュメントの検索
resolve-library-id → query-docs の順で使用
例: aws-cdk-lib の WebSocketApi の使い方を調べる
```

## Superpowers スキル

開発で使うスキル:

| スキル | タイミング |
|--------|-----------|
| **brainstorming** | 新機能の設計前（要件整理 → アプローチ提案 → 設計承認） |
| **writing-plans** | 設計承認後、実装計画の作成 |
| **executing-plans** | 実装計画に沿ったコード実装 |
| **tdd** | Lambda 実装時（テストファースト） |
| **verification-before-completion** | 完了宣言前の検証 |
| **code-review** | コード変更後のレビュー |
| **systematic-debugging** | バグ・テスト失敗時のデバッグ |
| **finishing-a-development-branch** | ブランチ作業完了時の統合判断 |

## エージェント

| エージェント | 用途 |
|------------|------|
| **planner** | 複雑な機能の実装計画 |
| **tdd-guide** | テスト駆動開発の実施 |
| **code-reviewer** | コード変更後の即時レビュー |
| **security-reviewer** | API エンドポイント、入力処理のセキュリティ確認 |
| **build-error-resolver** | ビルド/型エラーの解決 |
| **architect** | アーキテクチャ判断 |

## コーディング規約

- **不変性**: オブジェクトは常に新規作成、ミューテーション禁止
- **ファイルサイズ**: 200-400行目安、800行上限
- **エラーハンドリング**: try/catch 必須、ユーザーフレンドリーなメッセージ
- **入力バリデーション**: zod スキーマで検証
- **テスト**: TDD (RED → GREEN → REFACTOR)、カバレッジ 80% 以上
- **関数**: 50行以内、ネスト4段以内
