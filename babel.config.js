module.exports = function(api) {
  api.cache(true);
  
  const plugins = [];
  
  // 在生產環境中移除所有 logger.log 語句
  if (process.env.NODE_ENV === 'production') {
    plugins.push(['transform-remove-console', { exclude: ['error', 'warn'] }]);
  }
  
  return {
    presets: ['babel-preset-expo'],
    plugins
  };
}; 