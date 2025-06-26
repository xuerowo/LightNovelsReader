/**
 * 路徑處理工具函數
 * 用於處理相對路徑和絕對路徑
 */

const GITHUB_RAW_URL = 'https://raw.githubusercontent.com/xuerowo/myacgn/main/輕小說翻譯/';

/**
 * 判斷是否為絕對路徑
 * @param path 路徑字符串
 * @returns 是否為絕對路徑
 */
export const isAbsolutePath = (path: string): boolean => {
  return path.startsWith('http://') || path.startsWith('https://') || path.startsWith('//');
};

/**
 * 將相對路徑轉換為絕對路徑
 * @param path 路徑字符串
 * @param baseUrl 基礎URL，預設為GITHUB_RAW_URL
 * @returns 絕對路徑
 */
export const resolveUrl = (path: string, baseUrl: string = GITHUB_RAW_URL): string => {
  if (!path) return '';
  
  // 如果已經是絕對路徑，直接返回
  if (isAbsolutePath(path)) {
    return path;
  }
  
  // 如果是相對路徑，與基礎URL合併
  // 確保baseUrl以/結尾，path不以/開頭
  const cleanBaseUrl = baseUrl.endsWith('/') ? baseUrl : baseUrl + '/';
  const cleanPath = path.startsWith('/') ? path.slice(1) : path;
  
  return cleanBaseUrl + cleanPath;
};

/**
 * 解析封面圖片URL
 * @param coverPath 封面圖片路徑
 * @returns 完整的封面圖片URL
 */
export const resolveCoverUrl = (coverPath: string): string => {
  return resolveUrl(coverPath);
};

/**
 * 解析章節內容URL
 * @param chapterUrl 章節內容路徑
 * @returns 完整的章節內容URL
 */
export const resolveChapterUrl = (chapterUrl: string): string => {
  return resolveUrl(chapterUrl);
};

/**
 * 解析Markdown圖片URL
 * @param imagePath 圖片路徑
 * @returns 完整的圖片URL
 */
export const resolveImageUrl = (imagePath: string): string => {
  return resolveUrl(imagePath);
};

export default {
  isAbsolutePath,
  resolveUrl,
  resolveCoverUrl,
  resolveChapterUrl,
  resolveImageUrl
}; 