import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  StyleSheet,
  Pressable,
  Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import SortIcon from './SortIcon';

export type SortOption = 'lastUpdated' | 'chapterCount' | 'wordCount';

interface SortSelectorProps {
  currentSort: SortOption;
  onSortChange: (option: SortOption) => void;
  isDarkMode?: boolean;
}

const options: { value: SortOption; label: string }[] = [
  { value: 'lastUpdated', label: '最新更新' },
  { value: 'chapterCount', label: '章節數' },
  { value: 'wordCount', label: '文字數' },
];

const SortSelector: React.FC<SortSelectorProps> = ({ currentSort, onSortChange, isDarkMode = false }) => {
  const [modalVisible, setModalVisible] = useState(false);
  const buttonRef = useRef<View>(null);
  const [buttonLayout, setButtonLayout] = useState({ x: 0, y: 0, width: 0, height: 0 });

  const currentLabel = options.find(opt => opt.value === currentSort)?.label;
  const textColor = isDarkMode ? '#fff' : '#000';
  const backgroundColor = isDarkMode ? '#333' : '#fff';
  const overlayColor = isDarkMode ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.5)';
  const selectedColor = isDarkMode ? '#404040' : '#f0f0f0';

  return (
    <View>
      <TouchableOpacity
        style={styles.button}
        onPress={() => {
          buttonRef.current?.measure((x, y, width, height, pageX, pageY) => {
            setButtonLayout({ x: pageX, y: pageY, width, height });
            setModalVisible(true);
          });
        }}
        ref={buttonRef}
      >
        <View style={styles.iconGroup}>
          <SortIcon color={textColor} size={18} />
        </View>
        <Text style={[styles.buttonText, { color: textColor }]}>{currentLabel}</Text>
        <Ionicons 
          name="chevron-down" 
          size={16} 
          color={textColor} 
          style={styles.icon}
        />
      </TouchableOpacity>

      <Modal
        transparent
        visible={modalVisible}
        onRequestClose={() => setModalVisible(false)}
      >
        <Pressable 
          style={styles.modalContainer}
          onPress={() => setModalVisible(false)}
        >
          <View 
            style={[
              styles.modalView,
              {
                backgroundColor,
                position: 'absolute',
                top: buttonLayout.y + buttonLayout.height - 40,
                right: Dimensions.get('window').width - (buttonLayout.x + buttonLayout.width),
                minWidth: 120,
              }
            ]}
          >
            {options.map((option) => (
              <TouchableOpacity
                key={option.value}
                style={[
                  styles.optionButton,
                  currentSort === option.value && { backgroundColor: selectedColor }
                ]}
                onPress={() => {
                  onSortChange(option.value);
                  setModalVisible(false);
                }}
              >
                <Text style={[styles.optionText, { color: textColor }]}>
                  {option.label}
                </Text>
                {currentSort === option.value && (
                  <Ionicons name="checkmark" size={20} color={textColor} />
                )}
              </TouchableOpacity>
            ))}
          </View>
        </Pressable>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    height: 40,
  },
  iconGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 4,
  },
  buttonText: {
    fontSize: 16,
    marginHorizontal: 4,
  },
  icon: {
    marginLeft: 2,
  },
  modalContainer: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  modalView: {
    borderRadius: 8,
    padding: 5,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
  optionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 15,
    borderRadius: 8,
  },
  optionText: {
    fontSize: 16,
    marginRight: 8,
  },
});

export default SortSelector;
