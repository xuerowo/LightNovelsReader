import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { Novel } from '../types/novelTypes';
import { resolveCoverUrl } from '../utils/pathUtils';

interface NovelCardProps {
  novel: Novel;
  onPress: (novel: Novel) => void;
  isDarkMode?: boolean;
  forceRefresh?: boolean;
  onImagePress?: (imageUri: string) => void;
  imageCacheManager?: any;
}

// 聲明全局 imageCacheManager
declare global {
  var imageCacheManager: any;
}

const formatDateTime = (dateStr: string) => {
  if (dateStr === '未知時間') return dateStr;
  
  const date = new Date(dateStr.replace(' ', 'T'));
  const now = new Date();
  
  // 將時間部分設為0以進行純日期比較
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const compareDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffTime = today.getTime() - compareDate.getTime();
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
  
  // 如果是今天
  if (diffDays === 0) {
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    return `今天 ${hours}:${minutes}`;
  }
  
  // 如果是昨天
  if (diffDays === 1) {
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    return `昨天 ${hours}:${minutes}`;
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
};

// 文件緩存圖片組件
const CachedImage: React.FC<{
  novel: Novel;
  isDarkMode: boolean;
  forceRefresh: boolean;
  onPress?: (uri: string) => void;
}> = ({ novel, isDarkMode, forceRefresh, onPress }) => {
  const [imageError, setImageError] = useState(false);
  const [currentImageUri, setCurrentImageUri] = useState<string>('');
  
  const resolvedCoverUrl = resolveCoverUrl(novel.cover);

  // 文件緩存的圖片載入邏輯
  useEffect(() => {
    const loadImage = async () => {
      try {
        setImageError(false);
        
        if (!global.imageCacheManager) {
          console.warn('ImageCacheManager 未初始化');
          setImageError(true);
          return;
        }
        
        // 1. 先檢查並顯示本地緩存文件
        const cachedPath = await global.imageCacheManager.getCachedImagePath('cover', novel.title);
        if (cachedPath && !forceRefresh) {
          setCurrentImageUri(`file://${cachedPath}`);
        }
        
        // 2. 嘗試從網路獲取最新圖片並緩存
        try {
          const networkCachedPath = await global.imageCacheManager.cacheImage(
            resolvedCoverUrl,
            'cover',
            novel.title
          );
          
          if (networkCachedPath) {
            setCurrentImageUri(`file://${networkCachedPath}`);
          } else if (!cachedPath) {
            // 網路失敗且沒有本地緩存時設為錯誤
            setImageError(true);
          }
        } catch (networkError) {
          // 網路請求失敗，如果沒有本地緩存則顯示錯誤
          if (!cachedPath) {
            setImageError(true);
          }
          console.warn('網路載入封面圖片失敗:', networkError);
        }
      } catch (error) {
        setImageError(true);
        console.warn('載入封面圖片失敗:', error);
      }
    };

    loadImage();
  }, [novel.title, novel.cover, resolvedCoverUrl, forceRefresh]);

  if (imageError) {
    return (
      <View style={[styles.placeholderContainer, { backgroundColor: isDarkMode ? '#333' : '#f0f0f0' }]}>
        <Text style={[styles.placeholderText, { color: isDarkMode ? '#888' : '#666' }]}>
          封面圖片
        </Text>
      </View>
    );
  }

  const ImageComponent = (
    <ExpoImage
      source={{ uri: currentImageUri }}
      style={styles.image}
      contentFit="cover"
      onError={() => setImageError(true)}
      transition={200}
    />
  );

  if (onPress) {
    return (
      <TouchableOpacity
        onPress={(e) => {
          e.stopPropagation();
          onPress(currentImageUri);
        }}
        activeOpacity={0.8}
        style={styles.imageWrapper}
      >
        {ImageComponent}
      </TouchableOpacity>
    );
  }

  return ImageComponent;
};

const NovelCard: React.FC<NovelCardProps> = ({
  novel,
  onPress,
  isDarkMode = false,
  forceRefresh = false,
  onImagePress
}) => {
  
  return (
    <TouchableOpacity
      style={[
        styles.card,
        {
          backgroundColor: isDarkMode ? '#1c1c1c' : '#ffffff',
          borderColor: isDarkMode ? '#333' : '#e1e1e1',
        },
      ]}
      onPress={() => onPress(novel)}
      activeOpacity={0.7}
    >
      <View style={[styles.imageContainer, { backgroundColor: isDarkMode ? '#1c1c1c' : '#ffffff' }]}>
        <CachedImage
          novel={novel}
          isDarkMode={isDarkMode}
          forceRefresh={forceRefresh}
          onPress={onImagePress}
        />
      </View>
      <View style={[
        styles.cardInfo,
        {
          backgroundColor: isDarkMode ? '#1c1c1c' : '#ffffff',
          minHeight: 75,
          flex: 1,
          justifyContent: 'space-between',
        }
      ]}>
        <Text 
          style={[
            styles.title,
            {
              fontSize: 12,
              fontWeight: '500',
              color: isDarkMode ? '#e1e1e1' : '#333333',
              lineHeight: 16,
            }
          ]}
        >
          {novel.title}
        </Text>
        <View style={styles.bottomInfo}>
          <Text style={[
            styles.author,
            { color: isDarkMode ? '#e1e1e1' : '#333333', fontSize: 11 }
          ]} numberOfLines={1}>
            {novel.author}
          </Text>
          <Text style={[
            styles.lastUpdated,
            { color: isDarkMode ? '#e1e1e1' : '#333333', fontSize: 11 }
          ]} numberOfLines={1}>
            {formatDateTime(novel.lastUpdated)}
          </Text>
        </View>
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  card: {
    width: '48%',
    marginBottom: 10,
    borderRadius: 8,
    borderWidth: 1,
    backgroundColor: '#fff',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  imageContainer: {
    width: '100%',
    aspectRatio: 0.7,
    borderTopLeftRadius: 8,
    borderTopRightRadius: 8,
    overflow: 'hidden',
    backgroundColor: '#f0f0f0',
  },
  imageWrapper: {
    width: '100%',
    height: '100%',
  },
  image: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  cardInfo: {
    padding: 8,
    borderBottomLeftRadius: 8,
    borderBottomRightRadius: 8,
  },
  title: {
    fontSize: 12,
    fontWeight: '500',
  },
  bottomInfo: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 8,
  },
  author: {
    flex: 1,
    marginRight: 8,
    minWidth: 0, // 允許文字收縮
  },
  lastUpdated: {
    textAlign: 'right',
    flexShrink: 0,
    minWidth: 80, // 增加最小寬度以確保日期完整顯示
    maxWidth: 80, // 設定最大寬度防止過長
  },
  placeholderContainer: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  placeholderText: {
    fontSize: 12,
    fontWeight: '400',
    textAlign: 'center',
  }
});

// 使用 React.memo 優化渲染性能，只有 props 變化時才重新渲染
export default React.memo(NovelCard, (prevProps, nextProps) => {
  return (
    prevProps.novel.title === nextProps.novel.title &&
    prevProps.novel.cover === nextProps.novel.cover &&
    prevProps.novel.lastUpdated === nextProps.novel.lastUpdated &&
    prevProps.isDarkMode === nextProps.isDarkMode &&
    prevProps.forceRefresh === nextProps.forceRefresh &&
    prevProps.onImagePress === nextProps.onImagePress
  );
});