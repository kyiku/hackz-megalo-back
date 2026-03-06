# バックエンド要件定義書

> **最終更新日**: 2026-03-06
> **プロジェクト**: Receipt Purikura（レシートプリクラ）
> **開発期間**: 14日間（〜2026-03-16）
> **チーム**: 2名（A: フロント担当, B: バックエンド担当）

---

## 1. プロジェクト概要

サーマルレシートプリンターを使った白黒レトロプリクラサービス。
スマホで4枚撮影 → フィルター → コラージュ → レシート印刷。
ハッカソン出展作品として **AWS 19サービスのオーバーアーキテクチャ** で構築する。

### 成功指標

- 撮影〜印刷まで **30秒以内**
- **50人以上** の同時アクセス
- AWS 19サービス構成のインパクト

---

## 2. バックエンドの責務

バックエンドが担当する機能:

| カテゴリ | 内容 |
|---------|------|
| API | REST API (セッション管理, Presigned URL) |
| リアルタイム | WebSocket (進捗通知, WebRTCシグナリング) |
| 画像処理 | Step Functions + Lambda (フィルター, コラージュ, ディザリング) |
| AI | Rekognition, Bedrock, Comprehend, Polly, Transcribe |
| 印刷 | IoT Core MQTT → MacBook → プリンター |
| データ | DynamoDB (セッション), S3 (画像) |
| 監視 | CloudWatch, X-Ray, AppSync ダッシュボード |

---

## 3. 機能要件（バックエンド抜粋）

### 3.1 Must（MVP - これがないとデモできない）

| ID | 機能 | 説明 |
|----|------|------|
| B-01 | セッション作成 API | セッション ID 発行 + Presigned URL 4枚分返却 |
| B-02 | S3 アップロード受付 | Transfer Acceleration 対応 Presigned URL |
| B-03 | EventBridge → Step Functions 起動 | S3 PutObject をトリガーにパイプライン開始 |
| B-04 | 簡易フィルター適用 | sharp で美肌/モノクロ/セピア等（4枚並列） |
| B-05 | コラージュ生成 | 4枚を 2x2 グリッドに配置 (576x576px) |
| B-06 | ディザリング | Floyd-Steinberg でカラー→白黒2値変換 |
| B-07 | QR コード埋め込み | カラー版 DL 用 QR をレシート画像に追加 |
| B-08 | 印刷ジョブ送信 | IoT Core MQTT (フォールバック: SQS) |
| B-09 | セッション取得 API | 処理状態・結果を返す |

### 3.2 Should（あると審査で強い）

| ID | 機能 | 説明 |
|----|------|------|
| B-10 | WebSocket 進捗通知 | 処理ステップごとにクライアントへ通知 |
| B-11 | WebRTC シグナリング | スマホ↔PC の SDP/ICE 交換を中継 |
| B-12 | 顔検出 (Rekognition) | 顔の位置を検出してコラージュのクロップを最適化 |
| B-13 | キャプション生成 (Bedrock Sonnet) | コラージュから面白いキャプション自動生成 |
| B-14 | 感情分析 (Comprehend) | キャプション感情 → フレームデザイン自動選択 |
| B-15 | やじコメント高速 (Rekognition) | 表情検出 → テンプレートコメント生成 |
| B-16 | やじコメント深い (Bedrock Haiku) | マルチモーダル分析 → 高品質コメント生成 |
| B-17 | AI スタイル変換 (Stability AI) | アニメ風/ポップアート風等の画風変換 |
| B-18 | DynamoDB Streams → 統計更新 | セッション完了時にリアルタイム統計 |
| B-19 | AppSync サブスクリプション | ダッシュボードへリアルタイムプッシュ |
| B-20 | カラー版 DL URL 発行 | CloudFront 署名付き URL |
| B-21 | SNS 印刷完了通知 | ファンアウト配信 |

### 3.3 Nice to Have

| ID | 機能 | 説明 |
|----|------|------|
| B-22 | Polly カウントダウン音声 | 「3...2...1...はいチーズ！」の AI 音声生成 |
| B-23 | Transcribe 音声コマンド | 「撮って！」でシャッター |
| B-24 | Lambda@Edge デバイス最適化 | DL 時に端末に合わせてリサイズ |
| B-25 | CloudWatch Synthetics | 外形監視カナリア |

---

## 4. 非機能要件

| 項目 | 要件 |
|------|------|
| 簡易フィルター処理時間 | 撮影後 12秒以内に印刷完了 |
| AI スタイル処理時間 | 撮影後 30秒以内に印刷完了 |
| 同時接続 | 50人以上 |
| 認証 | なし（匿名利用、ハッカソン向け） |
| HTTPS | 全通信 HTTPS |
| データ保持 | S3: 7-30日 TTL, DynamoDB: 30日 TTL |

---

## 5. 段階的リリース計画（バックエンド視点）

| Stage | 目標 Day | 機能 | 対応 ID |
|-------|---------|------|---------|
| **1** | Day 5 | S3 Upload → コラージュ → ディザリング → 印刷 | B-01〜B-09 |
| **2** | Day 7 | WebSocket + WebRTC シグナリング | B-10, B-11 |
| **3** | Day 9 | 顔検出 + キャプション + 感情分析 + やじコメント | B-12〜B-16 |
| **4** | Day 11 | AI スタイル変換 + IoT/EventBridge/SNS/CloudFront | B-17, B-20, B-21 |
| **5** | Day 13 | AppSync + DynamoDB Streams + 監視 | B-18, B-19, B-22〜B-25 |

---

## 6. フロントエンドとの連携ポイント

| フロント側 | バックエンド側 | 通信方式 |
|-----------|-------------|---------|
| 撮影開始ボタン押下 | `POST /sessions` → セッション + Presigned URL 返却 | REST |
| 4枚アップロード完了 | `POST /sessions/:id/process` → パイプライン開始 | REST |
| 処理進捗表示 | WebSocket で `progress` イベント送信 | WebSocket |
| コラージュ結果表示 | `GET /sessions/:id` → 画像 URL 返却 | REST |
| WebRTC 映像配信 | WebSocket で SDP/ICE シグナリング中継 | WebSocket |
| やじコメント表示 | WebSocket で `yajiComment` イベント送信 | WebSocket |
| カラー版 DL | `GET /sessions/:id/download-url` → 署名付き URL | REST |
