/**
 * 緩存圖片組件
 * 提供統一的圖片載入、緩存和顯示功能
 */

import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import ImageCacheService from '../services/ImageCacheService';
import { resolveCoverUrl, resolveImageUrl } from '../utils/pathUtils';

export interface CachedImageProps {
  // 圖片來源
  source: {
    url: string;
    type: 'cover' | 'content';
    novelTitle: string;
    imageName?: string;
  };

  // 顯示屬性
  style?: any;
  contentFit?: 'cover' | 'contain' | 'fill' | 'scale-down' | 'none';

  // 交互屬性
  onPress?: (uri: string) => void;
  onLoad?: () => void;
  onError?: (error: any) => void;

  // 緩存控制
  forceRefresh?: boolean;
  preloadOnly?: boolean;

  // 自訂樣式
  placeholderStyle?: any;
  placeholderText?: string;
  showLoadingIndicator?: boolean;

  // 主題
  isDarkMode?: boolean;

  // 預設圖片
  useDefaultOnError?: boolean;
}

const CachedImage: React.FC<CachedImageProps> = ({
  source,
  style,
  contentFit = 'cover',
  onPress,
  onLoad,
  onError,
  forceRefresh = false,
  preloadOnly = false,
  placeholderStyle,
  placeholderText,
  showLoadingIndicator = true,
  isDarkMode = false,
  useDefaultOnError = true,
}) => {
  const [imageUri, setImageUri] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [hasError, setHasError] = useState<boolean>(false);
  const [cacheManager] = useState(() => ImageCacheService.getInstance());

  // 解析圖片 URL
  const getResolvedUrl = useCallback(() => {
    const { url, type } = source;
    if (type === 'cover') {
      return resolveCoverUrl(url);
    } else {
      return resolveImageUrl(url);
    }
  }, [source]);

  // 載入圖片
  const loadImage = useCallback(async () => {
    try {
      setIsLoading(true);
      setHasError(false);

      const { type, novelTitle, imageName = '' } = source;
      const resolvedUrl = getResolvedUrl();

      if (!resolvedUrl) {
        throw new Error('無效的圖片 URL');
      }

      // 1. 檢查緩存
      let cachedPath: string | null = null;
      if (!forceRefresh) {
        cachedPath = await cacheManager.getCachedImagePath(type, novelTitle, imageName);
        if (cachedPath) {
          setImageUri(`file://${cachedPath}`);
          setIsLoading(false);
          onLoad?.();
          return;
        }
      }

      // 2. 如果是預載入模式，只下載不顯示
      if (preloadOnly) {
        await cacheManager.cacheImage(resolvedUrl, type, novelTitle, imageName, useDefaultOnError);
        setIsLoading(false);
        return;
      }

      // 3. 下載並緩存新圖片
      const downloadedPath = await cacheManager.cacheImage(resolvedUrl, type, novelTitle, imageName, useDefaultOnError);

      if (downloadedPath) {
        setImageUri(`file://${downloadedPath}`);
        setIsLoading(false);
        onLoad?.();
      } else {
        throw new Error('圖片下載失敗');
      }

    } catch (error) {
      console.warn('載入圖片失敗:', error);
      setHasError(true);
      setIsLoading(false);
      onError?.(error);
    }
  }, [source, forceRefresh, preloadOnly, cacheManager, getResolvedUrl, onLoad, onError, useDefaultOnError]);

  // 處理圖片錯誤
  const handleImageError = useCallback(() => {
    setHasError(true);
    setIsLoading(false);
    onError?.(new Error('圖片載入失敗'));
  }, [onError]);

  // 處理圖片載入成功
  const handleImageLoad = useCallback(() => {
    setIsLoading(false);
    onLoad?.();
  }, [onLoad]);

  // 效果：載入圖片
  useEffect(() => {
    loadImage();
  }, [loadImage]);

  // 效果：當來源變化時重置狀態
  useEffect(() => {
    setImageUri('');
    setIsLoading(true);
    setHasError(false);
  }, [source.url, source.novelTitle, source.imageName]);

  // 載入指示器
  if (isLoading && showLoadingIndicator) {
    return (
      <View style={[styles.placeholderContainer, style, placeholderStyle]}>
        <ActivityIndicator
          size="small"
          color={isDarkMode ? '#888' : '#666'}
        />
      </View>
    );
  }

  // 錯誤狀態
  if (hasError) {
    return (
      <View style={[styles.placeholderContainer, style, placeholderStyle]}>
        <Text style={[
          styles.placeholderText,
          { color: isDarkMode ? '#888' : '#666' }
        ]}>
          {placeholderText || '圖片載入失敗'}
        </Text>
      </View>
    );
  }

  // 圖片組件
  const ImageComponent = (
    <ExpoImage
      source={{ uri: imageUri }}
      style={style}
      contentFit={contentFit}
      onLoad={handleImageLoad}
      onError={handleImageError}
      transition={200}
    />
  );

  // 如果有點擊事件，包裝在 TouchableOpacity 中
  if (onPress) {
    return (
      <TouchableOpacity
        onPress={(e) => {
          e.stopPropagation();
          onPress(imageUri);
        }}
        activeOpacity={0.8}
        style={style}
      >
        {ImageComponent}
      </TouchableOpacity>
    );
  }

  return ImageComponent;
};

const styles = StyleSheet.create({
  placeholderContainer: {
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f0f0f0',
  },
  placeholderText: {
    fontSize: 12,
    fontWeight: '400',
    textAlign: 'center',
  },
});

export default React.memo(CachedImage);