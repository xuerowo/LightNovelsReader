/**
 * 圖片緩存服務
 * 提供統一的圖片緩存管理，支援記憶體和文件系統雙層緩存
 */

import * as FileSystem from 'expo-file-system/legacy';
import AsyncStorage from '@react-native-async-storage/async-storage';
import logger from '../utils/logger';

export interface CacheMetadata {
  path: string;
  timestamp: number;
  url: string;
  size?: number;
  type: 'cover' | 'content';
}

export interface CacheStats {
  totalFiles: number;
  totalSize: number;
  memoryCacheCount: number;
  fileCacheCount: number;
}

export interface CacheOptions {
  maxMemoryCacheSize?: number; // 記憶體緩存最大大小（位元組）
  maxFileCacheSize?: number; // 文件緩存最大大小（位元組）
  maxFileCacheAge?: number; // 文件緩存最大年齡（毫秒）
  retryCount?: number; // 重試次數
  defaultImageUrl?: string; // 預設圖片 URL
}

class ImageCacheService {
  private static instance: ImageCacheService;
  private memoryCache: Map<string, string> = new Map();
  private metadataKey = 'image_cache_metadata';
  private cacheDir: string;
  private options: Required<CacheOptions>;

  private constructor(options: CacheOptions = {}) {
    this.cacheDir = `${FileSystem.documentDirectory || ''}images/`;
    this.options = {
      maxMemoryCacheSize: options.maxMemoryCacheSize || 50 * 1024 * 1024, // 50MB
      maxFileCacheSize: options.maxFileCacheSize || 500 * 1024 * 1024, // 500MB
      maxFileCacheAge: options.maxFileCacheAge || 30 * 24 * 60 * 60 * 1000, // 30天
      retryCount: options.retryCount || 3,
      defaultImageUrl: options.defaultImageUrl || 'https://raw.githubusercontent.com/xuerowo/myacgn/main/images/ImageError.png',
    };
  }

  static getInstance(options?: CacheOptions): ImageCacheService {
    if (!ImageCacheService.instance) {
      ImageCacheService.instance = new ImageCacheService(options);
    }
    return ImageCacheService.instance;
  }

  /**
   * 確保緩存目錄存在
   */
  private async ensureCacheDir(): Promise<void> {
    try {
      const dirInfo = await FileSystem.getInfoAsync(this.cacheDir);
      if (!dirInfo.exists) {
        await FileSystem.makeDirectoryAsync(this.cacheDir, { intermediates: true });
      }
    } catch (error) {
      logger.error('創建緩存目錄失敗:', error);
      throw error;
    }
  }

  /**
   * 生成緩存文件路徑
   */
  private getCacheFilePath(type: 'cover' | 'content', novelTitle: string, imageName: string = ''): string {
    const sanitizedTitle = novelTitle.replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, '_');
    const sanitizedImageName = imageName.replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, '_');

    if (type === 'cover') {
      return `${this.cacheDir}covers/${sanitizedTitle}_cover.jpg`;
    } else {
      return `${this.cacheDir}content/${sanitizedTitle}_${sanitizedImageName}.jpg`;
    }
  }

  /**
   * 生成緩存鍵
   */
  private getCacheKey(type: 'cover' | 'content', novelTitle: string, imageName: string = ''): string {
    return `${type}_${novelTitle}_${imageName}`;
  }

  /**
   * 獲取緩存元數據
   */
  private async getCacheMetadata(): Promise<Record<string, CacheMetadata>> {
    try {
      const data = await AsyncStorage.getItem(this.metadataKey);
      return data ? JSON.parse(data) : {};
    } catch (error) {
      logger.error('讀取緩存元數據失敗:', error);
      return {};
    }
  }

  /**
   * 保存緩存元數據
   */
  private async saveCacheMetadata(metadata: Record<string, CacheMetadata>): Promise<void> {
    try {
      await AsyncStorage.setItem(this.metadataKey, JSON.stringify(metadata));
    } catch (error) {
      logger.error('保存緩存元數據失敗:', error);
    }
  }

  /**
   * 下載圖片
   */
  private async downloadImage(url: string, filePath: string): Promise<boolean> {
    for (let attempt = 1; attempt <= this.options.retryCount; attempt++) {
      try {
        const downloadResult = await FileSystem.downloadAsync(url, filePath);
        if (downloadResult.status === 200) {
          return true;
        }
        logger.warn(`圖片下載失敗 (嘗試 ${attempt}/${this.options.retryCount}):`, url);
      } catch (error) {
        logger.warn(`圖片下載錯誤 (嘗試 ${attempt}/${this.options.retryCount}):`, error);
      }

      if (attempt < this.options.retryCount) {
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt)); // 指數退避
      }
    }
    return false;
  }

  /**
   * 清理過期緩存
   */
  private async cleanupExpiredCache(): Promise<void> {
    try {
      const metadata = await this.getCacheMetadata();
      const now = Date.now();
      let needsUpdate = false;

      for (const [key, cacheInfo] of Object.entries(metadata)) {
        if (now - cacheInfo.timestamp > this.options.maxFileCacheAge) {
          try {
            await FileSystem.deleteAsync(cacheInfo.path);
            delete metadata[key];
            needsUpdate = true;
            logger.log(`清理過期緩存: ${key}`);
          } catch (error) {
            logger.warn(`刪除過期緩存文件失敗: ${cacheInfo.path}`, error);
          }
        }
      }

      if (needsUpdate) {
        await this.saveCacheMetadata(metadata);
      }
    } catch (error) {
      logger.error('清理過期緩存失敗:', error);
    }
  }

  /**
   * 檢查緩存大小並清理
   */
  private async checkAndCleanupCache(): Promise<void> {
    try {
      const stats = await this.getCacheStats();

      if (stats.totalSize > this.options.maxFileCacheSize) {
        logger.log(`緩存大小超過限制，開始清理: ${stats.totalSize} > ${this.options.maxFileCacheSize}`);
        await this.cleanupOldestCache();
      }
    } catch (error) {
      logger.error('檢查緩存大小失敗:', error);
    }
  }

  /**
   * 清理最舊的緩存
   */
  private async cleanupOldestCache(): Promise<void> {
    try {
      const metadata = await this.getCacheMetadata();
      const sortedEntries = Object.entries(metadata)
        .sort(([, a], [, b]) => a.timestamp - b.timestamp);

      let deletedSize = 0;
      const targetSize = this.options.maxFileCacheSize * 0.7; // 清理到70%

      for (const [key, cacheInfo] of sortedEntries) {
        if (deletedSize >= targetSize) break;

        try {
          const fileInfo = await FileSystem.getInfoAsync(cacheInfo.path);
          if (fileInfo.exists) {
            await FileSystem.deleteAsync(cacheInfo.path);
            deletedSize += fileInfo.size || 0;
            delete metadata[key];
            logger.log(`清理舊緩存: ${key}`);
          }
        } catch (error) {
          logger.warn(`刪除緩存文件失敗: ${cacheInfo.path}`, error);
        }
      }

      if (Object.keys(metadata).length !== Object.keys(await this.getCacheMetadata()).length) {
        await this.saveCacheMetadata(metadata);
      }
    } catch (error) {
      logger.error('清理最舊緩存失敗:', error);
    }
  }

  /**
   * 獲取緩存的圖片路徑
   */
  async getCachedImagePath(type: 'cover' | 'content', novelTitle: string, imageName: string = ''): Promise<string | null> {
    try {
      const cacheKey = this.getCacheKey(type, novelTitle, imageName);

      // 先檢查記憶體緩存
      const memoryCached = this.memoryCache.get(cacheKey);
      if (memoryCached) {
        return memoryCached;
      }

      // 檢查文件緩存
      const metadata = await this.getCacheMetadata();
      const cacheInfo = metadata[cacheKey];

      if (cacheInfo && cacheInfo.path) {
        const fileInfo = await FileSystem.getInfoAsync(cacheInfo.path);
        if (fileInfo.exists) {
          // 添加到記憶體緩存
          this.memoryCache.set(cacheKey, cacheInfo.path);
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

  /**
   * 緩存圖片
   */
  async cacheImage(
    imageUrl: string,
    type: 'cover' | 'content',
    novelTitle: string,
    imageName: string = '',
    useDefaultOnError: boolean = true
  ): Promise<string | null> {
    try {
      await this.ensureCacheDir();

      const filePath = this.getCacheFilePath(type, novelTitle, imageName);
      const cacheKey = this.getCacheKey(type, novelTitle, imageName);

      // 確保子目錄存在
      const dirPath = filePath.substring(0, filePath.lastIndexOf('/'));
      const dirInfo = await FileSystem.getInfoAsync(dirPath);
      if (!dirInfo.exists) {
        await FileSystem.makeDirectoryAsync(dirPath, { intermediates: true });
      }

      // 下載圖片
      const success = await this.downloadImage(imageUrl, filePath);

      if (success) {
        // 獲取文件大小
        const fileInfo = await FileSystem.getInfoAsync(filePath);

        // 更新元數據
        const metadata = await this.getCacheMetadata();
        metadata[cacheKey] = {
          path: filePath,
          timestamp: Date.now(),
          url: imageUrl,
          size: fileInfo.exists ? (fileInfo as any).size || 0 : 0,
          type
        };
        await this.saveCacheMetadata(metadata);

        // 添加到記憶體緩存
        this.memoryCache.set(cacheKey, filePath);

        // 檢查並清理緩存
        await this.checkAndCleanupCache();

        return filePath;
      }

      // 如果下載失敗且啟用預設圖片，嘗試使用預設圖片
      if (useDefaultOnError && this.options.defaultImageUrl && imageUrl !== this.options.defaultImageUrl) {
        logger.log(`圖片下載失敗，嘗試使用預設圖片: ${imageUrl}`);
        return await this.cacheImage(this.options.defaultImageUrl, type, novelTitle, imageName, false);
      }

      return null;
    } catch (error) {
      logger.error('緩存圖片失敗:', error);

      // 如果發生錯誤且啟用預設圖片，嘗試使用預設圖片
      if (useDefaultOnError && this.options.defaultImageUrl && imageUrl !== this.options.defaultImageUrl) {
        logger.log(`圖片緩存過程出錯，嘗試使用預設圖片: ${imageUrl}`);
        return await this.cacheImage(this.options.defaultImageUrl, type, novelTitle, imageName, false);
      }

      return null;
    }
  }

  /**
   * 預載入圖片
   */
  async preloadImage(
    imageUrl: string,
    type: 'cover' | 'content',
    novelTitle: string,
    imageName: string = ''
  ): Promise<void> {
    try {
      const cacheKey = this.getCacheKey(type, novelTitle, imageName);

      // 如果已經在記憶體緩存中，直接返回
      if (this.memoryCache.has(cacheKey)) {
        return;
      }

      // 檢查文件緩存
      const cachedPath = await this.getCachedImagePath(type, novelTitle, imageName);
      if (cachedPath) {
        return;
      }

      // 非同步下載但不等待結果
      this.cacheImage(imageUrl, type, novelTitle, imageName).catch(error => {
        logger.warn('預載入圖片失敗:', error);
      });
    } catch (error) {
      logger.warn('預載入圖片失敗:', error);
    }
  }

  /**
   * 清理指定小說的緩存
   */
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
            this.memoryCache.delete(key);
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

  /**
   * 清理所有緩存
   */
  async clearAllCache(): Promise<void> {
    try {
      // 清理記憶體緩存
      this.memoryCache.clear();

      // 清理文件緩存
      await FileSystem.deleteAsync(this.cacheDir);

      // 清理元數據
      await AsyncStorage.removeItem(this.metadataKey);

      logger.log('所有圖片緩存已清理');
    } catch (error) {
      logger.error('清理所有緩存失敗:', error);
    }
  }

  /**
   * 獲取緩存統計信息
   */
  async getCacheStats(): Promise<CacheStats> {
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

      return {
        totalFiles,
        totalSize,
        memoryCacheCount: this.memoryCache.size,
        fileCacheCount: totalFiles
      };
    } catch (error) {
      logger.error('獲取緩存統計失敗:', error);
      return { totalFiles: 0, totalSize: 0, memoryCacheCount: 0, fileCacheCount: 0 };
    }
  }

  /**
   * 初始化服務
   */
  async initialize(): Promise<void> {
    try {
      await this.ensureCacheDir();
      await this.cleanupExpiredCache();
      logger.log('圖片緩存服務初始化完成');
    } catch (error) {
      logger.error('圖片緩存服務初始化失敗:', error);
    }
  }
}

export default ImageCacheService;