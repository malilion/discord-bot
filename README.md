# 碼力獅 Discord 同步 Bot

把碼力獅在各平台的內容自動整理進 Discord「碼力獅｜AI x 開源交流群」。
用 GitHub Actions 每 30 分鐘跑一次，**免費、不用租主機**。

```
Threads 貼文＋留言 ─▶ 📰｜綜合資訊（論壇，自動分類標籤，留言放進貼文）
部落格 RSS        ─▶ 📝｜部落格文章（論壇，自動分類標籤）
Malilion AI Radar ─▶ 📡｜科技雷達（新聞／官方動態／開源工具／版本更新／活動，每類每天一篇）
                  └▶ 🎓｜學習資源（論文／教學實作／研究與深度文章，每類每天一篇）
                       └─ state/seen.json 記錄已發過的內容，不會重複發
```

邀請連結（永不過期）：<https://discord.gg/Tnqxen3wAV>

---

## 會同步什麼

| 來源 | 目的地 | 規則 |
|---|---|---|
| Threads（自己的貼文） | 📰｜綜合資訊 | 每篇一個論壇貼文，帶「🧵 Threads」＋關鍵字分類標籤；留言依時間搬進該貼文，最近 14 天的貼文會持續補新留言 |
| 部落格 `https://www.malilion.com/rss.xml` | 📝｜部落格文章 | 每篇一個論壇貼文，帶關鍵字分類標籤 |
| [Malilion AI Radar](https://malilion.github.io/Malilion-AI-Radar/) | 📡｜科技雷達 | 台北 09:00 後每類一篇：📰 AI 新聞、🏢 官方動態、🛠️ 開源工具、🚀 版本更新、📅 社群活動 |
| Malilion AI Radar（學習類） | 🎓｜學習資源 | 📄 熱門論文、📘 教學實作（Simon Willison、DEV 等）、🧠 研究與深度文章（各大研究部落格、Latent Space 等） |
| Facebook 粉專 | 📰｜綜合資訊 | 程式已支援，填入 token 才會啟用 |

分類標籤靠關鍵字判斷（`config.json` → `discord.tags.rules`），沒命中任何分類會標「💡 觀點心得」。想調整分類，改關鍵字即可。

想跳過某篇貼文：在內文加上 `#不同步`。

---

## GitHub Secrets

Repo → Settings → Secrets and variables → Actions：

| Secret | 用途 |
|---|---|
| `DISCORD_WEBHOOK_URL` | 📰｜綜合資訊 的 Webhook |
| `DISCORD_BLOG_WEBHOOK_URL` | 📝｜部落格文章 的 Webhook |
| `DISCORD_RADAR_WEBHOOK_URL` | 📡｜科技雷達 的 Webhook |
| `DISCORD_LEARN_WEBHOOK_URL` | 🎓｜學習資源 的 Webhook |
| `THREADS_ACCESS_TOKEN` | Threads 長效 token（需要 `threads_basic`、`threads_read_replies`） |
| `FB_PAGE_ID`、`FB_PAGE_ACCESS_TOKEN` | （選用）Facebook 粉專 |

某個來源的 secret 沒設定時，那個來源會自動略過，不會發錯地方。

### 存 Webhook 網址的安全做法

> Discord 內嵌在 Claude 桌面 App 裡的瀏覽器無法複製到電腦剪貼簿，請用一般瀏覽器或 Discord App。

頻道設定 → 整合 → Webhook →「複製 Webhook 網址」，然後執行（會先確認剪貼簿真的是 Webhook 網址才存）：

```bash
pbpaste | grep -qE '^https://(ptb\.|canary\.)?discord(app)?\.com/api/webhooks/' && pbpaste | gh secret set DISCORD_WEBHOOK_URL -R malilion/discord-bot || echo "剪貼簿不是 Webhook 網址"
```

把 `DISCORD_WEBHOOK_URL` 換成要設定的 secret 名稱即可。

---

## 定期維護

- **Threads token 每 60 天到期**（目前這把約 2027-01-23 到期）。到期前執行：
  ```bash
  THREADS_ACCESS_TOKEN=目前的token node scripts/refresh-threads-token.js
  ```
  把印出的新 token 用 `pbpaste | gh secret set THREADS_ACCESS_TOKEN -R malilion/discord-bot` 存回去。
  過期時 Actions 會出現 Threads `HTTP 400 / code 190` 錯誤。
- GitHub 會暫停 60 天沒有活動的 repo 排程；有新內容時 bot 會 commit `state/seen.json`，通常不會遇到。若被暫停，到 Actions 頁面重新啟用即可。

---

## 設定說明（config.json）

| 設定 | 說明 |
|---|---|
| `sources.<來源>.enabled` | 開關來源 |
| `sources.<來源>.webhookEnv` | 這個來源改發到哪個 Webhook secret（部落格用 `DISCORD_BLOG_WEBHOOK_URL`） |
| `sources.<來源>.tags` | 這個來源專用的論壇標籤（不同論壇的標籤 ID 不同） |
| `sources.<來源>.firstRunPostLatest` | 第一次執行要發幾篇，`"all"` 代表搬全部舊文（由舊到新分批發） |
| `sources.threads.replies` | 留言同步：`followDays` 追蹤幾天內的貼文、`maxPerRun` 每次最多搬幾則 |
| `discord.tags` | 📰｜綜合資訊 的來源標籤、分類關鍵字與預設標籤 |
| `discord.maxPostsPerRun` | 每次最多發幾篇，多的下次再發 |
| `radar.postAfterHour` | 雷達貼文在台北時間幾點後發 |
| `radar.targets` | 科技雷達／學習資源各用哪個 Webhook secret |
| `radar.tags` | 每個類別貼文要套的論壇標籤 ID |
| `filter.excludeKeywords` | 含這些字就不同步（預設 `#不同步`） |

## 手動操作

- **立刻同步**：Actions →「Sync to Discord」→ Run workflow（一次最多 25 篇）
- **重發今天的雷達貼文**：把 `state/seen.json` 裡 `radar.posted` 的該類別刪掉後推上去，再手動跑一次（發過的連結記在 `radar.seen`，不會重複）
- **重新搬某個來源**：把 `state/seen.json` 裡該來源整段刪掉再推上去

## 本機測試

```bash
npm test                          # 單元測試＋端對端模擬（不會真的發文）
node src/index.js --dry-run       # 只印出會發什麼，不改 state
```

## 頻道結構

`channels.json` 記錄目前的頻道結構（可用 `scripts/setup-channels.js` 在新伺服器重建）：

- ———重要資訊———：📜 歡迎與規則（唯讀）、📣 公告（唯讀）、👋 自我介紹
- ———資源分享———：🛠️ 工具推薦、📖 好文分享、📰 綜合資訊、📝 部落格文章、🎓 學習資源、📡 科技雷達
- ———社群交流——— 另有 💬 學習討論（聊學習資源）
- ———社群交流———：❓ 問題求助、💬 閒聊、🚀 作品分享、💡 建議回饋、🎮 遊戲分享
- ———語音頻道———：☕ 聊天室、📚 共工讀書室
- ———Cat Island———：🐱 cat-island

自動同步的四個論壇只有 Bot 能開貼文，成員可以在貼文裡留言。
