# Step Functions ワークフロー設計

> **最終更新日**: 2026-03-06
> **ステータス**: Draft v1

---

## 1. 概要

Step Functions Express Workflow で画像処理パイプラインを制御する。
`POST /sessions/{id}/process` 呼び出しで起動し、完了まで非同期で処理する。

**ワークフロータイプ**: Express (同期不要、コスト最適化)
**最大実行時間**: 5 分
**リトライ**: 各ステップで最大 2 回リトライ (exponential backoff)

---

## 2. ワークフロー定義

```
                    ┌─ Input ─┐
                    │ sessionId │
                    │ filter    │
                    └────┬──────┘
                         │
                    ┌────▼────┐
                    │ Update   │  status → "processing"
                    │ Session  │  DynamoDB 更新
                    └────┬────┘
                         │
              ┌──────────┼──────────────┐
              │          │              │
        ┌─────▼────┐ ┌──▼───────┐ ┌───▼──────────┐
        │ face-    │ │ filter-  │ │ yaji-comment │
        │ detection│ │ apply    │ │ -fast        │
        │          │ │ (4枚並列) │ │              │
        └─────┬────┘ └──┬───────┘ └───┬──────────┘
              │          │              │
              │          │         ┌───▼──────────┐
              │          │         │ yaji-comment │
              │          │         │ -deep        │
              │          │         └───┬──────────┘
              │          │              │
              └──────────┼──────────────┘
                         │
                    ┌────▼──────────┐
                    │ collage-      │
                    │ generate      │  顔位置情報 + フィルター済み画像
                    └────┬──────────┘
                         │
                    ┌────▼──────────┐
                    │ caption-      │
                    │ generate      │  コラージュ → キャプション + 感情分析
                    └────┬──────────┘
                         │
                    ┌────▼──────────┐
                    │ print-        │
                    │ prepare       │  ディザリング + QR + ESC/POS
                    └────┬──────────┘
                         │
                    ┌────▼──────────┐
                    │ print-send    │  IoT Core MQTT パブリッシュ
                    │               │  status → "printing"
                    └────┬──────────┘
                         │
                    ┌────▼──────────┐
                    │ finalize      │  status → "done"
                    │               │  WebSocket 完了通知
                    └───────────────┘
```

---

## 3. 並列実行の詳細

### 3.1 第1段階（Parallel）

以下の 3 グループを **同時並列** 実行:

| グループ | Lambda | 入力 | 出力 |
|---------|--------|------|------|
| A: 顔検出 | `face-detection` | 4枚の S3 キー | 顔位置座標 + 感情ラベル (配列) |
| B: フィルター | `filter-apply` | 4枚の S3 キー + filter 種別 | フィルター済み 4枚の S3 キー |
| C: やじコメント (fast) | `yaji-comment-fast` | 4枚の S3 キー | コメント配列 (WebSocket で即時配信) |

### 3.2 第1段階完了後（Sequential）

| 順序 | Lambda | 依存 | 入力 | 出力 |
|------|--------|------|------|------|
| 1 | `yaji-comment-deep` | C 完了後 | 4枚の S3 キー | コメント配列 (WebSocket 配信) |
| 2 | `collage-generate` | A + B 完了後 | 顔位置 + フィルター済み画像 | コラージュ S3 キー |
| 3 | `caption-generate` | 2 完了後 | コラージュ S3 キー | キャプション + 感情スコア |
| 4 | `print-prepare` | 3 完了後 | コラージュ + キャプション | 印刷用バイナリ S3 キー |
| 5 | print-send (inline) | 4 完了後 | 印刷用 S3 キー | IoT Core MQTT 送信 |

> **注意**: `yaji-comment-deep` は fast と並列ではなく、fast 完了後に実行。
> fast がテンプレートベースの即座応答、deep が AI による高品質応答を担う時間差演出。

---

## 4. 各ステップの入出力

### 4.1 ワークフロー入力

```json
{
  "sessionId": "01JXXXXXXXXXXXXXXXXXXXX",
  "filter": "mono",
  "images": [
    "originals/01JX.../photo-1.jpg",
    "originals/01JX.../photo-2.jpg",
    "originals/01JX.../photo-3.jpg",
    "originals/01JX.../photo-4.jpg"
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
// 入力: ワークフロー入力 + filter 種別
// 出力:
{
  "filteredImages": [
    "filtered/01JX.../photo-1.jpg",
    "filtered/01JX.../photo-2.jpg",
    "filtered/01JX.../photo-3.jpg",
    "filtered/01JX.../photo-4.jpg"
  ]
}
```

> 4枚を Lambda 内で並列処理 (Promise.all)。

### 4.4 yaji-comment-fast

```json
// 入力: ワークフロー入力
// 出力:
{
  "comments": [
    { "text": "いい笑顔ｗｗｗ", "emotion": "happy" },
    { "text": "キメ顔すぎるｗ", "emotion": "surprised" }
  ]
}
```

> 出力と同時に WebSocket で `yajiComment` (lane: "fast") を配信。

### 4.5 yaji-comment-deep

```json
// 入力: ワークフロー入力
// 出力:
{
  "comments": [
    { "text": "左の人の表情が語りかけてくる...", "emotion": "happy" }
  ]
}
```

> 出力と同時に WebSocket で `yajiComment` (lane: "deep") を配信。

### 4.6 collage-generate

```json
// 入力: faces + filteredImages
// 出力:
{
  "collageKey": "collages/01JX.../collage.jpg"
}
```

> 顔位置を使って最適なクロップ → 2x2 グリッド (576x576px) 配置。

### 4.7 caption-generate

```json
// 入力: collageKey
// 出力:
{
  "caption": "楽しい思い出の一枚！",
  "sentiment": "POSITIVE",
  "sentimentScore": 0.95
}
```

### 4.8 print-prepare

```json
// 入力: collageKey + caption
// 出力:
{
  "printReadyKey": "print-ready/01JX.../receipt.bin",
  "downloadKey": "downloads/01JX.../collage.jpg"
}
```

> 処理内容:
> 1. コラージュにキャプションテキストを合成
> 2. カラー版 DL 用画像を downloads/ に保存
> 3. Floyd-Steinberg ディザリングで白黒2値変換
> 4. QR コード (DL URL) を埋め込み
> 5. ESC/POS ラスターコマンドに変換 → print-ready/ に保存

---

## 5. WebSocket 進捗通知

各ステップの **開始時** と **完了時** に WebSocket で `progress` イベントを送信する。

| step | タイミング | progress | message |
|------|-----------|----------|---------|
| `face-detection` | 開始 | 10 | 顔を検出中... |
| `filter-apply` | 開始 | 20 | フィルター適用中... |
| `filter-apply` | 完了 | 40 | フィルター完了 |
| `collage-generate` | 開始 | 50 | コラージュ生成中... |
| `collage-generate` | 完了 | 60 | コラージュ完了 |
| `caption-generate` | 開始 | 65 | キャプション生成中... |
| `print-prepare` | 開始 | 75 | 印刷準備中... |
| `printing` | 開始 | 90 | 印刷中... |
| `done` | 完了 | 100 | 完了！ |

> 進捗通知は Lambda 内から `@aws-sdk/client-apigatewaymanagementapi` で直接 WebSocket に送信する。
> `connectionId` は DynamoDB connections テーブルから `sessionId` で検索して取得。

---

## 6. エラーハンドリング

### 6.1 リトライポリシー

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

### 6.2 Catch (フォールバック)

- 個別ステップが失敗しても **パイプライン全体は停止しない**
- 必須ステップ (`filter-apply`, `collage-generate`, `print-prepare`): 失敗時はワークフロー全体を失敗にする
- オプショナルステップ (`face-detection`, `caption-generate`, `yaji-*`): 失敗時はスキップして続行

```
face-detection 失敗 → 顔位置なしでコラージュ生成（中央クロップ）
caption-generate 失敗 → キャプションなしで印刷
yaji-comment-* 失敗 → コメント配信なし（無視）
```

### 6.3 失敗時の DynamoDB 更新

ワークフロー全体が失敗した場合、`status` を `"error"` に更新し、エラー情報を保存する。
