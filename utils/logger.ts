/**
 * 自定義日誌工具
 * - 在開發環境中顯示所有日誌
 * - 在生產環境中只顯示錯誤和警告
 */

// 判斷是否處於開發環境 - 使用 React Native 的 __DEV__ 全局變數
const isDev = __DEV__;

// 創建空函數，用於生產環境中的 log 和 debug 方法
const noop = () => {};

// 創建自定義日誌對象
const logger = {
  /**
   * 用於一般信息記錄，僅在開發環境顯示
   */
  log: isDev ? console.log : noop,

  /**
   * 用於調試信息，僅在開發環境顯示
   */
  debug: isDev ? (...args: any[]) => console.log('[DEBUG]', ...args) : noop,

  /**
   * 用於警告信息，生產環境中也會顯示
   */
  warn: console.warn,

  /**
   * 用於錯誤信息，生產環境中也會顯示
   */
  error: console.error,

  /**
   * 用於性能測量
   */
  time: isDev ? console.time : noop,

  /**
   * 結束性能測量並顯示結果
   */
  timeEnd: isDev ? console.timeEnd : noop
};

export default logger; 