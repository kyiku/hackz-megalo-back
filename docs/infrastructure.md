# Receipt Purikura - インフラ要件定義書

> **最終更新日**: 2026-03-06
> **ステータス**: Draft v1
> **対象**: AWS インフラ構成・コスト・運用方針

---

## 1. 概要

Receipt Purikura のインフラはフルサーバーレス構成（AWS）で構築する。
EC2/ECS等の常時稼働サーバーは使用しない。唯一のローカル稼働はMacBook上の印刷サービスのみ。

### 基本方針

- **全サービスをサーバーレスで構成** → 使った分だけ課金
- **AWS CDK** で全インフラをコード管理
- **$95のサービスクレジット内** で開発14日間+本番3日間を賄う
- 開発中は即日構築・CI/CDフル活用。コスト高の3サービスのみ本番直前にON

---

## 2. AWSサービス一覧（19サービス）

### 2.1 常時構築OK（開発初日から構築・利用可能）

開発中の利用でコストがほぼ発生しないサービス群。**今すぐ構築してよい。**

| # | サービス | 用途 | 課金モデル | 開発中コスト |
|---|---------|------|-----------|------------|
| 1 | **Amplify Hosting** | フロントエンド(Next.js)ホスティング + CI/CD | 無料枠: 月1,000分ビルド | $0 |
| 2 | **S3** (Transfer Acceleration有効) | 画像ストレージ + 高速アップロード | $0.023/GB + $0.04/GBアクセラレーション | ~$0.05 |
| 3 | **API Gateway** (REST + WebSocket) | REST API + WebSocket + WebRTCシグナリング | $3.50/100万リクエスト + $1.00/100万WSメッセージ | ~$0 |
| 4 | **Lambda** (Python 3.12, ARM64, 10GB) | 画像処理パイプライン全ステップ | $0.20/100万リクエスト + 実行時間課金 | ~$0 (無料枠内) |
| 5 | **Step Functions Express** | 処理パイプラインオーケストレーション | $1.00/100万ステート遷移 | ~$0 |
| 6 | **DynamoDB** (オンデマンド) | セッションメタデータ + ルーム管理 | オンデマンド従量課金 | ~$0 (無料枠内) |
| 7 | **DynamoDB Streams** | イベントソーシング(統計更新トリガー) | DynamoDB料金に含む | $0 |
| 8 | **EventBridge** | S3→Step Functionsイベントルーティング | $1.00/100万イベント | ~$0 |
| 9 | **IoT Core** | MQTT印刷ジョブ送信(プリンター=IoTデバイス) | $1.00/100万メッセージ | ~$0 |
| 10 | **SQS** | IoT Coreフォールバック印刷キュー | $0.40/100万リクエスト | ~$0 |
| 11 | **SNS** | 印刷完了ファンアウト通知 | $0.50/100万通知 | ~$0 |
| 12 | **AppSync** | GraphQLサブスクリプション(ダッシュボード) | $4.00/100万クエリ | ~$0 |
| 13 | **CloudFront** + **Lambda@Edge** | カラー版DL配信 + デバイス最適化リサイズ | $0.085/GB + Lambda@Edge実行時間 | ~$0 |
| 14 | **CloudWatch** | ログ・メトリクス・ダッシュボード | $0.50/GBログ + $3/ダッシュボード | ~$1-2 |
| 15 | **X-Ray** + **ServiceLens** | トレーシング・マイクロサービスマップ | 無料枠: 月10万トレース | $0 |

### 2.2 従量課金AI系（開発中はテスト利用のみ）

使った回数分だけ課金。開発中はテストで数十回使う程度なので低コスト。

| # | サービス | 用途 | 単価 | 開発中コスト(14日) |
|---|---------|------|------|------------------|
| 16 | **Rekognition** | 顔検出 + 感情検出(やじコメント高速レーン) | $0.001/枚 | ~$0.05 |
| 17 | **Bedrock Claude Haiku** | やじコメント深いレーン | ~$0.005/回 | ~$0.50 |
| 17b | **Bedrock Claude Sonnet** | キャプション生成 | ~$0.01/回 | ~$0.30 |
| 17c | **Bedrock Stability AI** | AIスタイル変換 | ~$0.05/枚 | ~$1.00 |
| 18 | **Comprehend** | キャプション感情分析 | $0.0001/ユニット | ~$0.01 |
| 19a | **Polly** | カウントダウンAI音声合成 | $4.00/100万文字 | ~$0.01 |
| 19b | **Transcribe** | 音声コマンド認識 | $0.024/分 | ~$0.24 |
| | | | **AI系合計(開発中)** | **~$2.11** |

### 2.3 本番直前にON（開発中は構築不要 or OFF）

時間課金・月額課金のため、本番3日間のみ有効化する。

| # | サービス | 用途 | 課金モデル | 本番3日間コスト | ONにするタイミング |
|---|---------|------|-----------|---------------|-----------------|
| A | **Lambda Provisioned Concurrency** | コールドスタート排除(3関数×1) | $0.015/時/関数 | ~$3.24 | 本番初日の朝 |
| B | **WAF** | API Gateway前段ファイアウォール | $5/月 + $1/ルール | ~$0.50 | 本番初日の朝 |
| C | **CloudWatch Synthetics** | カナリア外形監視(5分間隔) | $0.0012/実行 | ~$1.04 | 本番初日の朝 |
| | | | **本番限定合計** | **~$4.78** | |

---

## 3. インフラ構成図

```
                        ┌──────────────────────────────────────────────────────────┐
                        │                       AWS Cloud ($95クレジット内)          │
                        │                                                          │
 [スマホ]               │  ┌────────┐  ┌──────────┐  ┌────────────────────┐       │
    │                   │  │ WAF    │──│ Amplify  │  │ CloudFront         │       │
    │── HTTPS ─────────────│ [本番] │  │ Hosting  │  │ + Lambda@Edge      │       │
    │                   │  └────────┘  │ (CI/CD)  │  └────────────────────┘       │
    │                   │              └──────────┘                                │
    │                   │                                                          │
    │── S3 Transfer ───────── S3 ──→ EventBridge ──→ Step Functions Express       │
    │   Acceleration    │                                │                         │
    │                   │                                │                         │
    │── WebSocket ─────────── API Gateway ──────┐       │                         │
    │   + WebRTC SDP    │                        │       ▼                         │
    │                   │                 ┌──────┴───────────────────┐             │
    │ ═══ WebRTC P2P ════════════[PC]     │  Step Functions Express  │             │
    │                   │                 │  (ARM64 Lambda 10GB)     │             │
    │                   │                 │  + Provisioned Conc.[本番]│             │
    │                   │                 │                          │             │
    │                   │                 │  Rekognition → Pillow/   │             │
    │                   │                 │  Stability → Collage →   │             │
    │                   │                 │  Bedrock → Comprehend →  │             │
    │                   │                 │  Dither+QR               │             │
    │                   │                 └──────┬───────────────────┘             │
    │                   │                        │                                 │
    │                   │         ┌──────────────┼──────────────┐                  │
    │                   │         ▼              ▼              ▼                  │
    │                   │    DynamoDB       IoT Core         Polly                 │
    │                   │         │          (MQTT)       (AI音声)                 │
    │                   │    DynamoDB                                              │
    │                   │    Streams         SQS(FB)       Transcribe              │
    │                   │         │                        (音声認識)               │
    │                   │         ▼              SNS                               │
    │                   │      AppSync        (通知FB)                             │
    │                   │     (GraphQL)                                            │
    │                   │                                                          │
    │                   │    CloudWatch + X-Ray + ServiceLens                      │
    │                   │    + Synthetics [本番]                                    │
    │                   └──────────────────────────────────────────────────────────┘
    │                                          │
    │                                          ▼
    │                                 ┌────────────────┐
    │                                 │    MacBook      │
    │                                 │  (ローカル唯一)  │
    │                                 │  印刷サービス    │
    │                                 │  🖨️ プリンター   │
    │                                 └────────────────┘

[本番] = 本番3日間のみ有効化するサービス
(FB) = フォールバック用
```

---

## 4. コスト試算

### 4.1 開発期間（14日間）

| カテゴリ | コスト |
|---------|--------|
| 常時構築OKサービス（無料枠+従量） | ~$1-2 |
| AI系テスト利用 | ~$2 |
| **開発期間合計** | **~$3-5 (約500-750円)** |

### 4.2 本番期間（3日間 × 50セッション/日 = 150セッション）

| カテゴリ | コスト |
|---------|--------|
| 本番限定サービス（Provisioned Conc., WAF, Synthetics） | ~$5 |
| 変動費（150セッション × ~$0.24/セッション） | ~$36 |
| **本番期間合計** | **~$41 (約6,150円)** |

### 4.3 セッション単価内訳

| サービス | コスト/セッション | 備考 |
|---------|-----------------|------|
| Bedrock Stability AI (AIスタイル時) | $0.10 | 50%が選択と仮定→平均$0.05 |
| Bedrock Haiku (やじコメント) | $0.03 | 5秒間隔×6回 |
| Transcribe (音声コマンド) | $0.024 | ~1分/セッション |
| Rekognition (やじ+顔検出) | $0.019 | 2秒間隔×15回+パイプライン4回 |
| Bedrock Sonnet (キャプション) | $0.01 | 1回 |
| Lambda (6ステップ) | $0.003 | ARM64 10GB×~3秒×6回 |
| その他(S3,DDB,IoT,SQS,SNS等) | ~$0.001 | ほぼ無料 |
| **合計** | **~$0.24** | **約36円/セッション** |

### 4.4 総コスト

| 項目 | コスト | 日本円 |
|------|--------|--------|
| 開発14日間 | ~$4 | ~600円 |
| 本番3日間 | ~$41 | ~6,150円 |
| **合計** | **~$45** | **約6,750円** |
| クレジット残高 | $95 | |
| **余り** | **~$50** | **約7,500円** |

### 4.5 コスト最適化オプション

| 施策 | 削減額 | トレードオフ |
|------|--------|------------|
| Provisioned Concurrency → 本番日の稼働時間のみ(8h/日) | -$1.60 | 稼働時間外はコールドスタートあり |
| AIスタイル変換をデモ限定に | -$5.00 | 一般来場者は簡易フィルターのみ |
| Transcribe → ボタン操作のみ | -$3.60 | 音声コマンド機能なし |
| やじコメント → 高速レーンのみ | -$4.50 | Bedrock Haiku不使用。テンプレートコメントのみ |
| **最小構成時の合計** | **~$30** | **約4,500円** |

---

## 5. 環境構成

### 5.1 環境一覧

| 環境 | 用途 | Amplifyブランチ | AWSリソース |
|------|------|----------------|------------|
| **dev** | 開発・テスト | `develop` | 共有（1セット） |
| **prod** | 本番（ハッカソン当日） | `main` | 共有（1セット） |

> 2名チーム・短期間のため環境は最小限。ステージング環境は設けない。
> dev/prodの切り替えは環境変数で管理する。

### 5.2 環境変数

| 変数 | dev | prod |
|------|-----|------|
| `STAGE` | `dev` | `prod` |
| `S3_BUCKET` | `receipt-purikura-dev` | `receipt-purikura-prod` |
| `DYNAMODB_TABLE` | `sessions-dev` | `sessions-prod` |
| `WEBSOCKET_URL` | dev用URL | prod用URL |
| `IOT_ENDPOINT` | dev用エンドポイント | prod用エンドポイント |
| `PROVISIONED_CONCURRENCY` | `0` | `1` |

---

## 6. CI/CD パイプライン

### 6.1 フロントエンド（Amplify Hosting）

```
GitHub Push → Amplify自動検知 → ビルド(Next.js) → デプロイ → HTTPS配信
                                    │
                                    ├─ develop → dev環境
                                    └─ main    → prod環境
```

| 設定 | 値 |
|------|-----|
| フレームワーク | Next.js (SSR or SSG) |
| ビルドコマンド | `npm run build` |
| Node.js | 20.x |
| 自動デプロイ | ブランチプッシュ時 |
| プレビューデプロイ | PRごとにプレビューURL発行 |

### 6.2 バックエンド（AWS CDK）

```
GitHub Push → GitHub Actions → CDK diff → CDK deploy
                                  │
                                  ├─ develop → dev スタック
                                  └─ main    → prod スタック
```

| 設定 | 値 |
|------|-----|
| IaC | AWS CDK (TypeScript) |
| CI | GitHub Actions |
| デプロイ | `cdk deploy --all` |
| Lambda層 | Pythonの依存(Pillow等)はLambda Layerとして別管理 |

### 6.3 GitHub Actions ワークフロー

```yaml
# .github/workflows/deploy-backend.yml の概要
on:
  push:
    branches: [main, develop]
    paths: ['infra/**', 'backend/**']

jobs:
  deploy:
    - checkout
    - setup Node.js + Python
    - npm ci (CDK依存)
    - pip install (Lambda依存)
    - cdk diff
    - cdk deploy --require-approval never
```

---

## 7. リージョン・ネットワーク

| 項目 | 設定 |
|------|------|
| プライマリリージョン | `ap-northeast-1`（東京） |
| CloudFront | グローバルエッジ |
| Lambda@Edge | `us-east-1`（Lambda@Edgeの制約） |
| HTTPS | Amplify標準SSL証明書 |
| カスタムドメイン | 任意（Amplifyで設定可能。なくても `xxx.amplifyapp.com` で利用可） |
| WebRTC STUN | `stun:stun.l.google.com:19302`（Google無料） |

---

## 8. セキュリティ

| 項目 | 方針 |
|------|------|
| 認証 | なし（匿名利用。ハッカソン向け） |
| HTTPS | 全通信HTTPS（Amplify標準 + API Gateway標準） |
| Presigned URL | 有効期限5分 |
| WAF | 本番時のみ有効化。レート制限ルール（1IP 100req/分） |
| S3バケット | パブリックアクセスブロック。Presigned URL経由のみ |
| IAM | Lambda実行ロールは最小権限。サービスごとにロール分離 |
| 画像保存 | DynamoDB TTL + S3ライフサイクルでイベント後に自動削除 |
| シークレット | AWS Systems Manager Parameter Store で管理 |

---

## 9. 監視・アラート

### 9.1 開発中（Day 1-14）

| 項目 | 設定 |
|------|------|
| CloudWatch Logs | 全Lambda関数のログ |
| X-Ray | トレーシング有効 |
| アラート | なし（手動確認） |

### 9.2 本番（3日間）

| 項目 | 設定 |
|------|------|
| CloudWatch Logs | 全Lambda関数のログ |
| X-Ray + ServiceLens | マイクロサービスマップ表示 |
| CloudWatch Synthetics | 5分間隔の外形監視カナリア |
| CloudWatch Alarm | Lambda エラー率 > 5% → SNS通知 |
| CloudWatch Alarm | Step Functions 失敗 → SNS通知 |
| CloudWatch Dashboard | 撮影数、処理時間、エラー率をリアルタイム表示 |

---

## 10. データライフサイクル

| データ | 保存先 | TTL/ライフサイクル |
|--------|--------|-------------------|
| 元画像(4枚/セッション) | S3 `originals/` | 7日後に自動削除 |
| フィルター済み画像 | S3 `filtered/` | 7日後に自動削除 |
| カラーコラージュ | S3 `collages/` | 30日後に自動削除 |
| 印刷用画像 | S3 `print-ready/` | 7日後に自動削除 |
| DL用コラージュ | S3 `downloads/` | 30日後に自動削除 |
| セッションメタデータ | DynamoDB | TTL: 30日 |
| CloudWatch Logs | CloudWatch | 保持期間: 7日 |
| X-Rayトレース | X-Ray | 保持期間: 30日（デフォルト） |

---

## 11. 構築タイムライン

### Day 1: 基盤構築

| タスク | 担当 | 詳細 |
|--------|------|------|
| AWSアカウント設定 | 全員 | クレジット適用確認、リージョン設定 |
| CDKプロジェクト初期化 | B | `cdk init --language typescript` |
| Amplify Hosting設定 | A | GitHubリポジトリ連携、自動デプロイ設定 |
| S3バケット作成 | B | Transfer Acceleration有効、ライフサイクル設定 |
| DynamoDBテーブル作成 | B | sessionsテーブル、TTL設定 |
| GitHub Actions設定 | B | CDKデプロイワークフロー |

### Day 2-3: API + リアルタイム基盤

| タスク | 担当 | 詳細 |
|--------|------|------|
| API Gateway (REST) | B | Presigned URL発行エンドポイント |
| API Gateway (WebSocket) | B | 接続管理 + シグナリングルーティング |
| EventBridge設定 | B | S3 PutObject → Step Functions起動ルール |
| IoT Core設定 | A | MQTTトピック、デバイス証明書 |

### Day 4: パイプライン基盤

| タスク | 担当 | 詳細 |
|--------|------|------|
| Step Functions Express定義 | B | 超並列パイプラインのステートマシン |
| Lambda Layer | B | Pillow + qrcode の共通レイヤー |
| AppSync設定 | B | スキーマ定義、DynamoDB Streamsリゾルバー |

### Day 10-11: 仕上げインフラ

| タスク | 担当 | 詳細 |
|--------|------|------|
| CloudFront + Lambda@Edge | A | カラー版DLのデバイス最適化 |
| SNS設定 | B | 印刷完了ファンアウトトピック |
| CloudWatch Dashboard | B | メトリクス表示 |
| X-Ray ServiceLens | B | トレーシング・マップ設定 |

### 本番直前（Day 12-13）: 本番スイッチON

| タスク | 担当 | 詳細 |
|--------|------|------|
| Provisioned Concurrency有効化 | B | 3関数 × 1 |
| WAF有効化 | B | API Gatewayにアタッチ |
| Synthetics有効化 | B | カナリアスクリプト起動 |
| 負荷テスト | 全員 | 50同時接続テスト |

### 本番後: クリーンアップ

| タスク | 担当 | 詳細 |
|--------|------|------|
| Provisioned Concurrency OFF | B | コスト停止 |
| WAF OFF | B | コスト停止 |
| Synthetics OFF | B | コスト停止 |
| S3ライフサイクル確認 | B | TTLで自動削除されることを確認 |

---

## 12. CDK スタック構成（案）

```
receipt-purikura/
├── bin/
│   └── app.ts                    # CDKアプリエントリポイント
├── lib/
│   ├── storage-stack.ts          # S3 + DynamoDB + DynamoDB Streams
│   ├── api-stack.ts              # API Gateway REST + WebSocket + WAF
│   ├── pipeline-stack.ts         # Step Functions + Lambda(6関数) + Lambda Layer
│   ├── ai-stack.ts               # Rekognition + Bedrock + Comprehend + Polly + Transcribe
│   ├── realtime-stack.ts         # AppSync + IoT Core + SNS + EventBridge
│   ├── cdn-stack.ts              # CloudFront + Lambda@Edge
│   ├── monitoring-stack.ts       # CloudWatch + X-Ray + Synthetics
│   └── hosting-stack.ts          # Amplify Hosting
├── lambda/
│   ├── presigned-url/            # Presigned URL発行
│   ├── webrtc-signaling/         # WebRTCシグナリング中継
│   ├── face-detection/           # Rekognition顔検出
│   ├── filter-apply/             # Pillow / Stability AI フィルター
│   ├── collage-generate/         # コラージュ生成
│   ├── caption-generate/         # Bedrock キャプション + Comprehend感情分析
│   ├── print-prepare/            # ディザリング + QR + ESC/POSラスター変換
│   ├── yaji-comment-fast/        # Rekognition感情→テンプレートコメント
│   ├── yaji-comment-deep/        # Bedrock Haikuマルチモーダルコメント
│   └── stats-update/             # DynamoDB Streams→統計更新
├── layers/
│   └── pillow-layer/             # Pillow + qrcode + Pillow依存の共通レイヤー
└── cdk.json
```

---

## 13. 未決定事項

| # | 項目 | 説明 | 決定期限 |
|---|------|------|----------|
| 1 | CDKスタック分割粒度 | 上記は案。依存関係でスタック分割を調整する可能性あり | Day 1 |
| 2 | Lambda@Edgeのリージョン | us-east-1にデプロイが必要。CDKのクロスリージョン対応方針 | Day 1 |
| 3 | カスタムドメイン | Amplifyのデフォルトドメイン(`xxx.amplifyapp.com`)で十分か | Day 1 |
| 4 | Bedrock モデルアクセス申請 | Claude Haiku/Sonnet、Stability AI の有効化が必要 | Day 1（最優先） |
| 5 | IoT Core デバイス証明書 | MacBookのIoTデバイス登録・証明書管理方針 | Day 2 |
| 6 | GitHub Actions用IAMユーザー | CDKデプロイ用のIAMロール・ポリシー設計 | Day 1 |
