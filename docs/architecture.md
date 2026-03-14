# バックエンド アーキテクチャ概要

> **最終更新日**: 2026-03-06
> **ステータス**: Draft v3
> **ランタイム**: Node.js 20 (TypeScript) / ARM64 (Graviton2) / 10GB メモリ
> **元定義**: [元要件定義書](/docs/requirements.md), [インフラ要件定義書](/docs/infrastructure.md)

---

## 1. 概要

フルサーバーレス構成。Lambda (Node.js 20, ARM64, 10GB) + Step Functions Express で画像処理パイプラインを構築する。

```
スマホ → S3 Upload → EventBridge → Step Functions Express → 各 Lambda → 出力
```

### 技術スタック

| カテゴリ | 技術 |
|---------|------|
| ランタイム | Node.js 20 (TypeScript), ARM64 (Graviton2) |
| メモリ | 10GB（CPU 最大化） |
| 画像処理 | sharp (フィルター, リサイズ, コラージュ, ディザリング) |
| QR コード | qrcode (npm) |
| ID 生成 | crypto.randomUUID() |
| バリデーション | zod |
| IaC | AWS CDK (TypeScript) |

---

## 2. 処理パイプライン

### 2.1 メインフロー（4フェーズ超並列化）

元要件定義書のパイプライン構造に準拠。

```
[S3 Upload (4枚)] → EventBridge → Step Functions Express 起動
        │
        ▼
╔═══════════════════════════════════════════════════╗
║  Phase 1: 並列処理（顔検出 + フィルター同時開始）  ║
║                                                   ║
║  ┌──────────────────┐  ┌──────────────────────┐  ║
║  │ 顔検出 (並列×4)  │  │ フィルター適用 (並列×4)│  ║
║  │ Rekognition      │  │ [簡易] sharp ~1秒     │  ║
║  │ ~1-2秒           │  │ [AI] Stability ~15秒 │  ║
║  └────────┬─────────┘  └──────────┬───────────┘  ║
║           └──→ クロップ調整 ──────┘               ║
╚═══════════════════════╪═══════════════════════════╝
                        │
                        ▼
╔═══════════════════════════════════════════════════╗
║  Phase 2: 並列処理（コラージュ + キャプション）    ║
║                                                   ║
║  ┌────────────────────┐  ┌──────────────────┐    ║
║  │ コラージュ生成      │  │ キャプション生成  │    ║
║  │ sharp 2x2グリッド   │  │ Bedrock Claude   │    ║
║  │ ~1-2秒             │  │ ~2-3秒           │    ║
║  └────────┬───────────┘  └──────┬───────────┘    ║
╚═══════════╪═════════════════════╪════════════════╝
            │                     │
            ▼                     ▼
╔═══════════════════════════════════════════════════╗
║  Phase 3: 並列処理（ディザリング + 感情分析）      ║
║                                                   ║
║  ┌────────────────────┐  ┌──────────────────┐    ║
║  │ ディザリング       │  │ 感情分析         │    ║
║  │ + QRコード埋め込み │  │ Comprehend       │    ║
║  │ + レシートレイアウト│  │ ~0.5秒           │    ║
║  │ ~1-2秒             │  │                  │    ║
║  └────────┬───────────┘  └──────┬───────────┘    ║
║           └──→ 感情連動フレーム ←┘                ║
║                最終合成                            ║
╚═══════════════════════╪══════════════════════════╝
                        │
                        ▼
╔═══════════════════════════════════════════════════╗
║  Phase 4: 並列出力（全て同時実行）                ║
║                                                   ║
║  ├──→ S3 保存（カラー版 + 印刷用）               ║
║  ├──→ DynamoDB 書き込み（→ Streams → AppSync）   ║
║  ├──→ WebSocket で completed 通知                ║
║  ├──→ EventBridge → SNS（ファンアウト）          ║
║  └──→ IoT Core MQTT で印刷ジョブ即時送信         ║
╚══════════════════════════════════════════════════╝

─── 所要時間（撮影時間除く）───
簡易フィルター: アップ(1-2秒) + Phase1(2秒) + Phase2(2秒) + Phase3(2秒) + 印刷(5秒) = ~12秒
AIスタイル:     アップ(1-2秒) + Phase1(15秒) + Phase2(3秒) + Phase3(2秒) + 印刷(5秒) = ~27秒
```

### 2.2 リアルタイム通信

| プロトコル | 用途 | AWS サービス |
|-----------|------|------------|
| WebSocket | 進捗通知 (`statusUpdate`/`completed`)、WebRTC シグナリング、撮影同期 | API Gateway WebSocket |
| WebRTC | スマホ↔PC 映像ストリーミング (片方向) | API Gateway (シグナリングのみ) |
| MQTT | 印刷ジョブ送信 | IoT Core |
| GraphQL Subscription | ダッシュボードリアルタイム更新 | AppSync |

---

## 3. Lambda 関数一覧

| 関数名 | メモリ | タイムアウト | 用途 |
|--------|--------|------------|------|
| `session-create` | 10GB | 10s | セッション作成 + Presigned URL 4枚発行 |
| `session-get` | 10GB | 10s | セッション情報取得 |
| `process-start` | 10GB | 10s | Step Functions 起動 |
| `ws-connect` | 10GB | 10s | WebSocket 接続ハンドラ |
| `ws-disconnect` | 10GB | 10s | WebSocket 切断ハンドラ |
| `ws-subscribe` | 10GB | 10s | セッション購読 |
| `ws-join-room` | 10GB | 10s | ルーム参加 |
| `ws-webrtc-offer` | 10GB | 10s | WebRTC SDP Offer 中継 |
| `ws-webrtc-answer` | 10GB | 10s | WebRTC SDP Answer 中継 |
| `ws-webrtc-ice` | 10GB | 10s | WebRTC ICE Candidate 中継 |
| `ws-shooting-sync` | 10GB | 10s | 撮影同期イベント中継 |
| `face-detection` | 10GB | 30s | Rekognition 顔検出 + 感情分析 |
| `filter-apply` | 10GB | 60s | sharp / Stability AI フィルター |
| `collage-generate` | 10GB | 60s | コラージュ合成 (sharp) |
| `caption-generate` | 10GB | 30s | Bedrock キャプション + Comprehend 感情分析 |
| `print-prepare` | 10GB | 60s | ディザリング + QR + フレーム合成 (印刷用 PNG 生成) |
| `yaji-comment-fast` | 10GB | 10s | Rekognition → テンプレートコメント |
| `yaji-comment-deep` | 10GB | 30s | Bedrock Haiku マルチモーダル |
| `stats-update` | 10GB | 10s | DynamoDB Streams → 統計更新 |

共通設定: ARM64 (Graviton2), Node.js 20 (TypeScript), 10GB メモリ
本番時: Provisioned Concurrency (filter-apply, collage-generate, print-prepare の3関数)

### 依存ライブラリ

| パッケージ | 用途 |
|-----------|------|
| `sharp` | 画像処理 (フィルター, リサイズ, コラージュ, ディザリング) |
| `qrcode` | QR コード生成 |
| `@aws-sdk/client-s3` | S3 操作 |
| `@aws-sdk/s3-request-presigner` | Presigned URL 生成 |
| `@aws-sdk/client-dynamodb` | DynamoDB 操作 |
| `@aws-sdk/lib-dynamodb` | DynamoDB ドキュメントクライアント |
| `@aws-sdk/client-rekognition` | 顔検出・感情分析 |
| `@aws-sdk/client-bedrock-runtime` | Bedrock AI 推論 |
| `@aws-sdk/client-comprehend` | 感情分析 |
| `@aws-sdk/client-iot-data-plane` | IoT Core MQTT パブリッシュ |
| `@aws-sdk/client-sfn` | Step Functions 起動 |
| `@aws-sdk/client-apigatewaymanagementapi` | WebSocket メッセージ送信 |
| `zod` | リクエストバリデーション |

---

## 4. データモデル

### 4.1 DynamoDB テーブル

**sessions テーブル**

| 属性 | 型 | 説明 |
|------|-----|------|
| `sessionId` (PK) | String | セッション ID (UUID) |
| `createdAt` (SK) | String | 撮影日時 (ISO 8601) |
| `filterType` | String | `simple` / `ai` |
| `filter` | String | `natural` / `beauty` / `bright` / `mono` / `sepia` / `anime` / `popart` / `watercolor` |
| `status` | String | `uploading` / `processing` / `completed` / `printed` / `failed` |
| `caption` | String | AI 生成キャプション |
| `originalImageKeys` | List\<String\> | S3 元画像キー (4枚) |
| `collageImageKey` | String | S3 カラー版コラージュキー |
| `printImageKey` | String | S3 印刷用白黒コラージュキー |
| `connectionId` | String | WebSocket 接続 ID (通知用) |
| `ttl` | Number | TTL (30日後) |

**connections テーブル**

| 属性 | 型 | 説明 |
|------|-----|------|
| `connectionId` (PK) | String | WebSocket 接続 ID |
| `sessionId` | String | セッション ID |
| `roomId` | String | WebRTC ルーム ID |
| `role` | String | `phone` / `pc` |
| `connectedAt` | Number | 接続タイムスタンプ |
| `ttl` | Number | TTL (1日後) |

> GSI: `sessionId-index` (sessionId → connectionId 検索用、進捗通知に使用)
> GSI: `roomId-index` (roomId → connectionId 検索用、シグナリング転送に使用)

### 4.2 S3 バケット構造

```
receipt-purikura-{stage}/
├── originals/{sessionId}/     # 元画像 (4枚) → 7日 TTL
│   ├── 1.jpg
│   ├── 2.jpg
│   ├── 3.jpg
│   └── 4.jpg
├── filtered/{sessionId}/      # フィルター済み → 7日 TTL
│   ├── 1.png
│   ├── 2.png
│   ├── 3.png
│   └── 4.png
├── collages/{sessionId}.png   # カラーコラージュ → 30日 TTL
├── print-ready/{sessionId}.png # 印刷用白黒コラージュ → 7日 TTL
└── downloads/{sessionId}.png  # DL用カラー版 → 30日 TTL
```

---

## 5. API エンドポイント

### 5.1 REST API

| メソッド | パス | 説明 | Lambda |
|---------|------|------|--------|
| `GET` | `/health` | ヘルスチェック | Mock Integration |
| `POST` | `/api/session` | セッション作成 | `session-create` |
| `GET` | `/api/session/{sessionId}` | セッション取得 | `session-get` |
| `POST` | `/api/session/{sessionId}/process` | パイプライン開始 | `process-start` |

### 5.2 WebSocket API

| ルートキー | 方向 | 説明 | Lambda |
|-----------|------|------|--------|
| `$connect` | → | 接続確立 | `ws-connect` |
| `$disconnect` | → | 切断 | `ws-disconnect` |
| `subscribe` | → | セッション購読 | `ws-subscribe` |
| `join_room` | → | ルーム参加 | `ws-join-room` |
| `webrtc_offer` | → | SDP Offer 送信 | `ws-webrtc-offer` |
| `webrtc_answer` | → | SDP Answer 送信 | `ws-webrtc-answer` |
| `webrtc_ice` | → | ICE Candidate 送信 | `ws-webrtc-ice` |
| `shooting_sync` | → | 撮影同期イベント | `ws-shooting-sync` |
| `statusUpdate` | ← | 処理進捗通知 | (Step Functions から送信) |
| `completed` | ← | 処理完了通知 | (Step Functions から送信) |
| `error` | ← | エラー通知 | (Step Functions から送信) |
| `yajiComment` | ← | やじコメント配信 | (Step Functions から送信) |

---

## 6. プロジェクト構成

> **担当分担**: `cdk/` はフロント担当（インフラ担当兼任）、`src/` はバックエンド担当が管理。
> 全 AWS リソースとアプリコードを本リポジトリで一元管理する。

```
back/
├── src/                       # Lambda コード (バックエンド担当)
│   ├── functions/             # Lambda ハンドラ
│   │   ├── session-create/
│   │   ├── session-get/
│   │   ├── process-start/
│   │   ├── ws-connect/
│   │   ├── ws-disconnect/
│   │   ├── ws-subscribe/
│   │   ├── ws-join-room/
│   │   ├── ws-webrtc-offer/
│   │   ├── ws-webrtc-answer/
│   │   ├── ws-webrtc-ice/
│   │   ├── ws-shooting-sync/
│   │   ├── face-detection/
│   │   ├── filter-apply/
│   │   ├── collage-generate/
│   │   ├── caption-generate/
│   │   ├── print-prepare/
│   │   ├── yaji-comment-fast/
│   │   ├── yaji-comment-deep/
│   │   └── stats-update/
│   ├── lib/                   # 共通ライブラリ
│   │   ├── dynamodb.ts        # DynamoDB ヘルパー
│   │   ├── s3.ts              # S3 ヘルパー
│   │   ├── websocket.ts       # WebSocket 送信ヘルパー
│   │   └── types.ts           # 共通型定義
│   └── utils/                 # ユーティリティ
│       ├── response.ts        # API レスポンスビルダー
│       └── validation.ts      # Zod スキーマ
├── cdk/                       # CDK IaC (フロント/インフラ担当)
│   ├── bin/app.ts
│   └── lib/
│       ├── github-oidc-stack.ts  # OIDC + IAM Role
│       └── app-stack.ts          # 全 AWS リソース
├── docs/                      # ドキュメント
├── tests/                     # テスト
└── package.json
```

---

## 7. 環境変数

| 変数名 | 説明 |
|--------|------|
| `STAGE` | `dev` / `prod` |
| `S3_BUCKET` | 画像バケット名 (`receipt-purikura-{stage}`) |
| `DYNAMODB_TABLE` | sessions テーブル名 |
| `CONNECTIONS_TABLE` | connections テーブル名 |
| `WEBSOCKET_URL` | WebSocket API エンドポイント |
| `IOT_ENDPOINT` | IoT Core エンドポイント |
| `BEDROCK_REGION` | Bedrock リージョン (ap-northeast-1) |
| `STATE_MACHINE_ARN` | Step Functions ステートマシン ARN |
| `PROVISIONED_CONCURRENCY` | `0` (dev) / `1` (prod) |
