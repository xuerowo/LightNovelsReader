import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Animated } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import Slider from '@react-native-community/slider';

interface ReadingSettingsProps {
  visible: boolean;
  onClose: () => void;
  isDarkMode: boolean;
  fontSize: number;
  lineHeight: number;
  onFontSizeChange: (size: number) => void;
  onLineHeightChange: (height: number) => void;
  onReset: () => void;
  theme: 'light' | 'dark' | 'eyeComfort';
  onThemeChange: (theme: 'light' | 'dark' | 'eyeComfort') => void;
}

export const DEFAULT_FONT_SIZE = 18;
export const DEFAULT_LINE_HEIGHT = 1.5;

const ReadingSettings: React.FC<ReadingSettingsProps> = ({
  visible,
  onClose,
  isDarkMode,
  fontSize,
  lineHeight,
  onFontSizeChange,
  onLineHeightChange,
  onReset,
  theme,
  onThemeChange
}) => {
  const translateY = React.useRef(new Animated.Value(300)).current;

  React.useEffect(() => {
    Animated.spring(translateY, {
      toValue: visible ? 0 : 300,
      useNativeDriver: true,
      friction: 8
    }).start();
  }, [visible]);

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
            字體大小
          </Text>
          <View style={styles.sliderContainer}>
            <MaterialIcons name="format-size" size={16} color={theme === 'light' ? '#000000' : theme === 'dark' ? '#ffffff' : '#4a4a4a'} />
            <Slider
              style={styles.slider}
              minimumValue={14}
              maximumValue={24}
              value={fontSize}
              onValueChange={onFontSizeChange}
              minimumTrackTintColor="#2196F3"
              maximumTrackTintColor={theme === 'light' ? '#cccccc' : theme === 'dark' ? '#666666' : '#cccccc'}
            />
            <MaterialIcons name="format-size" size={24} color={theme === 'light' ? '#000000' : theme === 'dark' ? '#ffffff' : '#4a4a4a'} />
          </View>
        </View>

        <View style={styles.settingItem}>
          <Text style={[styles.settingLabel, { color: theme === 'light' ? '#000000' : theme === 'dark' ? '#ffffff' : '#4a4a4a' }]}>
            行距
          </Text>
          <View style={styles.sliderContainer}>
            <MaterialIcons name="format-line-spacing" size={20} color={theme === 'light' ? '#000000' : theme === 'dark' ? '#ffffff' : '#4a4a4a'} />
            <Slider
              style={styles.slider}
              minimumValue={1.5}
              maximumValue={2.0}
              value={lineHeight}
              onValueChange={onLineHeightChange}
              minimumTrackTintColor="#2196F3"
              maximumTrackTintColor={theme === 'light' ? '#cccccc' : theme === 'dark' ? '#666666' : '#cccccc'}
            />
            <Text style={[styles.valueText, { color: theme === 'light' ? '#000000' : theme === 'dark' ? '#ffffff' : '#4a4a4a' }]}>
              {lineHeight.toFixed(1)}
            </Text>
          </View>
        </View>

        <TouchableOpacity style={styles.resetButton} onPress={onReset}>
          <Text style={styles.resetButtonText}>重置設定</Text>
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
};

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
  sliderContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  slider: {
    flex: 1,
    marginHorizontal: 10,
  },
  valueText: {
    minWidth: 30,
    textAlign: 'right',
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