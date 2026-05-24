// popup.js - ExtMaster 主弹窗逻辑

let allExtensions = [];
let currentGroup = 'all';
let currentSort = 'default';
let storageData = {};
let dragSrcEl = null;
let pendingUninstallId = null;

// 验证 URL 模式的安全性（与 background.js 保持一致）
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

// ── 主题应用函数（缺失的补全） ──
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
}

// ── 初始化 ──
document.addEventListener('DOMContentLoaded', init);

async function init() {
  storageData = await getStorage();

  // 迁移旧版全局配置
  if (storageData.sortMode !== undefined && !storageData.sortModes) {
    storageData.sortModes = { all: storageData.sortMode };
    delete storageData.sortMode;
    await setStorage({ sortModes: storageData.sortModes });
    await new Promise(r => chrome.storage.local.remove('sortMode', r));
  }
  if (storageData.manualOrder !== undefined && !storageData.manualOrders) {
    storageData.manualOrders = { all: storageData.manualOrder };
    delete storageData.manualOrder;
    await setStorage({ manualOrders: storageData.manualOrders });
    await new Promise(r => chrome.storage.local.remove('manualOrder', r));
  }
  storageData.sortModes = storageData.sortModes || {};
  storageData.manualOrders = storageData.manualOrders || {};

  currentSort = storageData.sortModes[currentGroup] || 'default';

  applyTheme(storageData.theme || 'light');
  document.getElementById('btnTheme').textContent = storageData.theme === 'dark' ? '☀️' : '🌙';
  document.getElementById('sortSelect').value = currentSort;
  document.getElementById('sortHint').style.display = currentSort === 'manual' ? 'flex' : 'none';
  document.getElementById('toggleAutoRule').checked = storageData.autoRuleEnabled !== false;

  // 初始化浏览器配置 UI
  const browserCfg = storageData.browserConfig || {};
  document.getElementById('browserSelect').value = browserCfg.type || 'auto';
  document.getElementById('customStoreUrl').value = browserCfg.customUrl || '';
  document.getElementById('customUrlRow').style.display = (browserCfg.type === 'custom') ? 'flex' : 'none';

  setupGroupTabs();
  await loadExtensions();
  bindEvents();
}

// ── 加载扩展列表 ──
async function loadExtensions() {
  const listEl = document.getElementById('extList');
  listEl.innerHTML = '<div class="loading">⏳ 加载中...</div>';

  allExtensions = await getExtensions();
  storageData = await getStorage();

  renderExtensions();
}

function renderExtensions() {
  const listEl = document.getElementById('extList');
  const manualOrder = ((storageData.manualOrders || {})[currentGroup] || []);
  const groups = storageData.groups || [];

  // 过滤
  let filtered = allExtensions;
  if (currentGroup !== 'all') {
    const grp = groups.find(g => g.id === currentGroup);
    if (grp) {
      filtered = allExtensions.filter(e => grp.members.includes(e.id));
    }
  }

  // 排序
  let sorted = sortExtensions(filtered, currentSort, manualOrder);

  listEl.innerHTML = '';

  if (sorted.length === 0) {
    listEl.innerHTML = '<div class="empty-state"><span class="icon">📭</span><span class="text">暂无扩展</span></div>';
    return;
  }

  for (const ext of sorted) {
    const grp = groups.find(g => g.members.includes(ext.id));
    const card = createExtCard(ext, grp);
    listEl.appendChild(card);
  }
}

function createExtCard(ext, group) {
  const card = document.createElement('div');
  card.className = 'ext-card' + (currentSort === 'manual' ? ' draggable' : '');
  card.draggable = (currentSort === 'manual');
  card.dataset.id = ext.id;

  const icon = document.createElement('img');
  icon.className = 'ext-icon';
  icon.alt = ext.name;
  if (ext.icons && ext.icons.length > 0) {
    icon.src = ext.icons[ext.icons.length - 1].url;
    icon.onerror = () => { icon.src = placeholderIcon(36); };
  } else {
    icon.src = placeholderIcon(36);
  }

  const info = document.createElement('div');
  info.className = 'ext-info';

  const name = document.createElement('div');
  name.className = 'ext-name' + (!ext.enabled ? ' disabled-ext' : '');
  name.textContent = ext.name;

  const meta = document.createElement('div');
  meta.className = 'ext-meta';
  meta.innerHTML = `<span class="ext-version">v${ext.version}</span>`;

  if (group) {
    const tag = document.createElement('span');
    tag.className = 'group-tag';
    tag.textContent = group.name;
    meta.appendChild(tag);
  }

  info.appendChild(name);
  info.appendChild(meta);

  const actions = document.createElement('div');
  actions.className = 'ext-actions';

  const toggle = document.createElement('button');
  toggle.className = 'btn btn-sm ' + (ext.enabled ? 'btn-secondary' : 'btn-primary');
  toggle.textContent = ext.enabled ? '禁用' : '启用';
  toggle.dataset.id = ext.id;
  toggle.dataset.action = 'toggle';
  actions.appendChild(toggle);

  const settings = document.createElement('div');
  settings.className = 'ext-more';
  settings.title = '扩展详情';
  settings.textContent = '⚙';
  settings.dataset.id = ext.id;
  settings.dataset.action = 'settings';
  settings.setAttribute('role', 'button');
  settings.setAttribute('tabindex', '0');
  actions.appendChild(settings);

  card.appendChild(icon);
  card.appendChild(info);
  card.appendChild(actions);

  return card;
}

// ── 分组标签 ──
function setupGroupTabs() {
  const tabsEl = document.getElementById('groupTabs');
  const groups = storageData.groups || [];

  // 保留"全部"和"未分组"
  const tabs = tabsEl.querySelectorAll('.tab:not([data-group="all"])');
  tabs.forEach(t => t.remove());

  for (const grp of groups) {
    const tab = document.createElement('button');
    tab.className = 'tab';
    tab.dataset.group = grp.id;
    tab.textContent = grp.name;
    tabsEl.appendChild(tab);
  }

  document.querySelectorAll('.tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.group === currentGroup);
  });
}

// ── 事件绑定 ──
function bindEvents() {
  // 主题切换
  document.getElementById('btnTheme').onclick = async () => {
    const newTheme = storageData.theme === 'dark' ? 'light' : 'dark';
    storageData.theme = newTheme;
    await setStorage({ theme: newTheme });
    applyTheme(newTheme);
    document.getElementById('btnTheme').textContent = newTheme === 'dark' ? '☀️' : '🌙';
  };

  // 设置面板
  document.getElementById('btnSettings').onclick = () => {
    document.getElementById('settingsPanel').classList.toggle('open');
  };
  document.getElementById('btnCloseSettings').onclick = () => {
    document.getElementById('settingsPanel').classList.remove('open');
  };
  document.getElementById('btnOpenRules').onclick = () => chrome.tabs.create({ url: chrome.runtime.getURL('rules.html') });
  document.getElementById('btnOpenGroups').onclick = () => chrome.tabs.create({ url: chrome.runtime.getURL('groups.html') });
  document.getElementById('toggleAutoRule').onchange = async (e) => {
    storageData.autoRuleEnabled = e.target.checked;
    await setStorage({ autoRuleEnabled: e.target.checked });
  };

  // 浏览器商店配置
  document.getElementById('browserSelect').onchange = async (e) => {
    const type = e.target.value;
    storageData.browserConfig = storageData.browserConfig || {};
    storageData.browserConfig.type = type;
    await setStorage({ browserConfig: storageData.browserConfig });
    document.getElementById('customUrlRow').style.display = type === 'custom' ? 'flex' : 'none';
    if (type !== 'custom') document.getElementById('customStoreUrl').value = '';
  };
  
  // 自定义商店 URL 验证
  document.getElementById('customStoreUrl').onchange = async (e) => {
    const url = e.target.value.trim();
    
    // 清空时不验证
    if (!url) {
      storageData.browserConfig = storageData.browserConfig || { type: 'custom' };
      storageData.browserConfig.type = 'custom';
      storageData.browserConfig.customUrl = '';
      await setStorage({ browserConfig: storageData.browserConfig });
      return;
    }
    
    // 验证 URL 格式和协议
    try {
      const parsed = new URL(url);
      if (!['https:', 'http:'].includes(parsed.protocol)) {
        alert('仅支持 HTTP/HTTPS 协议');
        e.target.value = storageData.browserConfig?.customUrl || '';
        return;
      }
      
      // 检查是否为危险协议
      if (url.toLowerCase().startsWith('javascript:') || 
          url.toLowerCase().startsWith('data:')) {
        alert('不支持该协议');
        e.target.value = storageData.browserConfig?.customUrl || '';
        return;
      }
      
      storageData.browserConfig = storageData.browserConfig || { type: 'custom' };
      storageData.browserConfig.type = 'custom';
      storageData.browserConfig.customUrl = url;
      await setStorage({ browserConfig: storageData.browserConfig });
    } catch (err) {
      alert('无效的 URL：' + err.message);
      e.target.value = storageData.browserConfig?.customUrl || '';
    }
  };

  // 导出扩展名称
  document.getElementById('btnExportNames').onclick = async () => {
    const exts = await getExtensions();
    const lines = exts.map(e => e.name).join('\n');
    const blob = new Blob([lines], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `extmaster-extensions-${new Date().toISOString().slice(0,10)}.txt`;
    a.click(); URL.revokeObjectURL(url);
  };

  // 备份（添加缺失的 3 个功能）
  document.getElementById('btnBackup').onclick = async () => {
    const data = {
      version: 1,
      exportedAt: new Date().toISOString(),
      // ✅ 已备份的功能
      rules: storageData.rules || [],
      autoRuleEnabled: storageData.autoRuleEnabled ?? true,
      groups: (storageData.groups || []).map(g => {
        const members = [];
        for (const eid of g.members) {
          const ext = allExtensions.find(e => e.id === eid);
          members.push({ id: eid, name: ext ? ext.name : '' });
        }
        return { id: g.id, name: g.name, members };
      }),
      // ✅ 新增：排序模式
      sortModes: storageData.sortModes || {},
      // ✅ 新增：手动排序顺序
      manualOrders: storageData.manualOrders || {},
      // ✅ 新增：主题设置
      theme: storageData.theme || 'light'
    };
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `extmaster-backup-${new Date().toISOString().slice(0,10)}.json`;
    a.click(); URL.revokeObjectURL(url);
  };

  // 恢复（添加备份文件验证）
  document.getElementById('btnRestore').onclick = () => {
    document.getElementById('fileRestore').click();
  };

  // 验证备份数据结构
  function validateBackupData(data) {
    if (!data || typeof data !== 'object') {
      return { valid: false, error: '无效的备份文件' };
    }
    
    if (data.version !== 1) {
      return { valid: false, error: '不支持的备份文件版本' };
    }
    
    // 验证 rules
    if (data.rules) {
      if (!Array.isArray(data.rules)) {
        return { valid: false, error: 'rules 必须是数组' };
      }
      
      for (const rule of data.rules) {
        if (typeof rule !== 'object') {
          return { valid: false, error: 'rule 格式错误' };
        }
        if (typeof rule.id !== 'string') {
          return { valid: false, error: 'rule.id 必须是字符串' };
        }
        if (typeof rule.urlPattern !== 'string') {
          return { valid: false, error: 'rule.urlPattern 必须是字符串' };
        }
        if (!Array.isArray(rule.actions)) {
          return { valid: false, error: 'rule.actions 必须是数组' };
        }
        
        // 验证 URL 模式
        const validation = validateUrlPattern(rule.urlPattern);
        if (!validation.valid) {
          return { valid: false, error: `规则 "${rule.urlPattern}" 无效: ${validation.error}` };
        }
        
        for (const action of rule.actions) {
          if (typeof action.extId !== 'string') {
            return { valid: false, error: 'action.extId 必须是字符串' };
          }
          if (typeof action.enabled !== 'boolean') {
            return { valid: false, error: 'action.enabled 必须是布尔值' };
          }
        }
      }
    }
    
    // 验证 groups
    if (data.groups) {
      if (!Array.isArray(data.groups)) {
        return { valid: false, error: 'groups 必须是数组' };
      }
      
      for (const group of data.groups) {
        if (typeof group !== 'object') {
          return { valid: false, error: 'group 格式错误' };
        }
        if (typeof group.id !== 'string') {
          return { valid: false, error: 'group.id 必须是字符串' };
        }
        if (typeof group.name !== 'string') {
          return { valid: false, error: 'group.name 必须是字符串' };
        }
        if (!Array.isArray(group.members)) {
          return { valid: false, error: 'group.members 必须是数组' };
        }
      }
    }
    
    // ✅ 新增：验证 sortModes
    if (data.sortModes) {
      if (typeof data.sortModes !== 'object' || Array.isArray(data.sortModes)) {
        return { valid: false, error: 'sortModes 必须是对象' };
      }
    }
    
    // ✅ 新增：验证 manualOrders
    if (data.manualOrders) {
      if (typeof data.manualOrders !== 'object' || Array.isArray(data.manualOrders)) {
        return { valid: false, error: 'manualOrders 必须是对象' };
      }
      
      // 验证每个分组的排序顺序
      for (const [groupId, order] of Object.entries(data.manualOrders)) {
        if (!Array.isArray(order)) {
          return { valid: false, error: `manualOrders['${groupId}'] 必须是数组` };
        }
        for (const extId of order) {
          if (typeof extId !== 'string') {
            return { valid: false, error: `manualOrders['${groupId}'] 中的扩展 ID 必须是字符串` };
          }
        }
      }
    }
    
    // ✅ 新增：验证 theme
    if (data.theme) {
      if (typeof data.theme !== 'string') {
        return { valid: false, error: 'theme 必须是字符串' };
      }
      if (!['light', 'dark'].includes(data.theme)) {
        return { valid: false, error: 'theme 必须是 "light" 或 "dark"' };
      }
    }
    
    return { valid: true };
  }

  document.getElementById('fileRestore').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = '';
    
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      
      // 验证备份数据
      const validation = validateBackupData(data);
      if (!validation.valid) {
        alert('备份文件验证失败：' + validation.error);
        return;
      }

      // ✅ 恢复已备份的功能
      if (data.rules) storageData.rules = data.rules;
      if (data.autoRuleEnabled !== undefined) storageData.autoRuleEnabled = data.autoRuleEnabled;

      if (data.groups) {
        storageData.groups = data.groups.map(g => ({
          id: g.id,
          name: g.name,
          members: g.members.map(m => m.id).filter(id => allExtensions.some(e => e.id === id))
        }));
      }

      // ✅ 新增：恢复排序模式
      if (data.sortModes) {
        storageData.sortModes = data.sortModes;
      }

      // ✅ 新增：恢复手动排序顺序（过滤不存在的扩展）
      if (data.manualOrders) {
        const allExtIds = allExtensions.map(e => e.id);
        storageData.manualOrders = {};
        for (const [groupId, order] of Object.entries(data.manualOrders)) {
          if (Array.isArray(order)) {
            storageData.manualOrders[groupId] = order.filter(id => allExtIds.includes(id));
          }
        }
      }

      // ✅ 新增：恢复主题设置
      if (data.theme) {
        storageData.theme = data.theme;
        applyTheme(data.theme);
        document.getElementById('btnTheme').textContent = data.theme === 'dark' ? '☀️' : '🌙';
      }

      // ✅ 保存所有恢复的数据
      await setStorage({
        rules: storageData.rules,
        autoRuleEnabled: storageData.autoRuleEnabled,
        groups: storageData.groups,
        sortModes: storageData.sortModes,
        manualOrders: storageData.manualOrders,
        theme: storageData.theme
      });

      renderExtensions();
      setupGroupTabs();
      document.getElementById('toggleAutoRule').checked = storageData.autoRuleEnabled;
      alert('恢复成功！');
    } catch (err) {
      alert('恢复失败：' + err.message);
    }
  };

  // 分组标签
  document.getElementById('groupTabs').onclick = async (e) => {
    const tab = e.target.closest('.tab');
    if (!tab) return;
    
    // 强制确保设置面板关闭（防御性编程）
    const panel = document.getElementById('settingsPanel');
    panel.classList.remove('open');
    panel.style.cssText = '';  // 清除任何内联样式
    
    currentGroup = tab.dataset.group;
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    
    // ✅ 居中显示当前选中的分组标签（手动计算，不影响其他功能）
    const tabsContainer = document.getElementById('groupTabs');
    if (tabsContainer && tab) {
      const tabOffsetLeft = tab.offsetLeft;
      const tabWidth = tab.offsetWidth;
      const containerWidth = tabsContainer.clientWidth;
      const targetScrollLeft = tabOffsetLeft - (containerWidth / 2) + (tabWidth / 2);
      tabsContainer.scrollTo({ left: targetScrollLeft, behavior: 'smooth' });
    }
    
    currentSort = (storageData.sortModes || {})[currentGroup] || 'default';
    document.getElementById('sortSelect').value = currentSort;
    document.getElementById('sortHint').style.display = currentSort === 'manual' ? 'flex' : 'none';
    renderExtensions();
    
    // 切换分组后，滚动到顶部
    const contentArea = document.querySelector('.content-area');
    if (contentArea) contentArea.scrollTop = 0;
  };

  // 新建分组
  document.getElementById('btnAddGroup').onclick = () => {
    document.getElementById('modalAddGroup').style.display = 'flex';
    document.getElementById('inputGroupName').value = '';
    document.querySelectorAll('.color-dot').forEach((d, i) => d.classList.toggle('selected', i === 0));
  };

  // 颜色选择
  document.getElementById('colorPicker').onclick = (e) => {
    const dot = e.target.closest('.color-dot');
    if (!dot) return;
    document.querySelectorAll('.color-dot').forEach(d => d.classList.remove('selected'));
    dot.classList.add('selected');
  };

  // 确认新建分组
  document.getElementById('btnConfirmGroup').onclick = async () => {
    const name = document.getElementById('inputGroupName').value.trim();
    if (!name) return;
    const color = document.querySelector('.color-dot.selected')?.dataset.color || '#4285F4';
    const newGroup = { id: uid(), name, color, members: [] };
    storageData.groups = [...(storageData.groups || []), newGroup];
    await setStorage({ groups: storageData.groups });
    setupGroupTabs();
    document.getElementById('modalAddGroup').style.display = 'none';
  };

  document.getElementById('btnCancelGroup').onclick = () => {
    document.getElementById('modalAddGroup').style.display = 'none';
  };

  // 排序
  document.getElementById('sortSelect').onchange = async (e) => {
    currentSort = e.target.value;
    storageData.sortModes = storageData.sortModes || {};
    storageData.sortModes[currentGroup] = currentSort;

    // 切换到手动排序时，如果当前分组还没有 manualOrder，则用当前列表顺序初始化
    if (currentSort === 'manual') {
      storageData.manualOrders = storageData.manualOrders || {};
      if (!Array.isArray(storageData.manualOrders[currentGroup]) || storageData.manualOrders[currentGroup].length === 0) {
        const filtered = allExtensions.filter(ext => {
          if (currentGroup === 'all') return true;
          const grp = (storageData.groups || []).find(g => g.id === currentGroup);
          return grp && grp.members && grp.members.includes(ext.id);
        });
        storageData.manualOrders[currentGroup] = filtered.map(x => x.id);
      }
    }

    await setStorage({ sortModes: storageData.sortModes, manualOrders: storageData.manualOrders });
    document.getElementById('sortHint').style.display = currentSort === 'manual' ? 'flex' : 'none';
    renderExtensions();
  };

  // 扩展列表点击
  document.getElementById('extList').onclick = handleExtListClick;

  // 卸载弹窗
  document.getElementById('btnCancelUninstall').onclick = () => {
    document.getElementById('modalUninstall').style.display = 'none';
    pendingUninstallId = null;
  };
  document.getElementById('btnConfirmUninstall').onclick = async () => {
    if (pendingUninstallId) {
      await new Promise(r => chrome.runtime.sendMessage({ type: 'UNINSTALL', id: pendingUninstallId }, r));
      document.getElementById('modalUninstall').style.display = 'none';
      pendingUninstallId = null;
      await loadExtensions();
    }
  };

  // 底部按钮
  document.getElementById('btnManageExt').onclick = () => {
    chrome.runtime.sendMessage({ type: 'OPEN_EXTENSIONS' });
    window.close();
  };
  document.getElementById('btnStore').onclick = async () => {
    const res = await new Promise(r => chrome.runtime.sendMessage({ type: 'OPEN_STORE' }, r));
    chrome.tabs.create({ url: res.url });
    window.close();
  };

  // 右键菜单
  document.addEventListener('click', () => closeContextMenu());
  document.getElementById('extList').oncontextmenu = handleContextMenu;

  // 拖拽排序
  setupDragDrop();
}

async function handleExtListClick(e) {
  const action = e.target.dataset.action;
  if (!action) return;
  const id = e.target.dataset.id;

  if (action === 'toggle') {
    const ext = allExtensions.find(x => x.id === id);
    if (!ext) return;
    const newState = !ext.enabled;
    await new Promise(r => chrome.runtime.sendMessage({ type: 'SET_ENABLED', id, enabled: newState }, r));
    await loadExtensions();
  } else if (action === 'settings') {
    chrome.runtime.sendMessage({ type: 'OPEN_EXT_PAGE', id });
    window.close();
  }
}

function handleContextMenu(e) {
  e.preventDefault();
  const card = e.target.closest('.ext-card');
  if (!card) return;

  const extId = card.dataset.id;
  const groups = storageData.groups || [];
  const extGroups = groups.filter(g => g.members.includes(extId));

  closeContextMenu();

  const menu = document.createElement('div');
  menu.className = 'context-menu open';
  menu.style.left = Math.min(e.clientX, window.innerWidth - 160) + 'px';
  menu.style.top = Math.min(e.clientY, window.innerHeight - 200) + 'px';

  // 启用/禁用
  const ext = allExtensions.find(x => x.id === extId);
  const toggleText = ext?.enabled ? '⏸ 禁用扩展' : '▶ 启用扩展';
  menu.innerHTML = `
    <div class="ctx-item" data-action="toggle" data-id="${extId}">${toggleText}</div>
    <div class="ctx-item" data-action="info" data-id="${extId}">🔍 扩展详情</div>
    <div class="ctx-divider"></div>
    <div class="ctx-item" data-action="assign" data-id="${extId}">📂 指派到分组 ›</div>
    <div class="ctx-divider"></div>
    <div class="ctx-item" data-action="uninstall" data-id="${extId}" style="color:var(--danger)">🗑 卸载</div>
  `;

  menu.onclick = async (ev) => {
    const act = ev.target.dataset.action;
    const actId = ev.target.dataset.id;
    closeContextMenu();

    if (act === 'toggle') {
      const ex = allExtensions.find(x => x.id === actId);
      await new Promise(r => chrome.runtime.sendMessage({ type: 'SET_ENABLED', id: actId, enabled: !ex.enabled }, r));
      await loadExtensions();
    } else if (act === 'info') {
      chrome.runtime.sendMessage({ type: 'OPEN_EXT_PAGE', id: actId });
      window.close();
    } else if (act === 'uninstall') {
      const ex = allExtensions.find(x => x.id === actId);
      document.getElementById('uninstallMsg').textContent = `确定要卸载「${ex.name}」吗？`;
      document.getElementById('modalUninstall').style.display = 'flex';
      pendingUninstallId = actId;
    } else if (act === 'assign') {
      showAssignMenu(ev.target, actId);
    }
  };

  document.body.appendChild(menu);
}

async function showAssignMenu(anchor, extId) {
  const groups = storageData.groups || [];
  closeContextMenu();

  const menu = document.createElement('div');
  menu.className = 'context-menu open';
  const rect = anchor.getBoundingClientRect();
  menu.style.left = rect.left + 'px';
  menu.style.top = (rect.bottom + 4) + 'px';

  const currentGroups = groups.filter(g => g.members.includes(extId));

  let html = '';
  if (groups.length === 0) {
    html = '<div class="ctx-item" style="color:var(--text2)">暂无分组</div>';
  } else {
    for (const g of groups) {
      const isMember = currentGroups.some(cg => cg.id === g.id);
      html += `<div class="ctx-item" data-action="group-${isMember ? 'remove' : 'add'}" data-ext="${extId}" data-grp="${g.id}">
        ${isMember ? '✓ ' : ''}${g.name}
      </div>`;
    }
    html += '<div class="ctx-divider"></div>';
    html += `<div class="ctx-item" data-action="group-remove" data-ext="${extId}" data-grp="all">❌ 从分组移除</div>`;
  }

  menu.innerHTML = html;
  menu.onclick = async (ev) => {
    const act = ev.target.dataset.action;
    const actExt = ev.target.dataset.ext;
    const actGrp = ev.target.dataset.grp;
    closeContextMenu();

    if (act === 'group-add') {
      const grp = groups.find(g => g.id === actGrp);
      if (grp && !grp.members.includes(actExt)) {
        grp.members.push(actExt);
        storageData.groups = groups;
        await setStorage({ groups });
        setupGroupTabs();
        renderExtensions();
      }
    } else if (act === 'group-remove') {
      if (actGrp === 'all') {
        storageData.groups = groups.map(g => ({ ...g, members: g.members.filter(m => m !== actExt) }));
      } else {
        const grp = groups.find(g => g.id === actGrp);
        if (grp) grp.members = grp.members.filter(m => m !== actExt);
      }
      await setStorage({ groups: storageData.groups });
      setupGroupTabs();
      renderExtensions();
    }
  };

  document.body.appendChild(menu);
}

function closeContextMenu() {
  document.querySelectorAll('.context-menu').forEach(m => m.remove());
}

// ── 拖拽排序 ──
function setupDragDrop() {
  const list = document.getElementById('extList');

  list.addEventListener('dragstart', (e) => {
    const card = e.target.closest('.ext-card');
    if (!card || currentSort !== 'manual') { e.preventDefault(); return; }
    dragSrcEl = card;
    card.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
  });

  list.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const card = e.target.closest('.ext-card');
    if (card && card !== dragSrcEl) {
      document.querySelectorAll('.ext-card').forEach(c => c.classList.remove('drag-over'));
      card.classList.add('drag-over');
    }
  });

  list.addEventListener('dragleave', (e) => {
    if (!e.relatedTarget?.closest('.ext-card')) {
      document.querySelectorAll('.ext-card').forEach(c => c.classList.remove('drag-over'));
    }
  });

  list.addEventListener('drop', async (e) => {
    e.preventDefault();
    const target = e.target.closest('.ext-card');
    if (!target || target === dragSrcEl || currentSort !== 'manual') return;

    const srcId = dragSrcEl.dataset.id;
    const dstId = target.dataset.id;

    // 计算新顺序
    const manualOrder = [...((storageData.manualOrders || {})[currentGroup] || [])];
    // 保证所有扩展 ID 都在列表中
    const allIds = allExtensions.map(x => x.id);
    for (const id of allIds) {
      if (!manualOrder.includes(id)) manualOrder.push(id);
    }

    const srcIdx = manualOrder.indexOf(srcId);
    const dstIdx = manualOrder.indexOf(dstId);

    manualOrder.splice(srcIdx, 1);
    manualOrder.splice(dstIdx, 0, srcId);

    storageData.manualOrders = storageData.manualOrders || {};
    storageData.manualOrders[currentGroup] = manualOrder;
    storageData.sortModes = storageData.sortModes || {};
    storageData.sortModes[currentGroup] = 'manual';
    currentSort = 'manual';
    document.getElementById('sortSelect').value = 'manual';
    document.getElementById('sortHint').style.display = 'flex';

    await setStorage({ manualOrders: storageData.manualOrders, sortModes: storageData.sortModes });
    document.querySelectorAll('.ext-card').forEach(c => c.classList.remove('dragging', 'drag-over', 'drag-over'));
    dragSrcEl = null;
    renderExtensions();
  });

  list.addEventListener('dragend', () => {
    document.querySelectorAll('.ext-card').forEach(c => c.classList.remove('dragging', 'drag-over'));
    dragSrcEl = null;
  });
}

// ── 分组标签拖拽滚动（彻底修复：流畅 + 全区域可拖） ──
function initGroupTabsDrag() {
  const wrap = document.getElementById('groupTabsWrap');  // 外层面板
  const tabs = document.getElementById('groupTabs');       // 可滚动容器
  if (!wrap || !tabs) return;
  
  let isDragging = false;
  let startX = 0;
  let startScrollLeft = 0;
  let hasMoved = false;
  
  // 鼠标按下：开始拖拽检测
  wrap.addEventListener('mousedown', (e) => {
    // 只响应左键
    if (e.button !== 0) return;
    // 点击.tab时不拖拽（保留点击切换功能）
    if (e.target.closest('.tab')) return;
    
    isDragging = true;
    hasMoved = false;
    startX = e.clientX;
    startScrollLeft = tabs.scrollLeft;
    wrap.style.cursor = 'grabbing';
    tabs.style.cursor = 'grabbing';
  });
  
  // 鼠标移动：执行拖拽滚动
  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    
    const deltaX = e.clientX - startX;
    
    // 移动超过5px才认为是拖拽（避免误触）
    if (Math.abs(deltaX) > 5) {
      hasMoved = true;
    }
    
    // 实时滚动（使用 requestAnimationFrame 优化流畅度）
    if (hasMoved) {
      cancelAnimationFrame(tabs._dragFrame);
      tabs._dragFrame = requestAnimationFrame(() => {
        tabs.scrollLeft = startScrollLeft - deltaX;
      });
    }
  });
  
  // 鼠标松开：结束拖拽
  document.addEventListener('mouseup', (e) => {
    if (!isDragging) return;
    
    isDragging = false;
    wrap.style.cursor = 'grab';
    tabs.style.cursor = 'grab';
    
    // 如果没有移动，认为是点击（触发按钮点击）
    if (!hasMoved && e.target.closest('#btnAddGroup')) {
      e.target.closest('#btnAddGroup').click();
    }
  });
  
  // 鼠标离开窗口：取消拖拽
  document.addEventListener('mouseleave', () => {
    if (isDragging) {
      isDragging = false;
      wrap.style.cursor = 'grab';
      tabs.style.cursor = 'grab';
    }
  });
}

// 在 DOMContentLoaded 时初始化拖拽功能
document.addEventListener('DOMContentLoaded', () => {
  setTimeout(initGroupTabsDrag, 100);
});
