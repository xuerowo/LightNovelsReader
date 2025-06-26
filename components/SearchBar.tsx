import React, { useState } from 'react';
import { View, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';

interface SearchBarProps {
  onSearch: (text: string) => void;
  isDarkMode: boolean;
}

const SearchBar: React.FC<SearchBarProps> = ({ onSearch, isDarkMode }) => {
  const [searchText, setSearchText] = useState('');

  return (
    <View style={[
      styles.container,
      { backgroundColor: isDarkMode ? '#333333' : '#f5f5f5' }
    ]}>
      <MaterialIcons 
        name="search" 
        size={24} 
        color={isDarkMode ? '#ffffff' : '#000000'} 
      />
      <TextInput
        style={[
          styles.input,
          { color: isDarkMode ? '#ffffff' : '#000000' }
        ]}
        value={searchText}
        onChangeText={(text) => {
          setSearchText(text);
          onSearch(text);
        }}
        placeholder="搜尋小說..."
        placeholderTextColor={isDarkMode ? '#888888' : '#666666'}
      />
      {searchText ? (
        <TouchableOpacity
          onPress={() => {
            setSearchText('');
            onSearch('');
          }}
        >
          <MaterialIcons 
            name="close" 
            size={24} 
            color={isDarkMode ? '#ffffff' : '#000000'} 
          />
        </TouchableOpacity>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 8,
    margin: 10,
    borderRadius: 8,
    gap: 8
  },
  input: {
    flex: 1,
    fontSize: 16,
    padding: 4
  }
});

export default SearchBar;