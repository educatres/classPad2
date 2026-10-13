# ClassPad2 即時同步手寫白板

線上使用：[ClassPad2](https://educatres.github.io/classPad2/)。原始碼：[educatres/classPad2](https://github.com/educatres/classPad2)。

我一直很喜歡使用 Google Jamboard 進行教學，因為它能讓學生在課堂中即時書寫、分享想法並彼此互動。可惜 Jamboard 服務結束後，我始終找不到完全符合需求的替代工具。市面上雖然已有不少功能完整的訂閱平台，但我通常只會在每學期的特定幾週密集使用，若為了短期的教學需求而長期訂閱，不太符合我的使用情境。

此外，我也不希望教學工具蒐集學生的個人資料，或要求學生另外註冊帳號。由於每次授課的班級與學生可能不同，若只是為了一堂課，就要求學生申請新的服務帳號，不僅增加學生的負擔，也會占用寶貴的上課時間。因此，我用 AI 協助開發了這套即時互動白板，並開放原始碼，供有需要的老師免費使用。

考量到並非每位老師都熟悉程式設定與系統部署，老師自行下載原始碼、建置環境及架設服務，仍有一定的使用門檻，因此本平台也提供可直接開啟使用的線上版本。由於伺服器資源有限，每次建立的課程白板可使用三小時，時間到期後，系統將自動清除課程資料；建立課程的次數則不受限制。老師可以在每節課開始前建立新的白板，課程結束後下載所有學生的白板資料，再自行刪除課程，或等待系統自動清除。

每位老師建立的課程皆為彼此獨立的空間，無法查看其他老師或其他課程的內容，在提供便利課堂互動的同時，也盡可能兼顧學生隱私與教學資料安全。

在開發過程中，我也依照自己的教學需求，加入了五項功能：

1. 「QR Code 快速進入」：本工具針對「生生用平板」的課堂情境設計。老師建立學生名單後，會為每位學生產生專屬 QR Code；學生只要使用平板掃描，即可進入自己的個人白板，無須註冊或登入。系統亦加入裝置綁定機制，可避免學生誤入或使用其他同學的白板空間，兼顧學生作品的獨立性。
2. 「全班即時監看與批注」：老師可以透過多格畫面，同時查看全班學生的即時手寫內容，不必逐一走到學生座位旁確認進度。當發現學生需要協助時，老師也能直接在該名學生的白板上遠端進行批注、圈選或提示，學生可立即看到老師的回饋，適合應用於課堂練習、分組活動及個別指導。
3. 「共用底圖」：當老師希望進行解題、填空、標示或課堂小考時，可以透過 Google Drive 分享題目圖片，並將圖片同步顯示在每位學生的白板上。學生可直接在題目底圖上書寫、作答或繪製標記，省去逐一發放紙本或請學生自行下載檔案的步驟。
4. 「學生作品即時投影」：課堂中經常需要讓全班觀摩某位學生的解題方式或優秀作品，因此平台提供指定學生畫面的投影功能。老師可以在監看畫面中選擇特定學生，將其白板即時顯示在教室投影機或電子白板上；學生的書寫內容與老師的批注也會同步更新。實際上課時，建議老師可另外準備一台平板作為控制與監看裝置，在觀察全班書寫狀況的同時，隨時選擇適合的學生作品進行全班討論與示範。
5. 「打包下載」：課程結束後，老師可以將全班學生的白板畫面一次打包下載為圖檔。

## 功能

- Firebase Anonymous Authentication 與 Realtime Database 即時同步
- 老師建立課堂、批次匯入最多 80 位學生、QR Code 與 CSV 連結
- 學生首次開啟連結後綁定匿名裝置，可由老師解除
- 學生只需開啟個人專屬網址即可綁定，不使用老師六位數密鑰
- 三層 Retina Canvas、Pointer Events、Apple Pencil 壓力、整筆橡皮擦
- 本機復原/重做、雙指 25%～400% 縮放與拖曳，學生與老師批注工具列提供每次 10% 的放大／縮小按鈕
- 4:3 固定白板比例，4／6／8／12 格即時監看、釘選優先排序、搜尋/篩選/輪播、全螢幕批注
- 永久老師連結與未遮蔽六位數密鑰，密鑰正確即可登入，不限老師連線數量
- 老師鎖定、清除圖層、本機合成下載 PNG
- 拒絕預設存取的 Firebase Security Rules 與 Emulator 權限測試

## 本機開發

需求：Node.js 22、pnpm 11、Java（只在執行 Firebase Emulator 時需要）。

```bash
cp .env.example .env
pnpm install
pnpm dev
```

在 `.env` 填入 Firebase Web App 設定。只有明確啟動 Emulator 時，才把 `VITE_USE_FIREBASE_EMULATORS` 設為 `true`。

## 驗證

```bash
pnpm test
pnpm test:rules
pnpm build
```

`test:rules` 會啟動 Authentication 與 Realtime Database Emulator，驗證老師、學生、其他匿名使用者和未登入使用者的允許/拒絕案例。

## Firebase 設定

1. Authentication → Sign-in method：啟用 Anonymous。
2. 建立 Realtime Database，區域建議 `asia-southeast1`，不要使用公開測試規則。
3. 安裝並登入 Firebase CLI，再部署規則：

   ```bash
   pnpm exec firebase login
   pnpm exec firebase use classpad2
   pnpm exec firebase deploy --only database
   ```

4. Authentication → Settings → Authorized domains 加入：
   - `educatres.github.io`
   - `localhost`
   - `127.0.0.1`

5. 權限資料會在首次使用後依規則建立於 `classes`、`students`、`boards`、`activeStrokes`、`presence`、`userClasses`、`teacherKeys`、`teacherKeyClaims` 與 `boardLookup` 節點，不需手動建立空資料表。課程建立滿 3 小時後，會在老師下次使用首頁、管理頁或監看頁時自動清除。

## GitHub Pages

Repository → Settings → Pages 的 Source 設為 **GitHub Actions**。GitHub Actions 建置使用 `/classPad2/` 路徑，本機開發使用 `/`。

推送 `main` 後，`.github/workflows/deploy-pages.yml` 會測試、建置並部署 `dist`。Repository 的 Actions Secrets 需要：

- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_DATABASE_URL`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_APP_ID`

Firebase Web API key 會包含在公開前端 bundle；資料授權完全由 Authentication 與 `database.rules.json` 強制執行。禁止提交 Service Account、Admin SDK 私鑰或 `.env`。

## 權限與隱私

Firebase 匿名驗證明確使用瀏覽器本機持久化，建立課堂後也會暫存該課堂與老師 UID，跳轉管理頁時會先恢復同一身分再讀取權限。每個課堂另有永久老師連結與未遮蔽的六位數字密鑰；新瀏覽器輸入正確密鑰後會加入課堂管理員，並與其他老師享有相同完整權限，不限連線數量。請妥善保管老師連結與密鑰，只應輸入學生座號或暱稱，不應輸入身分證字號、電話、Email、住址或醫療資料。

完整需求請見 [SPEC.md](./SPEC.md) 與 [即時同步手寫白板規格書.md](./即時同步手寫白板規格書.md)。

## 授權

整個專案採用 [Creative Commons 姓名標示－非商業性－相同方式分享 4.0 國際授權條款（CC BY-NC-SA 4.0）](https://creativecommons.org/licenses/by-nc-sa/4.0/deed.zh-hant) 授權。
