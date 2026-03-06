# API 仕様書

> **最終更新日**: 2026-03-06
> **ステータス**: Draft v1
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
    "createdAt": 1741262400
  }
}
```

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
      "originals": ["originals/01JX.../photo-1.jpg", "..."],
      "filtered": ["filtered/01JX.../photo-1.jpg", "..."],
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

**エラーレスポンス** `404`

```json
{
  "success": false,
  "error": "Session not found"
}
```

---

### 1.4 アップロード URL 発行

```
POST /sessions/{sessionId}/upload-url
```

**リクエストボディ**

```json
{
  "fileName": "photo-1.jpg",
  "contentType": "image/jpeg"
}
```

**レスポンス** `200`

```json
{
  "success": true,
  "data": {
    "uploadUrl": "https://receipt-purikura-dev.s3-accelerate.amazonaws.com/...",
    "key": "originals/01JX.../photo-1.jpg",
    "expiresIn": 300
  }
}
```

> S3 Transfer Acceleration 対応の Presigned URL を返す。有効期限 5 分。

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

---

## 2. WebSocket API

**接続先**: `wss://{ws-api-id}.execute-api.ap-northeast-1.amazonaws.com/{stage}`

### 2.1 接続

```
# クエリパラメータでセッション指定
wss://...?sessionId=01JXXXXXXXXXXXXXXXXXXXX
```

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

`step`: `"face-detection"` → `"filter-apply"` → `"collage-generate"` → `"caption-generate"` → `"print-prepare"` → `"done"`

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
