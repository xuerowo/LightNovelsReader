import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  ScrollView,
  Animated,
  View,
  ScrollViewProps,
  NativeSyntheticEvent,
  NativeScrollEvent,
  LayoutChangeEvent,
  ViewStyle,
} from 'react-native';

interface CustomScrollViewProps extends ScrollViewProps {
  indicatorWidth?: number;
  indicatorColor?: string;
  autoHide?: boolean;
  hideTimeout?: number;
  children: React.ReactNode;
}

const CustomScrollView = React.forwardRef<ScrollView, CustomScrollViewProps>(
  (
    {
      indicatorWidth = 4,
      indicatorColor = '#888',
      autoHide = true,
      hideTimeout = 1000,
      children,
      onScroll,
      onContentSizeChange,
      onLayout,
      style,
      ...scrollViewProps
    },
    ref
  ) => {
    // 動畫值
    const scrollIndicatorPosition = useRef(new Animated.Value(0)).current;
    const scrollIndicatorOpacity = useRef(new Animated.Value(0)).current;
    
    // 狀態
    const [contentHeight, setContentHeight] = useState(0);
    const [containerHeight, setContainerHeight] = useState(0);
    const [scrollY, setScrollY] = useState(0);
    const [showIndicator, setShowIndicator] = useState(false);
    
    // 自動隱藏計時器
    const hideTimerRef = useRef<NodeJS.Timeout | null>(null);

    // 計算指示器高度和最大滾動距離
    const indicatorHeight = Math.max(
      (containerHeight / contentHeight) * containerHeight,
      30 // 最小指示器高度
    );
    
    const maxScrollY = Math.max(0, contentHeight - containerHeight);
    const maxIndicatorY = containerHeight - indicatorHeight;

    // 顯示指示器
    const showScrollIndicator = useCallback(() => {
      if (!showIndicator) {
        setShowIndicator(true);
        Animated.timing(scrollIndicatorOpacity, {
          toValue: 0.8,
          duration: 200,
          useNativeDriver: false,
        }).start();
      }

      // 清除之前的計時器
      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current);
      }

      // 如果啟用自動隱藏，設置新的計時器
      if (autoHide) {
        hideTimerRef.current = setTimeout(() => {
          Animated.timing(scrollIndicatorOpacity, {
            toValue: 0,
            duration: 300,
            useNativeDriver: false,
          }).start(() => {
            setShowIndicator(false);
          });
        }, hideTimeout);
      }
    }, [showIndicator, scrollIndicatorOpacity, autoHide, hideTimeout]);

    // 處理滾動事件
    const handleScroll = useCallback(
      (event: NativeSyntheticEvent<NativeScrollEvent>) => {
        const currentScrollY = event.nativeEvent.contentOffset.y;
        setScrollY(currentScrollY);

        // 只有當內容可滾動時才顯示指示器
        if (contentHeight > containerHeight) {
          showScrollIndicator();
          
          // 計算指示器位置
          const progress = Math.max(0, Math.min(1, currentScrollY / maxScrollY));
          const indicatorY = progress * maxIndicatorY;
          
          scrollIndicatorPosition.setValue(indicatorY);
        }

        // 調用外部傳入的 onScroll 回調
        if (onScroll) {
          onScroll(event);
        }
      },
      [
        contentHeight,
        containerHeight,
        maxScrollY,
        maxIndicatorY,
        showScrollIndicator,
        scrollIndicatorPosition,
        onScroll,
      ]
    );

    // 處理內容大小變化
    const handleContentSizeChange = useCallback(
      (width: number, height: number) => {
        setContentHeight(height);
        
        // 調用外部傳入的 onContentSizeChange 回調
        if (onContentSizeChange) {
          onContentSizeChange(width, height);
        }
      },
      [onContentSizeChange]
    );

    // 處理容器佈局變化
    const handleLayout = useCallback(
      (event: LayoutChangeEvent) => {
        const { height } = event.nativeEvent.layout;
        setContainerHeight(height);
        
        // 調用外部傳入的 onLayout 回調
        if (onLayout) {
          onLayout(event);
        }
      },
      [onLayout]
    );

    // 清理計時器
    useEffect(() => {
      return () => {
        if (hideTimerRef.current) {
          clearTimeout(hideTimerRef.current);
        }
      };
    }, []);

    // 指示器樣式
    const indicatorStyle: ViewStyle = {
      position: 'absolute',
      right: 2,
      width: indicatorWidth,
      height: indicatorHeight,
      backgroundColor: indicatorColor,
      borderRadius: indicatorWidth / 2,
      opacity: scrollIndicatorOpacity,
      transform: [{ translateY: scrollIndicatorPosition }],
      zIndex: 1000,
    };

    // 容器樣式
    const containerStyle: ViewStyle = {
      flex: 1,
      position: 'relative',
    };

    return (
      <View style={[containerStyle, style]}>
        <ScrollView
          ref={ref}
          {...scrollViewProps}
          onScroll={handleScroll}
          onContentSizeChange={handleContentSizeChange}
          onLayout={handleLayout}
          showsVerticalScrollIndicator={false}
          showsHorizontalScrollIndicator={false}
          scrollEventThrottle={16}
          style={{ flex: 1 }}
        >
          {children}
        </ScrollView>
        
        {/* 自訂滾動指示器 */}
        {showIndicator && contentHeight > containerHeight && (
          <Animated.View style={indicatorStyle} pointerEvents="none" />
        )}
      </View>
    );
  }
);

CustomScrollView.displayName = 'CustomScrollView';

export default CustomScrollView;