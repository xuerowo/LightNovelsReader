import React from 'react';
import Svg, { Path } from 'react-native-svg';

interface SortIconProps {
  color: string;
  size?: number;
}

const SortIcon: React.FC<SortIconProps> = ({ color, size = 18 }) => {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {/* 三條線 */}
      <Path
        d="M4 7h10M4 12h8M4 17h6"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* 向下箭頭 */}
      <Path
        d="M17 13l3 3l3-3"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M20 8v8"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
};

export default SortIcon;
