import React from 'react';
import { View, Text, ActivityIndicator } from 'react-native';
import NovelCard from './NovelCard';
import CustomScrollView from './CustomScrollView';
import { Novel } from '../types/novelTypes';

interface NovelGridProps {
  novels: Novel[];
  onSelectNovel: (novel: Novel) => void;
  isLoading?: boolean;
  isDarkMode?: boolean;
  onScroll?: (event: any) => void;
  contentContainerStyle?: any;
  refreshControl?: React.ReactElement<any>;
  forceRefreshCovers?: boolean;
  onImagePress?: (imageUri: string) => void;
  theme?: string;
}

const NovelGrid: React.FC<NovelGridProps> = ({
  novels,
  onSelectNovel,
  isLoading = false,
  isDarkMode = false,
  onScroll,
  contentContainerStyle,
  refreshControl,
  forceRefreshCovers = false,
  onImagePress,
  theme = 'light'
}) => {
  if (isLoading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color={isDarkMode ? '#ffffff' : '#000000'} />
        <Text style={{ marginTop: 10, color: isDarkMode ? '#ffffff' : '#000000' }}>
          載入中...
        </Text>
      </View>
    );
  }

  if (!novels.length) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <Text style={{ color: isDarkMode ? '#ffffff' : '#000000' }}>
          沒有找到小說
        </Text>
      </View>
    );
  }

  return (
    <CustomScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{
        flexDirection: 'row',
        flexWrap: 'wrap',
        justifyContent: 'space-around',
        padding: 8,
        ...contentContainerStyle,
      }}
      onScroll={onScroll}
      refreshControl={refreshControl}
      indicatorColor={theme === 'dark' ? '#ffffff' : '#000000'}
      indicatorWidth={4}
      autoHide={true}
      hideTimeout={1500}
    >
      {novels.map((novel) => (
        <NovelCard
          key={novel.title}
          novel={novel}
          onPress={onSelectNovel}
          isDarkMode={isDarkMode}
          forceRefresh={forceRefreshCovers}
          onImagePress={onImagePress}
        />
      ))}
    </CustomScrollView>
  );
};

export default NovelGrid;