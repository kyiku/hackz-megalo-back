# API 仕様書

> **最終更新日**: 2026-03-06
> **ステータス**: Draft v3
> **Base URL**: `https://{api-id}.execute-api.ap-northeast-1.amazonaws.com/{stage}`
> **元定義**: [元要件定義書 セクション8](/docs/requirements.md#8-api仕様)

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
POST /api/session
```

**リクエストボディ**

```json
{
  "filterType": "simple",
  "filter": "beauty",
  "photoCount": 4
}
```

> `filterType`: `"simple"` (簡易フィルター) / `"ai"` (AI スタイル変換)
> `filter`: 簡易 = `"natural"` / `"beauty"` / `"bright"` / `"mono"` / `"sepia"` 、AI = `"anime"` / `"popart"` / `"watercolor"`

**レスポンス** `201`

```json
{
  "sessionId": "uuid-xxxx",
  "uploadUrls": [
    { "index": 1, "url": "https://receipt-purikura-dev.s3-accelerate.amazonaws.com/..." },
    { "index": 2, "url": "https://receipt-purikura-dev.s3-accelerate.amazonaws.com/..." },
    { "index": 3, "url": "https://receipt-purikura-dev.s3-accelerate.amazonaws.com/..." },
    { "index": 4, "url": "https://receipt-purikura-dev.s3-accelerate.amazonaws.com/..." }
  ],
  "websocketUrl": "wss://xxx.execute-api.ap-northeast-1.amazonaws.com/dev"
}
```

> S3 Transfer Acceleration 対応の Presigned URL を返す。有効期限 5 分。
> `websocketUrl` はフロントが WebSocket 接続に使う。

---

### 1.3 パイプライン開始

```
POST /api/session/:sessionId/process
```

> 4枚の S3 アップロード完了後にフロントから呼び出す。
> Step Functions Express ワークフローを起動し、非同期で処理を開始する。

**レスポンス** `202`

```json
{
  "sessionId": "uuid-xxxx",
  "status": "processing"
}
```

---

### 1.4 セッション取得

```
GET /api/session/:sessionId
```

**レスポンス** `200`

```json
{
  "sessionId": "uuid-xxxx",
  "status": "completed",
  "filterType": "simple",
  "filter": "beauty",
  "caption": "AIが生成したキャプション",
  "collageImageUrl": "https://cdn.example.com/...",
  "createdAt": "2026-03-16T14:30:00Z"
}
```

> `status` の遷移: `uploading` → `processing` → `completed` → `printed` → `failed`

**エラーレスポンス** `404`

```json
{
  "error": "Session not found"
}
```

---

## 2. WebSocket API

**接続先**: `wss://{ws-api-id}.execute-api.ap-northeast-1.amazonaws.com/{stage}`

### 2.1 接続

```
wss://...
```

### 2.2 クライアント → サーバー

#### subscribe (セッション購読)

```json
{
  "action": "subscribe",
  "data": {
    "sessionId": "uuid-xxxx"
  }
}
```

#### join_room (ルーム参加)

```json
{
  "action": "join_room",
  "data": {
    "roomId": "session-xxx",
    "role": "phone"
  }
}
```

> `role`: `"phone"` (スマホ) / `"pc"` (PC)

#### webrtc_offer (SDP Offer)

```json
{
  "action": "webrtc_offer",
  "data": {
    "roomId": "session-xxx",
    "sdp": "v=0\r\n..."
  }
}
```

#### webrtc_answer (SDP Answer)

```json
{
  "action": "webrtc_answer",
  "data": {
    "roomId": "session-xxx",
    "sdp": "v=0\r\n..."
  }
}
```

#### webrtc_ice (ICE Candidate)

```json
{
  "action": "webrtc_ice",
  "data": {
    "roomId": "session-xxx",
    "candidate": "candidate:..."
  }
}
```

#### shooting_start (撮影開始)

```json
{
  "action": "shooting_sync",
  "data": {
    "roomId": "session-xxx",
    "event": "shooting_start",
    "sessionId": "uuid-xxxx",
    "totalPhotos": 4
  }
}
```

#### countdown (カウントダウン)

```json
{
  "action": "shooting_sync",
  "data": {
    "roomId": "session-xxx",
    "event": "countdown",
    "photoIndex": 1,
    "count": 3
  }
}
```

#### shutter (シャッター)

```json
{
  "action": "shooting_sync",
  "data": {
    "roomId": "session-xxx",
    "event": "shutter",
    "photoIndex": 1
  }
}
```

#### shooting_complete (撮影完了)

```json
{
  "action": "shooting_sync",
  "data": {
    "roomId": "session-xxx",
    "event": "shooting_complete",
    "sessionId": "uuid-xxxx"
  }
}
```

### 2.3 サーバー → クライアント

#### statusUpdate (処理進捗)

```json
{
  "type": "statusUpdate",
  "data": {
    "sessionId": "uuid-xxxx",
    "status": "processing",
    "step": "filter",
    "progress": 50,
    "message": "フィルター適用中..."
  }
}
```

`step` の遷移順序:
1. `"upload"` — アップロード完了
2. `"face-detection"` — 顔検出中
3. `"filter"` — フィルター適用中
4. `"collage"` — コラージュ生成中
5. `"caption"` — キャプション生成中
6. `"dither"` — ディザリング・印刷準備中
7. `"print"` — 印刷中

#### completed (処理完了)

```json
{
  "type": "completed",
  "data": {
    "sessionId": "uuid-xxxx",
    "collageImageUrl": "https://cdn.example.com/..."
  }
}
```

#### error (エラー)

```json
{
  "type": "error",
  "data": {
    "sessionId": "uuid-xxxx",
    "message": "処理中にエラーが発生しました"
  }
}
```

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

> `lane`: `"fast"` (Rekognition テンプレート、2秒間隔) / `"deep"` (Bedrock Haiku、5秒間隔)

#### webrtc_offer / webrtc_answer / webrtc_ice (シグナリング転送)

```json
{
  "type": "webrtc_answer",
  "data": {
    "sdp": "v=0\r\n..."
  }
}
```

#### shooting_sync (撮影同期イベント転送)

```json
{
  "type": "shooting_sync",
  "data": {
    "event": "countdown",
    "photoIndex": 1,
    "count": 3
  }
}
```

> スマホから送信された撮影同期イベントを、同じ roomId の PC 側に転送する。

---

## 3. MQTT (IoT Core)

### 3.1 印刷ジョブ通知

**トピック**: `receipt-purikura/print/{sessionId}`

```json
{
  "sessionId": "uuid-xxxx",
  "imageKey": "print-ready/uuid-xxxx.png",
  "format": "png",
  "width": 576,
  "timestamp": 1741262400
}
```

> QoS: 1 (少なくとも1回配信)
> プロトコル: MQTT over WSS (ブラウザ対応)
> PC ブラウザが MQTT で通知を受信 → `imageKey` の PNG を S3 から取得 → WebUSB API で ESC/POS 変換・USB 印刷

### 3.2 印刷完了通知

**トピック**: `receipt-purikura/print/{sessionId}/status`

```json
{
  "sessionId": "uuid-xxxx",
  "status": "printed",
  "timestamp": 1741262410
}
```

---

## 4. 共通エラーフォーマット

```json
{
  "error": "Error message here"
}
```

| HTTP Status | 説明 |
|-------------|------|
| `400` | バリデーションエラー |
| `404` | リソースが見つからない |
| `429` | レート制限超過 |
| `500` | サーバーエラー |
