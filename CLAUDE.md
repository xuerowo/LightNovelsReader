# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 專案概述
這是一個使用 React Native 和 Expo 開發的輕小說閱讀器應用程式（名稱：輕小說雲境）。應用程式從 GitHub repository 獲取輕小說內容，提供離線閱讀、背景更新通知和主題切換功能。

## 開發命令
- `npm start` - 啟動 Expo 開發伺服器
- `npm run android` - 在 Android 平台運行應用程式
- `npm run ios` - 在 iOS 平台運行應用程式  
- `npm run web` - 在網頁平台運行應用程式

## 核心架構

### 主要檔案結構
- `App.tsx` - 主應用程式組件，包含所有核心邏輯
- `components/` - React 組件目錄
  - `NovelGrid.tsx` - 小說網格展示組件
  - `NovelCard.tsx` - 單個小說卡片組件
  - `ReadingSettings.tsx` - 閱讀設定組件
  - `SearchBar.tsx` - 搜尋列組件
  - `SortSelector.tsx` - 排序選擇器組件
- `types/novelTypes.ts` - TypeScript 類型定義
- `utils/` - 工具函數目錄
  - `logger.ts` - 自定義日誌工具
  - `pathUtils.ts` - 路徑處理工具函數

### 主要功能架構
1. **資料來源**: 從 GitHub raw URL (`https://raw.githubusercontent.com/xuerowo/myacgn/main/輕小說翻譯/`) 獲取小說內容
2. **狀態管理**: 使用 React useState 和 AsyncStorage 進行本地狀態管理
3. **背景任務**: 使用 Expo Background Fetch 和 Task Manager 進行背景更新檢查
4. **通知系統**: 使用 Expo Notifications 提供新章節更新通知
5. **主題系統**: 支援亮色/暗色主題切換
6. **閱讀功能**: 支援 Markdown 格式章節內容渲染

### 關鍵技術特點
- **安全導航欄顏色**: 使用 `safeChangeNavigationBarColor` 函數安全處理導航欄顏色變更
- **路徑解析**: `pathUtils.ts` 提供統一的相對/絕對路徑處理
- **日誌系統**: 開發環境顯示詳細日誌，生產環境僅顯示錯誤和警告
- **平台適配**: 支援 Android、iOS 和 Web 三個平台

### 資料結構
- `Novel` 介面定義小說基本資訊（標題、作者、封面、描述、章節等）
- `Chapter` 介面定義章節資訊（ID、標題、URL、更新時間）
- `ChapterRecord` 用於追蹤章節更新狀態

### 構建配置
- 使用 EAS Build 進行應用程式構建
- 支援 Preview 模式生成 APK
- 配置了完整的 Android 權限（通知、喚醒鎖定等）
- 啟用了 React Native 新架構