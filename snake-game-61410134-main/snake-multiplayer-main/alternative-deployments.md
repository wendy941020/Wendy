# 免費部署選項 - 替代 Google Cloud Run

## 🚀 推薦選項：Railway

Railway 提供免費額度，非常適合 Node.js + Socket.IO 應用。

### 步驟：

1. **註冊 Railway**：https://railway.app
2. **連接 GitHub**：建立新專案並連接你的 GitHub repo
3. **自動部署**：Railway 會自動建置並部署
4. **獲得 URL**：部署完成後會給你一個 `.up.railway.app` 的連結

### 設定檔案 (如果需要)

Railway 通常會自動偵測 Node.js 專案，但你可以加一個 `railway.json`：

```json
{
  "build": {
    "builder": "NIXPACKS"
  },
  "deploy": {
    "startCommand": "npm start"
  }
}
```

---

## 🛠️ 其他免費選項

### Vercel (不推薦 - 不支援 WebSocket)
- 適合靜態網站，不適合即時遊戲

### Heroku (免費額度有限)
```bash
heroku create your-app-name
git push heroku main
```

### Render
- 免費層級支援 Node.js
- 支援 WebSocket

---

## 📋 如果堅持用 Google Cloud

如果你一定要用 Google Cloud，可以：

1. 在你的本地機器安裝 gcloud
2. 執行 `deploy.bat`
3. 獲得 Cloud Run URL

Railway 是最簡單的選擇，建議先試試看！