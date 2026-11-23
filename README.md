# Live Translate — Gemini 即時字幕

在瀏覽器裡把**現場說話（麥克風）**或**另一個分頁的聲音（線上會議、影片）**即時翻譯成字幕。使用 Google Gemini Live API，每位使用者用**自己的 Gemini API 金鑰**，不需要任何後端伺服器。

> 目前使用的模型：`gemini-3.5-live-translate-preview`（Google 的預覽版模型，名稱與行為之後可能會變動）。

## 功能

- **兩種音訊來源**：麥克風，或擷取瀏覽器分頁的聲音
- **自動偵測原文語言**，翻譯成 35 種目標語言（預設繁體中文）
- **顯示模式**：原文 + 譯文／僅譯文／僅原文
- **長時間不中斷**：在背景定期換新連線（熱切換），避開 Live API 單次連線的時間上限
- **沉浸模式**：全黑背景大字幕，可切換全螢幕（按 Esc 離開）
- **浮動字幕**：把字幕變成永遠在最上層的小視窗，邊看其他畫面邊看字幕
- **下載逐字稿**：把整場的原文與譯文存成 `.txt`
- 可調整字幕大小、行數（1–3 行）、配色、置中對齊；設定會記在瀏覽器裡

## 使用方式

1. 在本機啟動：`npm install && npm run dev`，用 Chrome 或 Edge 打開 `http://localhost:5173`（或開已部署好的網址，見下方「部署」）
2. 到 [Google AI Studio](https://aistudio.google.com/apikey) 建立一組 Gemini API 金鑰（通常以 `AIza` 開頭），貼進網頁上的輸入框
3. 選擇音訊來源與目標語言
4. 按「開始擷取並翻譯」

**擷取分頁時**：瀏覽器跳出分享視窗後，務必勾選「分享分頁音訊 / Share tab audio」，否則抓不到聲音。macOS 上的 Chrome 只能抓單一分頁的聲音，無法抓整台電腦的聲音。

## 隱私與金鑰

- 金鑰只存在使用者自己瀏覽器的 `localStorage`，由瀏覽器**直接**連到 Google（`generativelanguage.googleapis.com`），沒有經過任何中間伺服器
- 音訊同樣直接傳給 Google 處理，本專案不會儲存或轉傳
- 因為金鑰存在瀏覽器裡，建議在共用電腦上用完後清掉；也建議另外申請一組專門給這個工具用的金鑰

## 瀏覽器需求

- **建議使用桌機版 Chrome 或 Edge**（本專案以這兩個瀏覽器為目標，其他瀏覽器未保證可用）
- 必須透過 `https://` 或 `http://localhost` 開啟，瀏覽器才允許使用麥克風與分頁擷取
- 「浮動字幕」需要 Chrome／Edge 116 以上（使用 Document Picture-in-Picture API）

## 開發

需求：Node.js `^20.19.0` 或 `>=22.12.0`

```bash
npm install
npm run dev       # 本機開發伺服器（http://localhost:5173）
npm run build     # 型別檢查 + 打包到 dist/
npm run preview   # 預覽打包結果
npm run lint      # oxlint
npm test          # vitest 單元測試
```

技術：React 19、TypeScript、Vite、Tailwind CSS v4。

### 部署

`npm run build` 產出的 `dist/` 是純靜態檔案，丟到任何靜態主機（nginx、GitHub Pages、Cloudflare Pages…）即可。Vite 設定了相對路徑（`base: './'`），所以放在子路徑（例如 `https://example.com/live/`）也能直接運作，不需要額外的 rewrite 規則。記得要用 HTTPS。

### 專案結構

```
src/
├── core.ts                  # 非 React 邏輯：音訊擷取、Gemini Live 連線與熱切換、逐字稿下載
├── segment.ts               # 把連續的翻譯文字切成一句一句的字幕行（含測試 segment.test.ts）
├── App.tsx                  # 主畫面
├── components/              # 字幕顯示、狀態燈、表單元件、圖示
└── hooks/                   # useTranslator（串起擷取 + 連線 + 分段）、localStorage、浮動字幕
test-disconnect.ts           # 手動長時間連線測試（需真實金鑰與 ffmpeg，說明見檔案開頭）
```

## 授權

[MIT](LICENSE)
