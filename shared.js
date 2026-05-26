// shared.js - 共享工具函数

const DEFAULT_STORAGE = {
  theme: 'light',
  sortMode: 'default',       // 旧版，已迁移至 sortModes
  manualOrder: [],            // 旧版，已迁移至 manualOrders
  sortModes: {},
  manualOrders: {},
  groups: [],
  rules: [],
  autoRuleEnabled: true,
  browserConfig: { type: 'auto', customUrl: '' }
};


// 可配置的商店 URL 映射（可扩展）
const BROWSE_STORE_URLS = {
  chrome: 'https://chromewebstore.google.com/',
  edge:   'https://microsoftedge.microsoft.com/addons/Microsoft-Edge-Extensions-Home'
};


// 自动检测浏览器类型
function detectBrowser() {
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes('edg/') || ua.includes('edge')) return 'edge';
  return 'chrome';
}

// 通过 service worker 获取扩展列表
function getExtensions() {
  return new Promise(resolve => {
    chrome.runtime.sendMessage({ type: 'GET_EXTENSIONS' }, resolve);
  });
}

// 获取存储数据
function getStorage() {
  return new Promise(resolve => {
    chrome.runtime.sendMessage({ type: 'GET_STORAGE' }, resolve);
  });
}

// 保存存储数据
function setStorage(data) {
  return new Promise(resolve => {
    chrome.runtime.sendMessage({ type: 'SET_STORAGE', data }, resolve);
  });
}

// 生成唯一 ID
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// URL 通配符匹配
function matchPattern(pattern, url) {
  const re = pattern.replace(/\./g, '\\.').replace(/\*/g, '.*');
  try {
    return new RegExp(`^${re}$`).test(url);
  } catch {
    return false;
  }
}

// 获取当前标签页 URL
function getCurrentTabUrl() {
  return new Promise(resolve => {
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
      resolve(tabs[0]?.url || '');
    });
  });
}

// 主题 CSS 变量应用
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
}

// 排序扩展
function sortExtensions(exts, mode, manualOrder) {
  switch (mode) {
    case 'enabledFirst':
      return [...exts].sort((a, b) => (b.enabled ? 1 : 0) - (a.enabled ? 1 : 0));
    case 'manual':
      return [...exts].sort((a, b) => {
        const ai = manualOrder.indexOf(a.id);
        const bi = manualOrder.indexOf(b.id);
        if (ai === -1 && bi === -1) return 0;
        if (ai === -1) return 1;
        if (bi === -1) return -1;
        return ai - bi;
      });
    default:
      return exts;
  }
}

// 生成占位扩展图标 SVG (inline data URI)
function placeholderIcon(size = 48, color = '#9aa0a6') {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '"><rect width="' + size + '" height="' + size + '" rx="8" fill="' + color + '"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="white" font-size="' + (size * 0.4) + '" font-family="system-ui">E</text></svg>';
  return 'data:image/svg+xml,' + encodeURIComponent(svg);
}

// 获取当前应使用的商店 URL（前端调用）
async function getStoreUrl() {
  const store = await getStorage();
  const cfg = store.browserConfig || {};
  if (cfg.type === 'custom' && cfg.customUrl) return cfg.customUrl;
  if (cfg.type !== 'auto' && BROWSE_STORE_URLS[cfg.type]) return BROWSE_STORE_URLS[cfg.type];
  return BROWSE_STORE_URLS[detectBrowser()];
}

// HTML 转义，防止 XSS
function escapeHtml(text) {
  return String(text || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// 迁移旧版存储 key（sortMode→sortModes, manualOrder→manualOrders）
function migrateStorageKeys(store) {
  let changed = false;
  if (store.sortMode !== undefined && !store.sortModes) {
    store.sortModes = { all: store.sortMode };
    delete store.sortMode;
    changed = true;
  }
  if (store.manualOrder !== undefined && !store.manualOrders) {
    store.manualOrders = { all: store.manualOrder };
    delete store.manualOrder;
    changed = true;
  }
  return changed;
}

// 下载文件
function downloadAsFile(content, filename, mimeType) {
  mimeType = mimeType || 'application/json';
  const blob = new Blob([content], { type: mimeType + ';charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// 保存/恢复分组展开状态（用于 DnD 重渲染后恢复展开）
function saveGroupOpenStates() {
  return [...document.querySelectorAll('.group-members.open')].map(el => el.id.replace('members-', ''));
}

function restoreGroupOpenStates(ids) {
  requestAnimationFrame(() => {
    ids.forEach(id => {
      const el = document.getElementById('members-' + id);
      if (el) el.classList.add('open');
    });
  });
}