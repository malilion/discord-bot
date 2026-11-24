# Discord 交流群 + 資源自動同步 Bot

把你在 **Threads、Facebook 粉專、部落格（RSS）** 分享的文章、工具和資源，自動同步到 Discord「📰｜綜合資訊」頻道。
用 GitHub Actions 每 30 分鐘跑一次，**免費、不用租主機**。

```
Threads ─┐
FB 粉專 ─┼─▶ GitHub Actions（每 30 分）─▶ Discord Webhook ─▶ 📰｜綜合資訊
部落格 RSS┘        └─ state/seen.json 記錄已發過的貼文，不會重複發
```

---

## 一、頻道規劃

`channels.json` 裡預設的結構（可自由增刪改名）：

| 分類 | 頻道 | 類型 | 用途 |
|---|---|---|---|
| 📌 新手導覽 | 📜｜歡迎與規則 | 文字・唯讀 | 規則、導覽 |
| | 📣｜公告 | 公告・唯讀 | 活動、更新 |
| | 👋｜自我介紹 | 文字 | 新成員打招呼 |
| 📚 資源分享 | **📰｜綜合資訊** | 文字・唯讀 | **Bot 自動同步**，成員可開討論串留言 |
| | 🛠️｜工具推薦 | 論壇 | 一個工具一篇，好搜尋 |
| | 📖｜好文分享 | 論壇 | 文章、影片、Podcast |
| | 🎓｜學習資源 | 文字 | 課程、書單、模板 |
| 💬 社群交流 | 💬｜閒聊 | 文字 | |
| | ❓｜問題求助 | 論壇 | 一個問題一篇 |
| | 🚀｜作品分享 | 文字 | |
| | 💡｜建議回饋 | 文字 | |
| 🔊 語音 | ☕ 聊天室 / 📚 共工讀書室 | 語音 | |

> 「公告」和「論壇」類型需要先把伺服器開成**社群伺服器**（伺服器設定 → 啟用社群）。沒開的話腳本會自動改建成一般文字頻道。

---

## 二、建立伺服器與頻道（約 5 分鐘）

1. **建立伺服器**：Discord 左側「＋」→ 親自建立 → 給我和我的朋友。
2. （建議）**啟用社群**：伺服器設定 → 啟用社群，這樣才有公告頻道和論壇頻道。
3. **建立一個 Bot 來幫你開頻道**
   1. 到 <https://discord.com/developers/applications> → New Application
   2. 左側 **Bot** → Reset Token → 複製 Token（像密碼一樣保管）
   3. 左側 **OAuth2 → URL Generator**：Scopes 勾 `bot`，Bot Permissions 勾 `Manage Channels`、`Manage Webhooks`、`Manage Roles`
   4. 打開產生的網址，把 Bot 邀請進你的伺服器
4. **拿伺服器 ID**：使用者設定 → 進階 → 開啟「開發者模式」→ 對伺服器圖示按右鍵 →「複製伺服器 ID」
5. **執行腳本**（需要 Node.js 20 以上）：

```bash
DISCORD_BOT_TOKEN=你的BotToken DISCORD_GUILD_ID=你的伺服器ID node scripts/setup-channels.js --dry-run
```

確認列出的內容沒問題，拿掉 `--dry-run` 正式建立：

```bash
DISCORD_BOT_TOKEN=你的BotToken DISCORD_GUILD_ID=你的伺服器ID node scripts/setup-channels.js
```

腳本最後會印出「綜合資訊」頻道的 **Webhook 網址**，下一步會用到。
重複執行是安全的，已存在的頻道會略過。開完頻道後 Bot 可以踢掉，同步用的是 Webhook，不需要 Bot 在線。

> 不想用腳本？也可以手動建頻道，然後在「綜合資訊」→ 編輯頻道 → 整合 → Webhook → 新 Webhook → 複製網址。

---

## 三、取得各平台的 Token

### Threads
1. 到 <https://developers.facebook.com/apps> 建立 App，用途選 **Access the Threads API**
2. 權限需要 `threads_basic`
3. 在 App 的 Threads 設定裡把自己的帳號加為測試人員，並在 Threads App（設定 → 帳號 → 網站權限）接受邀請
4. 用 Graph API Explorer 或 User Token Generator 產生 token，再換成**長效 token**（60 天）
5. **每 50 天左右**延長一次效期：
   ```bash
   THREADS_ACCESS_TOKEN=目前的token node scripts/refresh-threads-token.js
   ```
   把印出的新 token 更新到 GitHub Secret。

### Facebook 粉專
1. 同一個 Meta App 加入 **Facebook 登入** 產品
2. 在 Graph API Explorer 選你的 App，權限勾 `pages_show_list`、`pages_read_engagement`、`pages_read_user_content`，產生使用者 token
3. 用 Access Token Debugger 延長成長效使用者 token
4. 呼叫 `GET /me/accounts`，找到你粉專的 `id`（= `FB_PAGE_ID`）和 `access_token`（= `FB_PAGE_ACCESS_TOKEN`，這個不會過期）

### 部落格 RSS
不用 token，直接把 feed 網址填到 `config.json` 的 `sources.rss.feeds`：
- WordPress：`https://你的網域/feed`
- Medium：`https://medium.com/feed/@你的帳號`
- Substack：`https://你的名稱.substack.com/feed`
- 方格子 / 其他平台：找頁面上的 RSS 圖示

用不到的來源，把 `config.json` 裡對應的 `enabled` 改成 `false`。

---

## 四、上傳到 GitHub 並啟用自動同步

1. 在 GitHub 建一個 repo（建議 **Private**），把這個資料夾推上去
2. Repo → Settings → Secrets and variables → Actions → New repository secret，新增：

   | Secret | 內容 |
   |---|---|
   | `DISCORD_WEBHOOK_URL` | 步驟二拿到的 Webhook 網址 |
   | `THREADS_ACCESS_TOKEN` | Threads 長效 token |
   | `FB_PAGE_ID` | 粉專 ID |
   | `FB_PAGE_ACCESS_TOKEN` | 粉專 token |

3. Repo → Actions → **Sync to Discord** → Run workflow，手動跑第一次
4. 之後每 30 分鐘自動檢查一次

**第一次執行**每個來源只會發最新 3 篇（`config.json` → `firstRun.postLatest`），舊文標記為已讀，不會洗版。

---

## 五、設定說明（config.json）

| 設定 | 說明 |
|---|---|
| `filter.excludeKeywords` | 貼文含這些字就不同步，預設 `#不同步`，想跳過某篇就在貼文加上這個 hashtag |
| `filter.includeKeywords` | 有填的話，只同步含這些字的貼文（例如 `["#工具", "#資源"]`） |
| `filter.requireLink` | `true` = 只同步有附連結的貼文（適合只想同步資源類） |
| `discord.username` / `avatarUrl` | 頻道裡顯示的 Bot 名稱與頭像 |
| `discord.forumChannel` | 若「綜合資訊」改成論壇頻道，設 `true`，每篇會變成一個獨立貼文，更好搜尋 |
| `discord.maxPostsPerRun` | 每次最多發幾篇，多的下次再發 |

## 本機測試

```bash
cp .env.example .env   # 填入 token
node --env-file=.env src/index.js --dry-run   # 只印出會發什麼，不真的發
npm test
```

## 常見問題

- **Threads 抓不到 / 出現 code 190**：token 過期了，重新產生或跑 refresh 腳本。
- **同一篇發兩次**：確認 Actions 的 `Save state` 步驟有成功把 `state/seen.json` 推回 repo（需要 `contents: write` 權限，已在 workflow 設好）。
- **想重來**：刪掉 `state/seen.json`，下次會視為首次執行。
- **GitHub 排程沒準時**：GitHub 的 cron 偶爾會延遲 5–15 分鐘，屬正常現象；repo 60 天沒有活動排程會被暫停，到 Actions 頁面重新啟用即可。
