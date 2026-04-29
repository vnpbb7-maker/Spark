# SPARK — AI Growth Engine

> あなたのプロダクトに、最初の火をつける。

URLを入れるだけ。AIがターゲットを発見し、
コメントで自動接触し、最初の100人のβユーザーを獲得する。

## What is SPARK?

スタートアップや個人開発者の「0→1ユーザー獲得問題」を
AIで完全自動化するSaaSプラットフォーム。

## How it works

1. **プロダクト分析** — URLか説明文を入力。AIが本質的価値・ペルソナを自動抽出
2. **ターゲット発見** — X・Reddit・LinkedIn・TikTok・Instagram・Facebookをリアルタイムスキャン
3. **コメント生成** — 相手の文脈に合わせた自然なコメントをAIが生成
4. **承認 & 自動投稿** — 半自動モードで確認後投稿。慣れたら全自動に切り替え
5. **返信検知 & 学習** — 何が刺さったかをリアルタイム分析・改善
6. **100人獲得** — βユーザー確保からオンボーディングまで全自動

## Supported Platforms

- X (Twitter)
- Reddit
- LinkedIn
- TikTok
- Instagram
- Facebook

## Tech Stack

- **Frontend**: Next.js 14 (App Router) + TypeScript
- **Styling**: Tailwind CSS
- **Backend**: Next.js API Routes
- **DB**: Supabase (PostgreSQL + Auth + Realtime)
- **AI**: Anthropic Claude API (claude-sonnet-4-20250514)
- **Search**: Tavily API
- **Browser Automation**: Playwright
- **Queue**: Inngest
- **Deploy**: Vercel

## Getting Started

```bash
# リポジトリをクローン
git clone https://github.com/vnpbb7-maker/Spark.git
cd Spark

# 依存関係をインストール
npm install

# 環境変数を設定
cp .env.example .env.local
# .env.localを編集してAPIキーを入力

# 開発サーバーを起動
npm run dev
```

## Environment Variables

```env
ANTHROPIC_API_KEY=
TAVILY_API_KEY=
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
TWITTER_BEARER_TOKEN=
REDDIT_CLIENT_ID=
REDDIT_CLIENT_SECRET=
LINKEDIN_CLIENT_ID=
LINKEDIN_CLIENT_SECRET=
TIKTOK_CLIENT_KEY=
TIKTOK_CLIENT_SECRET=
INSTAGRAM_ACCESS_TOKEN=
FACEBOOK_ACCESS_TOKEN=
INNGEST_EVENT_KEY=
INNGEST_SIGNING_KEY=
```

## Pricing

| Plan | Price | Features |
|------|-------|----------|
| Starter | $99/月 | ターゲット発見・コメント生成・手動投稿・月50ターゲット |
| Growth | $299/月 | 自動コメント投稿・全6プラットフォーム・月200ターゲット |
| Agency | $999/月 | 無制限・ホワイトラベル・複数クライアント管理 |

## Roadmap

- [x] ランディングページ
- [ ] Supabase認証
- [ ] キャンペーン作成ウィザード
- [ ] ダッシュボード
- [ ] Playwright自動コメント投稿
- [ ] 返信監視
- [ ] Stripe課金

## License

Apache-2.0

---

Built with ❤️ by [SKILLIVE](https://skillive.com)
