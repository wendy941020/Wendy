@echo off
echo 開始部署 Snake Multiplayer 到 Google Cloud Run...
echo.

echo 步驟 1: 檢查 gcloud 是否安裝
gcloud version
if %errorlevel% neq 0 (
    echo 錯誤: gcloud 未安裝。請先安裝 Google Cloud SDK。
    echo 下載: https://cloud.google.com/sdk/docs/install
    pause
    exit /b 1
)

echo.
echo 步驟 2: 登入 Google Cloud
gcloud auth login

echo.
echo 步驟 3: 設定專案 ID
set /p PROJECT_ID="輸入你的 Google Cloud 專案 ID: "
gcloud config set project %PROJECT_ID%

echo.
echo 步驟 4: 啟用必要服務
gcloud services enable run.googleapis.com
gcloud services enable cloudbuild.googleapis.com

echo.
echo 步驟 5: 建置並推送 Docker 映像
gcloud builds submit --tag gcr.io/%PROJECT_ID%/snake-multiplayer

echo.
echo 步驟 6: 部署到 Cloud Run
set /p SESSION_SECRET="輸入 SESSION_SECRET (隨機字串): "
gcloud run deploy snake-multiplayer ^
  --image gcr.io/%PROJECT_ID%/snake-multiplayer ^
  --platform managed ^
  --region asia-east1 ^
  --allow-unauthenticated ^
  --set-env-vars SESSION_SECRET=%SESSION_SECRET%

echo.
echo 部署完成！請記下上面的服務 URL。
echo 你可以分享這個 URL 給其他人玩遊戲。
pause