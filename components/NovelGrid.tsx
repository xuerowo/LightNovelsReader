import React from 'react';
import { View, Text, ScrollView, ActivityIndicator } from 'react-native';
import NovelCard from './NovelCard';
import { Novel, Chapter } from '../types/novelTypes';

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
  onImagePress
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
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{
        flexDirection: 'row',
        flexWrap: 'wrap',
        justifyContent: 'space-around',
        padding: 8,
        ...contentContainerStyle,
      }}
      onScroll={onScroll}
      scrollEventThrottle={100}
      refreshControl={refreshControl}
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
    </ScrollView>
  );
};

export default NovelGrid;