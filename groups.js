// groups.js - 分组管理页（重写：拖拽排序 + 拖入扩展）

let groups = [];
let extensions = [];
let editingGroupId = null;
let currentSort = 'default';
let storageCache = {};

document.addEventListener('DOMContentLoaded', init);

async function init() {
  const store = await getStorage();
  applyTheme(store.theme || 'light');

  // 旧 key 迁移（与 popup.js 保持一致）
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
  if (changed) await setStorage({ sortModes: store.sortModes, manualOrders: store.manualOrders, groups: store.groups, rules: store.rules, autoRuleEnabled: store.autoRuleEnabled, browserConfig: store.browserConfig });

  groups = store.groups || [];
  extensions = await getExtensions();
  storageCache = store;
  storageCache.sortModes = storageCache.sortModes || {};
  storageCache.manualOrders = storageCache.manualOrders || {};
  currentSort = storageCache.sortModes['ungrouped'] || 'default';
  const sel = document.getElementById('groupSortSelect');
  if (sel) sel.value = currentSort;
  const hint = document.getElementById('groupSortHint');
  if (hint) hint.style.display = currentSort === 'manual' ? 'block' : 'none';
  renderAll();
  bindEvents();
}

function getUngrouped() {
  const grouped = new Set(groups.flatMap(g => g.members));
  return extensions.filter(e => !grouped.has(e.id));
}

function renderAll() {
  renderGroups();
  renderUngrouped();
}

// ── 渲染分组列表 ──
function renderGroups() {
  const listEl = document.getElementById('groupList');

  if (groups.length === 0) {
    listEl.innerHTML = '<div class="empty-state">📭 暂无分组，点击上方按钮创建</div>';
    return;
  }

  listEl.innerHTML = '';
  for (const grp of groups) {
    const card = document.createElement('div');
    card.className = 'group-card';
    card.dataset.id = grp.id;

    let members = extensions.filter(e => grp.members.includes(e.id));
    // 按该分组的排序配置排序（与 popup.html 同一套 sortModes/manualOrders）
    const grpSortMode = (storageCache.sortModes || {})[grp.id] || 'default';
    const grpManualOrder = ((storageCache.manualOrders || {})[grp.id] || []);
    members = sortExtensions(members, grpSortMode, grpManualOrder);

    card.innerHTML = `
      <div class="group-card-header" data-grp="${grp.id}">
        <span class="drag-handle" data-action="drag-handle" title="拖动排序">⠿</span>
        <span class="group-name" data-action="toggle-members">${escapeHtml(grp.name)}</span>
        <span class="group-count">${members.length} 个</span>
        <div class="group-card-actions">
          <button class="btn btn-sm btn-secondary" data-action="enable-all" data-grp="${grp.id}">▶</button>
          <button class="btn btn-sm btn-secondary" data-action="disable-all" data-grp="${grp.id}">⏸</button>
          <button class="icon-btn" data-action="edit" data-id="${grp.id}" title="编辑">✏️</button>
          <button class="icon-btn" data-action="delete" data-id="${grp.id}" title="删除">🗑</button>
        </div>
      </div>
      <div class="group-members" id="members-${grp.id}">
        ${members.length === 0
          ? '<div style="font-size:11px;color:var(--text2);padding:2px 0">从右侧拖入扩展，或右键扩展指派</div>'
          : members.map(e => `
            <div class="member-item">
              <img class="member-icon" src="${e.icons?.at(-1)?.url || placeholderIcon(20)}" onerror="this.src='${placeholderIcon(20)}'">
              <span class="member-name">${escapeHtml(e.name)}</span>
              <div class="member-actions">
                <button class="btn btn-sm ${e.enabled ? 'btn-secondary' : 'btn-primary'}" data-action="toggle-member" data-id="${e.id}">${e.enabled ? '⏸' : '▶'}</button>
                <button class="icon-btn" data-action="remove-member" data-grp="${grp.id}" data-id="${e.id}" title="移出分组" style="font-size:12px">✕</button>
              </div>
            </div>
          `).join('')
        }
      </div>
    `;

    listEl.appendChild(card);
  }

  // 保存展开状态
  document.querySelectorAll('.group-members.open').forEach(el => {
    const id = el.id.replace('members-', '');
    const newEl = document.getElementById(el.id);
    if (newEl) newEl.classList.add('open');
  });
}

// ── 渲染未分组扩展 ──
function renderUngrouped() {
  const listEl = document.getElementById('ungroupedList');
  let ungrouped = getUngrouped();

  // 按当前排序模式排序
  const manualOrder = ((storageCache.manualOrders || {})['ungrouped'] || []);
  ungrouped = sortExtensions(ungrouped, currentSort, manualOrder);

  document.getElementById('ungroupedCount').textContent = ungrouped.length;

  if (ungrouped.length === 0) {
    listEl.innerHTML = '<div class="empty-state">✅ 所有扩展都已分组</div>';
    return;
  }

  listEl.innerHTML = '';
  for (const ext of ungrouped) {
    const item = document.createElement('div');
    item.className = 'ext-item';
    item.draggable = (currentSort === 'manual');
    item.dataset.extId = ext.id;
    item.dataset.action = 'ext-drag';
    item.innerHTML = `
      <img class="ext-item-icon" src="${ext.icons?.at(-1)?.url || placeholderIcon(20)}" onerror="this.src='${placeholderIcon(20)}'">
      <span class="ext-item-name">${escapeHtml(ext.name)}</span>
    `;
    listEl.appendChild(item);
  }
}

// ── 事件绑定 ──
function bindEvents() {
  // 弹窗
  document.getElementById('btnAddGroup').onclick = () => openGroupModal();
  document.getElementById('btnCancelGroup').onclick = () => closeGroupModal();
  document.getElementById('btnConfirmGroup').onclick = () => confirmGroup();
  document.getElementById('btnDeleteGroup').onclick = () => deleteGroup();

  // 点击事件代理
  document.getElementById('groupList').onclick = async (e) => {
    const act = e.target.dataset.action;
    const gid = e.target.dataset.id || e.target.dataset.grp;

    // 展开/折叠
    if (act === 'toggle-members') {
      const card = e.target.closest('.group-card');
      if (card) {
        const members = document.getElementById(`members-${card.dataset.id}`);
        if (members) members.classList.toggle('open');
      }
      return;
    }

    if (act === 'edit') { openGroupModal(gid); return; }
    if (act === 'delete') {
      if (confirm('确定删除此分组？成员不会被卸载。')) {
        groups = groups.filter(g => g.id !== gid);
        await setStorage({ groups });
        renderAll();
      }
      return;
    }
    if (act === 'enable-all' || act === 'disable-all') {
      const grp = groups.find(g => g.id === gid);
      if (!grp) return;
      const enabled = act === 'enable-all';
      for (const eid of grp.members) {
        await new Promise(r => chrome.runtime.sendMessage({ type: 'SET_ENABLED', id: eid, enabled }, r));
      }
      extensions = await getExtensions();
      renderAll();
      return;
    }
    if (act === 'toggle-member') {
      const ext = extensions.find(x => x.id === gid);
      await new Promise(r => chrome.runtime.sendMessage({ type: 'SET_ENABLED', id: gid, enabled: !ext.enabled }, r));
      extensions = await getExtensions();
      renderAll();
      return;
    }
    if (act === 'remove-member') {
      const grp = groups.find(g => g.id === e.target.dataset.grp);
      if (grp) {
        grp.members = grp.members.filter(m => m !== e.target.dataset.id);
        await setStorage({ groups });
        renderAll();
      }
      return;
    }
  };

  // ── 分组卡片拖拽排序 ──
  setupGroupSortDrag();

  // ── 扩展拖入分组 ──
  setupExtDropToGroup();

  // ── 未分组列表排序 ──
  setupGroupSort();
  setupUngroupedDragDrop();
}

// ── 分组拖拽排序（Pointer Events） ──
let sortDragging = false;
let sortDragCard = null;

function setupGroupSortDrag() {
  const list = document.getElementById('groupList');

  list.addEventListener('pointerdown', (e) => {
    const handle = e.target.closest('.drag-handle');
    if (!handle) return;
    const card = handle.closest('.group-card');
    if (!card || groups.length < 2) return;

    e.preventDefault();
    sortDragging = true;
    sortDragCard = card;
    card.classList.add('dragging');
    card.setPointerCapture(e.pointerId);
  });

  list.addEventListener('pointermove', (e) => {
    if (!sortDragging || !sortDragCard) return;
    e.preventDefault();

    // 在其他卡片间显示蓝色指示线
    const cards = [...list.querySelectorAll('.group-card:not(.dragging)')];
    // 清除旧指示
    list.querySelectorAll('.sort-indicator').forEach(el => el.remove());

    for (const card of cards) {
      const rect = card.getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      if (e.clientY < midY) {
        const indicator = document.createElement('div');
        indicator.className = 'sort-indicator';
        list.insertBefore(indicator, card);
        break;
      }
      // 如果在最后一个卡片下方
      if (card === cards[cards.length - 1]) {
        const indicator = document.createElement('div');
        indicator.className = 'sort-indicator';
        list.appendChild(indicator);
      }
    }
  });

  list.addEventListener('pointerup', async (e) => {
    if (!sortDragging || !sortDragCard) return;
    e.preventDefault();

    sortDragging = false;
    sortDragCard.classList.remove('dragging');

    // 计算目标位置
    const fromId = sortDragCard.dataset.id;
    const cards = [...list.querySelectorAll('.group-card:not(.dragging)')];
    let targetIdx = groups.length - 1; // 默认放到最后

    for (let i = 0; i < cards.length; i++) {
      const rect = cards[i].getBoundingClientRect();
      if (e.clientY < rect.top + rect.height / 2) {
        // 找到 cards[i] 对应的 groups 索引，但需要考虑移除源后偏移
        const targetId = cards[i].dataset.id;
        targetIdx = groups.findIndex(g => g.id === targetId);
        break;
      }
    }

    // 清除指示线
    list.querySelectorAll('.sort-indicator').forEach(el => el.remove());

    // 执行排序
    const fromIdx = groups.findIndex(g => g.id === fromId);
    if (fromIdx !== -1 && fromIdx !== targetIdx) {
      const [moved] = groups.splice(fromIdx, 1);
      // 移除后目标索引可能偏移
      const adjustedIdx = targetIdx > fromIdx ? targetIdx - 1 : targetIdx;
      groups.splice(adjustedIdx, 0, moved);
      await setStorage({ groups });
    }

    sortDragCard = null;
    renderAll();
  });

  // 取消拖拽（ESC等）
  list.addEventListener('pointercancel', () => {
    if (sortDragCard) sortDragCard.classList.remove('dragging');
    list.querySelectorAll('.sort-indicator').forEach(el => el.remove());
    sortDragging = false;
    sortDragCard = null;
  });
}

// ── 扩展拖入分组 ──
let dragExtId = null;

function setupExtDropToGroup() {
  const ungroupedList = document.getElementById('ungroupedList');
  const groupList = document.getElementById('groupList');

  // 扩展开始拖动
  ungroupedList.addEventListener('dragstart', (e) => {
    const item = e.target.closest('.ext-item');
    if (!item) return;
    dragExtId = item.dataset.extId;
    item.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/ext-assign', item.dataset.extId);
  });

  ungroupedList.addEventListener('dragend', () => {
    if (dragExtId) {
      document.querySelectorAll('.ext-item.dragging').forEach(el => el.classList.remove('dragging'));
    }
    dragExtId = null;
    document.querySelectorAll('.group-members.drag-hover').forEach(el => el.classList.remove('drag-hover'));
    document.querySelectorAll('.group-card.drag-over').forEach(c => c.classList.remove('drag-over'));
  });

  // 拖到分组区域
  groupList.addEventListener('dragover', (e) => {
    if (!dragExtId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';

    // 高亮整个分组卡片
    const card = e.target.closest('.group-card');
    if (card) {
      document.querySelectorAll('.group-card.drag-over').forEach(c => c.classList.remove('drag-over'));
      card.classList.add('drag-over');
    }
    // 高亮成员区域
    const members = e.target.closest('.group-members');
    if (members) {
      document.querySelectorAll('.group-members.drag-hover').forEach(el => el.classList.remove('drag-hover'));
      members.classList.add('drag-hover');
    }
  });

  groupList.addEventListener('dragleave', (e) => {
    const card = e.target.closest('.group-card');
    const members = e.target.closest('.group-members');
    if (card && !card.contains(e.relatedTarget)) card.classList.remove('drag-over');
    if (members && !members.contains(e.relatedTarget)) members.classList.remove('drag-hover');
  });

  groupList.addEventListener('drop', async (e) => {
    if (!dragExtId) return;
    e.preventDefault();

    const card = e.target.closest('.group-card');
    if (!card) return;

    card.classList.remove('drag-over');
    document.querySelectorAll('.group-members.drag-hover').forEach(el => el.classList.remove('drag-hover'));

    const grpId = card.dataset.id;
    const grp = groups.find(g => g.id === grpId);
    if (!grp || grp.members.includes(dragExtId)) return;

    grp.members.push(dragExtId);
    await setStorage({ groups });

    // 展开该分组的成员列表
    const members = document.getElementById(`members-${grpId}`);
    if (members) members.classList.add('open');

    renderAll();

    // 重新展开
    const newMembers = document.getElementById(`members-${grpId}`);
    if (newMembers) newMembers.classList.add('open');
  });
}

// ── 弹窗 ──
function openGroupModal(editId = null) {
  editingGroupId = editId;
  const modal = document.getElementById('modalGroup');
  const title = document.getElementById('modalGroupTitle');
  const deleteBtn = document.getElementById('btnDeleteGroup');
  const nameInput = document.getElementById('inputGroupName');

  if (editId) {
    const grp = groups.find(g => g.id === editId);
    title.textContent = '编辑分组';
    nameInput.value = grp.name;
    deleteBtn.style.display = 'inline-block';
  } else {
    title.textContent = '新建分组';
    nameInput.value = '';
    deleteBtn.style.display = 'none';
  }

  modal.style.display = 'flex';
  nameInput.focus();
}

function closeGroupModal() {
  document.getElementById('modalGroup').style.display = 'none';
  editingGroupId = null;
}

async function confirmGroup() {
  const name = document.getElementById('inputGroupName').value.trim();
  if (!name) return;

  if (editingGroupId) {
    const grp = groups.find(g => g.id === editingGroupId);
    if (grp) { grp.name = name; }
  } else {
    groups.push({ id: uid(), name, members: [] });
  }

  await setStorage({ groups });
  closeGroupModal();
  renderAll();
}

async function deleteGroup() {
  if (!editingGroupId) return;
  groups = groups.filter(g => g.id !== editingGroupId);
  await setStorage({ groups });
  closeGroupModal();
  renderAll();
}

function escapeHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}


// ── 未分组列表排序下拉 ──
function setupGroupSort() {
  const sel = document.getElementById('groupSortSelect');
  if (!sel) return;
  sel.onchange = async (e) => {
    currentSort = e.target.value;
    storageCache.sortModes = storageCache.sortModes || {};
    storageCache.sortModes['ungrouped'] = currentSort;

    // 切换到手动排序时，用当前顺序初始化 manualOrder
    if (currentSort === 'manual') {
      storageCache.manualOrders = storageCache.manualOrders || {};
      if (!Array.isArray(storageCache.manualOrders['ungrouped']) || storageCache.manualOrders['ungrouped'].length === 0) {
        storageCache.manualOrders['ungrouped'] = getUngrouped().map(x => x.id);
      }
    }

    await setStorage({ sortModes: storageCache.sortModes, manualOrders: storageCache.manualOrders });
    const hint = document.getElementById('groupSortHint');
    if (hint) hint.style.display = currentSort === 'manual' ? 'block' : 'none';
    renderAll();   // 同步刷新分组内成员排序 + 未分组列表
  };
}

// ── 未分组列表手动拖拽排序 ──
let dragSrcEl = null;

function setupUngroupedDragDrop() {
  const list = document.getElementById('ungroupedList');
  if (!list) return;

  list.addEventListener('dragstart', (e) => {
    const item = e.target.closest('.ext-item');
    if (!item || currentSort !== 'manual') { e.preventDefault(); return; }
    dragSrcEl = item;
    item.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
  });

  list.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const item = e.target.closest('.ext-item');
    if (item && item !== dragSrcEl) {
      document.querySelectorAll('.ext-item').forEach(c => c.classList.remove('drag-over'));
      item.classList.add('drag-over');
    }
  });

  list.addEventListener('dragleave', (e) => {
    if (!e.relatedTarget || !e.currentTarget.contains(e.relatedTarget)) {
      document.querySelectorAll('.ext-item').forEach(c => c.classList.remove('drag-over'));
    }
  });

  list.addEventListener('drop', async (e) => {
    e.preventDefault();
    const target = e.target.closest('.ext-item');
    if (!target || !dragSrcEl || target === dragSrcEl || currentSort !== 'manual') return;

    const srcId = dragSrcEl.dataset.extId;
    const dstId = target.dataset.extId;

    let manualOrder = [...((storageCache.manualOrders || {})['ungrouped'] || [])];
    const allIds = getUngrouped().map(x => x.id);
    for (const id of allIds) {
      if (!manualOrder.includes(id)) manualOrder.push(id);
    }

    const srcIdx = manualOrder.indexOf(srcId);
    const dstIdx = manualOrder.indexOf(dstId);
    if (srcIdx === -1 || dstIdx === -1) return;

    manualOrder.splice(srcIdx, 1);
    manualOrder.splice(dstIdx, 0, srcId);

    storageCache.manualOrders = storageCache.manualOrders || {};
    storageCache.manualOrders['ungrouped'] = manualOrder;
    storageCache.sortModes = storageCache.sortModes || {};
    storageCache.sortModes['ungrouped'] = 'manual';
    currentSort = 'manual';
    await setStorage({ manualOrders: storageCache.manualOrders, sortModes: storageCache.sortModes });

    document.querySelectorAll('.ext-item').forEach(c => c.classList.remove('dragging', 'drag-over'));
    dragSrcEl = null;
    renderUngrouped();
  });

  list.addEventListener('dragend', () => {
    document.querySelectorAll('.ext-item').forEach(c => c.classList.remove('dragging', 'drag-over'));
    dragSrcEl = null;
  });
}
