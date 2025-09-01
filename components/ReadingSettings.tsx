import React, { useState, useEffect, useRef, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Animated, TextInput } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';

interface ReadingSettingsProps {
  visible: boolean;
  onClose: () => void;
  isDarkMode: boolean;
  fontSize: number;
  lineHeight: number;
  contentWidth: number;
  onFontSizeChange: (size: number) => void;
  onLineHeightChange: (height: number) => void;
  onContentWidthChange: (width: number) => void;
  onReset: () => void;
  theme: 'light' | 'dark' | 'eyeComfort';
  onThemeChange: (theme: 'light' | 'dark' | 'eyeComfort') => void;
}

export const DEFAULT_FONT_SIZE = 18.1;
export const DEFAULT_LINE_HEIGHT = 1.5;
export const DEFAULT_CONTENT_WIDTH = 100;

const ReadingSettings: React.FC<ReadingSettingsProps> = React.memo(({
  visible,
  onClose,
  isDarkMode,
  fontSize,
  lineHeight,
  contentWidth,
  onFontSizeChange,
  onLineHeightChange,
  onContentWidthChange,
  onReset,
  theme,
  onThemeChange
}) => {
  const translateY = useRef(new Animated.Value(300)).current;
  
  // 本地狀態管理，提供即時視覺回饋
  const [localFontSize, setLocalFontSize] = useState(fontSize);
  const [localLineHeight, setLocalLineHeight] = useState(lineHeight);
  const [localContentWidth, setLocalContentWidth] = useState(contentWidth);
  
  // 輸入框文字狀態
  const [fontSizeText, setFontSizeText] = useState(fontSize.toString());
  const [lineHeightText, setLineHeightText] = useState(lineHeight.toString());
  const [contentWidthText, setContentWidthText] = useState(contentWidth.toString());
  
  // 防抖計時器
  const fontSizeTimeoutRef = useRef<number | null>(null);
  const lineHeightTimeoutRef = useRef<number | null>(null);
  const contentWidthTimeoutRef = useRef<number | null>(null);
  
  // 同步外部狀態到本地狀態
  useEffect(() => {
    setLocalFontSize(fontSize);
    setFontSizeText(fontSize.toString());
  }, [fontSize]);
  
  useEffect(() => {
    setLocalLineHeight(lineHeight);
    setLineHeightText(lineHeight.toString());
  }, [lineHeight]);
  
  useEffect(() => {
    setLocalContentWidth(contentWidth);
    setContentWidthText(contentWidth.toString());
  }, [contentWidth]);
  
  // 動畫效果
  useEffect(() => {
    Animated.spring(translateY, {
      toValue: visible ? 0 : 300,
      useNativeDriver: true,
      friction: 8
    }).start();
  }, [visible, translateY]);
  
  // 清理計時器
  useEffect(() => {
    return () => {
      if (fontSizeTimeoutRef.current) {
        clearTimeout(fontSizeTimeoutRef.current);
      }
      if (lineHeightTimeoutRef.current) {
        clearTimeout(lineHeightTimeoutRef.current);
      }
      if (contentWidthTimeoutRef.current) {
        clearTimeout(contentWidthTimeoutRef.current);
      }
    };
  }, []);
  
  // 數值驗證和轉換工具函數
  const validateAndParseNumber = useCallback((text: string, min: number, max: number, defaultValue: number): number => {
    if (text.trim() === '') {
      return defaultValue;
    }
    const num = parseFloat(text);
    if (isNaN(num) || !isFinite(num)) {
      return defaultValue;
    }
    return Math.max(min, Math.min(max, num));
  }, []);
  
  const formatNumberText = useCallback((value: number, decimals: number): string => {
    return value.toFixed(decimals).replace(/\.?0+$/, '');
  }, []);
  
  // 防抖處理字體大小變更
  const handleFontSizeTextChange = useCallback((text: string) => {
    setFontSizeText(text);
    const validatedValue = validateAndParseNumber(text, 12, 30, DEFAULT_FONT_SIZE);
    setLocalFontSize(validatedValue);
    
    if (fontSizeTimeoutRef.current) {
      clearTimeout(fontSizeTimeoutRef.current);
    }
    
    fontSizeTimeoutRef.current = setTimeout(() => {
      onFontSizeChange(validatedValue);
      if (text.trim() !== '') {
        setFontSizeText(formatNumberText(validatedValue, 1));
      }
    }, 300) as any;
  }, [onFontSizeChange, validateAndParseNumber, formatNumberText]);
  
  // 防抖處理行距變更
  const handleLineHeightTextChange = useCallback((text: string) => {
    setLineHeightText(text);
    const validatedValue = validateAndParseNumber(text, 1.0, 3.0, DEFAULT_LINE_HEIGHT);
    setLocalLineHeight(validatedValue);
    
    if (lineHeightTimeoutRef.current) {
      clearTimeout(lineHeightTimeoutRef.current);
    }
    
    lineHeightTimeoutRef.current = setTimeout(() => {
      onLineHeightChange(validatedValue);
      if (text.trim() !== '') {
        setLineHeightText(formatNumberText(validatedValue, 2));
      }
    }, 300) as any;
  }, [onLineHeightChange, validateAndParseNumber, formatNumberText]);
  
  // 防抖處理內容寬度變更
  const handleContentWidthTextChange = useCallback((text: string) => {
    setContentWidthText(text);
    const validatedValue = validateAndParseNumber(text, 60, 100, DEFAULT_CONTENT_WIDTH);
    setLocalContentWidth(validatedValue);
    
    if (contentWidthTimeoutRef.current) {
      clearTimeout(contentWidthTimeoutRef.current);
    }
    
    contentWidthTimeoutRef.current = setTimeout(() => {
      onContentWidthChange(validatedValue);
      if (text.trim() !== '') {
        setContentWidthText(formatNumberText(validatedValue, 1));
      }
    }, 300) as any;
  }, [onContentWidthChange, validateAndParseNumber, formatNumberText]);

  if (!visible) return null;

  return (
    <View style={styles.overlay}>
      <TouchableOpacity 
        style={styles.backdrop}
        onPress={onClose} 
      />
      <Animated.View 
        style={[
          styles.container,
          { 
            backgroundColor: theme === 'light' ? '#ffffff' : theme === 'dark' ? '#333333' : '#f9f1e6',
            transform: [{ translateY }]
          }
        ]}
      >
        <View style={styles.header}>
          <Text style={[styles.title, { color: theme === 'light' ? '#000000' : theme === 'dark' ? '#ffffff' : '#4a4a4a' }]}>
            閱讀設定
          </Text>
          <TouchableOpacity onPress={onClose}>
            <MaterialIcons 
              name="close" 
              size={24} 
              color={theme === 'light' ? '#000000' : theme === 'dark' ? '#ffffff' : '#4a4a4a'} 
            />
          </TouchableOpacity>
        </View>

        <View style={styles.settingItem}>
          <Text style={[styles.settingLabel, { color: theme === 'light' ? '#000000' : theme === 'dark' ? '#ffffff' : '#4a4a4a' }]}>
            主題
          </Text>
          <View style={styles.themeContainer}>
            <TouchableOpacity
              style={[
                styles.themeOption,
                theme === 'light' && styles.selectedTheme,
                { backgroundColor: '#ffffff', borderColor: theme === 'light' ? '#2196F3' : '#cccccc' }
              ]}
              onPress={() => onThemeChange('light')}
            >
              <Text style={[styles.themeText, { color: '#000000' }]}>淺色</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.themeOption,
                theme === 'dark' && styles.selectedTheme,
                { backgroundColor: '#333333', borderColor: theme === 'dark' ? '#2196F3' : '#cccccc' }
              ]}
              onPress={() => onThemeChange('dark')}
            >
              <Text style={[styles.themeText, { color: '#ffffff' }]}>深色</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.themeOption,
                theme === 'eyeComfort' && styles.selectedTheme,
                { backgroundColor: '#f9f1e6', borderColor: theme === 'eyeComfort' ? '#2196F3' : '#cccccc' }
              ]}
              onPress={() => onThemeChange('eyeComfort')}
            >
              <Text style={[styles.themeText, { color: '#4a4a4a' }]}>護眼</Text>
            </TouchableOpacity>
          </View>
        </View>
        
        <View style={styles.settingItem}>
          <Text style={[styles.settingLabel, { color: theme === 'light' ? '#000000' : theme === 'dark' ? '#ffffff' : '#4a4a4a' }]}>
            字體大小 (12-30)
          </Text>
          <View style={styles.inputContainer}>
            <MaterialIcons name="format-size" size={16} color={theme === 'light' ? '#000000' : theme === 'dark' ? '#ffffff' : '#4a4a4a'} />
            <TextInput
              style={[
                styles.textInput,
                {
                  color: theme === 'light' ? '#000000' : theme === 'dark' ? '#ffffff' : '#4a4a4a',
                  borderColor: theme === 'light' ? '#cccccc' : theme === 'dark' ? '#666666' : '#cccccc',
                  backgroundColor: theme === 'light' ? '#f5f5f5' : theme === 'dark' ? '#444444' : '#f0f0f0'
                }
              ]}
              value={fontSizeText}
              onChangeText={handleFontSizeTextChange}
              keyboardType="numeric"
              placeholder={DEFAULT_FONT_SIZE.toString()}
              placeholderTextColor={theme === 'light' ? '#999999' : theme === 'dark' ? '#aaaaaa' : '#888888'}
            />
            <Text style={[styles.unitText, { color: theme === 'light' ? '#000000' : theme === 'dark' ? '#ffffff' : '#4a4a4a' }]}>
              px
            </Text>
          </View>
        </View>

        <View style={styles.settingItem}>
          <Text style={[styles.settingLabel, { color: theme === 'light' ? '#000000' : theme === 'dark' ? '#ffffff' : '#4a4a4a' }]}>
            行距 (1.0-3.0)
          </Text>
          <View style={styles.inputContainer}>
            <MaterialIcons name="format-line-spacing" size={20} color={theme === 'light' ? '#000000' : theme === 'dark' ? '#ffffff' : '#4a4a4a'} />
            <TextInput
              style={[
                styles.textInput,
                {
                  color: theme === 'light' ? '#000000' : theme === 'dark' ? '#ffffff' : '#4a4a4a',
                  borderColor: theme === 'light' ? '#cccccc' : theme === 'dark' ? '#666666' : '#cccccc',
                  backgroundColor: theme === 'light' ? '#f5f5f5' : theme === 'dark' ? '#444444' : '#f0f0f0'
                }
              ]}
              value={lineHeightText}
              onChangeText={handleLineHeightTextChange}
              keyboardType="numeric"
              placeholder={DEFAULT_LINE_HEIGHT.toString()}
              placeholderTextColor={theme === 'light' ? '#999999' : theme === 'dark' ? '#aaaaaa' : '#888888'}
            />
            <Text style={[styles.unitText, { color: theme === 'light' ? '#000000' : theme === 'dark' ? '#ffffff' : '#4a4a4a' }]}>
              倍
            </Text>
          </View>
        </View>

        <View style={styles.settingItem}>
          <Text style={[styles.settingLabel, { color: theme === 'light' ? '#000000' : theme === 'dark' ? '#ffffff' : '#4a4a4a' }]}>
            內容寬度 (60-100)
          </Text>
          <View style={styles.inputContainer}>
            <MaterialIcons name="format-align-center" size={20} color={theme === 'light' ? '#000000' : theme === 'dark' ? '#ffffff' : '#4a4a4a'} />
            <TextInput
              style={[
                styles.textInput,
                {
                  color: theme === 'light' ? '#000000' : theme === 'dark' ? '#ffffff' : '#4a4a4a',
                  borderColor: theme === 'light' ? '#cccccc' : theme === 'dark' ? '#666666' : '#cccccc',
                  backgroundColor: theme === 'light' ? '#f5f5f5' : theme === 'dark' ? '#444444' : '#f0f0f0'
                }
              ]}
              value={contentWidthText}
              onChangeText={handleContentWidthTextChange}
              keyboardType="numeric"
              placeholder={DEFAULT_CONTENT_WIDTH.toString()}
              placeholderTextColor={theme === 'light' ? '#999999' : theme === 'dark' ? '#aaaaaa' : '#888888'}
            />
            <Text style={[styles.unitText, { color: theme === 'light' ? '#000000' : theme === 'dark' ? '#ffffff' : '#4a4a4a' }]}>
              %
            </Text>
          </View>
        </View>

        <TouchableOpacity style={styles.resetButton} onPress={onReset}>
          <Text style={styles.resetButtonText}>重置設定</Text>
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
}, (prevProps, nextProps) => {
  // 自定義比較函數，只有關鍵 props 改變時才重新渲染
  return (
    prevProps.visible === nextProps.visible &&
    prevProps.fontSize === nextProps.fontSize &&
    prevProps.lineHeight === nextProps.lineHeight &&
    prevProps.contentWidth === nextProps.contentWidth &&
    prevProps.theme === nextProps.theme &&
    prevProps.isDarkMode === nextProps.isDarkMode
  );
});

ReadingSettings.displayName = 'ReadingSettings';

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  container: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 16,
    maxHeight: '80%',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  title: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  settingItem: {
    marginBottom: 20,
  },
  settingLabel: {
    fontSize: 16,
    marginBottom: 10,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  textInput: {
    flex: 1,
    height: 44,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginHorizontal: 10,
    fontSize: 16,
    lineHeight: 20,
    textAlign: 'center',
    textAlignVertical: 'center',
  },
  unitText: {
    minWidth: 30,
    textAlign: 'left',
    fontSize: 14,
    fontWeight: '500',
  },
  resetButton: {
    backgroundColor: '#2196F3',
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  resetButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  themeContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  themeOption: {
    flex: 1,
    marginHorizontal: 5,
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
    borderWidth: 2,
  },
  selectedTheme: {
    borderWidth: 2,
  },
  themeText: {
    fontSize: 14,
    fontWeight: 'bold',
  },
});

export default ReadingSettings;