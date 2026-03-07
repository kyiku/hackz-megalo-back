# 実装タスク分解

> **最終更新日**: 2026-03-06
> **対象**: AI エージェント / バックエンド開発者
> **前提**: CI/CD 構築済み。main push で自動デプロイ。
> **元定義**: [元要件定義書](/docs/requirements.md), [アーキテクチャ概要](/docs/architecture.md)

---

## 実装順序の方針

- Stage 1 (MVP) を最優先で完成させる
- 各タスクは **上から順に** 実装する（依存関係を考慮済み）
- 各タスクには **完了条件** を記載。テストが通ることを確認してから次へ進む
- CDK リソースと Lambda を **同時に** 実装する（CDK で定義 → Lambda ハンドラ実装 → デプロイ確認）

---

## Stage 1: MVP (B-01〜B-09)

> 目標: S3 アップロード → コラージュ → ディザリング → 印刷 の一連の流れが動く

### Task 1.1: プロジェクト構造 + 共通ライブラリ

**内容:**
- `src/` ディレクトリ構造を作成 (`functions/`, `lib/`, `utils/`)
- 共通型定義 (`src/lib/types.ts`)
  - `Session` 型 (DynamoDB のデータモデルに対応)
    - `sessionId` (UUID), `createdAt` (ISO 8601), `filterType`, `filter`
    - `status` (`uploading` / `processing` / `completed` / `printed` / `failed`)
    - `caption`, `originalImageKeys`, `collageImageKey`, `printImageKey`, `connectionId`, `ttl`
  - `ApiResponse<T>` 型
  - `ProgressEvent`, `YajiComment` 型
- DynamoDB ヘルパー (`src/lib/dynamodb.ts`)
  - `DynamoDBDocumentClient` のシングルトン
  - `getSession`, `putSession`, `updateSession` 関数
- S3 ヘルパー (`src/lib/s3.ts`)
  - `S3Client` のシングルトン
  - `generatePresignedUploadUrl` (Transfer Acceleration 対応), `generatePresignedDownloadUrl` 関数
- WebSocket 送信ヘルパー (`src/lib/websocket.ts`)
  - `sendToSession(sessionId, payload)` 関数
  - connections テーブルから `sessionId-index` GSI で connectionId を検索
  - `@aws-sdk/client-apigatewaymanagementapi` で送信
- API レスポンスビルダー (`src/utils/response.ts`)
  - `success(data, statusCode)`, `error(message, statusCode)` 関数
  - CORS ヘッダー付与
- Zod バリデーションスキーマ (`src/utils/validation.ts`)
  - `CreateSessionSchema`: `filterType` (`simple` / `ai`), `filter`, `photoCount`
  - `ProcessSchema`: `sessionId`
- `package.json` に runtime 依存を追加
  - `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`
  - `@aws-sdk/client-dynamodb`, `@aws-sdk/lib-dynamodb`
  - `zod`

**完了条件:**
- [ ] 共通ライブラリの単体テスト (mock AWS SDK)
- [ ] `npm run build` が通る
- [ ] `npm run type-check` が通る

---

### Task 1.2: CDK Storage リソース

**内容:**
- `cdk/lib/app-stack.ts` に S3 バケットを定義
  - バケット名: `receipt-purikura-${stage}`
  - Transfer Acceleration 有効化
  - CORS 設定 (`PUT`, `GET`, `*` origins)
  - ライフサイクルルール (originals: 7日, filtered: 7日, collages: 30日, print-ready: 7日, downloads: 30日)
- DynamoDB sessions テーブルを定義
  - PK: `sessionId` (String), SK: `createdAt` (String)
  - PAY_PER_REQUEST
  - TTL 属性: `ttl`
- DynamoDB connections テーブルを定義
  - PK: `connectionId` (String)
  - GSI: `sessionId-index` (sessionId → connectionId)
  - GSI: `roomId-index` (roomId → connectionId)
  - TTL 属性: `ttl`

**完了条件:**
- [ ] `cd cdk && npx cdk synth` が成功
- [ ] CloudFormation テンプレートに S3 + DynamoDB が含まれる
- [ ] `cd cdk && npx cdk diff` で差分確認

---

### Task 1.3: REST API + セッション作成 Lambda

**内容:**
- CDK: REST API Gateway を定義
  - パス: `/health` (Mock), `/api/session` (POST), `/api/session/{sessionId}` (GET), `/api/session/{sessionId}/process` (POST)
- CDK: `session-create` Lambda (NodejsFunction, 10GB, ARM64) を定義
- `src/functions/session-create/handler.ts` 実装
  - リクエストバリデーション (`filterType`, `filter`, `photoCount`)
  - `crypto.randomUUID()` でセッション ID 生成
  - DynamoDB にセッション保存 (status: `uploading`, createdAt: ISO 8601)
  - 4枚分の Presigned URL 生成 (Transfer Acceleration, `originals/{sessionId}/1.jpg` 〜 `4.jpg`)
  - レスポンス: `{ sessionId, uploadUrls: [{ index, url }], websocketUrl }`

**完了条件:**
- [ ] ハンドラの単体テスト (AWS SDK モック)
- [ ] CDK デプロイ成功
- [ ] curl で `POST /api/session` が動作する

---

### Task 1.4: セッション取得 Lambda

**内容:**
- CDK: `session-get` Lambda を定義、REST API にルート追加
- `src/functions/session-get/handler.ts` 実装
  - パスパラメータから sessionId 取得
  - DynamoDB からセッション取得
  - レスポンス: `{ sessionId, status, filterType, filter, caption, collageImageUrl, createdAt }`
  - 404 ハンドリング: `{ "error": "Session not found" }`

**完了条件:**
- [ ] ハンドラの単体テスト
- [ ] CDK デプロイ成功
- [ ] curl で `GET /api/session/{sessionId}` が動作する

---

### Task 1.5: Step Functions + パイプライン起動 Lambda

**内容:**
- CDK: Step Functions Express Workflow を定義
  - Phase 1: filter-apply (顔検出は Stage 3 で追加)
  - Phase 2: collage-generate (キャプションは Stage 3 で追加)
  - Phase 3: print-prepare
  - Phase 4: 出力 (S3 保存 + DynamoDB 更新 + IoT Core)
  - 初期段階では Phase 1→2→3→4 の直列ワークフロー、Stage 3 で並列化
- CDK: `process-start` Lambda を定義
- `src/functions/process-start/handler.ts` 実装
  - DynamoDB からセッション取得 (status が `uploading` であることを確認)
  - Step Functions `startExecution` 呼び出し
  - status を `processing` に更新
  - レスポンス: `{ sessionId, status: "processing" }` (202)

**完了条件:**
- [ ] Step Functions ワークフローが CDK で定義・デプロイ成功
- [ ] `POST /api/session/{sessionId}/process` で Step Functions が起動する
- [ ] CloudWatch Logs でワークフロー実行ログが確認できる

---

### Task 1.6: filter-apply Lambda

**内容:**
- `src/functions/filter-apply/handler.ts` 実装
  - S3 から 4枚の元画像を取得 (`originals/{sessionId}/1.jpg` 〜 `4.jpg`)
  - sharp でフィルター適用 (4枚並列: Promise.all)
    - `natural`: 処理なし（元画像のまま）
    - `beauty`: `sharp.blur(1.5).sharpen()`（ガウシアンぼかし + シャープ化）
    - `bright`: `sharp.modulate({ brightness: 1.2 }).linear(1.1, 0)`（明るさ + コントラスト）
    - `mono`: `sharp.greyscale()`
    - `sepia`: `sharp.greyscale().tint({ r: 112, g: 66, b: 20 })`
  - フィルター済み画像を S3 に保存 (`filtered/{sessionId}/1.png` 〜 `4.png`)

**完了条件:**
- [ ] ハンドラの単体テスト (sharp モック or テスト画像)
- [ ] デプロイ後、Step Functions から呼び出されてフィルター済み画像が S3 に保存される

---

### Task 1.7: collage-generate Lambda

**内容:**
- `src/functions/collage-generate/handler.ts` 実装
  - S3 からフィルター済み 4枚を取得 (`filtered/{sessionId}/1.png` 〜 `4.png`)
  - sharp で 2x2 グリッド配置 (576x576px)
    - 外側 padding: 10px, 写真間 gap: 6px
    - 各写真を正方形にクロップ → リサイズ
    - `sharp.composite()` で合成
  - コラージュ画像を S3 に保存 (`collages/{sessionId}.png`)

**完了条件:**
- [ ] 単体テスト
- [ ] 576x576px のコラージュ画像が正しいレイアウトで生成される

---

### Task 1.8: print-prepare Lambda

**内容:**
- `src/functions/print-prepare/handler.ts` 実装
  - S3 からコラージュ画像を取得 (`collages/{sessionId}.png`)
  - カラー版 DL 用画像を S3 に保存 (`downloads/{sessionId}.png`)
  - QR コード生成 (DL URL: `https://{domain}/download/{sessionId}`)
  - レシートレイアウト合成 (ヘッダー + コラージュ + キャプション + 日時 + QR コード)
  - Floyd-Steinberg ディザリングで白黒 2 値変換
    - sharp で grayscale → raw ピクセルデータ取得
    - Floyd-Steinberg アルゴリズムをカスタム実装
  - ESC/POS ラスターコマンド生成
    - GS v 0 コマンド (576px 幅)
    - `xL=72, xH=0` (576/8=72)
  - 印刷用画像を S3 に保存 (`print-ready/{sessionId}.png`)

**完了条件:**
- [ ] Floyd-Steinberg ディザリングの単体テスト
- [ ] ESC/POS バイナリ生成の単体テスト
- [ ] 印刷用画像と DL 用画像が S3 に保存される

---

### Task 1.9: IoT Core 印刷ジョブ送信

**内容:**
- CDK: IoT Policy, IoT Rule を定義
- Step Functions ワークフローの Phase 4 に印刷ジョブ送信ステップを追加
  - `@aws-sdk/client-iot-data-plane` で MQTT パブリッシュ
  - トピック: `receipt-purikura/print/{sessionId}`
  - ペイロード: `{ sessionId, imageKey, format: "escpos-raster", width: 576, timestamp }`
  - QoS: 1 (少なくとも1回配信)
- DynamoDB status を `completed` に更新
- WebSocket で `completed` イベント送信

**完了条件:**
- [ ] MQTT メッセージが IoT Core に送信される
- [ ] MacBook 側のクライアントで印刷ジョブを受信できる
- [ ] 印刷完了後に status が `printed` に更新される

---

## Stage 2: リアルタイム通信 (B-10〜B-12)

### Task 2.1: WebSocket API + 接続管理

**内容:**
- CDK: WebSocket API Gateway (V2) を定義
  - ルート: `$connect`, `$disconnect`, `subscribe`, `join_room`, `webrtc_offer`, `webrtc_answer`, `webrtc_ice`, `shooting_sync`
- `ws-connect` Lambda: connectionId を connections テーブルに保存
- `ws-disconnect` Lambda: connectionId を connections テーブルから削除

**完了条件:**
- [ ] wscat 等で WebSocket 接続・切断が動作する
- [ ] connections テーブルに正しく保存/削除される

---

### Task 2.2: WebSocket 進捗通知

**内容:**
- `ws-subscribe` Lambda 実装
  - `{ action: "subscribe", data: { sessionId } }` を受信
  - connections テーブルの sessionId を更新
- 各 Step Functions Lambda に進捗通知を埋め込む
  - `src/lib/websocket.ts` の `sendToSession()` を使用
  - `statusUpdate` イベント: `{ type: "statusUpdate", data: { sessionId, status, step, progress, message } }`

**完了条件:**
- [ ] WebSocket で `subscribe` 後、Step Functions 実行中に `statusUpdate` イベントを受信できる
- [ ] 処理完了時に `completed` イベントを受信できる

---

### Task 2.3: WebRTC シグナリング

**内容:**
- `ws-join-room` Lambda 実装
  - `{ action: "join_room", data: { roomId, role } }` を受信
  - connections テーブルに roomId + role を保存
- `ws-webrtc-offer` / `ws-webrtc-answer` / `ws-webrtc-ice` Lambda 実装
  - 同じ roomId の相手方 connectionId に SDP/ICE を転送
  - `roomId-index` GSI で検索

**完了条件:**
- [ ] 2つの WebSocket クライアント間で SDP/ICE のやり取りができる

---

### Task 2.4: 撮影同期イベント中継

**内容:**
- `ws-shooting-sync` Lambda 実装
  - `{ action: "shooting_sync", data: { roomId, event, ... } }` を受信
  - event: `shooting_start`, `countdown`, `shutter`, `shooting_complete`
  - 同じ roomId の他の接続に `{ type: "shooting_sync", data: { event, ... } }` を転送

**完了条件:**
- [ ] スマホ→PC に撮影同期イベントが正しく転送される
- [ ] countdown (photoIndex, count), shutter (photoIndex), shooting_complete (sessionId) が中継される

---

## Stage 3: AI 機能 (B-13〜B-18)

### Task 3.1: 顔検出 (Rekognition)

**内容:**
- `face-detection` Lambda 実装
  - 4枚の画像に対して Rekognition `DetectFaces` を並列呼び出し (Promise.all)
  - 顔のバウンディングボックス + 感情ラベルを返却
- Step Functions Phase 1 に並列ステップとして追加 (filter-apply と並列)
- collage-generate に顔位置情報を渡してスマートクロップ

**完了条件:**
- [ ] Rekognition DetectFaces が正しく呼び出される
- [ ] 顔位置を使ったスマートクロップでコラージュが改善される

---

### Task 3.2: やじコメント高速 (Rekognition)

**内容:**
- `yaji-comment-fast` Lambda 実装
  - Rekognition で感情検出 → テンプレートマッチング
  - WebSocket で即時配信: `{ type: "yajiComment", data: { text, emotion, lane: "fast", timestamp } }`
  - 2秒間隔で実行

**完了条件:**
- [ ] 表情に応じたテンプレートコメントが WebSocket で配信される

---

### Task 3.3: やじコメント深い (Bedrock Haiku)

**内容:**
- `yaji-comment-deep` Lambda 実装
  - Bedrock Claude Haiku でマルチモーダル分析
  - WebSocket で配信: `{ type: "yajiComment", data: { text, emotion, lane: "deep", timestamp } }`
  - 5秒間隔で実行

**完了条件:**
- [ ] Bedrock 呼び出しが成功し、高品質コメントが生成・配信される

---

### Task 3.4: キャプション生成 + 感情分析

**内容:**
- `caption-generate` Lambda 実装
  - Bedrock Claude でフィルター済み画像からキャプション生成
  - Comprehend で感情分析 (`DetectSentiment`)
  - DynamoDB にキャプション + 感情スコアを保存
- Step Functions Phase 2 に並列ステップとして追加 (collage-generate と並列)

**完了条件:**
- [ ] キャプションが自動生成されてセッションに保存される
- [ ] 感情スコアが Comprehend から取得される

---

### Task 3.5: 感情連動フレーム合成

**内容:**
- print-prepare Lambda にフレーム選択ロジックを追加
  - 感情スコア → フレームデザイン ID を決定
  - フレーム画像をコラージュにオーバーレイ
- Step Functions Phase 3 で感情分析結果を print-prepare に渡す

**完了条件:**
- [ ] 感情に応じたフレームがコラージュに合成される

---

## Stage 3.5: AI スタイル変換 (B-19)

### Task 3.6: AI スタイル変換 (Stability AI)

**内容:**
- filter-apply Lambda に Stability AI (Bedrock) 連携を追加
  - filterType が `ai` の場合に Bedrock Stability AI を呼び出す
  - `anime` / `popart` / `watercolor` の3スタイル
  - 4枚並列で Bedrock API 呼び出し (Promise.all)

**完了条件:**
- [ ] AI フィルター (`anime` / `popart` / `watercolor`) でスタイル変換が適用される

---

## Stage 4: 拡張機能 (B-22, B-23, B-26)

### Task 4.1: CloudFront + 署名付き URL

**内容:**
- CDK: CloudFront Distribution を定義 (S3 オリジン)
- session-get Lambda でカラー版 DL URL を CloudFront 署名付き URL で返却

**完了条件:**
- [ ] CloudFront 経由で画像 DL ができる

---

### Task 4.2: SNS 印刷完了通知

**内容:**
- CDK: SNS Topic を定義
- 印刷完了時 (IoT Core → Lambda) に SNS にパブリッシュ

**完了条件:**
- [ ] 印刷完了時に SNS メッセージが配信される

---

## Stage 5: 監視 + Nice to Have (B-20, B-21, B-24〜B-27)

### Task 5.1: DynamoDB Streams + 統計更新

### Task 5.2: AppSync サブスクリプション

### Task 5.3: Polly カウントダウン音声

### Task 5.4: Transcribe 音声コマンド

### Task 5.5: CloudWatch Synthetics

> Stage 5 の詳細は Stage 1〜4 完成後に設計する。

---

## 備考

### ESC/POS ラスターフォーマット

印刷用バイナリは ESC/POS の GS v 0 コマンドで生成する:

```
GS v 0 m xL xH yL yH d1...dk

m = 0 (通常密度)
xL, xH = 幅バイト数 (576px / 8 = 72 → xL=72, xH=0)
yL, yH = 高さ (画像の高さ)
d1...dk = ビットマップデータ (1ビット=1ピクセル、1=黒、0=白)
```

### ローカル開発

- Lambda のローカル実行は `vitest` でモックテスト
- AWS サービスとの結合テストはデプロイ後に実施
- `SAM Local` は使わない (CDK + NodejsFunction との相性が悪い)
- 開発フローは: コード変更 → テスト → push → CD 自動デプロイ → 動作確認
