import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  SafeAreaView,
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
  Animated,
  Platform,
  UIManager,
  TextStyle,
  Image,
  Dimensions,
  AppState,
  Linking,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import NovelGrid from './components/NovelGrid';
import * as Notifications from 'expo-notifications';
import * as ExpoBackgroundFetch from 'expo-background-fetch';
import * as TaskManager from 'expo-task-manager';
import * as Application from 'expo-application';
import Constants from 'expo-constants';
import debounce from 'lodash.debounce';
import { MaterialIcons } from '@expo/vector-icons';
import Markdown from 'react-native-markdown-display';
import ReadingSettings, { 
  DEFAULT_FONT_SIZE, 
  DEFAULT_LINE_HEIGHT 
} from './components/ReadingSettings';
import SearchBar from './components/SearchBar';
import SortSelector, { SortOption } from './components/SortSelector';
import { RefreshControl } from 'react-native';
import { Novel, Chapter } from './types/novelTypes';
import * as diff from 'diff';
import logger from './utils/logger';

const BACKGROUND_FETCH_TASK = 'background-fetch';
const GITHUB_RAW_URL = 'https://raw.githubusercontent.com/xuerowo/myacg/main/輕小說翻譯/';
const STATUS_BAR_HEIGHT = Platform.OS === 'ios' ? 44 : StatusBar.currentHeight || 0;

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

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
  readingTime: Record<string, number>; // 記錄每本小說的總閱讀時間(秒)
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
}

async function registerBackgroundFetch() {
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
    } else {
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

    // 獲取遠程小說列表
    const response = await fetch('https://raw.githubusercontent.com/xuerowo/myacg/main/輕小說翻譯/novels.json');
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
    if (!year || !month || !day) return '';
    
    const date = new Date(year, month - 1, day);
    if (isNaN(date.getTime())) return '';
    
    const now = new Date();
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
  refreshControl?: React.ReactElement;
  ListHeaderComponent?: React.ReactNode;
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
    <ScrollView
      ref={scrollViewRef}
      style={styles.listContainer}
      onScroll={onScroll}
      scrollEventThrottle={16}
      onScrollBeginDrag={(e) => e.persist()}
      refreshControl={refreshControl}
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
    </ScrollView>
  );
};

const imageCache = new Map<string, boolean>();

const MarkdownImage: React.FC<MarkdownImageProps> = React.memo(({ src, isDarkMode, backgroundColor }) => {
  const [isLoading, setIsLoading] = useState(!imageCache.get(src));
  const [error, setError] = useState(false);
  const screenWidth = Dimensions.get('window').width;
  const isMounted = useRef(true);

  useEffect(() => {
    return () => {
      isMounted.current = false;
    };
  }, []);

  const cleanUrl = useMemo(() => {
    if (src.startsWith('http')) {
      return src;
    }
    return `${GITHUB_RAW_URL}${src}`;
  }, [src]);

  useEffect(() => {
    if (!imageCache.has(cleanUrl)) {
      Image.prefetch(cleanUrl).then(() => {
        if (isMounted.current) {
          imageCache.set(cleanUrl, true);
          setIsLoading(false);
        }
      }).catch(() => {
        if (isMounted.current) {
          setError(true);
          setIsLoading(false);
        }
      });
    }
  }, [cleanUrl]);

  const imageStyles = useMemo(() => StyleSheet.create({
    container: {
      width: screenWidth,
      marginHorizontal: -16,
      backgroundColor
    },
    image: {
      width: screenWidth,
      height: screenWidth,
      resizeMode: 'contain',
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

  const source = useMemo(() => ({ 
    uri: cleanUrl,
    cache: 'force-cache' as const
  }), [cleanUrl]);

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
      <Image
        source={source}
        style={imageStyles.image}
        onError={() => {
          if (isMounted.current) {
            setError(true);
            setIsLoading(false);
          }
        }}
      />
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
         prevProps.backgroundColor === nextProps.backgroundColor;
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
interface NotificationData {
  updates: UpdateInfo[];
}

// 設置通知頻道
const setupNotifications = async (): Promise<void> => {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('updates', {
      name: '小說更新通知',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#FF231F7C',
      description: '接收小說更新的通知',
    });
  }
};

// 發送通知的函數
const sendUpdateNotification = async (updates: UpdateInfo[]): Promise<void> => {
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
    readingTime: {}  // 確保初始化為空對象
  });
  const [isAppReady, setIsAppReady] = useState(false);
  const [filteredNovels, setFilteredNovels] = useState<Novel[]>([]);
  const [settingsVisible, setSettingsVisible] = useState<boolean>(false);
  const [refreshingNovels, setRefreshingNovels] = useState(false);
  const [refreshingChapters, setRefreshingChapters] = useState(false);
  const [refreshingContent, setRefreshingContent] = useState(false);
  const spinValue = useRef(new Animated.Value(0)).current;

  const contentScrollViewRef = useRef<ScrollView>(null);
  const chaptersScrollViewRef = useRef<ScrollView>(null);
  const novelsScrollViewRef = useRef<ScrollView>(null);

  const [readChapters, setReadChapters] = useState<Record<string, Set<string>>>({});
  const [updateChecking, setUpdateChecking] = useState<boolean>(false);

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
        readingTime: newSettings.readingTime ?? {}  // 確保有默認值
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
        setSettings({
          isDarkMode: parsedSettings.isDarkMode ?? false,
          lastReadChapter: parsedSettings.lastReadChapter ?? {},
          scrollPosition: parsedSettings.scrollPosition ?? {},
          fontSize: parsedSettings.fontSize ?? DEFAULT_FONT_SIZE,
          lineHeight: parsedSettings.lineHeight ?? DEFAULT_LINE_HEIGHT,
          theme: parsedSettings.theme ?? 'light',
          readingTime: parsedSettings.readingTime ?? {}
        });
        
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
      
      // 檢查更新，只顯示對話框
      const updateResult = await checkNovelUpdates();
      if (updateResult?.hasUpdates) {
        Alert.alert(
          '發現更新',
          formatUpdateMessage(updateResult.updates),
          [{ text: '確定' }]
        );
      }
      
      // 1. 先嘗試從網路獲取數據
      try {
        const response = await fetch('https://raw.githubusercontent.com/xuerowo/myacg/main/輕小說翻譯/novels.json');
        if (response.ok) {
          const data = await response.json();
          const novelList = data.novels
            .map((novel: Novel) => ({
              ...novel,
              lastUpdated: novel.lastUpdated || '未知時間'
            }))
            .sort((a: Novel, b: Novel) => {
              if (a.lastUpdated === '未知時間') return 1;
              if (b.lastUpdated === '未知時間') return -1;
              
              const dateA = new Date(a.lastUpdated.replace(' ', 'T') + '+08:00');
              const dateB = new Date(b.lastUpdated.replace(' ', 'T') + '+08:00');
              
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

      // 檢查更新
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

      // 1. 先嘗試從網路獲取最新的小說資料
      try {
        const response = await fetch('https://raw.githubusercontent.com/xuerowo/myacg/main/輕小說翻譯/novels.json');
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

  const fetchChapterContent = async (chapter: Chapter) => {
    if (!currentNovel) return;

    try {
      setContentLoading(true);
      setError(null);

      // 先從章節記錄中檢查章節是否被標記為已修改
      const chapterStatuses = await getChapterStatus(currentNovel);
      const chapterInfo = chapterStatuses[chapter.title];
      const isModified = chapterInfo?.statuses?.includes('modified');

      // 獲取內容的key
      const contentKey = `chapter_${currentNovel}_${chapter.title}`;
      
      // 獲取舊內容（如果存在）以便後續比較差異
      const oldContent = await getLocalData(contentKey);
      
      // 無論是否有標記為修改，都從網路獲取最新內容
      try {
        const response = await fetch(chapter.url);
        if (!response.ok) {
          throw new Error(`下載章節失敗: ${response.status}`);
        }
        const newContent = await response.text();
        
        // 如果沒有本地內容或內容有變化，則更新並提示
        if (!oldContent || oldContent !== newContent) {
          // 比較差異
          let diffMessage = `《${currentNovel}》的「${chapter.title}」已顯示最新版本。`;
          let hasChanges = false;
          
          if (oldContent) {
            // 使用 diff 庫計算文本差異
            const changes = diff.diffChars(oldContent, newContent);
            
            // 整理新增和刪除的內容
            let addedText = '';
            let removedText = '';
            
            changes.forEach(change => {
              if (change.added) {
                addedText += change.value;
                hasChanges = true;
              } else if (change.removed) {
                removedText += change.value;
                hasChanges = true;
              }
            });
            
            // 限制長度以防止對話框太大
            const maxLength = 100;
            const formatText = (text: string, max: number) => 
              text.length > max ? text.substring(0, max) + '...' : text;
            
            // 更新差異信息
            if (addedText || removedText) {
              diffMessage = `《${currentNovel}》的「${chapter.title}」有內容更新，已顯示最新版本。\n\n${removedText ? '刪除: ' + formatText(removedText, maxLength) + '\n\n' : ''}${addedText ? '新增: ' + formatText(addedText, maxLength) : ''}`;
            }
          }
          
          // 刪除舊內容
          await AsyncStorage.removeItem(contentKey);
          
          // 保存到本地緩存
          await saveLocalData(contentKey, newContent);
          setCurrentContent(newContent);
          
          // 只有當章節已標記為修改且內容確實有變化時才顯示提示
          if (isModified && hasChanges) {
            Alert.alert(
              '章節內容已更新',
              diffMessage,
              [{ text: '確定' }]
            );
          }
          
          // 如果是被標記為已修改的章節，更新章節狀態，移除'modified'標記
          if (isModified && chapterInfo) {
            const updatedStatuses = chapterInfo.statuses.filter(status => status !== 'modified');
            chapterStatuses[chapter.title] = {
              ...chapterInfo,
              statuses: updatedStatuses
            };
            
            // 更新章節記錄
            const chaptersData = await AsyncStorage.getItem('chapters_records');
            const allChaptersRecord: ChapterRecord = chaptersData ? JSON.parse(chaptersData) : {};
            if (!allChaptersRecord[currentNovel]) {
              allChaptersRecord[currentNovel] = {};
            }
            allChaptersRecord[currentNovel] = chapterStatuses;
            await AsyncStorage.setItem('chapters_records', JSON.stringify(allChaptersRecord));
          }
        } else {
          // 內容沒有變化，但仍使用網路獲取的內容
          setCurrentContent(newContent);
        }
      } catch (networkError) {
        logger.error('從網路獲取章節失敗:', networkError);
        
        // 網路請求失敗時，如果有本地緩存則使用本地緩存
        if (oldContent) {
          setCurrentContent(oldContent);
        } else {
          throw networkError; // 如果沒有本地緩存，則拋出錯誤
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

  const handleReturnToChapters = useCallback((): void => {
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
  }, [currentNovel, lastReadChapter, scrollPosition, settings.theme]);

  const handleReturnToNovels = useCallback((): void => {
    setChapters([]);
    setCurrentNovel(null);
    setFilteredNovels(novels);

    if (novelsScrollViewRef.current) {
      novelsScrollViewRef.current.scrollTo({
        y: scrollPosition.novelsList || 0,
        animated: false
      });
    }
  }, [scrollPosition, novels]);

  const navigateChapter = useCallback((direction: 'prev' | 'next'): void => {
    const currentIndex = chapters.findIndex(
      chapter => chapter.title === lastReadChapter[currentNovel ?? '']
    );
    const newIndex = direction === 'next' ? currentIndex + 1 : currentIndex - 1;

    if (newIndex >= 0 && newIndex < chapters.length) {
      fetchChapterContent(chapters[newIndex]);
    }
  }, [chapters, currentNovel, lastReadChapter, settings.theme]);

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

  const handleScroll = useCallback(
    debounce((key: string, offset: number) => {
      if (!key.includes('undefined') && !key.includes('null')) {
        const newScrollPosition = {
          ...scrollPosition,
          [key]: offset
        };
        setScrollPosition(newScrollPosition);
        
        // 同時更新 settings 中的 scrollPosition
        const newSettings = {
          ...settings,
          scrollPosition: newScrollPosition
        };
        setSettings(newSettings);
        saveSettings(newSettings);
      }
    }, 50),
    [scrollPosition, settings]
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
  
              for (const chapter of allChapters) {
                const contentKey = `chapter_${novelTitle}_${chapter.title}`;
                const localContent = await getLocalData(contentKey);
                if (!localContent) {
                  undownloadedChapters.push(chapter);
                }
              }

              if (undownloadedChapters.length === 0) {
                Alert.alert('提示', '所有章節已下載');
                return;
              }

              for (const chapter of undownloadedChapters) {
                try {
                  const response = await fetch(chapter.url);
                  
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
                      // 刪除所有已下載的章節
                      for (const chapter of novel.chapters) {
                        const contentKey = `chapter_${novelName}_${chapter.title}`;
                        const hasContent = await getLocalData(contentKey);
                        if (hasContent) {
                          await AsyncStorage.removeItem(contentKey);
                          deletedCount++;
                        }
                      }

                      if (deletedCount > 0) {
                        Alert.alert(
                          '刪除完成',
                          `已刪除 ${deletedCount} 個已下載的章節`
                        );
                      } else {
                        Alert.alert(
                          '提示',
                          '沒有找到已下載的章節'
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

  const handleSettingsChange = (newFontSize: number, newLineHeight: number) => {
    setSettings(prev => ({
      ...prev,
      fontSize: newFontSize,
      lineHeight: newLineHeight
    }));
    saveSettings({
      isDarkMode: settings.isDarkMode,
      lastReadChapter: settings.lastReadChapter,
      scrollPosition: settings.scrollPosition,
      fontSize: newFontSize,
      lineHeight: newLineHeight,
      theme: settings.theme,
      readingTime: settings.readingTime
    });
  };

  const handleResetSettings = () => {
    setSettings(prev => ({
      ...prev,
      fontSize: DEFAULT_FONT_SIZE,
      lineHeight: DEFAULT_LINE_HEIGHT
    }));
    saveSettings({
      isDarkMode: settings.isDarkMode,
      lastReadChapter: settings.lastReadChapter,
      scrollPosition: settings.scrollPosition,
      fontSize: DEFAULT_FONT_SIZE,
      lineHeight: DEFAULT_LINE_HEIGHT,
      theme: settings.theme,
      readingTime: settings.readingTime
    });
  };

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

      // 無論是否有更新，都從網路重新獲取當前章節的內容
      try {
        const contentKey = `chapter_${currentNovel}_${chapter.title}`;
        
        // 直接從網路獲取
        const response = await fetch(chapter.url);
        if (!response.ok) {
          throw new Error(`下載章節失敗: ${response.status}`);
        }
        const text = await response.text();
        
        // 判斷內容是否有變化
        const localContent = await getLocalData(contentKey);
        const hasChanges = text !== localContent;
        
        if (hasChanges && localContent) {
          // 使用 diff 庫計算文本差異
          const changes = diff.diffChars(localContent, text);
          
          // 整理新增和刪除的內容
          let addedText = '';
          let removedText = '';
          
          changes.forEach(change => {
            if (change.added) {
              addedText += change.value;
            } else if (change.removed) {
              removedText += change.value;
            }
          });
          
          // 限制長度以防止對話框太大
          const maxLength = 100;
          const formatText = (text: string, max: number) => 
            text.length > max ? text.substring(0, max) + '...' : text;
          
          // 保存到本地緩存並更新顯示
          await saveLocalData(contentKey, text);
          setCurrentContent(text);
          
          // 如果章節有更新，清除 'modified' 標記
          const chapterStatuses = await getChapterStatus(currentNovel);
          const chapterInfo = chapterStatuses[chapter.title];
          if (chapterInfo?.statuses?.includes('modified')) {
            const updatedStatuses = chapterInfo.statuses.filter(status => status !== 'modified');
            chapterStatuses[chapter.title] = {
              ...chapterInfo,
              statuses: updatedStatuses
            };
            
            // 更新章節記錄
            const chaptersData = await AsyncStorage.getItem('chapters_records');
            const allChaptersRecord: ChapterRecord = chaptersData ? JSON.parse(chaptersData) : {};
            if (!allChaptersRecord[currentNovel]) {
              allChaptersRecord[currentNovel] = {};
            }
            allChaptersRecord[currentNovel] = chapterStatuses;
            await AsyncStorage.setItem('chapters_records', JSON.stringify(allChaptersRecord));
          }
          
          // 顯示詳細的變更信息
          Alert.alert(
            '內容已更新',
            `章節內容已更新至最新版本\n\n${removedText ? '刪除: ' + formatText(removedText, maxLength) + '\n\n' : ''}${addedText ? '新增: ' + formatText(addedText, maxLength) : ''}`,
            [{ 
              text: '確定'
            }]
          );
        } else {
          // 保存到本地緩存並更新顯示
          await saveLocalData(contentKey, text);
          setCurrentContent(text);
          
          Alert.alert('刷新完成', '章節內容已是最新版本');
        }
      } catch (error) {
        logger.error('刷新章節內容失敗:', error);
        throw error;
      }
    } catch (error) {
      logger.error('刷新內容時出錯:', error);
    } finally {
      setRefreshingContent(false);
    }
  }, [currentNovel, lastReadChapter, chapters]);

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
        case 'readingTime':
          const aReadingTime = settings.readingTime[a.title] || 0;
          const bReadingTime = settings.readingTime[b.title] || 0;
          return bReadingTime - aReadingTime;
        default:
          return 0;
      }
    });
  }, [currentSort, settings.readingTime]);

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

  const [readingStartTime, setReadingStartTime] = useState<number | null>(null);
  const [currentReadingTime, setCurrentReadingTime] = useState<number>(0);
  const [isReading, setIsReading] = useState(false);

  // 開始計時
  const startReadingTimer = useCallback(() => {
    setReadingStartTime(Date.now());
    setIsReading(true);
  }, []);

  // 停止計時並更新總閱讀時間
  const stopReadingTimer = useCallback(() => {
    if (readingStartTime && currentNovel) {
      const endTime = Date.now();
      const readingDuration = Math.floor((endTime - readingStartTime) / 1000); // 轉換為秒
      
      setSettings(prev => ({
        ...prev,
        readingTime: {
          ...prev.readingTime,
          [currentNovel]: (prev.readingTime[currentNovel] || 0) + readingDuration
        }
      }));
      
      // 保存到 AsyncStorage
      saveSettings({
        ...settings,
        readingTime: {
          ...settings.readingTime,
          [currentNovel]: (settings.readingTime[currentNovel] || 0) + readingDuration
        }
      });
      
      setReadingStartTime(null);
      setIsReading(false);
    }
  }, [readingStartTime, currentNovel, settings]);

  // 更新當前閱讀時間的計時器
  useEffect(() => {
    let timer: NodeJS.Timeout | null = null;
    
    if (isReading && readingStartTime && currentNovel) {
      timer = setInterval(() => {
        const currentTime = Date.now();
        const elapsedTime = Math.floor((currentTime - readingStartTime) / 1000);
        const totalTime = (settings.readingTime[currentNovel] || 0) + elapsedTime;
        setCurrentReadingTime(totalTime);
      }, 1000);
    } else if (currentNovel) {
      setCurrentReadingTime(settings.readingTime[currentNovel] || 0);
    }

    return () => {
      if (timer) {
        clearInterval(timer);
      }
    };
  }, [isReading, readingStartTime, currentNovel, settings.readingTime]);

  // 在章節內容加載完成時開始計時
  useEffect(() => {
    if (currentContent) {
      startReadingTimer();
    } else {
      stopReadingTimer();
    }
  }, [currentContent]);

  // 在應用退出時停止計時
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextAppState: string) => {
      if (nextAppState === 'background' || nextAppState === 'inactive') {
        stopReadingTimer();
      } else if (nextAppState === 'active' && currentContent) {
        startReadingTimer();
      }
    });

    return () => {
      subscription.remove();
    };
  }, [stopReadingTimer, startReadingTimer, currentContent]);

  const formatReadingTime = (seconds: number): string => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainingSeconds = seconds % 60;
    
    const parts = [];
    if (hours > 0) {
      parts.push(`${hours}小時`);
    }
    if (minutes > 0 || hours > 0) {
      parts.push(`${minutes}分鐘`);
    }
    parts.push(`${remainingSeconds}秒`);
    
    return parts.join('');
  };

  const ReadingTimeButton = () => (
    <TouchableOpacity
      style={styles.headerButton}
      onPress={() => {
        if (currentNovel) {
          Alert.alert(
            '閱讀時間統計',
            `您已閱讀《${currentNovel}》共 ${formatReadingTime(currentReadingTime)}`,
            [
              {
                text: '清除記錄',
                style: 'destructive',
                onPress: () => {
                  Alert.alert(
                    '確認清除',
                    '確定要清除此小說的閱讀時間記錄嗎？',
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
                            const newSettings = {
                              ...settings,
                              readingTime: {
                                ...settings.readingTime,
                                [currentNovel]: 0
                              }
                            };
                            await saveSettings(newSettings);
                            setSettings(newSettings);
                            Alert.alert('成功', '已清除閱讀時間記錄');
                          } catch (error) {
                            logger.error('清除閱讀時間記錄失敗:', error);
                            Alert.alert('錯誤', '清除閱讀時間記錄失敗');
                          }
                        }
                      }
                    ]
                  );
                }
              },
              { 
                text: '確定',
                style: 'cancel'
              }
            ]
          );
        }
      }}
    >
      <MaterialIcons 
        name="timer" 
        size={24}
        color={getTextColor()} 
      />
    </TouchableOpacity>
  );

  const styles = useMemo(() => StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: getBackgroundColor(),
    },
    listContainer: {
      padding: 10,
    },
    contentContainer: {
      padding: 15,
      paddingBottom: 60,
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
      height: 56,
    },
    headerRight: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    headerTitle: {
      fontSize: 20,
      fontWeight: 'bold',
      color: getTextColor(),
    },
    backButton: {
      width: 40,
      height: 40,
      justifyContent: 'center',
      alignItems: 'center',
      marginRight: 8,
    },
    statusBarPlaceholder: {
      height: STATUS_BAR_HEIGHT,
      backgroundColor: getStatusBarBackgroundColor(),
    },
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
      paddingBottom: 0,
      paddingHorizontal: 10,
      color: getTextColor(),
    },
    button: {
      padding: 10,
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
      fontWeight: 'bold',
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
      top: STATUS_BAR_HEIGHT + 1,
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
      width: '100%',
      height: undefined,
      aspectRatio: 1,
      resizeMode: 'contain',
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
      fontWeight: 'bold',
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
  }), [settings.theme]);

  const [isDescriptionExpanded, setIsDescriptionExpanded] = useState(false);

  useEffect(() => {
    const loadInitialData = async () => {
      try {
        // 嘗試從本地加載數據
        const localNovels = await getLocalData('novels');
        if (localNovels && Array.isArray(localNovels) && localNovels.length > 0) {
          setNovels(localNovels);
          setFilteredNovels(localNovels);
        }
        
        // 如果本地沒有數據，則從網絡加載
        if (!localNovels || !Array.isArray(localNovels) || localNovels.length === 0) {
          await fetchNovelList();
        }
      } catch (error) {
        logger.error(error);
      } finally {
        setIsAppReady(true);
      }
    };

    loadInitialData();
  }, []);

  useEffect(() => {
    const backAction = () => {
      if (currentContent) {
        handleReturnToChapters();
        return true;
      } else if (chapters.length > 0) {
        handleReturnToNovels();
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
    if (Platform.OS === 'android') {
      if (UIManager.setLayoutAnimationEnabledExperimental) {
        UIManager.setLayoutAnimationEnabledExperimental(true);
      }
    }
  }, []);

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
        currentVersion = '1.2.5'; // 硬編碼 app.json 中的版本號
      } else {
        // 已構建的應用使用原生應用版本
        currentVersion = Application.nativeApplicationVersion || '1.0.0';
      }
      
      console.log('當前版本:', currentVersion);
      
      // 獲取遠程版本信息
      const response = await fetch('https://raw.githubusercontent.com/xuerowo/myacg/main/輕小說翻譯/version.json');
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const versionInfo = await response.json();
      console.log('遠程版本:', versionInfo.version);
      console.log('比較結果:', compareVersions(versionInfo.version, currentVersion));
      
      // 比較版本號來決定是否顯示更新提示
      if (compareVersions(versionInfo.version, currentVersion) > 0) {
        Alert.alert(
          '發現新版本',
          `新版本 ${versionInfo.version} 已發布\n\n${versionInfo.releaseNotes || ''}`,
          [
            { text: '稍後', style: 'cancel' },
            { 
              text: '立即更新', 
              onPress: () => Linking.openURL(versionInfo.downloadUrl) 
            }
          ]
        );
      } else {
        Alert.alert('沒有新版本', '您已經使用最新版本');
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
        translucent
        backgroundColor={getStatusBarColor()}
        barStyle={getStatusBarStyle()} 
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
          <View style={styles.statusBarPlaceholder} />
          <View style={styles.header}>
            <TouchableOpacity
              style={styles.backButton}
              onPress={handleReturnToChapters}
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
          <ScrollView 
            ref={contentScrollViewRef}
            style={[
              styles.contentContainer,
              { 
                backgroundColor: getBackgroundColor(),
                paddingHorizontal: 16
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
            scrollEventThrottle={16}
            onScrollBeginDrag={(e) => e.persist()}
            onMomentumScrollEnd={(event) => {
              // 在滾動停止時額外保存一次位置
              if (currentNovel && lastReadChapter[currentNovel]) {
                handleScroll(
                  `${currentNovel}-${lastReadChapter[currentNovel]}`,
                  event.nativeEvent.contentOffset.y
                );
              }
            }}
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
              style={{
                body: {
                  ...styles.content,
                  fontSize: settings.fontSize,
                  lineHeight: settings.fontSize * settings.lineHeight,
                },
                strong: {
                  fontWeight: 'bold',
                  color: getTextColor()
                },
                em: {
                  fontWeight: 'bold',
                  color: getTextColor()
                },
                image: {
                  width: '100%',
                  height: undefined,
                  aspectRatio: 1,
                  resizeMode: 'contain',
                  marginVertical: 10,
                  marginHorizontal: -16, // 抵消 contentContainer 的 padding
                },
                heading1: {
                  fontSize: 22,
                  fontWeight: 'bold',
                  color: getTextColor(),
                  marginVertical: 16,
                  borderBottomWidth: 1,
                  borderBottomColor: getBackgroundColor() === '#ffffff' ? '#eeeeee' : '#333333',
                  paddingBottom: 8,
                  lineHeight: Math.max(settings.lineHeight * 1.5, 2) * 22, // 確保標題有足夠的行高
                },
                heading2: {
                  fontSize: 18,
                  fontWeight: 'bold',
                  color: getTextColor(),
                  marginVertical: 8,
                  lineHeight: Math.max(settings.lineHeight * 1.3, 1.8) * 18,
                },
                heading3: {
                  fontSize: 16,
                  fontWeight: 'bold',
                  color: getTextColor(),
                  marginVertical: 6,
                  lineHeight: Math.max(settings.lineHeight * 1.2, 1.6) * 16,
                },
              }}
              mergeStyle={true}
              rules={{
                image: (node, _children, _parent, _styles) => {
                  const { src } = node.attributes;
                  return <MarkdownImage 
                    key={node.key} 
                    src={src} 
                    isDarkMode={settings.theme === 'dark'} 
                    backgroundColor={getBackgroundColor()}
                  />;
                }
              }}
            >
              {currentContent}
            </Markdown>
            <View style={{ height: 10 }} />
          </ScrollView>
          <ReadingSettings
            visible={settingsVisible}
            onClose={() => setSettingsVisible(false)}
            isDarkMode={settings.isDarkMode}
            fontSize={settings.fontSize}
            lineHeight={settings.lineHeight}
            onFontSizeChange={(size) => handleSettingsChange(size, settings.lineHeight)}
            onLineHeightChange={(height) => handleSettingsChange(settings.fontSize, height)}
            onReset={handleResetSettings} 
            theme={settings.theme}
            onThemeChange={handleThemeChange}
          />
          {!settingsVisible && (
            <View style={styles.navigationBar}>
              <TouchableOpacity
                style={styles.button}
                onPress={() => navigateChapter('prev')}
                disabled={isFirstChapter()}
              >
                <MaterialIcons 
                  name="arrow-back" 
                  size={24} 
                  color={isFirstChapter() ? `${getTextColor()}50` : getTextColor()} 
                />
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.button}
                onPress={() => navigateChapter('next')}
                disabled={isLastChapter()}
              >
                <MaterialIcons 
                  name="arrow-forward" 
                  size={24} 
                  color={isLastChapter() ? `${getTextColor()}50` : getTextColor()} 
                />
              </TouchableOpacity>
            </View>
          )}
        </View>
      ) : chapters.length > 0 ? (
        <View style={{ flex: 1 }}>
          <View style={styles.statusBarPlaceholder} />
          <View style={styles.header}>
            <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
              <TouchableOpacity
                style={styles.backButton}
                onPress={handleReturnToNovels}
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
              <ReadingTimeButton />
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
                  <Image
                    source={{ uri: novels.find(n => n.title === currentNovel)?.cover }}
                    style={styles.novelCover}
                    resizeMode="cover"
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
                  <View style={{ maxHeight: isDescriptionExpanded ? undefined : 100, overflow: 'hidden' }}>
                    <Markdown 
                      style={{
                        body: {
                          fontSize: 14,
                          color: getTextColor(),
                        },
                        strong: {
                          fontWeight: 'bold',
                          color: getTextColor()
                        },
                        em: {
                          fontStyle: 'italic',
                          color: getTextColor()
                        },
                        heading1: {
                          fontSize: 18,
                          fontWeight: 'bold',
                          color: getTextColor(),
                          marginVertical: 8,
                          lineHeight: Math.max(settings.lineHeight * 1.5, 2) * 18, // 確保標題有足夠的行高
                        },
                        heading2: {
                          fontSize: 16,
                          fontWeight: 'bold',
                          color: getTextColor(),
                          marginVertical: 6,
                          lineHeight: Math.max(settings.lineHeight * 1.3, 1.8) * 16,
                        },
                        heading3: {
                          fontSize: 15,
                          fontWeight: 'bold',
                          color: getTextColor(),
                          marginVertical: 4,
                          lineHeight: Math.max(settings.lineHeight * 1.2, 1.6) * 15,
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
          />
        </View>
     ) : (
      <View style={{ flex: 1 }}>
        <View style={styles.statusBarPlaceholder} />
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
    </SafeAreaView>
  );
};

export default App;