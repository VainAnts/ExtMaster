// groups.js - 分组管理页（重写：拖拽排序 + 拖入扩展）

let groups = [];
let extensions = [];
let editingGroupId = null;
let currentSort = 'default';
let storageCache = {};

// HTML 转义函数，防止 XSS
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// 生成唯一 ID
function generateId() {
  return 'grp' + Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
}

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
        <span class="drag-handle" draggable="true" data-action="drag-handle" title="拖动分组排序">⠿</span>
        <span class="group-name" data-action="toggle-members">${escapeHtml(grp.name)}</span>
        <span class="group-count">${members.length} 个</span>
        <div class="group-card-actions">
          <button class="btn btn-sm btn-secondary" data-action="enable-all" data-grp="${grp.id}">▶</button>
          <button class="btn btn-sm btn-secondary" data-action="disable-all" data-grp="${grp.id}">⏸</button>
          <button class="icon-btn" data-action="edit" data-id="${grp.id}" title="编辑">✏️</button>
          <button class="icon-btn" data-action="delete" data-id="${grp.id}" title="删除">🗑</button>
        </div>
      </div>
      <div class="group-members" id="members-${grp.id}" data-sort-mode="${grpSortMode}">
        ${members.length === 0
          ? `<div style="font-size:11px;color:var(--text2);padding:2px 0">${grpSortMode === 'manual' ? '☝ 拖入扩展后可拖动排序，也可拖到其他分组' : '从右侧或其他分组拖入扩展'}</div>`
          : members.map(e => `
            <div class="member-item" draggable="true" data-ext-id="${e.id}" data-grp-id="${grp.id}">
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
    item.draggable = true;
    item.dataset.extId = ext.id;
    item.dataset.action = 'ext-drag';
    item.innerHTML = `
      <img class="ext-item-icon" src="${ext.icons?.at(-1)?.url || placeholderIcon(20)}" onerror="this.src='${placeholderIcon(20)}'">
      <span class="ext-item-name">${escapeHtml(ext.name)}</span>
    `;
    listEl.appendChild(item);
  }
}

// ── 分组模态框管理 ──
function openGroupModal(groupId = null) {
  const modal = document.getElementById('modalGroup');
  const title = document.getElementById('modalGroupTitle');
  const nameInput = document.getElementById('inputGroupName');
  const deleteBtn = document.getElementById('btnDeleteGroup');

  editingGroupId = groupId;

  if (groupId) {
    // 编辑模式
    const group = groups.find(g => g.id === groupId);
    if (!group) return;
    title.textContent = '编辑分组';
    nameInput.value = group.name;
    deleteBtn.style.display = 'inline-block';
  } else {
    // 新建模式
    title.textContent = '新建分组';
    nameInput.value = '';
    deleteBtn.style.display = 'none';
  }

  modal.style.display = 'flex';
  nameInput.focus();
}

function closeGroupModal() {
  const modal = document.getElementById('modalGroup');
  modal.style.display = 'none';
  editingGroupId = null;
}

async function confirmGroup() {
  const nameInput = document.getElementById('inputGroupName');
  const name = nameInput.value.trim();

  if (!name) {
    alert('请输入分组名称');
    return;
  }

  if (editingGroupId) {
    // 编辑现有分组
    const group = groups.find(g => g.id === editingGroupId);
    if (group) {
      group.name = name;
    }
  } else {
    // 创建新分组
    const newGroup = {
      id: generateId(),
      name: name,
      members: []
    };
    groups.push(newGroup);
  }

  await setStorage({ groups });
  closeGroupModal();
  renderAll();
}

async function deleteGroup() {
  if (!editingGroupId) return;

  const group = groups.find(g => g.id === editingGroupId);
  if (!group) return;

  if (!confirm(`确定删除分组「${group.name}」？\n成员不会被卸载，将移回未分组列表。`)) {
    return;
  }

  groups = groups.filter(g => g.id !== editingGroupId);
  await setStorage({ groups });
  closeGroupModal();
  renderAll();
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
        // 保存当前展开状态
        const openIds = [];
        document.querySelectorAll('.group-members.open').forEach(m => {
          const id = m.id.replace('members-', '');
          openIds.push(id);
        });
        
        grp.members = grp.members.filter(m => m !== e.target.dataset.id);
        await setStorage({ groups });
        renderAll();
        
        // 恢复展开状态
        setTimeout(() => {
          openIds.forEach(id => {
            const members = document.getElementById(`members-${id}`);
            if (members) members.classList.add('open');
          });
        }, 0);
      }
      return;
    }
  };

  // ── 分组卡片拖拽排序（HTML5 DnD） ──
  setupGroupSortDrag();

  // ── 未分组扩展拖拽（支持拖入扩展 + 手动排序） ──
  setupUngroupedDragAndDrop();

  // ── 分组内成员拖拽排序 ──
  setupMemberDragDrop();

  // ── 未分组列表排序下拉 ──
  // setupGroupSort(); // 已移除，不需要单独调用
}

// ── 分组拖拽排序（HTML5 Drag & Drop） ──
function setupGroupSortDrag() {
  const list = document.getElementById('groupList');
  if (!list) return;

  let dragCard = null;

  list.addEventListener('dragstart', (e) => {
    console.log('[GroupSort] dragstart triggered, target:', e.target.className, 'tag:', e.target.tagName);
    // 只有拖拽手柄（.drag-handle）触发分组排序
    if (!e.target.classList.contains('drag-handle')) {
      console.log('[GroupSort] Not a drag handle, ignoring');
      return;
    }
    const card = e.target.closest('.group-card');
    if (!card) { 
      console.log('[GroupSort] No card found');
      e.preventDefault(); 
      return; 
    }
    if (groups.length < 2) { 
      console.log('[GroupSort] Less than 2 groups, preventing drag');
      e.preventDefault(); 
      return; 
    }

    console.log('[GroupSort] Preparing to drag card:', card.dataset.id);
    dragCard = card;
    card.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/group-sort', card.dataset.id);
    console.log('[GroupSort] Started dragging group:', card.dataset.id);
  }, true); // 使用捕获阶段，确保优先处理

  list.addEventListener('dragover', (e) => {
    if (!dragCard) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';

    // 显示蓝色指示线
    const cards = [...list.querySelectorAll('.group-card:not(.dragging)')];
    list.querySelectorAll('.sort-indicator').forEach(el => el.remove());

    for (const c of cards) {
      const rect = c.getBoundingClientRect();
      if (e.clientY < rect.top + rect.height / 2) {
        const indicator = document.createElement('div');
        indicator.className = 'sort-indicator';
        list.insertBefore(indicator, c);
        return;
      }
    }
    // 放到最后
    const indicator = document.createElement('div');
    indicator.className = 'sort-indicator';
    list.appendChild(indicator);
  });

  list.addEventListener('dragleave', (e) => {
    if (!dragCard) return;
    if (!list.contains(e.relatedTarget)) {
      list.querySelectorAll('.sort-indicator').forEach(el => el.remove());
    }
  });

  list.addEventListener('drop', async (e) => {
    console.log('[GroupSort] drop event triggered');
    if (!dragCard) {
      console.log('[GroupSort] No dragCard, aborting');
      return;
    }
    const fromId = e.dataTransfer.getData('text/group-sort');
    console.log('[GroupSort] fromId:', fromId);
    if (!fromId) {
      console.log('[GroupSort] No fromId in dataTransfer');
      return;
    }
    e.preventDefault();

    list.querySelectorAll('.sort-indicator').forEach(el => el.remove());
    document.querySelectorAll('.group-card.dragging').forEach(c => c.classList.remove('dragging'));

    const cards = [...list.querySelectorAll('.group-card:not(.dragging)')];
    console.log('[GroupSort] Found', cards.length, 'cards');
    let targetIdx = groups.length - 1;

    for (let i = 0; i < cards.length; i++) {
      const rect = cards[i].getBoundingClientRect();
      if (e.clientY < rect.top + rect.height / 2) {
        targetIdx = groups.findIndex(g => g.id === cards[i].dataset.id);
        console.log('[GroupSort] Target index:', targetIdx, 'at card', cards[i].dataset.id);
        break;
      }
    }

    const fromIdx = groups.findIndex(g => g.id === fromId);
    console.log('[GroupSort] fromIdx:', fromIdx, 'targetIdx:', targetIdx);
    
    if (fromIdx !== -1 && fromIdx !== targetIdx) {
      console.log('[GroupSort] Moving group from', fromIdx, 'to', targetIdx);
      const [moved] = groups.splice(fromIdx, 1);
      
      // 重新计算目标索引（因为 splice 后数组长度变了）
      let finalIdx;
      if (targetIdx >= groups.length) {
        // 拖到最后，直接 push
        finalIdx = groups.length;
        console.log('[GroupSort] Append to end');
      } else {
        // 调整索引：如果目标在原位置之后，需要减 1
        finalIdx = targetIdx > fromIdx ? targetIdx - 1 : targetIdx;
        console.log('[GroupSort] Adjusted index:', finalIdx);
      }
      
      groups.splice(finalIdx, 0, moved);
      
      console.log('[GroupSort] New group order:', groups.map(g => g.name));
      await setStorage({ groups });
      console.log('[GroupSort] Storage updated');
    } else {
      console.log('[GroupSort] No move needed (fromIdx === targetIdx or invalid)');
    }

    dragCard = null;
    // 保持所有分组展开状态
    const openIds = [...document.querySelectorAll('.group-members.open')].map(el => el.id.replace('members-', ''));
    renderAll();
    requestAnimationFrame(() => {
      openIds.forEach(id => {
        const el = document.getElementById(`members-${id}`);
        if (el) el.classList.add('open');
      });
    });
  });

  list.addEventListener('dragend', () => {
    console.log('[GroupSort] dragend');
    list.querySelectorAll('.sort-indicator').forEach(el => el.remove());
    document.querySelectorAll('.group-card.dragging').forEach(c => c.classList.remove('dragging'));
    dragCard = null;
    // 保持所有分组展开状态
    const openIds = [...document.querySelectorAll('.group-members.open')].map(el => el.id.replace('members-', ''));
    requestAnimationFrame(() => {
      openIds.forEach(id => {
        const el = document.getElementById(`members-${id}`);
        if (el) el.classList.add('open');
      });
    });
  });
}

// ── 分组内成员拖拽排序（支持跨分组移动） ──
let memberDragSrc = null;

function setupMemberDragDrop() {
  const groupList = document.getElementById('groupList');
  if (!groupList) return;

  // dragstart: 只要成员项有 draggable 就允许拖（不限制手动模式，方便跨组移动）
  groupList.addEventListener('dragstart', (e) => {
    const item = e.target.closest('.member-item');
    if (!item) return;

    console.log('[MemberDrag] dragstart:', item.dataset.extId, 'from group:', item.dataset.grpId);
    memberDragSrc = item;
    item.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/member-reorder', item.dataset.extId);
    e.dataTransfer.setData('text/plain', item.dataset.extId); // 兼容外部拖入
  });

  // 注意：setupUngroupedDragAndDrop 的 groupList dragover 在 memberDragSrc 为真时
  // 只调 preventDefault(允许 drop 触发) 但不设视觉高亮，由本系统统一管理

  groupList.addEventListener('dragover', (e) => {
    if (!memberDragSrc) return;

    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';

    // 清除所有高亮
    document.querySelectorAll('.member-item.drag-over-above').forEach(c => c.classList.remove('drag-over-above'));
    document.querySelectorAll('.member-item.drag-over-below').forEach(c => c.classList.remove('drag-over-below'));
    document.querySelectorAll('.group-members.drag-hover').forEach(c => c.classList.remove('drag-hover'));
    document.querySelectorAll('.group-card.drag-hover').forEach(c => c.classList.remove('drag-hover'));

    // 查找目标元素
    const targetItem = e.target.closest('.member-item');
    const targetMembersArea = e.target.closest('.group-members');
    const targetCard = e.target.closest('.group-card');

    console.log('[MemberDrag dragover] target:', e.target.className, 'targetItem:', !!targetItem, 'targetMembersArea:', !!targetMembersArea);

    if (targetItem && targetItem !== memberDragSrc) {
      // 拖到成员项上 - 根据鼠标位置决定显示在上方还是下方
      const rect = targetItem.getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      
      if (e.clientY < midY) {
        // 在上半部分 - 显示在上方
        console.log('[MemberDrag dragover] Over member item (above):', targetItem.dataset.extId);
        targetItem.classList.add('drag-over-above');
        console.log('[MemberDrag dragover] Added drag-over-above class');
      } else {
        // 在下半部分 - 显示在下方
        console.log('[MemberDrag dragover] Over member item (below):', targetItem.dataset.extId);
        targetItem.classList.add('drag-over-below');
        console.log('[MemberDrag dragover] Added drag-over-below class');
      }
    } else if (targetMembersArea) {
      // 拖到分组成员区域的空白处 - 只在没有成员项时才高亮背景
      // 检查是否有成员项，如果有则找到最后一个成员项并显示在其下方
      const members = targetMembersArea.querySelectorAll('.member-item:not(.dragging)');
      if (members.length > 0) {
        // 有成员项时，在最后一个成员项下方显示指示器
        const lastMember = members[members.length - 1];
        console.log('[MemberDrag dragover] Over members area, showing below last member:', lastMember.dataset.extId);
        lastMember.classList.add('drag-over-below');
        console.log('[MemberDrag dragover] Added drag-over-below to last member');
      } else {
        // 没有成员项时，高亮整个区域
        console.log('[MemberDrag dragover] Over empty members area:', targetMembersArea.id);
        targetMembersArea.classList.add('drag-hover');
      }
    } else if (targetCard) {
      // 拖到分组卡片上（包括折叠状态）- 高亮整个卡片
      console.log('[MemberDrag dragover] Over group card:', targetCard.dataset.id);
      targetCard.classList.add('drag-hover');
    }
  });

  groupList.addEventListener('dragleave', (e) => {
    // 不在这里清除类名，因为 dragleave 会在鼠标移动到子元素时频繁触发
    // 所有清理工作都在 dragover 开始时处理
  });

  groupList.addEventListener('drop', async (e) => {
    console.log('[MemberDrag] drop event triggered');
    e.preventDefault();

    if (!memberDragSrc) {
      console.log('[MemberDrag] No memberDragSrc, cleanup');
      cleanupDrag();
      return;
    }

    const srcExtId = memberDragSrc.dataset.extId;
    const srcGrpId = memberDragSrc.dataset.grpId;
    console.log('[MemberDrag] Source - extId:', srcExtId, 'grpId:', srcGrpId);
    
    const srcGrp = groups.find(g => g.id === srcGrpId);
    if (!srcGrp) {
      console.log('[MemberDrag] Source group not found');
      cleanupDrag();
      return;
    }

    // 获取源分组的排序模式
    const srcSortMode = (storageCache.sortModes || {})[srcGrpId] || 'default';
    console.log('[MemberDrag] Source sort mode:', srcSortMode);

    // 查找目标位置（支持折叠的分组）
    const targetItem = e.target.closest('.member-item');
    const targetMembersArea = e.target.closest('.group-members');
    const targetCard = e.target.closest('.group-card');

    let targetGrpId, targetExtId, insertBefore;

    // 重新根据鼠标位置计算 insertBefore（与 dragover 视觉指示保持一致）
    function calcInsertBefore(item) {
      const rect = item.getBoundingClientRect();
      return e.clientY < rect.top + rect.height / 2;
    }

    if (targetItem && targetItem !== memberDragSrc) {
      // 拖到某个成员项上
      targetGrpId = targetItem.dataset.grpId;
      targetExtId = targetItem.dataset.extId;
      insertBefore = calcInsertBefore(targetItem);
      console.log('[MemberDrag] Target - member item:', targetExtId, 'in group:', targetGrpId, 'insertBefore:', insertBefore);
    } else if (targetMembersArea) {
      // 拖到分组成员区域空白处：若鼠标在区域内但不在任何成员项上，放到最后
      // 若鼠标恰好落在最后一个成员项上，则以该成员为参考重新计算
      const members = [...targetMembersArea.querySelectorAll('.member-item:not(.dragging)')];
      if (members.length > 0) {
        const lastMember = members[members.length - 1];
        // 如果鼠标不在任何成员项上（e.target 是 group-members 本身），放最后
        if (!e.target.closest('.member-item')) {
          targetGrpId = targetMembersArea.id.replace('members-', '');
          targetExtId = null;
          insertBefore = false;
          console.log('[MemberDrag] Target - empty area of group:', targetGrpId, '(append to end)');
        } else {
          // 鼠标在最后一个成员上，以此为参考
          targetGrpId = targetMembersArea.id.replace('members-', '');
          targetExtId = lastMember.dataset.extId;
          insertBefore = calcInsertBefore(lastMember);
          console.log('[MemberDrag] Target - last member of group:', targetExtId, 'insertBefore:', insertBefore);
        }
      } else {
        targetGrpId = targetMembersArea.id.replace('members-', '');
        targetExtId = null;
        insertBefore = false;
        console.log('[MemberDrag] Target - empty group area:', targetGrpId, '(append to end)');
      }
    } else if (targetCard) {
      // 拖到分组卡片上（包括折叠状态）- 放到该分组最后
      targetGrpId = targetCard.dataset.id;
      targetExtId = null;
      insertBefore = false;
      console.log('[MemberDrag] Target - group card (possibly collapsed):', targetGrpId, '(append to end)');
    } else {
      // 无效目标，取消操作
      console.log('[MemberDrag] Invalid target');
      cleanupDrag();
      return;
    }

    const targetGrp = groups.find(g => g.id === targetGrpId);
    if (!targetGrp) {
      console.log('[MemberDrag] Target group not found');
      cleanupDrag();
      return;
    }

    // 如果已经在目标分组中且是同一个元素，不做任何操作
    if (srcGrpId === targetGrpId && targetExtId === srcExtId) {
      console.log('[MemberDrag] Same element, no action');
      cleanupDrag();
      return;
    }

    console.log('[MemberDrag] Before move - src members:', [...srcGrp.members]);
    console.log('[MemberDrag] Before move - tgt members:', [...targetGrp.members]);

    // 从源分组移除
    const srcIndex = srcGrp.members.indexOf(srcExtId);
    console.log('[MemberDrag] Source index:', srcIndex);
    if (srcIndex !== -1) {
      srcGrp.members.splice(srcIndex, 1);
    }

    // 添加到目标分组
    if (targetExtId) {
      const targetIndex = targetGrp.members.indexOf(targetExtId);
      const insertIndex = insertBefore ? targetIndex : targetIndex + 1;
      console.log('[MemberDrag] Insert at index:', insertIndex);
      targetGrp.members.splice(insertIndex, 0, srcExtId);
    } else {
      // 放到最后
      console.log('[MemberDrag] Append to end');
      targetGrp.members.push(srcExtId);
    }

    console.log('[MemberDrag] After move - src members:', [...srcGrp.members]);
    console.log('[MemberDrag] After move - tgt members:', [...targetGrp.members]);

    // 更新排序模式为手动（必须在更新 manualOrders 之前）
    storageCache.sortModes = storageCache.sortModes || {};
    storageCache.manualOrders = storageCache.manualOrders || {};

    // 为目标分组初始化/更新 manualOrder
    storageCache.manualOrders[targetGrpId] = targetGrp.members.slice();
    storageCache.sortModes[targetGrpId] = 'manual';
    console.log('[MemberDrag] Set target group manualOrder:', storageCache.manualOrders[targetGrpId]);
    console.log('[MemberDrag] Set target group to manual mode');

    // 如果源分组还有成员且不是同一分组，也为其初始化 manualOrder
    if (srcGrp.members.length > 0 && srcGrpId !== targetGrpId) {
      storageCache.manualOrders[srcGrpId] = srcGrp.members.slice();
      storageCache.sortModes[srcGrpId] = 'manual';
      console.log('[MemberDrag] Set source group manualOrder:', storageCache.manualOrders[srcGrpId]);
      console.log('[MemberDrag] Set source group to manual mode');
    }

    // 一次性保存所有数据
    await setStorage({
      groups: groups,
      sortModes: storageCache.sortModes,
      manualOrders: storageCache.manualOrders
    });
    console.log('[MemberDrag] All storage updated together');

    // 清理并重新渲染
    cleanupDrag();
    console.log('[MemberDrag] Calling renderAll');
    renderAll();

    // 保持相关分组展开
    setTimeout(() => {
      const srcMembers = document.getElementById(`members-${srcGrpId}`);
      const tgtMembers = document.getElementById(`members-${targetGrpId}`);
      if (srcMembers) srcMembers.classList.add('open');
      if (tgtMembers) tgtMembers.classList.add('open');
      console.log('[MemberDrag] Expanded groups:', srcGrpId, targetGrpId);
    }, 0);
  });

  groupList.addEventListener('dragend', () => {
    console.log('[MemberDrag] dragend');
    cleanupDrag();
  });
}

function cleanupDrag() {
  document.querySelectorAll('.member-item').forEach(c => {
    c.classList.remove('dragging', 'drag-over-above', 'drag-over-below');
    c.style.opacity = ''; // 恢复透明度
  });
  document.querySelectorAll('.group-members').forEach(c => {
    c.classList.remove('drag-hover');
  });
  document.querySelectorAll('.group-card').forEach(c => {
    c.classList.remove('drag-hover');
  });
  memberDragSrc = null;
}

// ── 未分组扩展拖拽：支持拖入分组和手动排序 ──
let dragSrcEl = null;
let dragExtId = null;

function setupUngroupedDragAndDrop() {
  const ungroupedList = document.getElementById('ungroupedList');
  const groupList = document.getElementById('groupList');
  if (!ungroupedList) return;

  // 未分组扩展开始拖动
  ungroupedList.addEventListener('dragstart', (e) => {
    const item = e.target.closest('.ext-item');
    if (!item) return;

    // 手动排序模式下才允许在未分组列表内拖动
    if (currentSort === 'manual') {
      dragSrcEl = item;
      item.classList.add('dragging');
    }

    // 始终允许拖出到分组
    dragExtId = item.dataset.extId;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/ext-assign', item.dataset.extId);
    e.dataTransfer.setData('text/plain', item.dataset.extId);
  });

  ungroupedList.addEventListener('dragend', () => {
    if (dragSrcEl) {
      dragSrcEl.classList.remove('dragging');
      dragSrcEl = null;
    }
    if (dragExtId) {
      document.querySelectorAll('.ext-item.dragging').forEach(el => el.classList.remove('dragging'));
      dragExtId = null;
    }
    document.querySelectorAll('.group-members.drag-hover').forEach(el => el.classList.remove('drag-hover'));
    document.querySelectorAll('.group-card.drag-over').forEach(c => c.classList.remove('drag-over'));
    document.querySelectorAll('.ext-item.drag-over').forEach(c => c.classList.remove('drag-over'));
  });

// 拖到分组区域 - 处理未分组扩展的拖入
  groupList.addEventListener('dragover', (e) => {
    if (!dragExtId && !memberDragSrc) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';

    // 成员拖拽的高亮由 setupMemberDragDrop 处理，这里不重复设置
    if (memberDragSrc) return;

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
    // 不在这里清除类名，因为 dragleave 会在鼠标移动到子元素时频繁触发
    // 所有清理工作都在 dragover 开始时处理
  });

  groupList.addEventListener('drop', async (e) => {
    // 成员项的 drop 由 setupMemberDragDrop 处理
    if (memberDragSrc) return;

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

    dragExtId = null;
  });

  // 手动排序模式下的拖拽排序
  ungroupedList.addEventListener('dragover', (e) => {
    if (currentSort !== 'manual' || !dragSrcEl) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const item = e.target.closest('.ext-item');
    if (item && item !== dragSrcEl) {
      document.querySelectorAll('.ext-item').forEach(c => c.classList.remove('drag-over'));
      item.classList.add('drag-over');
    }
  });

  ungroupedList.addEventListener('dragleave', (e) => {
    if (currentSort !== 'manual') return;
    if (!e.relatedTarget || !e.currentTarget.contains(e.relatedTarget)) {
      document.querySelectorAll('.ext-item').forEach(c => c.classList.remove('drag-over'));
    }
  });

  ungroupedList.addEventListener('drop', async (e) => {
    if (currentSort !== 'manual' || !dragSrcEl) return;
    e.preventDefault();

    const target = e.target.closest('.ext-item');
    if (!target || target === dragSrcEl) return;

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
    dragExtId = null;
    renderUngrouped();
  });
}
