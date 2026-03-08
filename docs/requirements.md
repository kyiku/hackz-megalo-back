# バックエンド要件定義書

> **最終更新日**: 2026-03-06
> **プロジェクト**: Receipt Purikura（レシートプリクラ）
> **開発期間**: 14日間（〜2026-03-16）
> **チーム**: 2名（A: フロント + インフラ (CDK) 担当, B: バックエンド (Lambda コード) 担当）
> **ランタイム**: Node.js 20 (TypeScript) / ARM64 (Graviton2)
> **正規ドキュメント**: [元要件定義書](/docs/requirements.md) が全体の Source of Truth

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

| カテゴリ | 内容 |
|---------|------|
| API | REST API (`/api/session` 系) |
| リアルタイム | WebSocket (進捗通知, WebRTCシグナリング, 撮影同期) |
| 画像処理 | Step Functions Express + Lambda (フィルター, コラージュ, ディザリング) |
| AI | Rekognition, Bedrock (Claude + Stability AI), Comprehend, Polly, Transcribe |
| 印刷 | IoT Core MQTT で印刷通知 → PC ブラウザが WebUSB で直接印刷 |
| データ | DynamoDB (セッション), S3 (画像) |
| イベント | EventBridge (S3 → Step Functions トリガー) |
| 監視 | CloudWatch, X-Ray, AppSync ダッシュボード |

---

## 3. 機能要件（バックエンド）

### 3.1 Must（MVP - これがないとデモできない）

| ID | 機能 | 説明 |
|----|------|------|
| B-01 | セッション作成 API | `POST /api/session` — セッション ID 発行 + Presigned URL 4枚分 + WebSocket URL 返却 |
| B-02 | S3 アップロード受付 | Transfer Acceleration 対応 Presigned URL |
| B-03 | EventBridge → Step Functions 起動 | S3 PutObject をトリガーに、または `POST /api/session/:id/process` で手動起動 |
| B-04 | 簡易フィルター適用 | sharp で ナチュラル/美肌/明るさ補正/モノクロ/セピア（4枚並列） |
| B-05 | コラージュ生成 | 4枚を 2x2 グリッドに配置 (576x576px、padding: 10px、gap: 6px) |
| B-06 | ディザリング | Floyd-Steinberg でカラー→白黒2値変換、印刷用 PNG を生成 |
| B-07 | QR コード埋め込み | カラー版 DL 用 QR をレシート画像に追加 |
| B-08 | 印刷ジョブ通知 | IoT Core MQTT で印刷用画像の S3 キーを通知。ESC/POS 変換・USB 送信は PC ブラウザ側 (WebUSB) |
| B-09 | セッション取得 API | `GET /api/session/:id` — 処理状態・結果を返す |

### 3.2 Should（あると審査で強い）

| ID | 機能 | 説明 |
|----|------|------|
| B-10 | WebSocket 進捗通知 | `statusUpdate` / `completed` イベントでクライアントへ通知 |
| B-11 | WebRTC シグナリング | `join_room` / `webrtc_offer` / `webrtc_answer` / `webrtc_ice` を中継 |
| B-12 | 撮影同期イベント中継 | `shooting_start` / `countdown` / `shutter` / `shooting_complete` をスマホ→PC に中継 |
| B-13 | 顔検出 (Rekognition) | 顔の位置を検出してコラージュのクロップを最適化 |
| B-14 | キャプション生成 (Bedrock Sonnet) | コラージュから面白いキャプション自動生成 |
| B-15 | 感情分析 (Comprehend) | キャプション感情 → フレームデザイン自動選択 |
| B-16 | フレーム合成 | 感情分析結果に連動したプリクラ風フレームをオーバーレイ |
| B-17 | やじコメント高速 (Rekognition) | 表情検出 → テンプレートコメント生成 (2秒間隔) |
| B-18 | やじコメント深い (Bedrock Haiku) | マルチモーダル分析 → 高品質コメント生成 (5秒間隔) |
| B-19 | AI スタイル変換 (Stability AI) | アニメ風/ポップアート風/水彩画風の画風変換 |
| B-20 | DynamoDB Streams → 統計更新 | セッション完了時にリアルタイム統計 |
| B-21 | AppSync サブスクリプション | ダッシュボードへリアルタイムプッシュ |
| B-22 | カラー版 DL URL 発行 | CloudFront + Lambda@Edge 署名付き URL |
| B-23 | SNS 印刷完了通知 | ファンアウト配信 |

### 3.3 Nice to Have

| ID | 機能 | 説明 |
|----|------|------|
| B-24 | Polly カウントダウン音声 | 「3...2...1...はいチーズ！」の AI 音声を事前生成して S3 にキャッシュ |
| B-25 | Transcribe 音声コマンド | 「撮って！」でシャッター |
| B-26 | Lambda@Edge デバイス最適化 | DL 時に端末に合わせてリサイズ |
| B-27 | CloudWatch Synthetics | 外形監視カナリア |

---

## 4. フィルター仕様

### 簡易フィルター (sharp)

| ID | フィルター名 | 値 | 処理 |
|----|------------|-----|------|
| FL-01 | ナチュラル | `natural` | 処理なし（元写真のまま） |
| FL-02 | 美肌 | `beauty` | ガウシアンぼかし + ブレンド |
| FL-03 | 明るさ補正 | `bright` | 明るさ + コントラスト補正 |
| FL-04 | モノクロ | `mono` | グレースケール変換 |
| FL-05 | セピア | `sepia` | グレースケール + セピアカラーマップ |

### AI スタイル変換 (Bedrock Stability AI)

| ID | スタイル名 | 値 | 処理時間 |
|----|----------|-----|---------|
| AI-01 | アニメ風 | `anime` | ~10-20秒 |
| AI-02 | ポップアート風 | `popart` | ~10-20秒 |
| AI-03 | 水彩画風 | `watercolor` | ~10-20秒 |

---

## 5. 非機能要件

| 項目 | 要件 |
|------|------|
| 簡易フィルター処理時間 | 撮影後 **12秒以内** に印刷完了 |
| AI スタイル処理時間 | 撮影後 **30秒以内** に印刷完了 |
| 画像アップロード | **2秒以内** (WiFi環境、4枚同時) |
| 同時接続 | 50人以上 |
| Lambda メモリ | **10GB** (CPU 最大化) |
| Lambda アーキテクチャ | ARM64 (Graviton2) |
| 認証 | なし（匿名利用、ハッカソン向け） |
| HTTPS | 全通信 HTTPS |
| データ保持 | S3: 7-30日 TTL, DynamoDB: 30日 TTL |

---

## 6. 段階的リリース計画（バックエンド視点）

| Stage | 目標 Day | 機能 | 対応 ID |
|-------|---------|------|---------|
| **1** | Day 5 | S3 Upload → コラージュ → ディザリング → 印刷 | B-01〜B-09 |
| **2** | Day 7 | WebSocket + WebRTC シグナリング + 撮影同期 | B-10〜B-12 |
| **3** | Day 9 | 顔検出 + キャプション + 感情分析 + やじコメント | B-13〜B-18 |
| **3.5** | Day 10 | AI スタイル変換 | B-19 |
| **4** | Day 11 | IoT Core + EventBridge + SNS + CloudFront + Lambda@Edge | B-22, B-23, B-26 |
| **5** | Day 13 | AppSync + DynamoDB Streams + 監視 + Polly + Transcribe | B-20, B-21, B-24, B-25, B-27 |

---

## 7. フロントエンドとの連携ポイント

| フロント側 | バックエンド側 | 通信方式 |
|-----------|-------------|---------|
| 撮影開始ボタン押下 | `POST /api/session` → セッション + Presigned URL + WebSocket URL 返却 | REST |
| 4枚アップロード完了 | `POST /api/session/:id/process` → パイプライン開始 | REST |
| セッション購読 | WebSocket `subscribe` → sessionId を登録 | WebSocket |
| 処理進捗表示 | WebSocket `statusUpdate` イベント受信 | WebSocket |
| 処理完了 | WebSocket `completed` イベント受信 | WebSocket |
| ルーム参加 | WebSocket `join_room` → roomId + role 登録 | WebSocket |
| WebRTC 接続 | WebSocket `webrtc_offer` / `webrtc_answer` / `webrtc_ice` を中継 | WebSocket |
| 撮影同期 | WebSocket `shooting_start` / `countdown` / `shutter` / `shooting_complete` | WebSocket |
| コラージュ結果表示 | `GET /api/session/:id` → 画像 URL 返却 | REST |
| 印刷 | MQTT 通知受信 → S3 から印刷用 PNG 取得 → WebUSB で ESC/POS 送信 | MQTT + HTTPS + WebUSB |
| カラー版 DL | CloudFront 署名付き URL | HTTPS |
