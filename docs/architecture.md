# バックエンド アーキテクチャ概要

> **最終更新日**: 2026-03-06
> **ステータス**: Draft v2
> **ランタイム**: Node.js 20 (TypeScript) / ARM64 (Graviton2)

---

## 1. 概要

フルサーバーレス構成。Lambda (Node.js 20, ARM64) + Step Functions Express で画像処理パイプラインを構築する。

```
スマホ → S3 Upload → EventBridge → Step Functions Express → 各 Lambda → 出力
```

### 技術スタック

| カテゴリ | 技術 |
|---------|------|
| ランタイム | Node.js 20 (TypeScript) |
| 画像処理 | sharp (フィルター, リサイズ, コラージュ) |
| QR コード | qrcode |
| ディザリング | sharp + カスタム Floyd-Steinberg 実装 |
| ID 生成 | ulid |
| バリデーション | zod |
| IaC | AWS CDK (TypeScript) |

---

## 2. 処理パイプライン

### 2.1 メインフロー（撮影〜印刷）

```
[S3 Upload (4枚)]
        │
        ▼
  EventBridge (S3 PutObject)
        │
        ▼
  Step Functions Express ─────────────────────────────────────
        │                                                     │
        ├─→ face-detection (Rekognition)                     │
        │     顔検出 + 感情分析                                │
        │                                                     │
        ├─→ filter-apply (sharp / Stability AI)        [並列] │
        │     フィルター適用 or AIスタイル変換                    │
        │                                                     │
        ├─→ yaji-comment-fast (Rekognition → テンプレート)      │
        │     ニコニコ風コメント (高速レーン)                     │
        │                                                     │
        ├─→ yaji-comment-deep (Bedrock Haiku)                │
        │     ニコニコ風コメント (深いレーン)                     │
        │                                                     │
        ▼                                                     │
  collage-generate (sharp)                                    │
        コラージュ合成                                          │
        │                                                     │
        ├─→ caption-generate (Bedrock Sonnet + Comprehend)   │
        │     キャプション生成 + 感情分析                        │
        │                                                     │
        ▼                                                     │
  print-prepare                                               │
        ディザリング + QR + ESC/POS ラスター変換                 │
        │                                                     │
        ▼                                                     │
  IoT Core (MQTT) → MacBook → プリンター                       │
  ──────────────────────────────────────────────────────────── │
```

### 2.2 リアルタイム通信

| プロトコル | 用途 | AWS サービス |
|-----------|------|------------|
| WebSocket | 撮影進捗通知、セッション管理 | API Gateway WebSocket |
| WebRTC | スマホ↔PC 映像ストリーミング | API Gateway (シグナリングのみ) |
| MQTT | 印刷ジョブ送信 | IoT Core |
| GraphQL Subscription | ダッシュボードリアルタイム更新 | AppSync |

---

## 3. Lambda 関数一覧

| 関数名 | メモリ | タイムアウト | 用途 |
|--------|--------|------------|------|
| `session-create` | 256MB | 10s | セッション作成 + Presigned URL 発行 |
| `session-get` | 256MB | 10s | セッション情報取得 |
| `upload-url` | 256MB | 10s | S3 Presigned URL 発行 |
| `download-url` | 256MB | 10s | CloudFront 署名付き URL 発行 |
| `ws-connect` | 256MB | 10s | WebSocket 接続ハンドラ |
| `ws-disconnect` | 256MB | 10s | WebSocket 切断ハンドラ |
| `ws-join-room` | 256MB | 10s | ルーム参加 |
| `ws-signal` | 256MB | 10s | WebRTC SDP/ICE 中継 |
| `face-detection` | 1GB | 30s | Rekognition 顔検出 + 感情分析 |
| `filter-apply` | 2GB | 60s | sharp / Stability AI フィルター |
| `collage-generate` | 2GB | 60s | コラージュ合成 (sharp) |
| `caption-generate` | 1GB | 30s | Bedrock キャプション + Comprehend |
| `print-prepare` | 2GB | 60s | ディザリング + QR + ESC/POS |
| `yaji-comment-fast` | 512MB | 10s | Rekognition → テンプレートコメント |
| `yaji-comment-deep` | 1GB | 30s | Bedrock Haiku マルチモーダル |
| `stats-update` | 256MB | 10s | DynamoDB Streams → 統計更新 |

共通設定: ARM64 (Graviton2), Node.js 20 (TypeScript)

### 依存ライブラリ

| パッケージ | 用途 |
|-----------|------|
| `sharp` | 画像処理 (フィルター, リサイズ, コラージュ, ディザリング) |
| `qrcode` | QR コード生成 |
| `@aws-sdk/client-s3` | S3 操作 |
| `@aws-sdk/client-dynamodb` | DynamoDB 操作 |
| `@aws-sdk/lib-dynamodb` | DynamoDB ドキュメントクライアント |
| `@aws-sdk/client-rekognition` | 顔検出・感情分析 |
| `@aws-sdk/client-bedrock-runtime` | Bedrock AI 推論 |
| `@aws-sdk/client-comprehend` | 感情分析 |
| `@aws-sdk/client-iot-data-plane` | IoT Core MQTT パブリッシュ |
| `@aws-sdk/client-apigatewaymanagementapi` | WebSocket メッセージ送信 |
| `ulid` | セッション ID 生成 |
| `zod` | リクエストバリデーション |

---

## 4. データモデル

### 4.1 DynamoDB テーブル

**sessions テーブル**

| 属性 | 型 | 説明 |
|------|-----|------|
| `sessionId` (PK) | String | セッション ID (ULID) |
| `roomId` (GSI-PK) | String | WebRTC ルーム ID |
| `status` | String | `waiting` / `capturing` / `processing` / `printing` / `done` |
| `images` | Map | S3 キー (`originals`, `filtered`, `collage`) |
| `captions` | Map | キャプションテキスト + 感情スコア |
| `yajiComments` | List | やじコメント配列 |
| `createdAt` | Number | 作成タイムスタンプ |
| `ttl` | Number | TTL (30日後) |

**connections テーブル**

| 属性 | 型 | 説明 |
|------|-----|------|
| `connectionId` (PK) | String | WebSocket 接続 ID |
| `sessionId` (GSI-PK) | String | セッション ID |
| `roomId` | String | WebRTC ルーム ID |
| `role` | String | `phone` / `pc` |
| `connectedAt` | Number | 接続タイムスタンプ |
| `ttl` | Number | TTL (1日後) |

### 4.2 S3 バケット構造

```
receipt-purikura-{stage}/
├── originals/{sessionId}/     # 元画像 (4枚) → 7日 TTL
├── filtered/{sessionId}/      # フィルター済み → 7日 TTL
├── collages/{sessionId}/      # コラージュ → 30日 TTL
├── print-ready/{sessionId}/   # 印刷用画像 → 7日 TTL
└── downloads/{sessionId}/     # DL用カラー版 → 30日 TTL
```

---

## 5. API エンドポイント

### 5.1 REST API

| メソッド | パス | 説明 | Lambda |
|---------|------|------|--------|
| `GET` | `/health` | ヘルスチェック | - (API Gateway mock) |
| `POST` | `/sessions` | セッション作成 | `session-create` |
| `GET` | `/sessions/{id}` | セッション取得 | `session-get` |
| `POST` | `/sessions/{id}/upload-url` | Presigned URL 発行 | `upload-url` |
| `GET` | `/sessions/{id}/download-url` | DL用 URL 発行 | `download-url` |

### 5.2 WebSocket API

| ルート | 方向 | 説明 | Lambda |
|--------|------|------|--------|
| `$connect` | → | 接続確立 | `ws-connect` |
| `$disconnect` | → | 切断 | `ws-disconnect` |
| `joinRoom` | → | ルーム参加 | `ws-join-room` |
| `signal` | ↔ | WebRTC SDP/ICE シグナリング | `ws-signal` |
| `progress` | ← | 処理進捗通知 | (Step Functions から送信) |
| `yajiComment` | ← | やじコメント配信 | (Step Functions から送信) |

---

## 6. プロジェクト構成

```
back/
├── src/
│   ├── functions/            # Lambda ハンドラ
│   │   ├── session-create/
│   │   ├── session-get/
│   │   ├── upload-url/
│   │   ├── download-url/
│   │   ├── ws-connect/
│   │   ├── ws-disconnect/
│   │   ├── ws-join-room/
│   │   ├── ws-signal/
│   │   ├── face-detection/
│   │   ├── filter-apply/
│   │   ├── collage-generate/
│   │   ├── caption-generate/
│   │   ├── print-prepare/
│   │   ├── yaji-comment-fast/
│   │   ├── yaji-comment-deep/
│   │   └── stats-update/
│   ├── lib/                  # 共通ライブラリ
│   │   ├── dynamodb.ts       # DynamoDB ヘルパー
│   │   ├── s3.ts             # S3 ヘルパー
│   │   ├── websocket.ts      # WebSocket 送信ヘルパー
│   │   └── types.ts          # 共通型定義
│   └── utils/                # ユーティリティ
│       ├── response.ts       # API レスポンスビルダー
│       └── validation.ts     # Zod スキーマ
├── cdk/                      # CDK (IaC)
│   ├── bin/app.ts
│   └── lib/
├── docs/                     # ドキュメント
├── tests/                    # テスト
└── package.json
```

---

## 7. 環境変数

| 変数名 | 説明 |
|--------|------|
| `STAGE` | `dev` / `prod` |
| `S3_BUCKET` | 画像バケット名 |
| `SESSIONS_TABLE` | sessions テーブル名 |
| `CONNECTIONS_TABLE` | connections テーブル名 |
| `WEBSOCKET_ENDPOINT` | WebSocket API エンドポイント |
| `IOT_ENDPOINT` | IoT Core エンドポイント |
| `BEDROCK_REGION` | Bedrock リージョン (ap-northeast-1) |
