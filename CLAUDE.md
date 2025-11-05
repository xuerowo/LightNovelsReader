# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 專案概述

這是一個基於 React Native + Expo 開發的輕小說閱讀器應用程式「輕小說雲境」，支援 iOS、Android 和 Web 平台。應用程式從 GitHub 倉庫獲取輕小說內容，提供閱讀、緩存、更新通知等功能。

## 常用指令

### 開發與執行
- `npm start` - 啟動 Expo 開發伺服器
- `npm run android` - 在 Android 設備/模擬器上執行
- `npm run ios` - 在 iOS 設備/模擬器上執行
- `npm run web` - 在瀏覽器中執行 Web 版本

### 程式碼品質
- `npm run lint` - 執行 ESLint 程式碼檢查

## 核心架構

### 主要檔案結構
- `App.tsx` (3940行) - 主應用程式檔案，包含所有核心邏輯
- `components/` - React 元件
- `utils/` - 工具函數
- `types/` - TypeScript 型別定義

### 關鍵系統設計

#### 1. 資料獲取與儲存
- 資料來源：GitHub Raw URL (`https://raw.githubusercontent.com/xuerowo/myacgn/main/輕小說翻譯/`)
- 本地儲存：使用 `@react-native-async-storage/async-storage`
- 檔案系統：使用 `expo-file-system` 進行圖片緩存

#### 2. 圖片緩存系統（ImageCacheManager）
位於 `App.tsx:52-238`，採用單例模式設計：
- 封面圖片緩存：`{FileSystem.documentDirectory}images/covers/`
- 內容圖片緩存：`{FileSystem.documentDirectory}images/content/`
- 元數據管理：使用 AsyncStorage 儲存緩存元數據
- 支援自動清理過期緩存和獲取緩存統計

#### 3. 批次寫入系統
位於 `App.tsx:625-675`：
- 使用 Map 暫存待寫入資料
- 使用防抖機制（500ms）批次寫入 AsyncStorage
- 減少 I/O 操作，提升效能

#### 4. 更新檢查與通知系統
- 背景任務：使用 `expo-background-fetch` 和 `expo-task-manager`
- 通知系統：使用 `expo-notifications`
- 差異比對：使用 `diff` 套件比對章節內容變化
- 任務名稱：`BACKGROUND_FETCH_TASK = 'background-fetch'`

#### 5. 主題系統
支援三種主題模式（Settings interface, App.tsx:553-561）：
- `light` - 亮色模式
- `dark` - 暗色模式
- `eyeComfort` - 護眼模式

#### 6. 路徑解析系統
位於 `utils/pathUtils.ts`：
- 自動處理相對路徑和絕對路徑
- 統一將相對路徑轉換為完整 GitHub Raw URL
- 提供專用的封面、章節、圖片 URL 解析函數

### 核心資料結構

#### Novel (types/novelTypes.ts)
```typescript
interface Novel {
  title: string;
  author: string;
  cover: string;  // 可為相對或絕對路徑
  description: string;
  originalUrl: string;
  chapters: Chapter[];
  tags: string[];
  lastUpdated: string;
  totalWordCount: number;
}
```

#### Chapter (types/novelTypes.ts)
```typescript
interface Chapter {
  id: number;
  title: string;
  url: string;  // 可為相對或絕對路徑
  lastUpdated: string;
}
```

### 重要元件

- `NovelGrid` - 小說網格顯示元件
- `NovelCard` - 小說卡片元件
- `ReadingSettings` - 閱讀設定元件（字體大小、行高、內容寬度）
- `CustomScrollView` - 自訂捲動視圖
- `SearchBar` - 搜尋列元件
- `SortSelector` - 排序選擇器元件

### 日誌系統
使用自訂 logger (`utils/logger.ts`)：
- 開發環境：顯示所有日誌
- 生產環境：只顯示錯誤和警告
- Babel 配置會在生產環境中自動移除 console.log（保留 error 和 warn）

## 開發注意事項

### React Native New Architecture
- 專案已啟用 New Architecture (`newArchEnabled: true` in app.json)

### 平台特定功能
- 通知功能在 Expo Go 中支援有限，建議使用開發構建版本測試
- 背景任務在 Expo Go 中功能受限

### AsyncStorage 鍵值規範
- `novels` - 小說列表資料
- `settings` - 應用程式設定
- `chapter_{novelTitle}_{chapterIndex}` - 章節內容
- `image_cache_metadata` - 圖片緩存元數據
- `read_chapters_{novelTitle}` - 已讀章節記錄
- `last_updates` - 最後更新資訊

### 程式碼修改時的注意事項
- App.tsx 是單一大檔案（3940行），修改前務必確認上下文和相依性
- 圖片 URL 處理必須使用 `pathUtils` 中的函數，不要手動拼接
- 新增 AsyncStorage 操作時優先使用批次寫入系統（scheduleBatchWrite）
- 所有日誌輸出使用 logger 而非 console
- 修改快取相關程式碼時注意 ImageCacheManager 的單例模式
