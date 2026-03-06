# バックエンド アーキテクチャ概要

> **最終更新日**: 2026-03-06
> **ステータス**: Draft v1

---

## 1. 概要

フルサーバーレス構成。Lambda (Python 3.12, ARM64) + Step Functions Express で画像処理パイプラインを構築する。

```
スマホ → S3 Upload → EventBridge → Step Functions Express → 各 Lambda → 出力
```

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
        ├─→ filter-apply (Pillow / Stability AI)       [並列] │
        │     フィルター適用 or AIスタイル変換                    │
        │                                                     │
        ├─→ yaji-comment-fast (Rekognition → テンプレート)      │
        │     ニコニコ風コメント (高速レーン)                     │
        │                                                     │
        ├─→ yaji-comment-deep (Bedrock Haiku)                │
        │     ニコニコ風コメント (深いレーン)                     │
        │                                                     │
        ▼                                                     │
  collage-generate (Pillow)                                   │
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

| 関数名 | ランタイム | メモリ | タイムアウト | 用途 |
|--------|----------|--------|------------|------|
| `presigned-url` | Python 3.12 | 256MB | 10s | S3 Presigned URL 発行 |
| `webrtc-signaling` | Python 3.12 | 256MB | 10s | WebRTC SDP/ICE 中継 |
| `face-detection` | Python 3.12 | 1GB | 30s | Rekognition 顔検出 + 感情分析 |
| `filter-apply` | Python 3.12 | 10GB | 60s | Pillow / Stability AI フィルター |
| `collage-generate` | Python 3.12 | 10GB | 60s | コラージュ合成 |
| `caption-generate` | Python 3.12 | 1GB | 30s | Bedrock キャプション + Comprehend |
| `print-prepare` | Python 3.12 | 10GB | 60s | ディザリング + QR + ESC/POS |
| `yaji-comment-fast` | Python 3.12 | 512MB | 10s | Rekognition → テンプレートコメント |
| `yaji-comment-deep` | Python 3.12 | 1GB | 30s | Bedrock Haiku マルチモーダル |
| `stats-update` | Python 3.12 | 256MB | 10s | DynamoDB Streams → 統計更新 |

共通設定: ARM64 (Graviton2), Python 3.12

### Lambda Layer

| レイヤー | 内容 |
|---------|------|
| `pillow-layer` | Pillow, qrcode, 画像処理共通ライブラリ |

---

## 4. データモデル

### 4.1 DynamoDB テーブル

**sessions テーブル**

| 属性 | 型 | 説明 |
|------|-----|------|
| `sessionId` (PK) | String | セッション ID (ULID) |
| `roomId` (GSI-PK) | String | WebRTC ルーム ID |
| `status` | String | `waiting` / `capturing` / `processing` / `printing` / `done` |
| `images` | List | S3 キーの配列 (originals, filtered, collage) |
| `captions` | Map | キャプションテキスト + 感情スコア |
| `yajiComments` | List | やじコメント配列 |
| `createdAt` | Number | 作成タイムスタンプ |
| `ttl` | Number | TTL (30日後) |

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

| メソッド | パス | 説明 | レスポンス |
|---------|------|------|----------|
| `POST` | `/sessions` | セッション作成 | `{ sessionId, roomId }` |
| `GET` | `/sessions/{id}` | セッション取得 | `{ session }` |
| `POST` | `/sessions/{id}/upload-url` | Presigned URL 発行 | `{ uploadUrl, key }` |
| `GET` | `/sessions/{id}/download-url` | DL用 URL 発行 | `{ downloadUrl }` |
| `GET` | `/health` | ヘルスチェック | `{ status: "ok" }` |

### 5.2 WebSocket API

| ルート | 方向 | 説明 |
|--------|------|------|
| `$connect` | → | 接続確立、connectionId を DynamoDB に保存 |
| `$disconnect` | → | 切断、connectionId を削除 |
| `joinRoom` | → | ルーム参加 |
| `signal` | ↔ | WebRTC SDP/ICE シグナリング |
| `progress` | ← | 処理進捗通知 |
| `yajiComment` | ← | やじコメント配信 |

---

## 6. 環境変数

| 変数名 | 説明 |
|--------|------|
| `STAGE` | `dev` / `prod` |
| `S3_BUCKET` | 画像バケット名 |
| `DYNAMODB_TABLE` | sessions テーブル名 |
| `WEBSOCKET_URL` | WebSocket API エンドポイント |
| `IOT_ENDPOINT` | IoT Core エンドポイント |
| `BEDROCK_REGION` | Bedrock リージョン |
