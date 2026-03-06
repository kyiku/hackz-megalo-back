# API 仕様書

> **最終更新日**: 2026-03-06
> **ステータス**: Draft v2
> **Base URL**: `https://{api-id}.execute-api.ap-northeast-1.amazonaws.com/{stage}`

---

## 1. REST API

### 1.1 ヘルスチェック

```
GET /health
```

**レスポンス** `200`

```json
{
  "status": "ok",
  "timestamp": "2026-03-06T12:00:00Z"
}
```

---

### 1.2 セッション作成

```
POST /sessions
```

**リクエストボディ**

```json
{
  "photoCount": 4
}
```

**レスポンス** `201`

```json
{
  "success": true,
  "data": {
    "sessionId": "01JXXXXXXXXXXXXXXXXXXXX",
    "roomId": "room-abc123",
    "status": "waiting",
    "uploadUrls": [
      {
        "photoIndex": 1,
        "uploadUrl": "https://receipt-purikura-dev.s3-accelerate.amazonaws.com/...",
        "key": "originals/01JX.../photo-1.jpg"
      },
      {
        "photoIndex": 2,
        "uploadUrl": "https://receipt-purikura-dev.s3-accelerate.amazonaws.com/...",
        "key": "originals/01JX.../photo-2.jpg"
      },
      {
        "photoIndex": 3,
        "uploadUrl": "https://receipt-purikura-dev.s3-accelerate.amazonaws.com/...",
        "key": "originals/01JX.../photo-3.jpg"
      },
      {
        "photoIndex": 4,
        "uploadUrl": "https://receipt-purikura-dev.s3-accelerate.amazonaws.com/...",
        "key": "originals/01JX.../photo-4.jpg"
      }
    ],
    "createdAt": 1741262400
  }
}
```

> セッション作成時に Presigned URL を同時に発行して返す（B-01 + B-02）。
> S3 Transfer Acceleration 対応。有効期限 5 分。

---

### 1.3 セッション取得

```
GET /sessions/{sessionId}
```

**レスポンス** `200`

```json
{
  "success": true,
  "data": {
    "sessionId": "01JXXXXXXXXXXXXXXXXXXXX",
    "roomId": "room-abc123",
    "status": "processing",
    "images": {
      "originals": [
        "originals/01JX.../photo-1.jpg",
        "originals/01JX.../photo-2.jpg",
        "originals/01JX.../photo-3.jpg",
        "originals/01JX.../photo-4.jpg"
      ],
      "filtered": [
        "filtered/01JX.../photo-1.jpg",
        "filtered/01JX.../photo-2.jpg",
        "filtered/01JX.../photo-3.jpg",
        "filtered/01JX.../photo-4.jpg"
      ],
      "collage": "collages/01JX.../collage.jpg"
    },
    "captions": {
      "text": "楽しい思い出の一枚！",
      "sentiment": "POSITIVE",
      "sentimentScore": 0.95
    },
    "yajiComments": [
      { "text": "いい笑顔ｗｗｗ", "emotion": "happy", "lane": "fast" },
      { "text": "最高の瞬間を捉えた一枚", "emotion": "happy", "lane": "deep" }
    ],
    "createdAt": 1741262400
  }
}
```

> `status` の遷移: `waiting` → `capturing` → `processing` → `printing` → `done`
> `images`, `captions`, `yajiComments` は処理完了後に値が入る。

**エラーレスポンス** `404`

```json
{
  "success": false,
  "error": "Session not found"
}
```

---

### 1.4 パイプライン開始

```
POST /sessions/{sessionId}/process
```

**リクエストボディ**

```json
{
  "filter": "mono"
}
```

> `filter`: `"mono"` (モノクロ) / `"sepia"` (セピア) / `"beauty"` (美肌) / `"pop-art"` (ポップアート) / `"anime"` (アニメ風)
> `"pop-art"`, `"anime"` は AI スタイル変換 (Stability AI) を使用。

**レスポンス** `202`

```json
{
  "success": true,
  "data": {
    "executionArn": "arn:aws:states:ap-northeast-1:...:execution:...",
    "status": "processing"
  }
}
```

> 4枚アップロード完了後にフロントから呼び出す。
> Step Functions Express ワークフローを起動し、非同期で処理を開始する。
> 進捗は WebSocket の `progress` イベントで通知。

---

### 1.5 ダウンロード URL 発行

```
GET /sessions/{sessionId}/download-url
```

**レスポンス** `200`

```json
{
  "success": true,
  "data": {
    "downloadUrl": "https://dxxxxxxxxx.cloudfront.net/downloads/01JX.../collage.jpg?...",
    "expiresIn": 3600
  }
}
```

> CloudFront 経由の署名付き URL。有効期限 1 時間。
> `status` が `done` でない場合は `400` エラー。

---

## 2. WebSocket API

**接続先**: `wss://{ws-api-id}.execute-api.ap-northeast-1.amazonaws.com/{stage}`

### 2.1 接続

```
wss://...?sessionId=01JXXXXXXXXXXXXXXXXXXXX
```

> クエリパラメータで `sessionId` を指定して接続。

### 2.2 クライアント → サーバー

#### joinRoom

```json
{
  "action": "joinRoom",
  "data": {
    "roomId": "room-abc123",
    "role": "phone"
  }
}
```

`role`: `"phone"` (スマホ) または `"pc"` (PC)

#### signal (WebRTC シグナリング)

```json
{
  "action": "signal",
  "data": {
    "roomId": "room-abc123",
    "type": "offer",
    "sdp": "v=0\r\n..."
  }
}
```

`type`: `"offer"` / `"answer"` / `"ice-candidate"`

### 2.3 サーバー → クライアント

#### progress (処理進捗)

```json
{
  "type": "progress",
  "data": {
    "sessionId": "01JXXXXXXXXXXXXXXXXXXXX",
    "step": "filter-apply",
    "progress": 50,
    "message": "フィルター適用中..."
  }
}
```

`step` の遷移順序:
1. `"upload-complete"` — アップロード完了
2. `"face-detection"` — 顔検出中
3. `"filter-apply"` — フィルター適用中
4. `"collage-generate"` — コラージュ生成中
5. `"caption-generate"` — キャプション生成中
6. `"print-prepare"` — 印刷準備中
7. `"printing"` — 印刷中
8. `"done"` — 完了

#### yajiComment (やじコメント配信)

```json
{
  "type": "yajiComment",
  "data": {
    "text": "いい笑顔ｗｗｗ",
    "emotion": "happy",
    "lane": "fast",
    "timestamp": 1741262400
  }
}
```

> `lane`: `"fast"` (Rekognition テンプレート、即座) / `"deep"` (Bedrock Haiku、数秒後)
> `emotion`: `"happy"` / `"surprised"` / `"calm"` / `"sad"` / `"angry"` / `"confused"`

#### signal (WebRTC シグナリング転送)

```json
{
  "type": "signal",
  "data": {
    "type": "answer",
    "sdp": "v=0\r\n..."
  }
}
```

---

## 3. MQTT (IoT Core)

### 3.1 印刷ジョブ送信

**トピック**: `print/{deviceId}/job`

```json
{
  "sessionId": "01JXXXXXXXXXXXXXXXXXXXX",
  "imageKey": "print-ready/01JX.../receipt.bin",
  "format": "escpos-raster",
  "width": 576,
  "timestamp": 1741262400
}
```

### 3.2 印刷完了通知

**トピック**: `print/{deviceId}/status`

```json
{
  "sessionId": "01JXXXXXXXXXXXXXXXXXXXX",
  "status": "completed",
  "timestamp": 1741262410
}
```

---

## 4. 共通エラーフォーマット

```json
{
  "success": false,
  "error": "Error message here"
}
```

| HTTP Status | 説明 |
|-------------|------|
| `400` | バリデーションエラー |
| `404` | リソースが見つからない |
| `429` | レート制限超過 |
| `500` | サーバーエラー |
