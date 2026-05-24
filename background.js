// ExtMaster - Service Worker
// 职责：管理扩展状态、自动化规则、存储

const DEFAULT_STORAGE = {
  theme: 'light',
  sortMode: 'default',
  manualOrder: [],
  groups: [],
  rules: [],
  autoRuleEnabled: true,
  browserConfig: {
    type: 'auto', // 'auto' | 'chrome' | 'edge' | 'custom'
    customUrl: ''     // 当 type='custom' 时的自定义商店 URL
  }
};

// 可配置的商店 URL 映射（可扩展）
const BROWSE_STORE_URLS = {
  chrome: 'https://chromewebstore.google.com/',
  edge:   'https://microsoftedge.microsoft.com/addons/Microsoft-Edge-Extensions-Home'
};

// 自动检测浏览器类型
function detectBrowser() {
  const ua = navigator.userAgent.toLowerCase();
  const updateUrl = chrome.runtime.getManifest().update_url || '';
  if (updateUrl.includes('microsoftedge') || updateUrl.includes('edgeupdate')) return 'edge';
  if (ua.includes('edg/') || ua.includes('edge')) return 'edge';
  return 'chrome';
}

// 获取当前应使用的商店 URL
async function getStoreUrl() {
  const store = await chrome.storage.local.get('browserConfig');
  const cfg = store.browserConfig || {};
  if (cfg.type === 'custom' && cfg.customUrl) return cfg.customUrl;
  if (cfg.type !== 'auto' && BROWSE_STORE_URLS[cfg.type]) return BROWSE_STORE_URLS[cfg.type];
  return BROWSE_STORE_URLS[detectBrowser()];
}

// 获取所有扩展列表
async function getExtensions() {
  return new Promise((resolve) => {
    chrome.management.getAll((exts) => {
      resolve(exts.filter(e => !e.isApp && e.type === 'extension'));
    });
  });
}

// 启用/禁用扩展
function setExtensionEnabled(id, enabled) {
  chrome.management.setEnabled(id, enabled, () => chrome.runtime.lastError);
}

// 卸载扩展
function uninstallExtension(id) {
  return new Promise((resolve) => {
    chrome.management.uninstall(id, { showConfirmDialog: true }, resolve);
  });
}

// 验证 URL 模式的安全性
function validateUrlPattern(pattern) {
  if (typeof pattern !== 'string') return { valid: false, error: 'Pattern must be a string' };
  if (pattern.length > 200) return { valid: false, error: 'Pattern too long (max 200 chars)' };
  
  // 限制 * 数量
  const starCount = (pattern.match(/\*/g) || []).length;
  if (starCount > 10) return { valid: false, error: 'Too many wildcards (max 10)' };
  
  // 检查是否有危险的正则字符（除了我们支持的 * 和 ?）
  const dangerousChars = /[+{}()|[^$\\]/;
  if (dangerousChars.test(pattern.replace(/\*/g, '').replace(/\?/g, ''))) {
    return { valid: false, error: 'Pattern contains unsupported regex characters' };
  }
  
  return { valid: true };
}

// 安全的通配符匹配
function safeMatchPattern(pattern, url) {
  const validation = validateUrlPattern(pattern);
  if (!validation.valid) {
    console.warn('Invalid URL pattern:', pattern, validation.error);
    return false;
  }
  
  try {
    // 转义正则特殊字符，然后替换 * 为 .*
    const escaped = pattern
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.');
    
    const regex = new RegExp(`^${escaped}$`);
    return regex.test(url);
  } catch (e) {
    console.warn('Regex creation failed for pattern:', pattern, e);
    return false;
  }
}

// 应用自动化规则
async function applyAutoRules(tabId, url) {
  const store = await chrome.storage.local.get(Object.keys(DEFAULT_STORAGE));
  const data = { ...DEFAULT_STORAGE, ...store };
  if (!data.autoRuleEnabled || !data.rules.length) return;

  for (const rule of data.rules) {
    if (!rule.enabled) continue;
    
    // 使用安全的匹配函数
    if (!safeMatchPattern(rule.urlPattern, url)) continue;

    for (const action of rule.actions) {
      const ext = (await getExtensions()).find(e => e.id === action.extId);
      if (ext && ext.enabled !== action.enabled) {
        setExtensionEnabled(action.extId, action.enabled);
      }
    }
    break; // 命中即停止
  }
}

// 监听标签页 URL 变化
chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status === 'complete' && tab.url) {
    applyAutoRules(tabId, tab.url);
  }
});

// 监听消息
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    switch (msg.type) {
      case 'GET_EXTENSIONS':
        sendResponse(await getExtensions());
        break;
      case 'SET_ENABLED':
        setExtensionEnabled(msg.id, msg.enabled);
        sendResponse({ ok: true });
        break;
      case 'UNINSTALL':
        await uninstallExtension(msg.id);
        sendResponse({ ok: true });
        break;
      case 'GET_STORAGE':
        sendResponse(await chrome.storage.local.get(null));
        break;
      case 'SET_STORAGE':
        await chrome.storage.local.set(msg.data);
        sendResponse({ ok: true });
        break;
      case 'OPEN_EXT_PAGE':
        chrome.tabs.create({ url: `chrome://extensions/?id=${msg.id}` });
        sendResponse({ ok: true });
        break;
      case 'OPEN_STORE':
        sendResponse({ url: await getStoreUrl(), ok: true });
        break;
      case 'OPEN_EXTENSIONS':
        chrome.tabs.create({ url: 'chrome://extensions/' });
        sendResponse({ ok: true });
        break;
    }
  })();
  return true;
});