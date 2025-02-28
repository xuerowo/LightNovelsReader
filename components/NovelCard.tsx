import React, { useState } from 'react';
import { View, Text, TouchableOpacity, Image, StyleSheet } from 'react-native';
import { Novel, Chapter } from '../types/novelTypes';

interface NovelCardProps {
  novel: Novel;
  onPress: (novel: Novel) => void;
  isDarkMode?: boolean;
  forceRefresh?: boolean;
}

const formatDateTime = (dateStr: string) => {
  if (dateStr === '未知時間') return dateStr;
  
  const date = new Date(dateStr.replace(' ', 'T') + '+08:00');
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

const NovelCard: React.FC<NovelCardProps> = ({
  novel,
  onPress,
  isDarkMode = false,
  forceRefresh = false
}) => {
  const [imageError, setImageError] = useState(false);
  const coverUrl = novel.cover + (forceRefresh ? `?t=${Date.now()}` : '');
  
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
        <Image
          source={{ uri: imageError ? "/api/placeholder/160/240" : coverUrl,
            cache: forceRefresh ? 'reload' : 'default'
          }}
          style={styles.image}
          resizeMode="cover"
          onError={() => setImageError(true)}
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
          ]}>
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
  },
  lastUpdated: {
    textAlign: 'right',
  }
});

export default NovelCard;