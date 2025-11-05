/**
 * 圖片緩存鉤子
 * 提供圖片緩存相關的 React Hook
 */

import { useState, useEffect, useCallback } from 'react';
import ImageCacheService, { CacheStats } from '../services/ImageCacheService';

export interface UseImageCacheOptions {
  forceRefresh?: boolean;
  preloadOnly?: boolean;
}

export interface UseImageCacheResult {
  imageUri: string;
  isLoading: boolean;
  hasError: boolean;
  loadImage: () => Promise<void>;
  clearCache: () => Promise<void>;
}

export interface UseImageCacheStatsResult {
  stats: CacheStats | null;
  isLoading: boolean;
  refreshStats: () => Promise<void>;
}

/**
 * 使用圖片緩存的鉤子
 */
export const useImageCache = (
  url: string,
  type: 'cover' | 'content',
  novelTitle: string,
  imageName: string = '',
  options: UseImageCacheOptions = {}
): UseImageCacheResult => {
  const [imageUri, setImageUri] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [hasError, setHasError] = useState<boolean>(false);
  const [cacheManager] = useState(() => ImageCacheService.getInstance());

  const loadImage = useCallback(async () => {
    try {
      setIsLoading(true);
      setHasError(false);

      // 檢查緩存
      let cachedPath: string | null = null;
      if (!options.forceRefresh) {
        cachedPath = await cacheManager.getCachedImagePath(type, novelTitle, imageName);
        if (cachedPath) {
          setImageUri(`file://${cachedPath}`);
          setIsLoading(false);
          return;
        }
      }

      // 如果是預載入模式，只下載不顯示
      if (options.preloadOnly) {
        await cacheManager.cacheImage(url, type, novelTitle, imageName);
        setIsLoading(false);
        return;
      }

      // 下載並緩存新圖片
      const downloadedPath = await cacheManager.cacheImage(url, type, novelTitle, imageName);

      if (downloadedPath) {
        setImageUri(`file://${downloadedPath}`);
        setIsLoading(false);
      } else {
        throw new Error('圖片下載失敗');
      }

    } catch (error) {
      console.warn('載入圖片失敗:', error);
      setHasError(true);
      setIsLoading(false);
    }
  }, [url, type, novelTitle, imageName, options.forceRefresh, options.preloadOnly, cacheManager]);

  const clearCache = useCallback(async () => {
    try {
      await cacheManager.clearNovelCache(novelTitle);
      setImageUri('');
      setIsLoading(true);
      setHasError(false);
    } catch (error) {
      console.warn('清理緩存失敗:', error);
    }
  }, [novelTitle, cacheManager]);

  // 自動載入圖片
  useEffect(() => {
    loadImage();
  }, [loadImage]);

  return {
    imageUri,
    isLoading,
    hasError,
    loadImage,
    clearCache,
  };
};

/**
 * 使用圖片緩存統計的鉤子
 */
export const useImageCacheStats = (): UseImageCacheStatsResult => {
  const [stats, setStats] = useState<CacheStats | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [cacheManager] = useState(() => ImageCacheService.getInstance());

  const refreshStats = useCallback(async () => {
    try {
      setIsLoading(true);
      const cacheStats = await cacheManager.getCacheStats();
      setStats(cacheStats);
    } catch (error) {
      console.warn('獲取緩存統計失敗:', error);
    } finally {
      setIsLoading(false);
    }
  }, [cacheManager]);

  // 自動載入統計
  useEffect(() => {
    refreshStats();
  }, [refreshStats]);

  return {
    stats,
    isLoading,
    refreshStats,
  };
};

/**
 * 圖片預載入鉤子
 */
export const useImagePreload = (
  urls: Array<{ url: string; type: 'cover' | 'content'; novelTitle: string; imageName?: string }>
): void => {
  const [cacheManager] = useState(() => ImageCacheService.getInstance());

  useEffect(() => {
    const preloadImages = async () => {
      for (const image of urls) {
        try {
          await cacheManager.preloadImage(
            image.url,
            image.type,
            image.novelTitle,
            image.imageName || ''
          );
        } catch (error) {
          console.warn(`預載入圖片失敗: ${image.url}`, error);
        }
      }
    };

    preloadImages();
  }, [urls, cacheManager]);
};

export default useImageCache;