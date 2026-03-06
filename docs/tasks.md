# 実装タスク分解

> **最終更新日**: 2026-03-06
> **対象**: AI エージェント / バックエンド開発者
> **前提**: CI/CD 構築済み。main push で自動デプロイ。

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
  - `ApiResponse<T>` 型
  - `ProgressEvent`, `YajiComment` 型
- DynamoDB ヘルパー (`src/lib/dynamodb.ts`)
  - `DynamoDBDocumentClient` のシングルトン
  - `getSession`, `putSession`, `updateSession` 関数
- S3 ヘルパー (`src/lib/s3.ts`)
  - `S3Client` のシングルトン
  - `generatePresignedUploadUrl`, `generatePresignedDownloadUrl` 関数
- API レスポンスビルダー (`src/utils/response.ts`)
  - `success(data, statusCode)`, `error(message, statusCode)` 関数
- Zod バリデーションスキーマ (`src/utils/validation.ts`)
  - `CreateSessionSchema`, `UploadUrlSchema`, `ProcessSchema`
- `package.json` に runtime 依存を追加
  - `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`
  - `@aws-sdk/client-dynamodb`, `@aws-sdk/lib-dynamodb`
  - `ulid`, `zod`

**完了条件:**
- [ ] 共通ライブラリの単体テスト (mock AWS SDK)
- [ ] `npm run build` が通る
- [ ] `npm run type-check` が通る

---

### Task 1.2: CDK Storage リソース

**内容:**
- `cdk/lib/app-stack.ts` に S3 バケットを定義
  - Transfer Acceleration 有効化
  - CORS 設定
  - ライフサイクルルール (originals: 7日, collages: 30日, etc.)
- DynamoDB sessions テーブルを定義
  - PAY_PER_REQUEST
  - TTL 属性
  - GSI: roomId-index
- DynamoDB connections テーブルを定義
  - GSI: sessionId-index

**完了条件:**
- [ ] `cd cdk && npx cdk synth` が成功
- [ ] CloudFormation テンプレートに S3 + DynamoDB が含まれる
- [ ] `cd cdk && npx cdk diff` で差分確認

---

### Task 1.3: REST API + セッション作成 Lambda

**内容:**
- CDK: REST API Gateway を定義
- CDK: `session-create` Lambda (NodejsFunction) を定義
- `src/functions/session-create/handler.ts` 実装
  - リクエストバリデーション (photoCount)
  - ULID でセッション ID 生成
  - roomId 生成 (`room-${nanoid(8)}` 等)
  - DynamoDB にセッション保存
  - 4枚分の Presigned URL 生成 (Transfer Acceleration)
  - レスポンス返却

**完了条件:**
- [ ] ハンドラの単体テスト (AWS SDK モック)
- [ ] CDK デプロイ成功
- [ ] curl で `POST /sessions` が動作する

---

### Task 1.4: セッション取得 Lambda

**内容:**
- CDK: `session-get` Lambda を定義、REST API にルート追加
- `src/functions/session-get/handler.ts` 実装
  - パスパラメータから sessionId 取得
  - DynamoDB からセッション取得
  - 404 ハンドリング

**完了条件:**
- [ ] ハンドラの単体テスト
- [ ] CDK デプロイ成功
- [ ] curl で `GET /sessions/{id}` が動作する

---

### Task 1.5: Step Functions + パイプライン起動 Lambda

**内容:**
- CDK: Step Functions Express Workflow を定義
  - 初期段階では filter-apply → collage-generate → print-prepare の直列ワークフロー
  - face-detection, caption, yaji は Stage 3 で追加
- CDK: `process-start` Lambda を定義
- `src/functions/process-start/handler.ts` 実装
  - DynamoDB からセッション取得 (images 確認)
  - Step Functions startExecution 呼び出し
  - status を `processing` に更新

**完了条件:**
- [ ] Step Functions ワークフローが CDK で定義・デプロイ成功
- [ ] `POST /sessions/{id}/process` で Step Functions が起動する
- [ ] CloudWatch Logs でワークフロー実行ログが確認できる

---

### Task 1.6: filter-apply Lambda

**内容:**
- `src/functions/filter-apply/handler.ts` 実装
  - S3 から 4枚の元画像を取得
  - sharp でフィルター適用 (mono / sepia / beauty)
    - `mono`: `sharp.greyscale()`
    - `sepia`: `sharp.tint({ r: 112, g: 66, b: 20 })`
    - `beauty`: `sharp.blur(1.5).sharpen()`
  - フィルター済み画像を S3 に保存 (filtered/{sessionId}/)
  - 4枚並列処理 (Promise.all)

**完了条件:**
- [ ] ハンドラの単体テスト (sharp モック or テスト画像)
- [ ] デプロイ後、Step Functions から呼び出されてフィルター済み画像が S3 に保存される

---

### Task 1.7: collage-generate Lambda

**内容:**
- `src/functions/collage-generate/handler.ts` 実装
  - S3 からフィルター済み 4枚を取得
  - sharp で 2x2 グリッド配置 (576x576px)
    - 各画像を 288x288px にリサイズ
    - `sharp.composite()` で合成
  - コラージュ画像を S3 に保存 (collages/{sessionId}/)

**完了条件:**
- [ ] 単体テスト
- [ ] 576x576px のコラージュ画像が生成される

---

### Task 1.8: print-prepare Lambda

**内容:**
- `src/functions/print-prepare/handler.ts` 実装
  - S3 からコラージュ画像を取得
  - QR コード生成 (DL URL 用)
  - QR コードをコラージュに合成
  - Floyd-Steinberg ディザリングで白黒 2 値変換
    - sharp で grayscale → raw ピクセルデータ取得
    - Floyd-Steinberg アルゴリズムをカスタム実装
  - ESC/POS ラスターコマンド生成
    - GS v 0 コマンド (576px 幅)
  - 印刷用バイナリを S3 に保存 (print-ready/{sessionId}/)
  - カラー版 DL 用画像を S3 に保存 (downloads/{sessionId}/)

**完了条件:**
- [ ] Floyd-Steinberg ディザリングの単体テスト
- [ ] ESC/POS バイナリ生成の単体テスト
- [ ] 印刷用バイナリと DL 用画像が S3 に保存される

---

### Task 1.9: IoT Core 印刷ジョブ送信

**内容:**
- CDK: IoT Policy, IoT Rule を定義
- Step Functions ワークフローの最後に印刷ジョブ送信ステップを追加
  - `@aws-sdk/client-iot-data-plane` で MQTT パブリッシュ
  - トピック: `print/{deviceId}/job`
  - DynamoDB status を `printing` に更新
- IoT Rule: `print/+/status` を受けて DynamoDB status を `done` に更新する Lambda

**完了条件:**
- [ ] MQTT メッセージが IoT Core に送信される
- [ ] MacBook 側のクライアントで印刷ジョブを受信できる
- [ ] 印刷完了後に status が `done` に更新される

---

### Task 1.10: ダウンロード URL Lambda

**内容:**
- CDK: `download-url` Lambda を定義、REST API にルート追加
- `src/functions/download-url/handler.ts` 実装
  - DynamoDB でセッション status 確認 (`done` のみ許可)
  - S3 Presigned URL (GET) を生成
  - 将来的に CloudFront 署名付き URL に変更可能

**完了条件:**
- [ ] 単体テスト
- [ ] status が `done` のセッションで DL URL が取得できる
- [ ] status が `done` でないときに 400 エラー

---

## Stage 2: リアルタイム通信 (B-10, B-11)

### Task 2.1: WebSocket API + 接続管理

**内容:**
- CDK: WebSocket API Gateway (V2) を定義
- `ws-connect` / `ws-disconnect` Lambda 実装
  - connectionId + sessionId を DynamoDB connections テーブルに保存/削除

**完了条件:**
- [ ] wscat 等で WebSocket 接続・切断が動作する
- [ ] connections テーブルに正しく保存/削除される

---

### Task 2.2: WebSocket 進捗通知

**内容:**
- WebSocket 送信ヘルパー (`src/lib/websocket.ts`)
  - `sendProgress(sessionId, step, progress, message)` 関数
  - connections テーブルから sessionId で connectionId を検索
  - `@aws-sdk/client-apigatewaymanagementapi` で送信
- 各 Step Functions Lambda に進捗通知を埋め込む

**完了条件:**
- [ ] Step Functions 実行中に WebSocket で progress イベントを受信できる

---

### Task 2.3: WebRTC シグナリング

**内容:**
- `ws-join-room` / `ws-signal` Lambda 実装
  - joinRoom: connections テーブルに roomId + role を保存
  - signal: 同じ roomId の相手方 connectionId に SDP/ICE を転送

**完了条件:**
- [ ] 2つの WebSocket クライアント間で SDP/ICE のやり取りができる

---

## Stage 3: AI 機能 (B-12〜B-16)

### Task 3.1: 顔検出 (Rekognition)

**内容:**
- `face-detection` Lambda 実装
- Step Functions に並列ステップとして追加
- 顔位置情報を collage-generate に渡す

**完了条件:**
- [ ] Rekognition DetectFaces が正しく呼び出される
- [ ] 顔位置を使ったスマートクロップでコラージュが改善される

---

### Task 3.2: やじコメント高速 (Rekognition)

**内容:**
- `yaji-comment-fast` Lambda 実装
  - Rekognition で感情検出 → テンプレートマッチング
  - WebSocket で即時配信 (lane: "fast")
- Step Functions に並列ステップとして追加

**完了条件:**
- [ ] 表情に応じたテンプレートコメントが WebSocket で配信される

---

### Task 3.3: やじコメント深い (Bedrock Haiku)

**内容:**
- `yaji-comment-deep` Lambda 実装
  - Bedrock Claude Haiku でマルチモーダル分析
  - WebSocket で配信 (lane: "deep")
- Step Functions に yaji-comment-fast 後のステップとして追加

**完了条件:**
- [ ] Bedrock 呼び出しが成功し、高品質コメントが生成・配信される

---

### Task 3.4: キャプション生成 + 感情分析

**内容:**
- `caption-generate` Lambda 実装
  - Bedrock Claude Sonnet でコラージュからキャプション生成
  - Comprehend で感情分析
  - DynamoDB にキャプション + 感情スコアを保存
- Step Functions に collage-generate 後のステップとして追加

**完了条件:**
- [ ] キャプションが自動生成されてセッションに保存される
- [ ] 感情スコアが Comprehend から取得される

---

## Stage 4: 拡張機能 (B-17, B-20, B-21)

### Task 4.1: AI スタイル変換 (Stability AI)

**内容:**
- filter-apply Lambda に Stability AI (Bedrock) 連携を追加
  - filter が `pop-art` / `anime` の場合に Stability AI を呼び出す

**完了条件:**
- [ ] pop-art / anime フィルターで AI スタイル変換が適用される

---

### Task 4.2: CloudFront + 署名付き URL

**内容:**
- CDK: CloudFront Distribution を定義 (S3 オリジン)
- download-url Lambda を CloudFront 署名付き URL に変更

**完了条件:**
- [ ] CloudFront 経由で画像 DL ができる

---

### Task 4.3: SNS 印刷完了通知

**内容:**
- CDK: SNS Topic を定義
- 印刷完了時に SNS にパブリッシュ

**完了条件:**
- [ ] 印刷完了時に SNS メッセージが配信される

---

## Stage 5: 監視 + Nice to Have (B-18〜B-25)

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
