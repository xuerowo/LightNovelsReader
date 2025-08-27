import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  ScrollView,
  Text,
  View,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  useColorScheme as _useColorScheme,
  StatusBar,
  BackHandler,
  Alert,
  Animated as RNAnimated,
  Platform,
  UIManager,
  TextStyle,
  Image,
  Dimensions,
  AppState,
  Linking,
  RefreshControl,
  Modal,
  Pressable,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Image as ExpoImage } from 'expo-image';
import * as FileSystem from 'expo-file-system';
import NovelGrid from './components/NovelGrid';
import CustomScrollView from './components/CustomScrollView';
import * as Notifications from 'expo-notifications';
import * as ExpoBackgroundFetch from 'expo-background-fetch';
import * as TaskManager from 'expo-task-manager';
import * as Application from 'expo-application';
import Constants from 'expo-constants';
import * as SystemUI from 'expo-system-ui';
import debounce from 'lodash.debounce';
import { MaterialIcons } from '@expo/vector-icons';
import Markdown from 'react-native-markdown-display';
import ReadingSettings, { 
  DEFAULT_FONT_SIZE, 
  DEFAULT_LINE_HEIGHT 
} from './components/ReadingSettings';
import SearchBar from './components/SearchBar';
import SortSelector, { SortOption } from './components/SortSelector';
import { Novel, Chapter } from './types/novelTypes';
import * as diff from 'diff';
import logger from './utils/logger';
import { resolveChapterUrl, resolveImageUrl, resolveCoverUrl } from './utils/pathUtils';

// 圖片緩存管理類
class ImageCacheManager {
  private static instance: ImageCacheManager;
  private cacheDir: string;
  private metadataKey = 'image_cache_metadata';

  private constructor() {
    this.cacheDir = `${FileSystem.documentDirectory}images/`;
  }

  static getInstance(): ImageCacheManager {
    if (!ImageCacheManager.instance) {
      ImageCacheManager.instance = new ImageCacheManager();
    }
    return ImageCacheManager.instance;
  }

  // 確保緩存目錄存在
  private async ensureCacheDir(): Promise<void> {
    try {
      const dirInfo = await FileSystem.getInfoAsync(this.cacheDir);
      if (!dirInfo.exists) {
        await FileSystem.makeDirectoryAsync(this.cacheDir, { intermediates: true });
      }
    } catch (error) {
      logger.error('創建緩存目錄失敗:', error);
    }
  }

  // 生成緩存文件路徑
  private getCacheFilePath(type: 'cover' | 'content', novelTitle: string, imageName: string = ''): string {
    const sanitizedTitle = novelTitle.replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, '_');
    const sanitizedImageName = imageName.replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, '_');
    
    if (type === 'cover') {
      return `${this.cacheDir}covers/${sanitizedTitle}_cover.jpg`;
    } else {
      return `${this.cacheDir}content/${sanitizedTitle}_${sanitizedImageName}.jpg`;
    }
  }

  // 獲取緩存元數據
  private async getCacheMetadata(): Promise<Record<string, { path: string; timestamp: number; url: string }>> {
    try {
      const data = await AsyncStorage.getItem(this.metadataKey);
      return data ? JSON.parse(data) : {};
    } catch (error) {
      logger.error('讀取緩存元數據失敗:', error);
      return {};
    }
  }

  // 保存緩存元數據
  private async saveCacheMetadata(metadata: Record<string, { path: string; timestamp: number; url: string }>): Promise<void> {
    try {
      await AsyncStorage.setItem(this.metadataKey, JSON.stringify(metadata));
    } catch (error) {
      logger.error('保存緩存元數據失敗:', error);
    }
  }

  // 下載並緩存圖片
  async cacheImage(imageUrl: string, type: 'cover' | 'content', novelTitle: string, imageName: string = ''): Promise<string | null> {
    try {
      await this.ensureCacheDir();
      
      const filePath = this.getCacheFilePath(type, novelTitle, imageName);
      const dirPath = filePath.substring(0, filePath.lastIndexOf('/'));
      
      // 確保子目錄存在
      const dirInfo = await FileSystem.getInfoAsync(dirPath);
      if (!dirInfo.exists) {
        await FileSystem.makeDirectoryAsync(dirPath, { intermediates: true });
      }

      // 下載圖片
      const downloadResult = await FileSystem.downloadAsync(imageUrl, filePath);
      
      if (downloadResult.status === 200) {
        // 更新元數據
        const metadata = await this.getCacheMetadata();
        const cacheKey = `${type}_${novelTitle}_${imageName}`;
        metadata[cacheKey] = {
          path: filePath,
          timestamp: Date.now(),
          url: imageUrl
        };
        await this.saveCacheMetadata(metadata);
        
        return filePath;
      }
      
      return null;
    } catch (error) {
      logger.error('緩存圖片失敗:', error);
      return null;
    }
  }

  // 獲取緩存的圖片路徑
  async getCachedImagePath(type: 'cover' | 'content', novelTitle: string, imageName: string = ''): Promise<string | null> {
    try {
      const metadata = await this.getCacheMetadata();
      const cacheKey = `${type}_${novelTitle}_${imageName}`;
      const cacheInfo = metadata[cacheKey];
      
      if (cacheInfo && cacheInfo.path) {
        // 檢查文件是否還存在
        const fileInfo = await FileSystem.getInfoAsync(cacheInfo.path);
        if (fileInfo.exists) {
          return cacheInfo.path;
        } else {
          // 文件不存在，清理元數據
          delete metadata[cacheKey];
          await this.saveCacheMetadata(metadata);
        }
      }
      
      return null;
    } catch (error) {
      logger.error('獲取緩存圖片路徑失敗:', error);
      return null;
    }
  }

  // 清理指定小說的所有緩存
  async clearNovelCache(novelTitle: string): Promise<number> {
    try {
      const metadata = await this.getCacheMetadata();
      let deletedCount = 0;
      
      const keysToDelete = Object.keys(metadata).filter(key => 
        key.includes(novelTitle)
      );
      
      for (const key of keysToDelete) {
        const cacheInfo = metadata[key];
        if (cacheInfo && cacheInfo.path) {
          try {
            await FileSystem.deleteAsync(cacheInfo.path);
            delete metadata[key];
            deletedCount++;
          } catch (error) {
            logger.warn('刪除緩存文件失敗:', error);
          }
        }
      }
      
      if (deletedCount > 0) {
        await this.saveCacheMetadata(metadata);
      }
      
      return deletedCount;
    } catch (error) {
      logger.error('清理小說緩存失敗:', error);
      return 0;
    }
  }

  // 獲取緩存統計信息
  async getCacheStats(): Promise<{ totalFiles: number; totalSize: number }> {
    try {
      const metadata = await this.getCacheMetadata();
      let totalFiles = 0;
      let totalSize = 0;
      
      for (const cacheInfo of Object.values(metadata)) {
        if (cacheInfo.path) {
          try {
            const fileInfo = await FileSystem.getInfoAsync(cacheInfo.path);
            if (fileInfo.exists) {
              totalFiles++;
              totalSize += fileInfo.size || 0;
            }
          } catch (error) {
            // 忽略單個文件的錯誤
          }
        }
      }
      
      return { totalFiles, totalSize };
    } catch (error) {
      logger.error('獲取緩存統計失敗:', error);
      return { totalFiles: 0, totalSize: 0 };
    }
  }
}

// 圖片緩存管理函數（保持向後兼容）
const getImageCacheKey = (type: 'cover' | 'content', novelTitle: string, imageName: string = '') => {
  return type === 'cover' 
    ? `image_cover_${novelTitle}` 
    : `image_content_${novelTitle}_${imageName}`;
};

const clearImageCache = async (novelTitle: string): Promise<number> => {
  try {
    // 優先使用新的 ImageCacheManager
    if (global.imageCacheManager) {
      const deletedCount = await global.imageCacheManager.clearNovelCache(novelTitle);
      return deletedCount;
    }
    
    // 向後兼容：清理舊的 AsyncStorage 緩存
    const keys = await AsyncStorage.getAllKeys();
    const imageCacheKeys = keys.filter(key => 
      key.startsWith(`image_cover_${novelTitle}`) || 
      key.startsWith(`image_content_${novelTitle}`)
    );
    
    if (imageCacheKeys.length > 0) {
      await AsyncStorage.multiRemove(imageCacheKeys);
    }
    
    return imageCacheKeys.length;
  } catch (error) {
    logger.error('清除圖片緩存失敗:', error);
    return 0;
  }
};

const getImageCacheSize = async (novelTitle?: string): Promise<number> => {
  try {
    // 優先使用新的 ImageCacheManager
    if (global.imageCacheManager) {
      const stats = await global.imageCacheManager.getCacheStats();
      return stats.totalFiles;
    }
    
    // 向後兼容：檢查舊的 AsyncStorage 緩存
    const keys = await AsyncStorage.getAllKeys();
    const imageCacheKeys = novelTitle 
      ? keys.filter(key => key.startsWith(`image_cover_${novelTitle}`) || key.startsWith(`image_content_${novelTitle}`))
      : keys.filter(key => key.startsWith('image_'));
    
    return imageCacheKeys.length;
  } catch (error) {
    logger.error('獲取圖片緩存大小失敗:', error);
    return 0;
  }
};
import { 
  PinchGestureHandler, 
  PanGestureHandler, 
  State, 
  GestureHandlerRootView, 
  gestureHandlerRootHOC,
  TapGestureHandler
} from 'react-native-gesture-handler';

// 修復焦點縮放的雙指縮放和單指平移燈箱組件
const LightboxImageViewer: React.FC<{ imageUri: string }> = ({ imageUri }) => {
  const screenWidth = Dimensions.get('window').width;
  const screenHeight = Dimensions.get('window').height;
  const imageWidth = screenWidth * 0.9;
  const imageHeight = screenHeight * 0.9;
  
  // 狀態管理 - 分離基礎狀態和手勢狀態
  const baseScale = useRef(new RNAnimated.Value(1)).current;
  const gestureScale = useRef(new RNAnimated.Value(1)).current;
  const translateX = useRef(new RNAnimated.Value(0)).current;
  const translateY = useRef(new RNAnimated.Value(0)).current;
  const panX = useRef(new RNAnimated.Value(0)).current;
  const panY = useRef(new RNAnimated.Value(0)).current;
  
  // 狀態追蹤變數
  const lastScale = useRef(1);
  const lastTranslateX = useRef(0);
  const lastTranslateY = useRef(0);
  
  // 圖片在螢幕上的中心位置
  const imageCenterX = screenWidth / 2;
  const imageCenterY = screenHeight / 2;
  
  // 邊界計算
  const clampTranslate = (x: number, y: number, currentScale: number) => {
    const scaledWidth = imageWidth * currentScale;
    const scaledHeight = imageHeight * currentScale;
    const maxX = Math.max(0, (scaledWidth - imageWidth) / 2);
    const maxY = Math.max(0, (scaledHeight - imageHeight) / 2);
    
    return {
      x: Math.max(-maxX, Math.min(maxX, x)),
      y: Math.max(-maxY, Math.min(maxY, y))
    };
  };

  // 縮放手勢事件處理 - 分離手勢縮放，避免自動綁定衝突
  const onPinchGestureEvent = RNAnimated.event(
    [], // 移除自動綁定，避免狀態衝突
    { 
      useNativeDriver: false,
      listener: (event: any) => {
        const { scale: currentGestureScale, focalX, focalY } = event.nativeEvent;
        
        // 計算觸摸點相對於圖片中心的偏移
        const focalOffsetX = focalX - imageCenterX;
        const focalOffsetY = focalY - imageCenterY;
        
        // 計算新的總縮放值
        const newTotalScale = lastScale.current * currentGestureScale;
        
        // 使用正確的變換公式：新位置 = 原位置 + 焦點偏移 * (1 - 縮放比例)
        const newTranslateX = lastTranslateX.current + focalOffsetX * (1 - currentGestureScale);
        const newTranslateY = lastTranslateY.current + focalOffsetY * (1 - currentGestureScale);
        
        // 應用邊界限制
        const clamped = clampTranslate(newTranslateX, newTranslateY, newTotalScale);
        
        // 手動更新 Animated 值
        gestureScale.setValue(currentGestureScale);
        translateX.setValue(clamped.x);
        translateY.setValue(clamped.y);
        
        console.log('Pinch gesture:', {
          currentGestureScale,
          focalX, focalY,
          focalOffsetX, focalOffsetY,
          newTotalScale,
          newTranslateX, newTranslateY,
          clampedX: clamped.x, clampedY: clamped.y
        });
      }
    }
  );

  const onPinchHandlerStateChange = (event: any) => {
    if (event.nativeEvent.oldState === State.ACTIVE) {
      // 縮放結束，合併狀態到基礎值
      const { scale: finalGestureScale, focalX, focalY } = event.nativeEvent;
      
      const newBaseScale = lastScale.current * finalGestureScale;
      const focalOffsetX = focalX - imageCenterX;
      const focalOffsetY = focalY - imageCenterY;
      const finalTranslateX = lastTranslateX.current + focalOffsetX * (1 - finalGestureScale);
      const finalTranslateY = lastTranslateY.current + focalOffsetY * (1 - finalGestureScale);
      
      const clamped = clampTranslate(finalTranslateX, finalTranslateY, newBaseScale);
      
      // 更新狀態追蹤
      lastScale.current = newBaseScale;
      lastTranslateX.current = clamped.x;
      lastTranslateY.current = clamped.y;
      
      // 將手勢狀態合併到基礎狀態，並重置手勢
      baseScale.setValue(newBaseScale);
      gestureScale.setValue(1); // 重置手勢縮放
      translateX.setValue(clamped.x);
      translateY.setValue(clamped.y);
      
      console.log('Pinch ended, final state:', {
        newBaseScale,
        finalTranslateX: clamped.x,
        finalTranslateY: clamped.y
      });
    }
  };

  // 平移手勢事件處理
  const onPanGestureEvent = RNAnimated.event(
    [{ nativeEvent: { translationX: panX, translationY: panY } }],
    { 
      useNativeDriver: false,
      listener: (event: any) => {
        console.log('Pan event:', event.nativeEvent.translationX, event.nativeEvent.translationY, 'Scale:', lastScale.current);
      }
    }
  );

  const onPanHandlerStateChange = (event: any) => {
    if (event.nativeEvent.oldState === State.ACTIVE) {
      // 平移結束，更新基礎位置
      const newTranslateX = lastTranslateX.current + event.nativeEvent.translationX;
      const newTranslateY = lastTranslateY.current + event.nativeEvent.translationY;
      
      // 應用邊界限制
      const clamped = clampTranslate(newTranslateX, newTranslateY, lastScale.current);
      lastTranslateX.current = clamped.x;
      lastTranslateY.current = clamped.y;
      
      console.log('Pan ended, new position:', clamped.x, clamped.y);
      
      // 更新基礎位置並重置平移手勢
      translateX.setValue(clamped.x);
      translateY.setValue(clamped.y);
      panX.setValue(0);
      panY.setValue(0);
    }
  };


  const pinchRef = useRef(null);
  const panRef = useRef(null);

  return (
    <View style={{ 
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center'
    }}>
      <PanGestureHandler
        ref={panRef}
        onGestureEvent={onPanGestureEvent}
        onHandlerStateChange={onPanHandlerStateChange}
        minPointers={1}
        maxPointers={1}
        simultaneousHandlers={[pinchRef]}
        enabled={true}
        shouldCancelWhenOutside={false}
      >
        <RNAnimated.View>
          <PinchGestureHandler
            ref={pinchRef}
            onGestureEvent={onPinchGestureEvent}
            onHandlerStateChange={onPinchHandlerStateChange}
            simultaneousHandlers={[panRef]}
          >
            <RNAnimated.View 
              style={{
                transform: [
                  { 
                    translateX: RNAnimated.add(translateX, panX)
                  },
                  { 
                    translateY: RNAnimated.add(translateY, panY)
                  },
                  { 
                    scale: RNAnimated.multiply(baseScale, gestureScale)
                  }
                ]
              }}
            >
              <ExpoImage
                source={{ uri: imageUri }}
                style={{
                  width: imageWidth,
                  height: imageHeight
                }}
                contentFit="contain"
                contentPosition="center"
              />
            </RNAnimated.View>
          </PinchGestureHandler>
        </RNAnimated.View>
      </PanGestureHandler>
    </View>
  );
};

// 使用 gestureHandlerRootHOC 包裝組件以支援 Android Modal 中的手勢處理
const LightboxImageViewerWithHOC = gestureHandlerRootHOC(LightboxImageViewer);

// 安全的導航欄顏色函數
const safeChangeNavigationBarColor = (color: string, isLight: boolean, animated: boolean) => {
  try {
    const navigationBarColorModule = require('react-native-navigation-bar-color');
    const changeFunc = navigationBarColorModule.default || navigationBarColorModule;
    if (typeof changeFunc === 'function') {
      return changeFunc(color, isLight, animated);
    }
  } catch (error) {
    // 在 Expo Go 或不支持的環境中會失敗，這是正常的
    if (__DEV__ && Constants.appOwnership === 'expo') {
      console.warn('📱 導航欄顏色功能在 Expo Go 中不可用，請使用 development build 或發布版本查看效果');
    }
  }
  return Promise.resolve();
};

const BACKGROUND_FETCH_TASK = 'background-fetch';
const GITHUB_RAW_URL = 'https://raw.githubusercontent.com/xuerowo/myacgn/main/輕小說翻譯/';
// 移除硬編碼的 STATUS_BAR_HEIGHT，改用 SafeAreaView 的 insets

// 檢查是否在支持的環境中再設置通知處理器
const isNotificationSupported = Constants.appOwnership !== 'expo';

if (isNotificationSupported) {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
}

interface ChapterInfo {
  name: string;
  sha: string;
  timestamp: number;
  statuses: ('new' | 'modified')[];
}

interface ChapterRecord {
  [novelName: string]: {
    [chapterName: string]: ChapterInfo;
  };
}

interface Settings {
  isDarkMode: boolean;
  lastReadChapter: Record<string, string>;
  scrollPosition: Record<string, number>;
  fontSize: number;
  lineHeight: number;
  theme: 'light' | 'dark' | 'eyeComfort';
}

interface ScrollPositions {
  [key: string]: number;
}

interface UpdateInfo {
  novelName: string;
  isNewNovel?: boolean;
  isDeletedNovel?: boolean;
  newChapters: string[];
  modifiedChapters: string[];
  deletedChapters: string[];
}

interface GitHubFile {
  name: string;
  type: 'file' | 'dir';
  sha: string;
  path: string;
}

interface DownloadProgress {
  total: number;
  current: number;
  isDownloading: boolean;
}

interface MarkdownImageProps {
  src: string;
  isDarkMode: boolean;
  backgroundColor: string;
  onImagePress?: (imageUri: string) => void;
  novelTitle?: string;
  chapterTitle?: string;
}

interface CachedCoverImageProps {
  coverPath: string;
  novelTitle: string;
  style: any;
  isDarkMode?: boolean;
  onPress?: () => void;
  forceRefresh?: boolean;
}

async function registerBackgroundFetch() {
  // 背景任務在 Expo Go 中也可能受限
  if (!isNotificationSupported) {
    logger.warn('背景任務在 Expo Go 中不完全支持');
    return;
  }
  
  try {
    await ExpoBackgroundFetch.registerTaskAsync(BACKGROUND_FETCH_TASK, {
      minimumInterval: 60 * 15,
      stopOnTerminate: false,
      startOnBoot: true,
    });
  } catch (err) {
    logger.error("Task Register failed:", err);
  }
}

// 批次 AsyncStorage 寫入系統
const batchWriteQueue = new Map<string, any>();
let batchWriteTimer: number | null = null;

const flushBatchWrites = async (): Promise<void> => {
  if (batchWriteQueue.size === 0) return;
  
  try {
    const operations: Array<[string, string]> = [];
    
    for (const [key, data] of batchWriteQueue.entries()) {
      if (key.startsWith('chapter_')) {
        operations.push([key, data]);
      } else {
        operations.push([key, JSON.stringify(data)]);
      }
    }
    
    await AsyncStorage.multiSet(operations);
    batchWriteQueue.clear();
  } catch (err) {
    logger.error('批次保存失敗:', err);
    batchWriteQueue.clear();
  }
};

const batchSaveLocalData = (key: string, data: any): void => {
  batchWriteQueue.set(key, data);
  
  if (batchWriteTimer) {
    clearTimeout(batchWriteTimer);
  }
  
  batchWriteTimer = setTimeout(flushBatchWrites, 1000) as any;
};

const saveLocalData = async (key: string, data: any): Promise<void> => {
  try {
    // 如果是章節內容，直接保存文本
    if (key.startsWith('chapter_')) {
      await AsyncStorage.setItem(key, data);
    } else {
      // 其他數據需要 JSON 序列化
      await AsyncStorage.setItem(key, JSON.stringify(data));
    }
  } catch (err) {
    logger.error('保存本地數據失敗:', err);
  }
};

const getLocalData = async (key: string): Promise<any | null> => {
  try {
    const data = await AsyncStorage.getItem(key);
    if (!data) return null;
    
    // 如果是章節內容，直接返回文本
    if (key.startsWith('chapter_')) {
      return data;
    }
    // 其他數據需要 JSON 解析
    return JSON.parse(data);
  } catch (err) {
    logger.error('讀取本地數據失敗:', err);
    return null;
  }
};

TaskManager.defineTask(BACKGROUND_FETCH_TASK, async () => {
  try {
    await checkNovelUpdates();
    return ExpoBackgroundFetch.BackgroundFetchResult.NewData;
  } catch (error) {
    logger.error('背景任務執行失敗:', error);
    return ExpoBackgroundFetch.BackgroundFetchResult.Failed;
  }
});

const getChapterStatus = async (novelName: string | null): Promise<Record<string, ChapterInfo>> => {
  try {
    if (!novelName) return {};
    
    const chaptersData = await AsyncStorage.getItem('chapters_records');
    
    const allChaptersRecord: ChapterRecord = chaptersData ? JSON.parse(chaptersData) : {};
    
    return allChaptersRecord[novelName] || {};
  } catch (error) {
    logger.error('獲取章節記錄失敗:', error);
    return {};
  }
};

// 清理過期的"新"標記（超過3天的標記）
const cleanExpiredNewLabels = async (): Promise<void> => {
  try {
    const chaptersData = await AsyncStorage.getItem('chapters_records');
    if (!chaptersData) return;
    
    const allChaptersRecord: ChapterRecord = JSON.parse(chaptersData);
    const threeDaysAgo = Date.now() - (3 * 24 * 60 * 60 * 1000);
    let hasChanges = false;

    // 檢查所有小說的所有章節
    Object.keys(allChaptersRecord).forEach(novelName => {
      Object.keys(allChaptersRecord[novelName]).forEach(chapterTitle => {
        const chapterInfo = allChaptersRecord[novelName][chapterTitle];
        
        // 如果章節時間戳超過3天且有"新"標記，則移除"新"標記
        if (chapterInfo.timestamp < threeDaysAgo && chapterInfo.statuses.includes('new')) {
          allChaptersRecord[novelName][chapterTitle].statuses = 
            chapterInfo.statuses.filter(status => status !== 'new');
          hasChanges = true;
        }
      });
    });

    // 如果有變更，保存更新後的記錄
    if (hasChanges) {
      await AsyncStorage.setItem('chapters_records', JSON.stringify(allChaptersRecord));
    }
  } catch (error) {
    logger.error('清理過期標記失敗:', error);
  }
};

const checkNovelUpdates = async () => {
  try {
    const chaptersData = await AsyncStorage.getItem('chapters_records');
    const allChaptersRecord: ChapterRecord = chaptersData ? JSON.parse(chaptersData) : {};
    
    // 獲取本地存儲的小說列表
    const localNovels = await getLocalData('novels');
    if (!localNovels || !Array.isArray(localNovels) || localNovels.length === 0) {
      return { hasUpdates: false, updates: [] };
    }

    // 獲取遠程小說列表（添加 cache-busting）
    const timestamp = Date.now();
    const response = await fetch(`https://raw.githubusercontent.com/xuerowo/myacgn/main/輕小說翻譯/novels.json?t=${timestamp}`, {
      cache: 'no-cache',
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
      }
    });
    if (!response.ok) {
      throw new Error('無法獲取遠程小說列表');
    }

    const { novels: remoteNovels } = await response.json();
    const localNovelTitles = localNovels.map((n: Novel) => n.title);
    const remoteNovelTitles = remoteNovels.map((n: Novel) => n.title);

    const updates: UpdateInfo[] = [];

    // 檢查新增的小說
    const newNovels = remoteNovelTitles.filter((title: string) => !localNovelTitles.includes(title));
    newNovels.forEach((novelTitle: string) => {
      updates.push({
        novelName: novelTitle,
        isNewNovel: true,
        newChapters: [],
        modifiedChapters: [],
        deletedChapters: []
      });
    });

    // 檢查刪除的小說
    const deletedNovels = localNovelTitles.filter((title: string) => !remoteNovelTitles.includes(title));
    deletedNovels.forEach((novelTitle: string) => {
      updates.push({
        novelName: novelTitle,
        isDeletedNovel: true,
        newChapters: [],
        modifiedChapters: [],
        deletedChapters: []
      });
    });

    // 檢查現有小說的更新
    for (const remoteNovel of remoteNovels) {
      const localNovel = localNovels.find((n: Novel) => n.title === remoteNovel.title);
      if (!localNovel) continue;

      const newChapters: string[] = [];
      const modifiedChapters: string[] = [];
      const deletedChapters: string[] = [];

      // 檢查新增和修改的章節
      remoteNovel.chapters.forEach((remoteChapter: Chapter) => {
        const localChapter = localNovel.chapters.find((ch: Chapter) => ch.id === remoteChapter.id);
        if (!localChapter) {
          newChapters.push(remoteChapter.title);
        } else if (
          localChapter.lastUpdated !== remoteChapter.lastUpdated || 
          localChapter.url !== remoteChapter.url
        ) {
          modifiedChapters.push(remoteChapter.title);
        }
      });

      // 檢查刪除的章節
      localNovel.chapters.forEach((localChapter: Chapter) => {
        if (!remoteNovel.chapters.find((ch: Chapter) => ch.id === localChapter.id)) {
          deletedChapters.push(localChapter.title);
        }
      });

      if (newChapters.length > 0 || modifiedChapters.length > 0 || deletedChapters.length > 0) {
        updates.push({
          novelName: remoteNovel.title,
          newChapters,
          modifiedChapters,
          deletedChapters
        });
      }
    }

    return {
      hasUpdates: updates.length > 0,
      updates
    };
    
  } catch (error) {
    logger.error('檢查更新失敗:', error);
    throw error;
  }
};

const formatChapterDateTime = (dateStr: string) => {
  if (!dateStr) return '';
  
  try {
    // 解析日期時間字符串
    const [datePart] = dateStr.split(' ');
    if (!datePart) return '';
    
    const [year, month, day] = datePart.split('-').map(num => parseInt(num, 10));
    if (isNaN(year) || isNaN(month) || isNaN(day)) return '';
    
    const date = new Date(year, month - 1, day);
    if (isNaN(date.getTime())) return '';
    
    const now = new Date();
    // 使用當前時區的日期比較，保持用戶體驗的一致性
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const compareDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const diffTime = today.getTime() - compareDate.getTime();
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    
    // 如果是今天
    if (diffDays === 0) {
      return '今天';
    }
    
    // 如果是昨天
    if (diffDays === 1) {
      return '昨天';
    }
    
    // 如果是7天內
    if (diffDays < 7) {
      return `${diffDays}天前`;
    }
    
    // 如果是今年
    if (date.getFullYear() === now.getFullYear()) {
      return `${date.getMonth() + 1}月${date.getDate()}日`;
    }
    
    // 如果是更早的時間
    return `${date.getFullYear()}/${(date.getMonth() + 1).toString().padStart(2, '0')}/${date.getDate().toString().padStart(2, '0')}`;
  } catch (error) {
    return dateStr; // 如果解析失敗，返回原始字符串
  }
};

interface ChapterListProps {
  chapters: Chapter[];
  currentNovel: string | null;
  onSelectChapter: (chapter: Chapter) => void;
  lastReadChapter?: string;
  readChapters: Set<string>;
  styles: any;
  scrollViewRef: any;
  onScroll: (event: any) => void;
  refreshControl?: React.ReactElement<any>;
  ListHeaderComponent?: React.ReactNode;
  theme?: string;
}

const ChapterList: React.FC<ChapterListProps> = ({ 
  chapters, 
  currentNovel, 
  onSelectChapter, 
  lastReadChapter, 
  readChapters,
  styles,
  scrollViewRef,
  onScroll,
  refreshControl, 
  ListHeaderComponent,
  theme = 'light',
}) => {
  const [chapterStatuses, setChapterStatuses] = useState<Record<string, ChapterInfo>>({});
  
  useEffect(() => {
    const loadChapterStatuses = async () => {
      const statuses = await getChapterStatus(currentNovel);
      setChapterStatuses(statuses);
    };
    
    loadChapterStatuses();
  }, [currentNovel]);
  
  const checkIsRecent = (timestamp: number): boolean => {
    const threeDaysAgo = Date.now() - (3 * 24 * 60 * 60 * 1000);  // 3天前的時間戳
    return timestamp > threeDaysAgo;  // 如果章節的時間戳比3天前新，就顯示標記
  };

  return (
    <CustomScrollView
      ref={scrollViewRef}
      style={styles.listContainer}
      contentContainerStyle={{ paddingBottom: 80 }}
      onScroll={onScroll}
      onScrollBeginDrag={(e) => e.persist()}
      refreshControl={refreshControl}
      indicatorColor={theme === 'dark' ? '#ffffff' : '#000000'}
      indicatorWidth={4}
      autoHide={true}
      hideTimeout={1500}
    >
      {ListHeaderComponent}
      {chapters.map((chapter) => {
        const chapterInfo = chapterStatuses[chapter.title];
        const isRecent = chapterInfo?.timestamp ? checkIsRecent(chapterInfo.timestamp) : false;
        const isNew = chapterInfo?.statuses?.includes('new');
        const isModified = chapterInfo?.statuses?.includes('modified');
        const isRead = readChapters.has(chapter.title);

        return (
          <TouchableOpacity
            key={chapter.title}
            style={[
              styles.chapterItem,
              isRead && lastReadChapter !== chapter.title && styles.readChapter,
              lastReadChapter === chapter.title && styles.lastReadChapter
            ]}
            onPress={() => onSelectChapter(chapter)}
          >
            <View style={styles.chapterItemContent}>
              <Text style={[
                styles.chapterTitle,
                isRead && lastReadChapter !== chapter.title && styles.readChapterTitle,
              ]}>
                {chapter.title}
              </Text>
              <View style={styles.chapterRightContent}>
                {chapter.lastUpdated && (
                  <Text style={[
                    styles.chapterDate,
                  ]}>
                    {formatChapterDateTime(chapter.lastUpdated)}
                  </Text>
                )}
                <View style={styles.statusContainer}>
                  {isNew && (
                    <View style={[styles.badge, styles.newBadge]}>
                      <Text style={styles.badgeText}>新</Text>
                    </View>
                  )}
                  {isModified && (
                    <View style={[styles.badge, styles.modifiedBadge]}>
                      <Text style={styles.badgeText}>改</Text>
                    </View>
                  )}
                </View>
              </View>
            </View>
          </TouchableOpacity>
        );
      })}
    </CustomScrollView>
  );
};

// 使用 LRU 緩存限制大小，避免內存洩漏
const imageCache = new Map<string, boolean>();
const MAX_IMAGE_CACHE_SIZE = 100;

// 清理最舊的緩存項
const cleanImageCache = () => {
  if (imageCache.size > MAX_IMAGE_CACHE_SIZE) {
    const firstKey = imageCache.keys().next().value;
    if (firstKey) {
      imageCache.delete(firstKey);
    }
  }
};

// 統一的緩存封面圖片組件
const CachedCoverImage: React.FC<CachedCoverImageProps> = React.memo(({ 
  coverPath, 
  novelTitle, 
  style, 
  isDarkMode = false, 
  onPress, 
  forceRefresh = false 
}) => {
  const [imageError, setImageError] = useState(false);
  const [currentImageUri, setCurrentImageUri] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);
  
  const resolvedCoverUrl = resolveCoverUrl(coverPath);
  const cacheManager = ImageCacheManager.getInstance();

  // 基於文件系統的圖片載入邏輯
  useEffect(() => {
    const loadImage = async () => {
      try {
        setImageError(false);
        setIsLoading(true);
        
        // 1. 先檢查本地文件緩存
        const cachedPath = await cacheManager.getCachedImagePath('cover', novelTitle);
        if (cachedPath && !forceRefresh) {
          setCurrentImageUri(cachedPath);
          setIsLoading(false);
        }
        
        // 2. 嘗試從網路獲取並緩存最新圖片
        try {
          const networkUrl = resolvedCoverUrl;
          const downloadedPath = await cacheManager.cacheImage(networkUrl, 'cover', novelTitle);
          
          if (downloadedPath) {
            // 網路圖片下載成功，更新顯示
            setCurrentImageUri(downloadedPath);
          } else if (!cachedPath) {
            // 下載失敗且沒有緩存時設為錯誤
            setImageError(true);
          }
        } catch (networkError) {
          // 網路請求失敗，如果沒有緩存則顯示錯誤
          if (!cachedPath) {
            setImageError(true);
          }
          logger.warn('載入封面圖片失敗:', networkError);
        }
      } catch (error) {
        logger.error('圖片載入過程出錯:', error);
        setImageError(true);
      } finally {
        setIsLoading(false);
      }
    };

    loadImage();
  }, [novelTitle, coverPath, resolvedCoverUrl, forceRefresh, cacheManager]);

  if (imageError) {
    return (
      <View style={[style, { backgroundColor: isDarkMode ? '#333' : '#f0f0f0', justifyContent: 'center', alignItems: 'center' }]}>
        <Text style={{ color: isDarkMode ? '#888' : '#666', fontSize: 12 }}>
          封面圖片
        </Text>
      </View>
    );
  }

  const ImageComponent = (
    <View style={style}>
      <ExpoImage
        source={{ uri: currentImageUri }}
        style={style}
        contentFit="cover"
        onError={() => setImageError(true)}
        transition={200}
      />
      {isLoading && (
        <View style={[
          {
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            justifyContent: 'center',
            alignItems: 'center',
            backgroundColor: 'rgba(0,0,0,0.3)'
          }
        ]}>
          <ActivityIndicator size="small" color="#ffffff" />
        </View>
      )}
    </View>
  );

  if (onPress) {
    return (
      <TouchableOpacity onPress={onPress} activeOpacity={0.8}>
        {ImageComponent}
      </TouchableOpacity>
    );
  }

  return ImageComponent;
}, (prevProps, nextProps) => {
  return (
    prevProps.coverPath === nextProps.coverPath &&
    prevProps.novelTitle === nextProps.novelTitle &&
    prevProps.isDarkMode === nextProps.isDarkMode &&
    prevProps.forceRefresh === nextProps.forceRefresh &&
    prevProps.onPress === nextProps.onPress
  );
});

const MarkdownImage: React.FC<MarkdownImageProps> = React.memo(({ src, isDarkMode, backgroundColor, onImagePress, novelTitle, chapterTitle }) => {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(false);
  const [currentImageUri, setCurrentImageUri] = useState<string>('');
  const screenWidth = Dimensions.get('window').width;
  const isMounted = useRef(true);

  useEffect(() => {
    return () => {
      isMounted.current = false;
    };
  }, []);

  const cleanUrl = useMemo(() => {
    return resolveImageUrl(src);
  }, [src]);

  const cacheManager = ImageCacheManager.getInstance();

  // 基於文件系統的圖片載入邏輯
  useEffect(() => {
    const loadImage = async () => {
      if (!isMounted.current) return;
      
      try {
        setError(false);
        setIsLoading(true);
        
        // 生成圖片標識（使用URL作為圖片名稱的一部分）
        const imageName = src.split('/').pop()?.replace(/[^a-zA-Z0-9]/g, '_') || 'unknown';
        
        // 生成章節特定的快取鍵（使用小說標題和章節標題）
        const cacheKey = novelTitle && chapterTitle ? `${novelTitle}_${chapterTitle}` : 'current';
        
        // 1. 先檢查本地文件緩存
        const cachedPath = await cacheManager.getCachedImagePath('content', cacheKey, imageName);
        if (cachedPath && isMounted.current) {
          setCurrentImageUri(cachedPath);
          setIsLoading(false);
        }
        
        // 2. 嘗試從網路獲取並緩存最新圖片
        try {
          const downloadedPath = await cacheManager.cacheImage(cleanUrl, 'content', cacheKey, imageName);
          
          if (downloadedPath && isMounted.current) {
            // 網路圖片下載成功，更新顯示
            setCurrentImageUri(downloadedPath);
            
            // 更新內存緩存
            cleanImageCache();
            imageCache.set(cleanUrl, true);
          } else if (!cachedPath && isMounted.current) {
            // 下載失敗且沒有緩存時設為錯誤
            setError(true);
          }
        } catch (networkError) {
          // 網路請求失敗，如果沒有緩存則顯示錯誤
          if (!cachedPath && isMounted.current) {
            setError(true);
          }
          logger.warn('載入章節圖片失敗:', networkError);
        }
      } catch (error) {
        if (isMounted.current) {
          logger.error('圖片載入過程出錯:', error);
          setError(true);
        }
      } finally {
        if (isMounted.current) {
          setIsLoading(false);
        }
      }
    };

    loadImage();
  }, [cleanUrl, src, cacheManager, novelTitle, chapterTitle]);

  const imageStyles = useMemo(() => StyleSheet.create({
    container: {
      width: screenWidth,
      marginHorizontal: -16,
      backgroundColor
    },
    image: {
      width: screenWidth,
      height: screenWidth,
      resizeMode: 'contain' as const,
      backgroundColor
    },
    loadingContainer: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor
    }
  }), [screenWidth, backgroundColor]);

  if (error) {
    return (
      <View style={imageStyles.container}>
        <View style={imageStyles.loadingContainer}>
          <Text style={{ color: isDarkMode ? '#ffffff' : '#000000' }}>圖片載入失敗</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={imageStyles.container}>
      <TouchableOpacity 
        onPress={() => onImagePress?.(currentImageUri)}
        activeOpacity={0.8}
      >
        <ExpoImage
          source={{ uri: currentImageUri }}
          style={imageStyles.image}
          contentFit="contain"
          onError={() => {
            if (isMounted.current) {
              setError(true);
              setIsLoading(false);
            }
          }}
          transition={200}
        />
      </TouchableOpacity>
      {isLoading && (
        <View style={imageStyles.loadingContainer}>
          <ActivityIndicator size="large" color={isDarkMode ? '#ffffff' : '#000000'} />
        </View>
      )}
    </View>
  );
}, (prevProps, nextProps) => {
  return prevProps.src === nextProps.src && 
         prevProps.isDarkMode === nextProps.isDarkMode && 
         prevProps.backgroundColor === nextProps.backgroundColor &&
         prevProps.onImagePress === nextProps.onImagePress &&
         prevProps.novelTitle === nextProps.novelTitle &&
         prevProps.chapterTitle === nextProps.chapterTitle;
});

// 格式化更新消息
const formatUpdateMessage = (updates: UpdateInfo[]): string => {
  return updates
    .map(update => {
      const novelName = update.novelName;
      
      if (update.isNewNovel) {
        return `${novelName}\n新增小說`;
      }
      
      if (update.isDeletedNovel) {
        return `${novelName}\n已被刪除`;
      }

      const newChapters = update.newChapters.length > 0 
        ? `新增章節：${update.newChapters.length}章\n(${update.newChapters.join('、')})` 
        : '';
      const modifiedChapters = update.modifiedChapters.length > 0 
        ? `\n修改章節：${update.modifiedChapters.length}章\n(${update.modifiedChapters.join('、')})` 
        : '';

      return `${novelName}${newChapters}${modifiedChapters}`;
    })
    .join('\n\n');
};

// 添加通知相關的類型定義
interface NotificationData extends Record<string, unknown> {
  updates: UpdateInfo[];
}

// 設置通知頻道
const setupNotifications = async (): Promise<void> => {
  if (!isNotificationSupported) {
    logger.warn('通知功能在 Expo Go 中不支持');
    return;
  }
  
  if (Platform.OS === 'android') {
    try {
      await Notifications.setNotificationChannelAsync('updates', {
        name: '小說更新通知',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#FF231F7C',
        description: '接收小說更新的通知',
      });
    } catch (error) {
      logger.error('設置通知頻道失敗:', error);
    }
  }
};

// 發送通知的函數
const sendUpdateNotification = async (updates: UpdateInfo[]): Promise<void> => {
  if (!isNotificationSupported) {
    logger.warn('通知功能在 Expo Go 中不支持');
    return;
  }
  
  try {
    const notificationContent = formatUpdateMessage(updates);
    
    await Notifications.scheduleNotificationAsync({
      content: {
        title: '發現小說更新',
        body: notificationContent.length > 100 
          ? notificationContent.substring(0, 97) + '...' 
          : notificationContent,
        data: { updates } as NotificationData,
        badge: 1,
      },
      trigger: null,
    });
  } catch (error) {
    logger.error('發送通知失敗:', error);
  }
};

const App: React.FC = () => {
  const insets = useSafeAreaInsets();
  
  // 初始化全局 ImageCacheManager
  React.useEffect(() => {
    if (!global.imageCacheManager) {
      global.imageCacheManager = ImageCacheManager.getInstance();
    }
  }, []);
  
  const [novels, setNovels] = useState<Novel[]>([]);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [currentContent, setCurrentContent] = useState<string>('');
  const [novelsLoading, setNovelsLoading] = useState<boolean>(false);
  const [chaptersLoading, setChaptersLoading] = useState<boolean>(false);
  const [contentLoading, setContentLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [currentNovel, setCurrentNovel] = useState<string | null>(null);
  const [lastReadChapter, setLastReadChapter] = useState<Record<string, string>>({});
  const [scrollPosition, setScrollPosition] = useState<ScrollPositions>({});
  const [settings, setSettings] = useState<Settings>({
    isDarkMode: false,
    lastReadChapter: {},
    scrollPosition: {},
    fontSize: 18,
    lineHeight: 1.5,
    theme: 'light',
  });
  const [isAppReady, setIsAppReady] = useState(false);
  const [filteredNovels, setFilteredNovels] = useState<Novel[]>([]);
  const [settingsVisible, setSettingsVisible] = useState<boolean>(false);
  const [refreshingNovels, setRefreshingNovels] = useState(false);
  const [refreshingChapters, setRefreshingChapters] = useState(false);
  const [refreshingContent, setRefreshingContent] = useState(false);

  const contentScrollViewRef = useRef<ScrollView>(null);
  const chaptersScrollViewRef = useRef<ScrollView>(null);
  const novelsScrollViewRef = useRef<ScrollView>(null);

  const [readChapters, setReadChapters] = useState<Record<string, Set<string>>>({});
  const [updateChecking, setUpdateChecking] = useState<boolean>(false);
  
  // Lightbox 相關狀態
  const [lightboxVisible, setLightboxVisible] = useState<boolean>(false);
  const [lightboxImages, setLightboxImages] = useState<Array<{uri: string}>>([]);
  const [lightboxIndex, setLightboxIndex] = useState<number>(0);

  const handleSearch = (text: string) => {
    if (!text) {
      setFilteredNovels(novels);
      return;
    }
    const filtered = novels.filter(novel => 
      novel.title.toLowerCase().includes(text.toLowerCase())
    );
    setFilteredNovels(filtered);
  };

  // Lightbox 處理函數
  const openLightbox = (imageUri: string, index: number = 0) => {
    setLightboxImages([{ uri: imageUri }]);
    setLightboxIndex(index);
    setLightboxVisible(true);
  };

  const closeLightbox = () => {
    setLightboxVisible(false);
    setLightboxImages([]);
    setLightboxIndex(0);
  };

  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress>({
    total: 0,
    current: 0,
    isDownloading: false
  });

  const saveSettings = async (newSettings: Settings): Promise<void> => {
    try {
      await AsyncStorage.setItem('reader_settings', JSON.stringify({
        isDarkMode: newSettings.isDarkMode,
        lastReadChapter: newSettings.lastReadChapter,
        scrollPosition: newSettings.scrollPosition,
        fontSize: newSettings.fontSize,
        lineHeight: newSettings.lineHeight,
        theme: newSettings.theme,
      }));
    } catch (err) {
      logger.error('保存設置失敗:', err);
    }
  };

  const loadSettings = async (): Promise<void> => {
    try {
      const settingsStr = await AsyncStorage.getItem('reader_settings');
      if (settingsStr) {
        const parsedSettings: Settings = JSON.parse(settingsStr);
        setSettings(parsedSettings);
        
        // 同時更新這兩個狀態
        setLastReadChapter(parsedSettings.lastReadChapter ?? {});
        setScrollPosition(parsedSettings.scrollPosition ?? {});
      }
    } catch (err) {
      logger.error('載入設置失敗:', err);
    }
  };

  const handleThemeChange = (newTheme: 'light' | 'dark' | 'eyeComfort') => {
    // 如果主題沒有變化，直接返回，避免不必要的狀態更新
    if (settings.theme === newTheme) return;
    
    const updatedSettings = {
      ...settings,
      theme: newTheme,
      isDarkMode: newTheme === 'dark'
    };
    
    // 先更新狀態
    setSettings(updatedSettings);
    
    // 立即保存主題設置到 AsyncStorage，但避免再次觸發設置更新
    AsyncStorage.setItem('theme_settings', JSON.stringify({
      theme: newTheme,
      isDarkMode: newTheme === 'dark'
    })).catch(err => logger.error('保存主題設置失敗:', err));
  };

  const getBackgroundColor = () => {
    switch (settings.theme) {
      case 'light':
        return '#ffffff';
      case 'dark':
        return '#333333';
      case 'eyeComfort':
        return '#f9f1e6'; // 暖色調米色背景
    }
  };

  const getTextColor = () => {
    switch (settings.theme) {
      case 'light':
        return '#000000';
      case 'dark':
        return '#ffffff';
      case 'eyeComfort':
        return '#4a4a4a'; // 柔和的深灰色文字
    }
  };

  const getStatusBarColor = () => {
    return getBackgroundColor();
  };

  const getStatusBarStyle = () => {
    switch (settings.theme) {
      case 'dark':
        return 'light-content';
      case 'light':
      case 'eyeComfort':
        return 'dark-content';
    }
  };

  useEffect(() => {
    StatusBar.setBackgroundColor(getStatusBarColor());
    StatusBar.setBarStyle(getStatusBarStyle());
    
    // 設置導航欄顏色和按鍵顏色
    if (Platform.OS === 'android') {
      const navigationBarColor = getBackgroundColor();
      const isLight = settings.theme === 'light' || settings.theme === 'eyeComfort';
      
      // 嘗試多種方法設置導航欄
      Promise.all([
        // 方法1: 使用 expo-system-ui 設置導航欄背景
        SystemUI.setBackgroundColorAsync(navigationBarColor).catch(() => {}),
        // 方法2: 使用第三方庫設置導航欄和按鍵顏色
        safeChangeNavigationBarColor(navigationBarColor, isLight, true)
      ]).catch(() => {
        logger.warn('無法設置導航欄顏色');
      });
    }
  }, [settings.theme]);

  const getStatusBarBackgroundColor = () => {
    switch (settings.theme) {
      case 'dark':
        return '#333333';
      case 'light':
        return '#f5f5f5';
      case 'eyeComfort':
        return '#e6ebe3'; // 略微淺一點的護眼色調
    }
  };

  const toggleTheme = (): void => {
    setSettings(prev => {
      const nextTheme = prev.theme === 'light' ? 'dark' : 
                       prev.theme === 'dark' ? 'eyeComfort' : 'light';
      return {
        ...prev,
        isDarkMode: nextTheme === 'dark',
        theme: nextTheme
      };
    });
    saveSettings({
      ...settings,
      isDarkMode: settings.theme === 'light',  // 下一個主題是深色時為 true
      theme: settings.theme === 'light' ? 'dark' : 
             settings.theme === 'dark' ? 'eyeComfort' : 'light'
    });
  };

  const sortChapters = useCallback((chapters: Chapter[]) => {
    return [...chapters].sort((a: Chapter, b: Chapter) => {
      const numA = parseInt(a.title.match(/\d+/)?.[0] || '0');
      const numB = parseInt(b.title.match(/\d+/)?.[0] || '0');
      return numA - numB;
    });
  }, []);

  const fetchNovelList = async (): Promise<void> => {
    try {
      setNovelsLoading(true);
      
      // 1. 先嘗試從網路獲取數據（添加 cache-busting）
      try {
        const timestamp = Date.now();
        const response = await fetch(`https://raw.githubusercontent.com/xuerowo/myacgn/main/輕小說翻譯/novels.json?t=${timestamp}`, {
          cache: 'no-cache',
          headers: {
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Pragma': 'no-cache',
            'Expires': '0'
          }
        });
        if (response.ok) {
          const data = await response.json();
          
          // 檢查更新，只顯示對話框
          const updateResult = await checkNovelUpdates();
          if (updateResult?.hasUpdates) {
            Alert.alert(
              '發現更新',
              formatUpdateMessage(updateResult.updates),
              [{ text: '確定' }]
            );
          }
          const novelList = data.novels
            .map((novel: Novel) => ({
              ...novel,
              lastUpdated: novel.lastUpdated || '未知時間'
            }))
            .sort((a: Novel, b: Novel) => {
              if (a.lastUpdated === '未知時間') return 1;
              if (b.lastUpdated === '未知時間') return -1;
              
              const dateA = new Date(a.lastUpdated.replace(' ', 'T'));
              const dateB = new Date(b.lastUpdated.replace(' ', 'T'));
              
              return dateB.getTime() - dateA.getTime();
            });
          
          setNovels(novelList);
          setFilteredNovels(novelList);
          await saveLocalData('novels', novelList);
          return;
        }
      } catch (networkError) {
        logger.error('網路請求失敗:', networkError);
      }

      // 2. 如果網路請求失敗，嘗試讀取本地數據
      const localNovels = await getLocalData('novels');
      if (localNovels && Array.isArray(localNovels) && localNovels.length > 0) {
        setNovels(localNovels);
        setFilteredNovels(localNovels);
      } else {
        setNovels([]);
        setFilteredNovels([]);
        throw new Error('無法獲取小說數據，請檢查網路連接');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '無法載入小說列表');
      logger.error(err);
    } finally {
      setNovelsLoading(false);
    }
  };

  const fetchChapterList = async (novelTitle: string): Promise<void> => {
    try {
      setChaptersLoading(true);
      setCurrentNovel(novelTitle);

      // 檢查更新（不影響離線使用）
      try {
        const updateResult = await checkNovelUpdates();
        
        if (updateResult?.hasUpdates) {
          const novelUpdate = updateResult.updates.find(
            update => update.novelName === novelTitle
          );
          
          if (novelUpdate) {
            // 更新章節狀態記錄
            const chaptersData = await AsyncStorage.getItem('chapters_records');
            const allChaptersRecord: ChapterRecord = chaptersData ? JSON.parse(chaptersData) : {};
            
            if (!allChaptersRecord[novelTitle]) {
              allChaptersRecord[novelTitle] = {};
            }

            // 更新新增章節的狀態
            novelUpdate.newChapters.forEach(chapterTitle => {
              allChaptersRecord[novelTitle][chapterTitle] = {
                name: chapterTitle,
                sha: '',  // 可以從 API 獲取
                timestamp: Date.now(),
                statuses: ['new']
              };
            });

            // 更新修改章節的狀態
            novelUpdate.modifiedChapters.forEach(chapterTitle => {
              if (allChaptersRecord[novelTitle][chapterTitle]) {
                allChaptersRecord[novelTitle][chapterTitle].statuses.push('modified');
                allChaptersRecord[novelTitle][chapterTitle].timestamp = Date.now();
              } else {
                allChaptersRecord[novelTitle][chapterTitle] = {
                  name: chapterTitle,
                  sha: '',  // 可以從 API 獲取
                  timestamp: Date.now(),
                  statuses: ['modified']
                };
              }
            });

            await AsyncStorage.setItem('chapters_records', JSON.stringify(allChaptersRecord));
            
            Alert.alert(
              '發現更新',
              formatUpdateMessage([novelUpdate]),
              [{ text: '確定' }]
            );
          }
        }
      } catch (updateError) {
        // 更新檢查失敗不影響後續邏輯，繼續使用本地數據
        logger.warn('更新檢查失敗，繼續使用本地數據:', updateError);
      }

      // 1. 先嘗試從網路獲取最新的小說資料（添加 cache-busting）
      try {
        const timestamp = Date.now();
        const response = await fetch(`https://raw.githubusercontent.com/xuerowo/myacgn/main/輕小說翻譯/novels.json?t=${timestamp}`, {
          cache: 'no-cache',
          headers: {
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Pragma': 'no-cache',
            'Expires': '0'
          }
        });
        if (response.ok) {
          const data = await response.json();
          const novel = data.novels.find((n: Novel) => n.title === novelTitle);
          if (novel) {
            const sortedChapters = sortChapters(novel.chapters);
            setChapters(sortedChapters);
            
            // 更新 novels 中對應小說的章節資料
            setNovels(prevNovels => {
              const updatedNovels = prevNovels.map(n => 
                n.title === novelTitle ? { ...n, chapters: novel.chapters } : n
              );
              saveLocalData('novels', updatedNovels);
              return updatedNovels;
            });

            if (scrollPosition[`${novelTitle}-chapters`]) {
              setTimeout(() => {
                if (chaptersScrollViewRef.current) {
                  chaptersScrollViewRef.current.scrollTo({
                    y: scrollPosition[`${novelTitle}-chapters`],
                    animated: false
                  });
                }
              }, 0);
            }
            return;
          }
        }
      } catch (networkError) {
        logger.error('網路請求失敗:', networkError);
      }

      // 2. 如果網路請求失敗，嘗試使用本地數據
      const novel = novels.find(n => n.title === novelTitle);
      if (!novel) {
        throw new Error(`找不到小說：${novelTitle}`);
      }

      const sortedChapters = sortChapters(novel.chapters);
      setChapters(sortedChapters);

      if (scrollPosition[`${novelTitle}-chapters`]) {
        setTimeout(() => {
          if (chaptersScrollViewRef.current) {
            chaptersScrollViewRef.current.scrollTo({
              y: scrollPosition[`${novelTitle}-chapters`] || 0,
              animated: false
            });
          }
        }, 0);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '無法載入章節列表');
      logger.error(err);
    } finally {
      setChaptersLoading(false);
    }
  };

  // 強制保存當前狀態的函數
  const saveCurrentState = useCallback(async () => {
    try {
      const newSettings = {
        ...settings,
        lastReadChapter,
        scrollPosition
      };
      await saveLocalData('settings', newSettings);
      logger.log('已強制保存當前狀態');
    } catch (error) {
      logger.error('強制保存狀態失敗:', error);
    }
  }, [settings, lastReadChapter, scrollPosition]);

  const fetchChapterContent = async (chapter: Chapter) => {
    if (!currentNovel) return;

    // 在獲取新章節前保存當前狀態
    await saveCurrentState();

    try {
      setContentLoading(true);
      setError(null);

      // 統一使用新的存儲鍵格式
      const newContentKey = `chapter_${currentNovel}_${chapter.title}`;
      const oldContentKey = `content-${currentNovel}-${chapter.title}`;
      
      // 優先讀取新格式，回退到舊格式以保持兼容性
      let localContent = await getLocalData(newContentKey);
      if (!localContent) {
        localContent = await getLocalData(oldContentKey);
        // 如果找到舊格式數據，遷移到新格式
        if (localContent) {
          await saveLocalData(newContentKey, localContent);
          // 保留舊數據一段時間，不立即刪除
        }
      }
      
      // 優化離線體驗：如果有本地內容，先顯示本地內容，然後嘗試更新
      if (localContent) {
        setCurrentContent(localContent);
        setContentLoading(false); // 先顯示本地內容
        
        // 在後台嘗試獲取最新內容
        try {
          const resolvedChapterUrl = resolveChapterUrl(chapter.url);
          const timestamp = Date.now();
          const urlWithCacheBusting = `${resolvedChapterUrl}?t=${timestamp}`;
          const response = await fetch(urlWithCacheBusting, {
            cache: 'no-cache',
            headers: {
              'Cache-Control': 'no-cache, no-store, must-revalidate',
              'Pragma': 'no-cache',
              'Expires': '0'
            }
          });
          if (response.ok) {
            const newContent = await response.text();
            // 如果內容有變化，則更新
            if (newContent !== localContent) {
              await saveLocalData(newContentKey, newContent);
              setCurrentContent(newContent);
            }
          }
        } catch (networkError) {
          // 後台更新失敗不影響用戶體驗
          logger.debug('後台更新章節失敗:', networkError);
        }
      } else {
        // 沒有本地內容時，必須從網路獲取
        try {
          const resolvedChapterUrl = resolveChapterUrl(chapter.url);
          const timestamp = Date.now();
          const urlWithCacheBusting = `${resolvedChapterUrl}?t=${timestamp}`;
          const response = await fetch(urlWithCacheBusting, {
            cache: 'no-cache',
            headers: {
              'Cache-Control': 'no-cache, no-store, must-revalidate',
              'Pragma': 'no-cache',
              'Expires': '0'
            }
          });
          if (!response.ok) {
            throw new Error(`下載章節失敗: ${response.status}`);
          }
          const newContent = await response.text();
          
          await saveLocalData(newContentKey, newContent);
          setCurrentContent(newContent);
        } catch (networkError) {
          logger.error('獲取章節內容失敗:', networkError);
          throw new Error('無法載入章節內容，請檢查網路連接');
        }
      }
      
      // 更新最後閱讀章節
      const newLastReadChapter = {
        ...lastReadChapter,
        [currentNovel]: chapter.title
      };
      setLastReadChapter(newLastReadChapter);

      // 同時更新 settings 中的 lastReadChapter
      const newSettings = {
        ...settings,
        lastReadChapter: newLastReadChapter
      };
      setSettings(newSettings);
      saveSettings(newSettings);

      // 更新已讀章節集合
      setReadChapters(prev => {
        const novelChapters = prev[currentNovel] || new Set();
        novelChapters.add(chapter.title);
        const newReadChapters = {
          ...prev,
          [currentNovel]: novelChapters
        };
        saveLocalData('readChapters', Object.fromEntries(
          Object.entries(newReadChapters).map(([novel, chapters]) => [
            novel,
            Array.from(chapters)
          ])
        ));
        return newReadChapters;
      });

      // 恢復滾動位置
      const scrollKey = `${currentNovel}-${chapter.title}`;
      const savedPosition = scrollPosition[scrollKey];
      
      if (typeof savedPosition === 'number') {
        setTimeout(() => {
          if (contentScrollViewRef.current) {
            contentScrollViewRef.current.scrollTo({
              y: savedPosition,
              animated: false
            });
          }
        }, 0);
      }

    } catch (error) {
      logger.error('獲取章節內容失敗:', error);
      setError(error instanceof Error ? error.message : '未知錯誤');
    } finally {
      setContentLoading(false);
    }
  };

  const handleReturnToChapters = useCallback(async (): Promise<void> => {
    // 在返回章節列表前保存當前狀態
    await saveCurrentState();
    
    if (currentNovel && lastReadChapter[currentNovel]) {
      setCurrentContent('');

      setTimeout(() => {
        if (chaptersScrollViewRef.current) {
          chaptersScrollViewRef.current.scrollTo({
            y: scrollPosition[`${currentNovel}-chapters`] || 0,
            animated: false
          });
        }
      }, 0);
    }
  }, [currentNovel, lastReadChapter, scrollPosition, settings.theme, saveCurrentState]);

  const handleReturnToNovels = useCallback(async (): Promise<void> => {
    // 在返回小說列表前保存當前狀態
    await saveCurrentState();
    
    setChapters([]);
    setCurrentNovel(null);
    setFilteredNovels(novels);

    if (novelsScrollViewRef.current) {
      novelsScrollViewRef.current.scrollTo({
        y: scrollPosition.novelsList || 0,
        animated: false
      });
    }
  }, [scrollPosition, novels, saveCurrentState]);

  const navigateChapter = useCallback(async (direction: 'prev' | 'next'): Promise<void> => {
    // 在章節切換前保存當前狀態
    await saveCurrentState();
    
    const currentIndex = chapters.findIndex(
      chapter => chapter.title === lastReadChapter[currentNovel ?? '']
    );
    const newIndex = direction === 'next' ? currentIndex + 1 : currentIndex - 1;

    if (newIndex >= 0 && newIndex < chapters.length) {
      await fetchChapterContent(chapters[newIndex]);
    }
  }, [chapters, currentNovel, lastReadChapter, settings.theme, saveCurrentState, fetchChapterContent]);

  // 檢查是否已經是第一章
  const isFirstChapter = useCallback((): boolean => {
    if (!chapters.length || !currentNovel) return false;
    const currentIndex = chapters.findIndex(
      chapter => chapter.title === lastReadChapter[currentNovel]
    );
    return currentIndex === 0;
  }, [chapters, currentNovel, lastReadChapter]);

  // 檢查是否已經是最後一章
  const isLastChapter = useCallback((): boolean => {
    if (!chapters.length || !currentNovel) return false;
    const currentIndex = chapters.findIndex(
      chapter => chapter.title === lastReadChapter[currentNovel]
    );
    return currentIndex === chapters.length - 1;
  }, [chapters, currentNovel, lastReadChapter]);

  // 使用 useRef 來避免重新創建 debounce 函數
  const debouncedScrollHandler = useRef(
    debounce((key: string, offset: number, currentScrollPosition: any, currentSettings: any) => {
      if (!key.includes('undefined') && !key.includes('null')) {
        const newScrollPosition = {
          ...currentScrollPosition,
          [key]: offset
        };
        setScrollPosition(newScrollPosition);
        
        // 同時更新 settings 中的 scrollPosition
        const newSettings = {
          ...currentSettings,
          scrollPosition: newScrollPosition
        };
        setSettings(newSettings);
        batchSaveLocalData('reader_settings', {
          isDarkMode: newSettings.isDarkMode,
          lastReadChapter: newSettings.lastReadChapter,
          scrollPosition: newSettings.scrollPosition,
          fontSize: newSettings.fontSize,
          lineHeight: newSettings.lineHeight,
          theme: newSettings.theme,
        });
      }
    }, 500)
  ).current;

  const handleScroll = useCallback(
    (key: string, offset: number) => {
      debouncedScrollHandler(key, offset, scrollPosition, settings);
    },
    [scrollPosition, settings, debouncedScrollHandler]
  );

  const handleCheckUpdate = async () => {
    try {
      setContentLoading(true);
      
      // 檢查更新前清理過期標記
      await cleanExpiredNewLabels();
      
      const result = await checkNovelUpdates();
      if (result?.hasUpdates) {
        // 只顯示對話框，不發送通知
        Alert.alert(
          '發現更新',
          formatUpdateMessage(result.updates),
          [{ text: '確定', onPress: () => {} }]
        );
      } else {
        Alert.alert('檢查完成', '暫時沒有新的更新');
      }
    } catch (error) {
      logger.error('檢查更新失敗:', error);
      Alert.alert(
        '檢查更新失敗',
        `發生錯誤: ${error instanceof Error ? error.message : '未知錯誤'}\n請稍後重試`
      );
    } finally {
      setContentLoading(false);
    }
  };

  const downloadChapters = async (novelTitle: string) => {
    try {
      if (downloadProgress.isDownloading) {
        Alert.alert('提示', '已有下載任務正在進行中');
        return;
      }

      const novel = novels.find(n => n.title === novelTitle);
      if (!novel) {
        Alert.alert('錯誤', '找不到小說資料');
        return;
      }

      // 加入確認對話框
      Alert.alert(
        '確認下載',
        `確定要下載《${novelTitle}》的所有章節嗎？\n共 ${novel.chapters.length} 章`,
        [
          {
            text: '取消',
            style: 'cancel'
          },
          {
            text: '確定下載',
            onPress: async () => {
              setDownloadProgress({ total: novel.chapters.length, current: 0, isDownloading: true });

              const allChapters = novel.chapters;
              const undownloadedChapters: Chapter[] = [];
  
              // 檢查哪些章節尚未下載（檢查新舊格式）
              for (const chapter of allChapters) {
                const newContentKey = `chapter_${novelTitle}_${chapter.title}`;
                const oldContentKey = `content-${novelTitle}-${chapter.title}`;
                
                // 檢查新格式和舊格式
                const hasNewContent = await getLocalData(newContentKey);
                const hasOldContent = await getLocalData(oldContentKey);
                
                // 如果兩種格式都沒有，才需要下載
                if (!hasNewContent && !hasOldContent) {
                  undownloadedChapters.push(chapter);
                } else if (hasOldContent && !hasNewContent) {
                  // 如果只有舊格式，遷移到新格式
                  await saveLocalData(newContentKey, hasOldContent);
                }
              }

              if (undownloadedChapters.length === 0) {
                setDownloadProgress({
                  total: 0,
                  current: 0,
                  isDownloading: false
                });
                Alert.alert('提示', '所有章節已下載');
                return;
              }

              for (const chapter of undownloadedChapters) {
                try {
                  const resolvedChapterUrl = resolveChapterUrl(chapter.url);
                  const response = await fetch(resolvedChapterUrl);
                  
                  if (!response.ok) {
                    logger.error(`下載章節 ${chapter.title} 失敗: ${response.status}`);
                    continue;
                  }
  
                  const text = await response.text();
                  const contentKey = `chapter_${novelTitle}_${chapter.title}`;
                  await saveLocalData(contentKey, text);
  
                  setDownloadProgress(prev => ({
                    ...prev,
                    current: prev.current + 1
                  }));
                } catch (error) {
                  logger.error(`下載章節 ${chapter.title} 時發生錯誤:`, error);
                }
              }
  
              setDownloadProgress({
                total: 0,
                current: 0,
                isDownloading: false
              });
  
              Alert.alert(
                '下載完成', 
                `成功下載 ${undownloadedChapters.length} 個章節`
              );
            }
          }
        ]
      );
    } catch (error) {
      logger.error('下載過程中發生錯誤:', error);
      setDownloadProgress({
        total: 0,
        current: 0,
        isDownloading: false
      });
      Alert.alert('錯誤', '下載過程中發生錯誤');
    }
  };

  const deleteDownloadedContent = async (novelName: string) => {
    Alert.alert(
      '選擇操作',
      '請選擇要執行的操作',
      [
        {
          text: '刪除已下載章節',
          onPress: async () => {
            Alert.alert(
              '確認刪除',
              '確定要刪除所有已下載的章節嗎？',
              [
                {
                  text: '取消',
                  style: 'cancel'
                },
                {
                  text: '確定',
                  style: 'destructive',
                  onPress: async () => {
                    try {
                      const novel = novels.find(n => n.title === novelName);
                      if (!novel) {
                        throw new Error('找不到小說');
                      }

                      let deletedCount = 0;
                      // 刪除所有已下載的章節（檢查新舊格式）
                      for (const chapter of novel.chapters) {
                        const newContentKey = `chapter_${novelName}_${chapter.title}`;
                        const oldContentKey = `content-${novelName}-${chapter.title}`;
                        
                        // 檢查並刪除新格式
                        const hasNewContent = await getLocalData(newContentKey);
                        if (hasNewContent) {
                          await AsyncStorage.removeItem(newContentKey);
                          deletedCount++;
                        }
                        
                        // 檢查並刪除舊格式
                        const hasOldContent = await getLocalData(oldContentKey);
                        if (hasOldContent) {
                          await AsyncStorage.removeItem(oldContentKey);
                          deletedCount++;
                        }
                      }

                      // 刪除圖片緩存
                      const deletedImageCount = await clearImageCache(novelName);

                      if (deletedCount > 0 || deletedImageCount > 0) {
                        let message = '';
                        if (deletedCount > 0) {
                          message += `已刪除 ${deletedCount} 個已下載的章節`;
                        }
                        if (deletedImageCount > 0) {
                          if (message) message += '\n';
                          message += `已刪除 ${deletedImageCount} 個緩存圖片`;
                        }
                        Alert.alert('刪除完成', message);
                      } else {
                        Alert.alert(
                          '提示',
                          '沒有找到已下載的章節或緩存圖片'
                        );
                      }
                    } catch (error) {
                      logger.error('刪除內容時發生錯誤:', error);
                      Alert.alert('錯誤', '刪除內容時發生錯誤');
                    }
                  }
                }
              ]
            );
          }
        },
        {
          text: '清除已讀狀態',
          onPress: async () => {
            Alert.alert(
              '確認清除',
              '確定要清除所有已讀狀態嗎？',
              [
                {
                  text: '取消',
                  style: 'cancel'
                },
                {
                  text: '確定',
                  style: 'destructive',
                  onPress: async () => {
                    try {
                      // 清除已讀狀態
                      const readCount = readChapters[novelName]?.size || 0;
                      const newReadChapters = { ...readChapters };
                      delete newReadChapters[novelName];
                      setReadChapters(newReadChapters);
                      await saveLocalData('readChapters', Object.fromEntries(
                        Object.entries(newReadChapters).map(([novel, chapters]) => [
                          novel,
                          Array.from(chapters)
                        ])
                      ));

                      Alert.alert(
                        '清除完成',
                        `已清除 ${readCount} 個已讀記錄`
                      );
                    } catch (error) {
                      logger.error('清除已讀狀態時發生錯誤:', error);
                      Alert.alert('錯誤', '清除已讀狀態時發生錯誤');
                    }
                  }
                }
              ]
            );
          }
        },
        {
          text: '取消',
          style: 'cancel'
        }
      ]
    );
  };

  // 防抖保存設定的 ref
  const saveSettingsTimeoutRef = useRef<number | null>(null);

  const handleFontSizeChange = useCallback((newFontSize: number) => {
    setSettings(prev => {
      const updatedSettings = {
        ...prev,
        fontSize: newFontSize
      };
      
      // 清除之前的防抖計時器
      if (saveSettingsTimeoutRef.current) {
        clearTimeout(saveSettingsTimeoutRef.current);
      }
      
      // 設定防抖保存，300ms 後執行
      saveSettingsTimeoutRef.current = setTimeout(() => {
        saveSettings(updatedSettings);
      }, 300) as unknown as number;
      
      return updatedSettings;
    });
  }, []);

  const handleLineHeightChange = useCallback((newLineHeight: number) => {
    setSettings(prev => {
      const updatedSettings = {
        ...prev,
        lineHeight: newLineHeight
      };
      
      // 清除之前的防抖計時器
      if (saveSettingsTimeoutRef.current) {
        clearTimeout(saveSettingsTimeoutRef.current);
      }
      
      // 設定防抖保存，300ms 後執行
      saveSettingsTimeoutRef.current = setTimeout(() => {
        saveSettings(updatedSettings);
      }, 300) as unknown as number;
      
      return updatedSettings;
    });
  }, []);

  // 保留舊的函數以支援重置等操作
  const handleSettingsChange = useCallback((newFontSize: number, newLineHeight: number) => {
    setSettings(prev => {
      const updatedSettings = {
        ...prev,
        fontSize: newFontSize,
        lineHeight: newLineHeight
      };
      
      // 清除之前的防抖計時器
      if (saveSettingsTimeoutRef.current) {
        clearTimeout(saveSettingsTimeoutRef.current);
      }
      
      // 設定防抖保存，300ms 後執行
      saveSettingsTimeoutRef.current = setTimeout(() => {
        saveSettings(updatedSettings);
      }, 300) as unknown as number;
      
      return updatedSettings;
    });
  }, []);

  const handleResetSettings = useCallback(() => {
    // 清除防抖計時器，立即保存重置設定
    if (saveSettingsTimeoutRef.current) {
      clearTimeout(saveSettingsTimeoutRef.current);
    }
    
    setSettings(prev => {
      const resetSettings = {
        ...prev,
        fontSize: DEFAULT_FONT_SIZE,
        lineHeight: DEFAULT_LINE_HEIGHT
      };
      
      // 重置設定立即保存，不使用防抖
      saveSettings(resetSettings);
      
      return resetSettings;
    });
  }, []);

  // 清理防抖計時器
  useEffect(() => {
    return () => {
      if (saveSettingsTimeoutRef.current) {
        clearTimeout(saveSettingsTimeoutRef.current);
      }
    };
  }, []);

  const [forceRefreshCovers, setForceRefreshCovers] = useState(false);

  const handleApiError = (error: any, action: string) => {
    logger.error(`${action}失敗:`, error);
    setError(`${action}失敗: ${error.message || error}`);
    Alert.alert('錯誤', `${action}失敗: ${error.message || '請檢查網絡連接'}`);
  };

  const onRefreshNovels = useCallback(async () => {
    try {
      setRefreshingNovels(true);
      setForceRefreshCovers(true);
      
      // 檢查更新
      const updateResult = await checkNovelUpdates();
      
      // 重新獲取小說列表
      await fetchNovelList();
      
      if (updateResult?.hasUpdates) {
        Alert.alert(
          '發現更新',
          formatUpdateMessage(updateResult.updates),
          [{ text: '確定' }]
        );
      }
    } catch (error) {
      logger.error('刷新失敗:', error);
      handleApiError(error, '刷新小說列表');
    } finally {
      setRefreshingNovels(false);
      setForceRefreshCovers(false);
    }
  }, []);

  const onRefreshChapters = useCallback(async () => {
    if (!currentNovel) return;
    try {
      setRefreshingChapters(true);
      
      // 檢查更新
      const updateResult = await checkNovelUpdates();
      
      // 重新獲取章節列表
      await fetchChapterList(currentNovel);
      
      if (updateResult?.hasUpdates) {
        const novelUpdate = updateResult.updates.find(
          update => update.novelName === currentNovel
        );
        
        if (novelUpdate) {
          Alert.alert(
            '發現更新',
            formatUpdateMessage([novelUpdate]),
            [{ text: '確定' }]
          );
        }
      }
    } catch (error) {
      logger.error('刷新章節失敗:', error);
      handleApiError(error, '刷新章節列表');
    } finally {
      setRefreshingChapters(false);
    }
  }, [currentNovel]);

  const onRefreshContent = useCallback(async () => {
    if (!currentNovel || !lastReadChapter[currentNovel]) return;
    try {
      setRefreshingContent(true);
      
      // 獲取當前章節
      const currentChapterName = lastReadChapter[currentNovel];
      const chapter = chapters.find((c: Chapter) => c.title === currentChapterName);
      
      if (!chapter) {
        logger.error('找不到當前章節');
        return;
      }

      // 直接重新獲取章節內容
      await fetchChapterContent(chapter);
      
    } catch (error) {
      logger.error('刷新內容失敗:', error);
      setError(error instanceof Error ? error.message : '未知錯誤');
    } finally {
      setRefreshingContent(false);
    }
  }, [currentNovel, lastReadChapter, chapters, fetchChapterContent]);

  const [currentSort, setCurrentSort] = useState<SortOption>('lastUpdated');

  const sortNovels = useCallback((novels: Novel[]) => {
    return [...novels].sort((a, b) => {
      switch (currentSort) {
        case 'lastUpdated':
          const aLastUpdated = a.chapters[a.chapters.length - 1]?.lastUpdated || '';
          const bLastUpdated = b.chapters[b.chapters.length - 1]?.lastUpdated || '';
          return new Date(bLastUpdated).getTime() - new Date(aLastUpdated).getTime();
        case 'chapterCount':
          return b.chapters.length - a.chapters.length;
        case 'wordCount':
          const aWordCount = a.totalWordCount || 0;
          const bWordCount = b.totalWordCount || 0;
          return bWordCount - aWordCount;
        default:
          return 0;
      }
    });
  }, [currentSort]);

  const sortedNovels = useMemo(() => sortNovels(novels), [novels, sortNovels]);
  const sortedFilteredNovels = useMemo(() => 
    filteredNovels.length > 0 ? sortNovels(filteredNovels) : sortedNovels
  , [filteredNovels, sortNovels, sortedNovels]);

  const handleSortChange = (sortOption: SortOption) => {
    setCurrentSort(sortOption);
    if (!chapters) return;

    const sortedChapters = [...chapters].sort((a, b) => {
      switch (sortOption) {
        case 'lastUpdated':
          const dateA = new Date(a.lastUpdated).getTime();
          const dateB = new Date(b.lastUpdated).getTime();
          return dateB - dateA;
        case 'chapterCount':
          const numA = parseInt(a.title.match(/\d+/)?.[0] || '0', 10);
          const numB = parseInt(b.title.match(/\d+/)?.[0] || '0', 10);
          return numA - numB;
        case 'wordCount':
          // 這裡需要實際的字數數據，暫時用標題長度代替
          return b.title.length - a.title.length;
        default:
          return 0;
      }
    });

    setChapters(sortedChapters);
  };

  const markChapterAsRead = useCallback(async (novelTitle: string, chapterTitle: string) => {
    setReadChapters(prev => {
      const novelChapters = prev[novelTitle] || new Set();
      novelChapters.add(chapterTitle);
      const newReadChapters = {
        ...prev,
        [novelTitle]: novelChapters
      };
      
      // 將 Set 轉換為陣列後儲存
      const saveData = Object.entries(newReadChapters).reduce(
        (acc, [novel, chaptersSet]) => ({
          ...acc,
          [novel]: Array.from(chaptersSet as Set<string>)
        }), 
        {}
      );
      saveLocalData('readChapters', saveData);
      return newReadChapters;
    });
  }, []);

  useEffect(() => {
    if (currentNovel && lastReadChapter[currentNovel]) {
      markChapterAsRead(currentNovel, lastReadChapter[currentNovel]);
    }
  }, [currentNovel, lastReadChapter]);

  const styles = useMemo(() => StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: getBackgroundColor(),
    },
    listContainer: {
      padding: 10,
    },
    contentContainer: {
      padding: 10,
    },
    content: {
      fontSize: 18,
      lineHeight: 26,
      color: getTextColor(),
      marginBottom: 20,
    } as TextStyle,
    chapterItem: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 12,
      paddingHorizontal: 16,
      borderBottomWidth: 1,
      borderBottomColor: '#e1e1e1',
    },
    chapterItemContent: {
      flex: 1,
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    chapterLeftContent: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      marginRight: 12,
    },
    chapterRightContent: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    chapterTitle: {
      flex: 1,
      fontSize: 14,
      marginRight: 12,
      color: getTextColor(),
    },
    readChapterTitle: {
      color: settings.theme === 'dark' ? '#999999' : '#999999',
    },
    chapterDate: {
      fontSize: 12,
      color: settings.theme === 'dark' ? '#999999' : '#666666',
      minWidth: 75,
      textAlign: 'right',
    },
    readChapter: {
      backgroundColor: settings.theme === 'dark' ? '#2c2c2c' : 
        settings.theme === 'eyeComfort' ? '#f0e6d6' : '#f0f0f0',
    },
    lastReadChapter: {
      backgroundColor: settings.theme === 'dark' ? '#1e3a5f' : 
        settings.theme === 'eyeComfort' ? '#e6d6c4' : '#e6f3ff',
    },
    item: {
      padding: 15,
      borderBottomWidth: 1,
      borderBottomColor: getBackgroundColor() === '#ffffff' ? '#eeeeee' : '#333333',
    },
    lastReadItem: {
      backgroundColor: getBackgroundColor() === '#ffffff' ? '#e6f3ff' : '#1e3a5f',
    },
    title: {
      fontSize: 16,
      color: getTextColor(),
      flex: 1,
      marginRight: 8,
    },
    error: {
      color: 'red',
      padding: 15,
      textAlign: 'center',
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      height: 48,
    },
    headerRight: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    headerTitle: {
      fontSize: 20,
      fontWeight: 'bold' as const,
      color: getTextColor(),
    },
    backButton: {
      width: 40,
      height: 40,
      justifyContent: 'center',
      alignItems: 'center',
      marginRight: 8,
    },
    // 移除 statusBarPlaceholder，因為已經使用 SafeAreaView
    loadingContainer: {
      paddingTop: '100%',
      top: 0,
      bottom: 0,
      left: 0,
      right: 0,
      justifyContent: 'center',
      alignItems: 'center',
      gap: 10,
    },
    loadingText: {
      fontSize: 16,
      color: getTextColor(),
      marginTop: 10,
    },
    navigationBar: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingBottom: insets.bottom > 0 ? 0 : 4,
      paddingTop: 2,
      paddingHorizontal: 10,
      backgroundColor: getBackgroundColor(),
    },
    button: {
      padding: 8,
      borderRadius: 5,
    },
    buttonText: {
      color: getTextColor(),
      textAlign: 'center',
    },
    themeButton: {
      padding: 10,
      backgroundColor: getBackgroundColor(),
      borderRadius: 5,
      margin: 10,
    },
    updateButton: {
      padding: 10,
      backgroundColor: '#4CAF50',
      borderRadius: 5,
      margin: 10,
    },
    chapterRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      flex: 1,
    },
    statusContainer: {
      flexDirection: 'row',
      marginLeft: 8,
    },
    badge: {
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: 4,
      marginLeft: 4,
    },
    newBadge: {
      backgroundColor: '#4CAF50',
    },
    modifiedBadge: {
      backgroundColor: '#2196F3',
    },
    badgeText: {
      color: '#ffffff',
      fontSize: 10,
      fontWeight: 'bold' as const,
    },
    headerButton: {
      width: 40,
      height: 40,
      justifyContent: 'center',
      alignItems: 'center',
      borderRadius: 20,
      marginLeft: 8,
    },
    downloadButton: {
      width: 40,
      height: 40,
      justifyContent: 'center',
      alignItems: 'center',
      borderRadius: 20,
    },
    downloadProgress: {
      position: 'absolute',
      top: insets.top + 1,
      left: 0,
      right: 0,
      flexDirection: 'row',
      justifyContent: 'center',
      alignItems: 'center',
      padding: 8,
      backgroundColor: getBackgroundColor() === '#ffffff' ? '#f5f5f5' : '#333333',
      zIndex: 1000,
    },
    downloadText: {
      color: getTextColor(),
      marginRight: 8,
    },
    markdownImage: {
      width: '100%' as const,
      height: undefined,
      aspectRatio: 1,
      resizeMode: 'contain' as const,
      backgroundColor: getBackgroundColor(),
      marginVertical: 10,
      marginHorizontal: -16, // 抵消 contentContainer 的 padding
    },
    imageLoadingContainer: {
      alignItems: 'center',
      justifyContent: 'center',
      height: 200,
    },
    settingsButton: {
      width: 40,
      height: 40,
      justifyContent: 'center',
      alignItems: 'center',
      borderRadius: 20,
      position: 'absolute',
      right: 8,
      top: 0,
    },
    timeText: {
      fontSize: 12,
    },
    novelDetailContainer: {
      padding: 16,
      backgroundColor: getBackgroundColor(),
    },
    coverAndInfoContainer: {
      flexDirection: 'row',
      marginBottom: 16,
    },
    novelCover: {
      width: 120,
      height: 160,
      borderRadius: 8,
    },
    novelInfo: {
      flex: 1,
      marginLeft: 16,
    },
    novelTitle: {
      fontSize: 18,
      fontWeight: 'bold' as const,
      marginBottom: 8,
    },
    novelAuthor: {
      fontSize: 14,
      color: '#666666',
      marginBottom: 8,
    },
    novelOriginalUrl: {
      fontSize: 14,
      color: '#007AFF',
      marginBottom: 4,
      textDecorationLine: 'underline',
    },
    originalUrlContainer: {
      marginBottom: 8,
    },
    tagsContainer: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      marginBottom: 8,
    },
    tag: {
      padding: 4,
      paddingHorizontal: 8,
      borderRadius: 4,
      backgroundColor: '#f0f0f0',
      marginRight: 8,
      marginBottom: 8,
    },
    tagText: {
      fontSize: 12,
      color: '#666666',
    },
    novelDescription: {
      fontSize: 14,
      color: '#666666',
    },
    expandButton: {
      paddingVertical: 4,
    },
    expandButtonText: {
      fontSize: 14,
      color: '#2196F3',
    },
    chapterEndContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      marginVertical: 15,
      marginHorizontal: -16,
      paddingHorizontal: 16,
    },
    chapterEndDivider: {
      flex: 1,
      height: 1,
      backgroundColor: settings.theme === 'dark' ? '#555555' : 
                       settings.theme === 'eyeComfort' ? '#d4c4a8' : '#e0e0e0',
    },
    chapterEndText: {
      fontSize: 14,
      color: settings.theme === 'dark' ? '#888888' : 
             settings.theme === 'eyeComfort' ? '#8a7a6a' : '#666666',
      fontWeight: '500',
      marginHorizontal: 16,
      fontStyle: 'italic',
    },
  }), [settings.theme, getBackgroundColor, getTextColor, insets]);

  // 預編譯的 Markdown 樣式，避免每次渲染都重新計算
  const markdownStyles = useMemo(() => ({
    body: {
      ...styles.content,
      fontSize: settings.fontSize,
      lineHeight: Platform.OS === 'android' 
        ? Math.max(settings.fontSize * settings.lineHeight, settings.fontSize + 6)
        : Math.max(settings.fontSize * settings.lineHeight, settings.fontSize + 4),
      color: getTextColor(),
      includeFontPadding: true,
      ...(Platform.OS === 'android' && {
        allowFontScaling: false,
      }),
    },
    paragraph: {
      fontSize: settings.fontSize,
      lineHeight: Platform.OS === 'android' 
        ? Math.max(settings.fontSize * settings.lineHeight, settings.fontSize + 6)
        : Math.max(settings.fontSize * settings.lineHeight, settings.fontSize + 4),
      color: getTextColor(),
      marginVertical: Platform.OS === 'android' ? 6 : 4,
      includeFontPadding: true,
      textAlignVertical: 'center' as const,
      ...(Platform.OS === 'android' && {
        allowFontScaling: false,
      }),
    },
    strong: {
      fontWeight: 'bold' as const,
      color: getTextColor()
    },
    em: {
      fontWeight: 'bold' as const,
      color: getTextColor()
    },
    image: {
      width: '100%' as const,
      height: undefined,
      aspectRatio: 1,
      resizeMode: 'contain' as const,
      marginVertical: 10,
      marginHorizontal: -16,
    },
    heading1: {
      fontSize: 22,
      fontWeight: 'bold' as const,
      color: getTextColor(),
      lineHeight: 32,
      includeFontPadding: true,
      textAlignVertical: 'center' as const,
      width: '100%' as const,
      flexShrink: 0,
    },
    heading2: {
      fontSize: 18,
      fontWeight: 'bold' as const,
      color: getTextColor(),
      lineHeight: 26,
      includeFontPadding: true,
      textAlignVertical: 'center' as const,
      width: '100%' as const,
      flexShrink: 0,
    },
    heading3: {
      fontSize: 16,
      fontWeight: 'bold' as const,
      color: getTextColor(),
      lineHeight: 22,
      includeFontPadding: true,
      textAlignVertical: 'center' as const,
      width: '100%' as const,
      flexShrink: 0,
    },
  }), [settings.fontSize, settings.lineHeight, getTextColor, styles.content]);

  // 預編譯的標題容器樣式
  const headingContainerStyles = useMemo(() => ({
    heading1Container: {
      marginVertical: 16,
      marginHorizontal: -16,
      paddingHorizontal: 16,
      paddingBottom: 8,
      borderBottomWidth: 1,
      borderBottomColor: getBackgroundColor() === '#ffffff' ? '#eeeeee' : '#333333',
    },
    heading2Container: {
      marginVertical: 8,
      marginHorizontal: -16,
      paddingHorizontal: 16,
    },
    heading3Container: {
      marginVertical: 6,
      marginHorizontal: -16,
      paddingHorizontal: 16,
    },
  }), [getBackgroundColor]);

  // 優化的 Markdown 渲染規則
  const markdownRules = useMemo(() => ({
    paragraph: (node: any, children: any, _parent: any, _styles: any) => (
      <View key={node.key} style={{ 
        marginVertical: Platform.OS === 'android' ? 6 : 4,
        width: '100%',
        flexDirection: 'row',
        flexWrap: 'wrap'
      }}>
        <Text 
          style={{
            fontSize: settings.fontSize,
            lineHeight: Platform.OS === 'android' 
              ? Math.max(settings.fontSize * settings.lineHeight, settings.fontSize + 8)
              : Math.max(settings.fontSize * settings.lineHeight, settings.fontSize + 4),
            color: getTextColor(),
            includeFontPadding: true,
            textAlignVertical: 'center' as const,
            width: '100%',
            flexShrink: 1,
            flexWrap: 'wrap',
            ...(Platform.OS === 'android' && {
              allowFontScaling: false,
            }),
          }}
        >
          {children}
        </Text>
      </View>
    ),
    image: (node: any, _children: any, _parent: any, _styles: any) => {
      const { src } = node.attributes;
      return <MarkdownImage 
        key={node.key} 
        src={src} 
        isDarkMode={settings.theme === 'dark'} 
        backgroundColor={getBackgroundColor()}
        onImagePress={openLightbox}
        novelTitle={currentNovel ?? undefined}
        chapterTitle={currentNovel ? lastReadChapter[currentNovel] : undefined}
      />;
    },
    heading1: (node: any, children: any, _parent: any, _styles: any) => (
      <View key={node.key} style={headingContainerStyles.heading1Container}>
        <Text style={markdownStyles.heading1}>
          {children}
        </Text>
      </View>
    ),
    heading2: (node: any, children: any, _parent: any, _styles: any) => (
      <View key={node.key} style={headingContainerStyles.heading2Container}>
        <Text style={markdownStyles.heading2}>
          {children}
        </Text>
      </View>
    ),
    heading3: (node: any, children: any, _parent: any, _styles: any) => (
      <View key={node.key} style={headingContainerStyles.heading3Container}>
        <Text style={markdownStyles.heading3}>
          {children}
        </Text>
      </View>
    ),
  }), [settings.theme, getBackgroundColor, markdownStyles, headingContainerStyles, openLightbox, settings.fontSize, settings.lineHeight, getTextColor, currentNovel, lastReadChapter]);

  // 渲染章節內容
  const renderChapterContent = useCallback(() => {
    return (
      <CustomScrollView 
        ref={contentScrollViewRef}
        style={[
          styles.contentContainer,
          { 
            backgroundColor: getBackgroundColor(),
            paddingHorizontal: 16,
            flex: 1
          }
        ]}
        onScroll={(event) => {
          if (currentNovel && lastReadChapter[currentNovel]) {
            handleScroll(
              `${currentNovel}-${lastReadChapter[currentNovel]}`,
              event.nativeEvent.contentOffset.y
            );
          }
        }}
        onScrollBeginDrag={(e) => e.persist()}
        indicatorColor={settings.theme === 'dark' ? '#ffffff' : '#000000'}
        indicatorWidth={4}
        autoHide={true}
        hideTimeout={2000}
        refreshControl={
          <RefreshControl
            refreshing={refreshingContent}
            onRefresh={onRefreshContent}
            colors={[getTextColor()]}
            tintColor={getTextColor()}
          />
        }
      >
        <Markdown 
          style={markdownStyles as any}
          mergeStyle={true}
          rules={markdownRules}
        >
          {currentContent}
        </Markdown>
        
        {/* 章節結束提示 */}
        <View style={styles.chapterEndContainer}>
          <View style={styles.chapterEndDivider} />
          <Text style={styles.chapterEndText}>本話結束</Text>
          <View style={styles.chapterEndDivider} />
        </View>
      </CustomScrollView>
    );
  }, [currentContent, markdownStyles, markdownRules, getBackgroundColor, getTextColor, handleScroll, refreshingContent, onRefreshContent, contentScrollViewRef, styles]);

  const [isDescriptionExpanded, setIsDescriptionExpanded] = useState(false);

  useEffect(() => {
    const loadInitialData = async () => {
      try {
        // 優先從網路載入最新數據
        try {
          await fetchNovelList();
        } catch (networkError) {
          logger.error('網路載入失敗，嘗試使用本地數據:', networkError);
          
          // 網路載入失敗時才使用本地數據
          const localNovels = await getLocalData('novels');
          if (localNovels && Array.isArray(localNovels) && localNovels.length > 0) {
            setNovels(localNovels);
            setFilteredNovels(localNovels);
          } else {
            // 如果連本地數據都沒有，顯示錯誤
            setError('無法載入小說數據，請檢查網路連接');
          }
        }
      } catch (error) {
        logger.error('初始化載入失敗:', error);
        setError('初始化失敗，請重新啟動應用程式');
      } finally {
        setIsAppReady(true);
      }
    };

    loadInitialData();
  }, []);

  useEffect(() => {
    const backAction = () => {
      if (currentContent) {
        handleReturnToChapters().catch(error => logger.error('返回章節列表失敗:', error));
        return true;
      } else if (chapters.length > 0) {
        handleReturnToNovels().catch(error => logger.error('返回小說列表失敗:', error));
        return true;
      } else if (novels.length > 0) {
        BackHandler.exitApp();
        return true;
      }

      return false;
    };
  
    const backHandler = BackHandler.addEventListener(
      'hardwareBackPress',
      backAction
    );
  
    return () => backHandler.remove();
  }, [currentContent, chapters.length, novels.length, handleReturnToChapters, handleReturnToNovels]);

  useEffect(() => {
    const initialize = async () => {
      try {
        await loadSettings();
        
        // 初始化導航欄顏色
        if (Platform.OS === 'android') {
          const theme = settings.theme || 'light';
          const navigationBarColor = theme === 'dark' ? '#333333' : 
                                   theme === 'eyeComfort' ? '#f9f1e6' : '#ffffff';
          const isLight = theme === 'light' || theme === 'eyeComfort';
          
          // 嘗試多種方法設置導航欄
          Promise.all([
            // 方法1: 使用 expo-system-ui 設置導航欄背景
            SystemUI.setBackgroundColorAsync(navigationBarColor).catch(() => {}),
            // 方法2: 使用第三方庫設置導航欄和按鍵顏色
            safeChangeNavigationBarColor(navigationBarColor, isLight, true)
          ]).catch(() => {
            logger.warn('無法設置導航欄顏色');
          });
        }
        
        // 只在支持的環境中請求通知權限
        if (isNotificationSupported) {
          try {
            const { status: existingStatus } = await Notifications.getPermissionsAsync();
            let finalStatus = existingStatus;
            if (existingStatus !== 'granted') {
              const { status } = await Notifications.requestPermissionsAsync();
              finalStatus = status;
            }
            
            if (finalStatus === 'granted') {
              await setupNotifications();
              await registerBackgroundFetch();
            }
          } catch (error) {
            logger.error('設置通知權限失敗:', error);
          }
        } else {
          logger.warn('在 Expo Go 中跳過通知設置');
        }
        
        // 添加清理過期標記的調用
        await cleanExpiredNewLabels();
        
        const updateResult = await checkNovelUpdates();
        if (updateResult?.hasUpdates) {
          // 改為顯示對話框而不是發送通知
          setTimeout(() => {
            Alert.alert(
              '發現更新',
              formatUpdateMessage(updateResult.updates),
              [{ text: '確定', onPress: () => {} }]
            );
          }, 1000); // 稍微延遲確保UI已完全加載
        }
        
        await new Promise(resolve => setTimeout(resolve, 0));
        setIsAppReady(true);
      } catch (error) {
        logger.error(error);
      }
    };

    initialize();
  }, []);

  useEffect(() => {
    // 在 New Architecture 中這個 API 已經不再需要
    if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
      try {
        UIManager.setLayoutAnimationEnabledExperimental(true);
      } catch (error) {
        // 在 New Architecture 中這是 no-op，忽略錯誤
      }
    }
  }, []);

  // AppState 監聽邏輯 - 監聽應用程式從背景回到前景
  useEffect(() => {
    let lastActiveTime = Date.now();
    const REFRESH_INTERVAL = 5 * 60 * 1000; // 5分鐘
    
    const handleAppStateChange = async (nextAppState: string) => {
      if (nextAppState === 'active') {
        const now = Date.now();
        
        // 如果距離上次活躍時間超過設定間隔，則刷新數據
        if (now - lastActiveTime > REFRESH_INTERVAL) {
          logger.log('應用程式回到前景，刷新數據');
          
          try {
            // 優先刷新小說列表
            await fetchNovelList();
            
            // 如果當前有選中的小說，也刷新章節列表
            if (currentNovel) {
              await fetchChapterList(currentNovel);
            }
          } catch (error) {
            logger.error('回到前景時刷新數據失敗:', error);
          }
        }
        
        lastActiveTime = now;
      } else if (nextAppState === 'background' || nextAppState === 'inactive') {
        // 當應用程式進入背景或非活躍狀態時，保存當前滾動位置
        try {
          // 保存所有當前設置和滾動位置
          const newSettings = {
            ...settings,
            lastReadChapter,
            scrollPosition
          };
          await saveLocalData('settings', newSettings);
          logger.log('應用程式進入背景，已保存滾動位置和設置');
        } catch (error) {
          logger.error('保存背景狀態失敗:', error);
        }
      }
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);
    
    return () => {
      subscription?.remove();
      
      // 組件卸載時保存當前狀態
      const saveOnUnmount = async () => {
        try {
          const newSettings = {
            ...settings,
            lastReadChapter,
            scrollPosition
          };
          await saveLocalData('settings', newSettings);
          logger.log('組件卸載時已保存滾動位置和設置');
        } catch (error) {
          logger.error('組件卸載時保存狀態失敗:', error);
        }
      };
      
      saveOnUnmount();
    };
  }, [currentNovel]);

  useEffect(() => {
    setFilteredNovels(novels);
  }, [novels]);
  
  useEffect(() => {
    const loadReadChapters = async () => {
      const savedReadChapters = await getLocalData('readChapters');
      if (savedReadChapters) {
        // 將物件的值轉換為 Set
        const convertedReadChapters = Object.entries(savedReadChapters).reduce(
          (acc, [novel, chapters]) => ({
            ...acc,
            [novel]: new Set(chapters as string[])
          }), 
          {}
        );
        setReadChapters(convertedReadChapters);
      }
    };
    loadReadChapters();
  }, []);

  // 解析版本號為數組，例如將 "1.2.5" 轉換為 [1, 2, 5]
  const parseVersion = (version: string): number[] => {
    return version.split('.').map(Number);
  };

  // 比較兩個版本號，返回 1 表示 v1 > v2，-1 表示 v1 < v2，0 表示相等
  const compareVersions = (v1: string, v2: string): number => {
    const parts1 = parseVersion(v1);
    const parts2 = parseVersion(v2);
    
    for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
      const part1 = parts1[i] || 0;
      const part2 = parts2[i] || 0;
      
      if (part1 > part2) return 1;
      if (part1 < part2) return -1;
    }
    
    return 0; // 版本相同
  };

  // 檢查應用更新
  const checkAppUpdate = async (): Promise<void> => {
    try {
      setUpdateChecking(true);
      
      // 使用正確的方式獲取應用版本
      let currentVersion;
      
      // 判斷應用是否在 Expo Go 中運行
      if (Constants.appOwnership === 'expo') {
        // 從 app.json 獲取版本號（在 Expo Go 中運行時）
        currentVersion = '1.2.11'; // 硬編碼 app.json 中的版本號
      } else {
        // 已構建的應用使用原生應用版本
        currentVersion = Application.nativeApplicationVersion || '1.0.0';
      }
      
      logger.log('當前版本:', currentVersion);
      
      // 獲取遠程版本信息
      const response = await fetch('https://raw.githubusercontent.com/xuerowo/myacgn/main/輕小說翻譯/version.json');
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const versionData = await response.json();
      
      // 從 history 陣列中取得最新版本資訊（第一個元素為最新）
      const latestVersion = versionData.history[0];
      
      logger.log('遠程版本:', latestVersion.version);
      logger.log('比較結果:', compareVersions(latestVersion.version, currentVersion));
      
      // 比較版本號來決定是否顯示更新提示
      if (compareVersions(latestVersion.version, currentVersion) > 0) {
        const buttons = [
          { text: '稍後', style: 'cancel' as const },
          { 
            text: '立即更新', 
            onPress: () => Linking.openURL(versionData.downloadUrl) 
          }
        ];
        
        // 如果有完整更新日誌URL，添加查看更新日誌按鈕
        if (versionData.fullChangelogUrl) {
          buttons.splice(1, 0, {
            text: '查看更新日誌',
            onPress: () => Linking.openURL(versionData.fullChangelogUrl)
          });
        }
        
        Alert.alert(
          '發現新版本',
          `新版本 ${latestVersion.version} 已發布\n發布日期：${latestVersion.date}\n\n${latestVersion.changes}`,
          buttons
        );
      } else {
        const buttons: any[] = [
          { text: '確定', style: 'default' as const }
        ];
        
        // 如果有完整更新日誌URL，添加查看更新日誌按鈕
        if (versionData.fullChangelogUrl) {
          buttons.splice(0, 0, {
            text: '查看更新日誌',
            onPress: () => Linking.openURL(versionData.fullChangelogUrl)
          });
        }
        
        Alert.alert(
          '沒有新版本',
          `您已經使用最新版本\n當前版本：${currentVersion}`,
          buttons
        );
      }
    } catch (error) {
      handleApiError(error, '檢查更新');
    } finally {
      setUpdateChecking(false);
    }
  };

  if (!isAppReady) {
    return null;
  }

  if (error) {
    return (
      <SafeAreaView style={styles.container}>
        <Text style={styles.error}>{error}</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar 
        backgroundColor={getStatusBarColor()}
        barStyle={getStatusBarStyle()}
        translucent={false}
      />
      {novelsLoading || chaptersLoading || contentLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={getTextColor()} />
          <Text style={styles.loadingText}>
            {contentLoading
            ? '正在載入閱讀內容...'
            : chaptersLoading
            ? '正在載入章節列表...'
            : '正在載入小說列表...'}
          </Text>
        </View>
      ) : currentContent ? (
        <View style={{ flex: 1 }}>
          <View style={styles.header}>
            <TouchableOpacity
              style={styles.backButton}
              onPress={() => handleReturnToChapters().catch(error => logger.error('返回章節列表失敗:', error))}
            >
              <MaterialIcons 
                name="chevron-left" 
                size={32}
                color={getTextColor()} 
              />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.settingsButton}
              onPress={() => setSettingsVisible(true)}
            >
              <MaterialIcons 
                name="more-vert"
                size={24}
                color={getTextColor()} 
              />
            </TouchableOpacity>
          </View>
          {renderChapterContent()}
          <ReadingSettings
            visible={settingsVisible}
            onClose={() => setSettingsVisible(false)}
            isDarkMode={settings.isDarkMode}
            fontSize={settings.fontSize}
            lineHeight={settings.lineHeight}
            onFontSizeChange={handleFontSizeChange}
            onLineHeightChange={handleLineHeightChange}
            onReset={handleResetSettings} 
            theme={settings.theme}
            onThemeChange={handleThemeChange}
          />
          {!settingsVisible && (
            <View style={styles.navigationBar}>
              <TouchableOpacity
                style={styles.button}
                onPress={() => navigateChapter('prev').catch(error => logger.error('切換章節失敗:', error))}
                disabled={isFirstChapter()}
              >
                <MaterialIcons 
                  name="arrow-back" 
                  size={22} 
                  color={isFirstChapter() ? `${getTextColor()}50` : getTextColor()} 
                />
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.button}
                onPress={() => navigateChapter('next').catch(error => logger.error('切換章節失敗:', error))}
                disabled={isLastChapter()}
              >
                <MaterialIcons 
                  name="arrow-forward" 
                  size={22} 
                  color={isLastChapter() ? `${getTextColor()}50` : getTextColor()} 
                />
              </TouchableOpacity>
            </View>
          )}
        </View>
      ) : chapters.length > 0 ? (
        <View style={{ flex: 1 }}>
          <View style={styles.header}>
            <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
              <TouchableOpacity
                style={styles.backButton}
                onPress={() => handleReturnToNovels().catch(error => logger.error('返回小說列表失敗:', error))}
              >
                <MaterialIcons 
                  name="chevron-left" 
                  size={32}
                  color={getTextColor()} 
                />
              </TouchableOpacity>
              <Text style={styles.headerTitle}>章節列表</Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <TouchableOpacity
                style={styles.downloadButton}
                onPress={() => currentNovel && downloadChapters(currentNovel)}
                disabled={downloadProgress.isDownloading}
              >
                <MaterialIcons 
                  name="file-download" 
                  size={24}
                  color={getTextColor()} 
                />
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.headerButton}
                onPress={() => currentNovel && deleteDownloadedContent(currentNovel)}
                disabled={downloadProgress.isDownloading}
              >
                <MaterialIcons 
                  name="delete" 
                  size={24}
                  color={getTextColor()} 
                />
              </TouchableOpacity>
            </View>
            {downloadProgress.isDownloading && (
              <View style={styles.downloadProgress}>
                <Text style={styles.downloadText}>
                  正在下載: {downloadProgress.current}/{downloadProgress.total}
                </Text>
                <ActivityIndicator 
                  size="small" 
                  color={getTextColor()} 
                />
              </View>
            )}
          </View>
          <ChapterList
            ListHeaderComponent={
              <View style={styles.novelDetailContainer}>
                <View style={styles.coverAndInfoContainer}>
                  <CachedCoverImage
                    coverPath={novels.find(n => n.title === currentNovel)?.cover || ''}
                    novelTitle={currentNovel || ''}
                    style={styles.novelCover}
                    isDarkMode={settings.theme === 'dark'}
                    onPress={() => {
                      const coverUrl = resolveCoverUrl(novels.find(n => n.title === currentNovel)?.cover || '');
                      const coverUrlWithTimestamp = `${coverUrl}?t=${Date.now()}`;
                      openLightbox(coverUrlWithTimestamp);
                    }}
                  />
                  <View style={styles.novelInfo}>
                    <Text style={[styles.novelTitle, { color: getTextColor() }]}>
                      {currentNovel}
                    </Text>
                    <Text style={[styles.novelAuthor, { color: getTextColor() }]}>
                      作者：{novels.find(n => n.title === currentNovel)?.author}
                    </Text>
                    <View style={styles.originalUrlContainer}>
                      <Text style={{ color: getTextColor() }}>原連結：</Text>
                      <View style={{ flex: 1 }}>
                        {novels.find(n => n.title === currentNovel)?.originalUrl.split('、').map((url, index) => (
                          <TouchableOpacity
                            key={index}
                            onPress={() => {
                              if (url) {
                                Linking.openURL(url.trim());
                              }
                            }}
                          >
                            <Text style={styles.novelOriginalUrl}>
                              {url.trim()}
                            </Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    </View>
                    <View style={styles.tagsContainer}>
                      {novels.find(n => n.title === currentNovel)?.tags.map((tag, index) => (
                        <View key={index} style={styles.tag}>
                          <Text style={styles.tagText}>{tag}</Text>
                        </View>
                      ))}
                    </View>
                  </View>
                </View>
                <View>
                  <View style={{ maxHeight: isDescriptionExpanded ? undefined : 120, overflow: 'hidden' }}>
                    <Markdown 
                      style={{
                        body: {
                          fontSize: 14,
                          color: getTextColor(),
                        },
                        strong: {
                          fontWeight: 'bold' as const,
                          color: getTextColor()
                        },
                        em: {
                          fontStyle: 'italic',
                          color: getTextColor()
                        },
                        heading1: {
                          fontSize: 18,
                          fontWeight: 'bold' as const,
                          color: getTextColor(),
                          marginVertical: 8,
                          width: '100%' as const, // 確保標題佔滿可用寬度
                          lineHeight: 26, // 固定行高確保標題完整顯示
                        },
                        heading2: {
                          fontSize: 16,
                          fontWeight: 'bold' as const,
                          color: getTextColor(),
                          marginVertical: 6,
                          width: '100%' as const, // 確保標題佔滿可用寬度
                          lineHeight: 22, // 固定行高確保標題完整顯示
                        },
                        heading3: {
                          fontSize: 15,
                          fontWeight: 'bold' as const,
                          color: getTextColor(),
                          marginVertical: 4,
                          width: '100%' as const, // 確保標題佔滿可用寬度
                          lineHeight: 20, // 固定行高確保標題完整顯示
                        },
                        paragraph: {
                          marginVertical: 4,
                        },
                      }}
                    >
                      {novels.find(n => n.title === currentNovel)?.description}
                    </Markdown>
                  </View>
                  <TouchableOpacity 
                    style={styles.expandButton}
                    onPress={() => setIsDescriptionExpanded(!isDescriptionExpanded)}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <Text style={[styles.expandButtonText, { color: '#2196F3' }]}>
                        {isDescriptionExpanded ? '收起' : '展開'}
                      </Text>
                      <MaterialIcons
                        name={isDescriptionExpanded ? 'keyboard-arrow-up' : 'keyboard-arrow-down'}
                        size={20}
                        color="#2196F3"
                        style={{ marginLeft: 4 }}
                      />
                    </View>
                  </TouchableOpacity>
                </View>
              </View>
            }
            chapters={chapters.filter(chapter => chapter.id !== -1)}
            currentNovel={currentNovel}
            onSelectChapter={fetchChapterContent}
            lastReadChapter={lastReadChapter[currentNovel ?? '']}
            readChapters={currentNovel ? readChapters[currentNovel] ?? new Set() : new Set()}
            styles={styles}
            scrollViewRef={chaptersScrollViewRef}
            onScroll={(event) => handleScroll(`${currentNovel}-chapters`, event.nativeEvent.contentOffset.y)}
            refreshControl={
              <RefreshControl
                refreshing={refreshingChapters}
                onRefresh={onRefreshChapters}
                colors={[getTextColor()]}
                tintColor={getTextColor()}
              />
            }
            theme={settings.theme}
          />
        </View>
     ) : (
      <View style={{ flex: 1 }}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>輕小說</Text>
          <View style={styles.headerRight}>
            <TouchableOpacity
              style={styles.headerButton}
              onPress={checkAppUpdate}
              disabled={updateChecking}
            >
              {updateChecking ? (
                <ActivityIndicator size="small" color={getTextColor()} />
              ) : (
                <MaterialIcons 
                  name="system-update" 
                  size={24}
                  color={getTextColor()} 
                />
              )}
            </TouchableOpacity>
            <SortSelector
              currentSort={currentSort}
              onSortChange={setCurrentSort}
              isDarkMode={settings.theme === 'dark'}
            />
          </View>
        </View>
        <SearchBar 
          onSearch={handleSearch} 
          isDarkMode={settings.theme === 'dark'}
        />
        <NovelGrid
          novels={sortedFilteredNovels}
          onSelectNovel={(novel) => fetchChapterList(novel.title)}
          isLoading={novelsLoading}
          isDarkMode={settings.theme === 'dark'}
          theme={settings.theme}
          contentContainerStyle={{ paddingBottom: insets.bottom + 20 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshingNovels}
              onRefresh={onRefreshNovels}
              colors={[getTextColor()]}
              tintColor={getTextColor()}
            />
          }
          forceRefreshCovers={forceRefreshCovers}
        />
      </View>
      )}
      
      {/* Lightbox 元件 */}
      <Modal
        visible={lightboxVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={closeLightbox}
      >
        <View style={{ 
          flex: 1, 
          backgroundColor: '#000000',
          justifyContent: 'center',
          alignItems: 'center'
        }}>
          {/* 關閉按鈕區域 */}
          <Pressable
            style={{
              position: 'absolute',
              top: 40,
              right: 20,
              width: 40,
              height: 40,
              borderRadius: 20,
              backgroundColor: 'rgba(0,0,0,0.5)',
              justifyContent: 'center',
              alignItems: 'center',
              zIndex: 10
            }}
            onPress={closeLightbox}
          >
            <Text style={{ color: 'white', fontSize: 18, fontWeight: 'bold' }}>×</Text>
          </Pressable>
          
          {lightboxImages.length > 0 && (
            <LightboxImageViewerWithHOC imageUri={lightboxImages[lightboxIndex]?.uri} />
          )}
        </View>
      </Modal>
    </SafeAreaView>
  );
};

const AppWrapper: React.FC = () => {
  return (
    <SafeAreaProvider>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <App />
      </GestureHandlerRootView>
    </SafeAreaProvider>
  );
};

export default AppWrapper;