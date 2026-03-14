# Step Functions ワークフロー設計

> **最終更新日**: 2026-03-06
> **ステータス**: Draft v3
> **元定義**: [元要件定義書 セクション9](/docs/requirements.md#9-画像処理パイプライン詳細step-functions)

---

## 1. 概要

Step Functions Express Workflow で画像処理パイプラインを制御する。
`POST /api/session/:sessionId/process` 呼び出しで起動し、完了まで非同期で処理する。

**ワークフロータイプ**: Express (同期不要、コスト最適化)
**最大実行時間**: 5 分
**リトライ**: 各ステップで最大 2 回リトライ (exponential backoff)

---

## 2. ワークフロー定義（4フェーズ超並列化）

元要件定義書 セクション 9.1 に準拠。

```
        [POST /api/session/:sessionId/process → Step Functions Express 起動]
                           │
                    ┌──────▼──────┐
                    │   Input      │
                    │ sessionId    │
                    │ filterType   │
                    │ filter       │
                    │ images (4枚) │
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
                    │ Update       │  status → "processing"
                    │ Session      │  WebSocket statusUpdate 送信
                    └──────┬──────┘
                           │
╔══════════════════════════╪══════════════════════════╗
║  Phase 1: 並列処理（顔検出 + フィルター同時開始）    ║
║                          │                          ║
║  ┌──────────────────┐  ┌─▼────────────────────┐    ║
║  │ face-detection    │  │ filter-apply          │    ║
║  │ Rekognition ×4   │  │ [簡易] sharp ~1秒    │    ║
║  │ ~1-2秒           │  │ [AI] Stability ~15秒  │    ║
║  └────────┬─────────┘  └──────────┬───────────┘    ║
║           └──→ クロップ調整 ──────┘                  ║
╚══════════════════════════╪══════════════════════════╝
                           │
╔══════════════════════════╪══════════════════════════╗
║  Phase 2: 並列処理（コラージュ + キャプション）      ║
║                          │                          ║
║  ┌──────────────────┐  ┌─▼────────────────────┐    ║
║  │ collage-generate  │  │ caption-generate      │    ║
║  │ sharp 2x2グリッド│  │ Bedrock Claude        │    ║
║  │ ~1-2秒            │  │ + Comprehend 感情分析  │    ║
║  └────────┬──────────┘  └──────────┬───────────┘    ║
╚═══════════╪════════════════════════╪════════════════╝
            │                        │
╔═══════════╪════════════════════════╪════════════════╗
║  Phase 3: 並列処理（ディザリング + 感情分析）        ║
║           │                        │                ║
║  ┌────────▼──────────┐  ┌─────────▼───────────┐    ║
║  │ print-prepare      │  │ 感情連動フレーム選択  │    ║
║  │ ディザリング        │  │ sentimentScore →     │    ║
║  │ + QRコード埋め込み  │  │ フレームデザイン決定  │    ║
║  │ + レシートレイアウト │  │ ~0.5秒              │    ║
║  │ ~1-2秒             │  │                      │    ║
║  └────────┬───────────┘  └──────────┬───────────┘   ║
║           └──→ 感情連動フレーム最終合成 ←┘            ║
╚══════════════════════════╪══════════════════════════╝
                           │
╔══════════════════════════╪══════════════════════════╗
║  Phase 4: 並列出力（全て同時実行）                   ║
║                          │                          ║
║  ├──→ S3 保存（カラー版 + 印刷用）                  ║
║  ├──→ DynamoDB 書き込み（→ Streams → AppSync）      ║
║  ├──→ WebSocket で completed 通知                   ║
║  ├──→ EventBridge → SNS（ファンアウト）             ║
║  └──→ IoT Core MQTT で印刷ジョブ即時送信            ║
╚═════════════════════════════════════════════════════╝

─── 所要時間（撮影時間除く）───
簡易フィルター: アップ(1-2秒) + Phase1(2秒) + Phase2(2秒) + Phase3(2秒) + 印刷(5秒) = ~12秒
AIスタイル:     アップ(1-2秒) + Phase1(15秒) + Phase2(3秒) + Phase3(2秒) + 印刷(5秒) = ~27秒
```

> **やじコメント** (`yaji-comment-fast`, `yaji-comment-deep`) は撮影中にリアルタイム配信するため、
> Step Functions パイプライン **外** で実行する。WebSocket 経由で撮影画像を受け取り次第、
> 独立した Lambda として即時実行される。

---

## 3. フェーズ詳細

### 3.1 Phase 1: 顔検出 + フィルター（Parallel）

以下の 2 グループを **同時並列** 実行:

| グループ | Lambda | 入力 | 出力 |
|---------|--------|------|------|
| A: 顔検出 | `face-detection` | 4枚の S3 キー | 顔位置座標 + 感情ラベル (配列) |
| B: フィルター | `filter-apply` | 4枚の S3 キー + filterType + filter | フィルター済み 4枚の S3 キー |

両方の結果を結合し、Phase 2 に渡す。

### 3.2 Phase 2: コラージュ + キャプション（Parallel）

| グループ | Lambda | 依存 | 入力 | 出力 |
|---------|--------|------|------|------|
| A: コラージュ | `collage-generate` | Phase 1 完了 | 顔位置 + フィルター済み画像 | コラージュ S3 キー |
| B: キャプション | `caption-generate` | Phase 1 完了 | フィルター済み画像 (4枚) | キャプション + 感情スコア |

### 3.3 Phase 3: ディザリング + 感情連動フレーム（Parallel → 合成）

| グループ | Lambda | 依存 | 入力 | 出力 |
|---------|--------|------|------|------|
| A: 印刷準備 | `print-prepare` | Phase 2 コラージュ完了 | コラージュ + キャプション | 印刷用 PNG + QR |
| B: 感情フレーム | (inline) | Phase 2 キャプション完了 | 感情スコア | フレームデザイン ID |

A + B の結果を合成して最終印刷画像を生成。

### 3.4 Phase 4: 並列出力

Phase 3 完了後、以下を **全て同時** 実行:

| 出力先 | 内容 | 実装 |
|--------|------|------|
| S3 | カラー版 (`collages/`) + 印刷用 (`print-ready/`) + DL 用 (`downloads/`) | S3 PutObject |
| DynamoDB | セッション更新 (status → `completed`, 画像 URL 等) | DynamoDB UpdateItem |
| WebSocket | `completed` イベント送信 | API Gateway Management API |
| EventBridge | 完了イベント → SNS ファンアウト | EventBridge PutEvents |
| IoT Core | MQTT 印刷ジョブ送信 (`receipt-purikura/print/{sessionId}`) | IoT Data Plane Publish |

---

## 4. 各ステップの入出力

### 4.1 ワークフロー入力

```json
{
  "sessionId": "uuid-xxxx",
  "filterType": "simple",
  "filter": "mono",
  "images": [
    "originals/uuid-xxxx/1.jpg",
    "originals/uuid-xxxx/2.jpg",
    "originals/uuid-xxxx/3.jpg",
    "originals/uuid-xxxx/4.jpg"
  ],
  "bucket": "receipt-purikura-dev"
}
```

### 4.2 face-detection

```json
// 入力: ワークフロー入力をそのまま渡す
// 出力:
{
  "faces": [
    {
      "photoIndex": 1,
      "boundingBox": { "left": 0.2, "top": 0.1, "width": 0.3, "height": 0.4 },
      "emotions": [{ "type": "HAPPY", "confidence": 95.2 }]
    }
  ]
}
```

### 4.3 filter-apply

```json
// 入力: ワークフロー入力 + filterType + filter
// 出力:
{
  "filteredImages": [
    "filtered/uuid-xxxx/1.png",
    "filtered/uuid-xxxx/2.png",
    "filtered/uuid-xxxx/3.png",
    "filtered/uuid-xxxx/4.png"
  ]
}
```

> 4枚を Lambda 内で並列処理 (Promise.all)。

### 4.4 collage-generate

```json
// 入力: faces + filteredImages
// 出力:
{
  "collageKey": "collages/uuid-xxxx.png"
}
```

> 顔位置を使って最適なクロップ → 2x2 グリッド (576x576px, padding: 10px, gap: 6px) 配置。

### 4.5 caption-generate

```json
// 入力: filteredImages (4枚)
// 出力:
{
  "caption": "楽しい思い出の一枚！",
  "sentiment": "POSITIVE",
  "sentimentScore": 0.95
}
```

> Bedrock Claude でキャプション生成 + Comprehend で感情分析。

### 4.6 print-prepare

```json
// 入力: collageKey + caption + sentimentScore
// 出力:
{
  "printReadyKey": "print-ready/uuid-xxxx.png",
  "downloadKey": "downloads/uuid-xxxx.png"
}
```

> 処理内容:
> 1. コラージュにキャプションテキストを合成
> 2. 感情スコアに連動したフレームをオーバーレイ
> 3. カラー版 DL 用画像を `downloads/` に保存
> 4. Floyd-Steinberg ディザリングで白黒2値変換
> 5. QR コード (DL URL) を埋め込み
> 6. 印刷用 PNG を `print-ready/` に保存
>
> **注意**: ESC/POS 変換は PC ブラウザ側 (WebUSB) で行う。Lambda はディザリング済み PNG の生成まで。

---

## 5. やじコメント（パイプライン外）

やじコメントは撮影フェーズ中にリアルタイム配信するため、Step Functions パイプラインとは **独立** して動作する。

### 5.1 yaji-comment-fast (Rekognition)

```json
// 入力: S3 画像キー + connectionId
// 出力: WebSocket で即時配信
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

> 2秒間隔で Rekognition 感情検出 → テンプレートマッチング → WebSocket 配信。

### 5.2 yaji-comment-deep (Bedrock Haiku)

```json
// 入力: S3 画像キー + connectionId
// 出力: WebSocket で即時配信
{
  "type": "yajiComment",
  "data": {
    "text": "左の人の表情が語りかけてくる...",
    "emotion": "happy",
    "lane": "deep",
    "timestamp": 1741262405
  }
}
```

> 5秒間隔で Bedrock Haiku マルチモーダル分析 → 高品質コメント → WebSocket 配信。

---

## 6. WebSocket 進捗通知

各ステップの **開始時** に WebSocket で `statusUpdate` イベントを送信する。

| step | タイミング | progress | message |
|------|-----------|----------|---------|
| `upload` | アップロード完了 | 10 | アップロード完了 |
| `face-detection` | Phase 1 開始 | 20 | 顔を検出中... |
| `filter` | Phase 1 開始 | 30 | フィルター適用中... |
| `collage` | Phase 2 開始 | 50 | コラージュ生成中... |
| `caption` | Phase 2 開始 | 55 | キャプション生成中... |
| `dither` | Phase 3 開始 | 70 | ディザリング・印刷準備中... |
| `print` | Phase 4 開始 | 90 | 印刷中... |

完了時は `completed` イベント:

```json
{
  "type": "completed",
  "data": {
    "sessionId": "uuid-xxxx",
    "collageImageUrl": "https://cdn.example.com/..."
  }
}
```

> 進捗通知は Lambda 内から `@aws-sdk/client-apigatewaymanagementapi` で WebSocket に送信。
> `connectionId` は DynamoDB connections テーブルから `sessionId-index` GSI で検索。

---

## 7. エラーハンドリング

### 7.1 リトライポリシー

```json
{
  "Retry": [
    {
      "ErrorEquals": ["States.TaskFailed", "States.Timeout"],
      "IntervalSeconds": 2,
      "MaxAttempts": 2,
      "BackoffRate": 2.0
    }
  ]
}
```

### 7.2 Catch (フォールバック)

- 必須ステップ (`filter-apply`, `collage-generate`, `print-prepare`): 失敗時はワークフロー全体を失敗にする
- オプショナルステップ (`face-detection`, `caption-generate`): 失敗時はスキップして続行

```
face-detection 失敗 → 顔位置なしでコラージュ生成（中央クロップ）
caption-generate 失敗 → キャプションなしで印刷
```

### 7.3 失敗時の DynamoDB 更新

ワークフロー全体が失敗した場合:
1. `status` を `"failed"` に更新
2. WebSocket で `error` イベントを送信

```json
{
  "type": "error",
  "data": {
    "sessionId": "uuid-xxxx",
    "message": "処理中にエラーが発生しました"
  }
}
```

---

## 8. CDK 実装方針

CDK の `Chain`, `Parallel`, `LambdaInvoke` で ASL を定義する。

```typescript
// Phase 1: Parallel
const phase1 = new sfn.Parallel(this, 'Phase1-FaceAndFilter')
  .branch(faceDetectionStep)
  .branch(filterApplyStep)

// Phase 2: Parallel
const phase2 = new sfn.Parallel(this, 'Phase2-CollageAndCaption')
  .branch(collageGenerateStep)
  .branch(captionGenerateStep)

// Phase 3: print-prepare (感情フレーム選択を内部で実行)
const phase3 = printPrepareStep

// Phase 4: Parallel outputs
const phase4 = new sfn.Parallel(this, 'Phase4-Outputs')
  .branch(s3SaveStep)
  .branch(dynamoUpdateStep)
  .branch(websocketNotifyStep)
  .branch(iotPrintStep)

// Chain all phases
const workflow = updateSessionStep
  .next(phase1)
  .next(phase2)
  .next(phase3)
  .next(phase4)
```
