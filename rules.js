// rules.js - 自动化规则管理页

let rules = [];
let extensions = [];
let editingRuleId = null;

document.addEventListener('DOMContentLoaded', init);

async function init() {
  const store = await getStorage();
  applyTheme(store.theme || 'light');
  rules = store.rules || [];
  extensions = await getExtensions();
  renderRules();
  bindEvents();
}

function renderRules() {
  const listEl = document.getElementById('ruleList');

  if (rules.length === 0) {
    listEl.innerHTML = '<div class="empty-state">📭 暂无规则，点击上方添加按钮创建</div>';
    return;
  }

  listEl.innerHTML = '';
  for (const rule of rules) {
    const item = document.createElement('div');
    item.className = 'rule-item' + (rule.enabled ? '' : ' disabled-rule');
    item.dataset.id = rule.id;

    const actionsSummary = (rule.actions || [])
      .map(a => {
        const ext = extensions.find(e => e.id === a.extId);
        return `${ext?.name || a.extId} → ${a.enabled ? '启用' : '禁用'}`;
      }).join(' | ');

    item.innerHTML = `
      <div class="rule-header" data-rule="${rule.id}">
        <label class="toggle rule-toggle">
          <input type="checkbox" class="rule-checkbox" ${rule.enabled ? 'checked' : ''} data-id="${rule.id}">
          <span class="toggle-slider"></span>
        </label>
        <span class="rule-pattern">${escapeHtml(rule.urlPattern)}</span>

      </div>
      <div class="rule-body" id="body-${rule.id}">
        <div class="rule-action-row">
          <label>URL 规则</label>
          <input type="text" class="form-input" value="${escapeHtml(rule.urlPattern)}" data-field="pattern" data-id="${rule.id}" style="flex:1;font-family:monospace">
        </div>
        <div class="rule-action-row"><label>操作</label><span style="font-size:11px;color:var(--text2)">（直接在下方编辑）</span></div>
        <div class="rule-actions-inline" id="inline-actions-${rule.id}">
          ${(rule.actions || []).map((a, i) => `
            <div class="rule-action-row" style="padding-left:16px">
              <select class="form-select" data-action="ext" data-rule="${rule.id}" data-index="${i}">
                ${extensions.map(e => `<option value="${e.id}" ${a.extId === e.id ? 'selected' : ''}>${e.name}</option>`).join('')}
              </select>
              <select class="form-select" data-action="state" data-rule="${rule.id}" data-index="${i}">
                <option value="true" ${a.enabled ? 'selected' : ''}>启用</option>
                <option value="false" ${!a.enabled ? 'selected' : ''}>禁用</option>
              </select>
              <button class="icon-btn" data-action="delAction" data-rule="${rule.id}" data-index="${i}" title="删除">🗑</button>
            </div>
          `).join('')}
        </div>
        <div class="rule-footer">
          <button class="btn btn-danger btn-sm" data-action="deleteRule" data-id="${rule.id}">🗑 删除规则</button>
          <div style="flex:1"></div>
          <button class="btn btn-secondary btn-sm" data-action="addAction" data-id="${rule.id}">➕ 添加操作</button>
          <button class="btn btn-sm" data-action="cancelEdit" data-id="${rule.id}">取消</button>
          <button class="btn btn-primary btn-sm" data-action="saveEdit" data-id="${rule.id}">💾 保存</button>
        </div>
      </div>
    `;

    listEl.appendChild(item);
  }
}

function bindEvents() {
  document.getElementById('btnAddRule').onclick = () => openRuleModal();
  document.getElementById('btnCancelRule').onclick = () => closeRuleModal();
  document.getElementById('btnAddAction').onclick = () => addActionRow();
  document.getElementById('btnSaveRule').onclick = () => saveRule();
  document.getElementById('btnConvertUrl').onclick = () => convertUrlToPattern();
  document.getElementById('btnDeleteRule').onclick = () => deleteRule();
  document.getElementById('btnConfirmUninstall')?.remove();

  // 规则总开关
  document.getElementById('ruleList').onchange = async (e) => {
    if (e.target.classList.contains('rule-checkbox')) {
      const id = e.target.dataset.id;
      const rule = rules.find(r => r.id === id);
      if (rule) {
        rule.enabled = e.target.checked;
        await setStorage({ rules });
        renderRules();
      }
    }
  };

  // 展开/折叠
  document.getElementById('ruleList').onclick = async (e) => {
    const ruleEl = e.target.closest('.rule-header');
    if (e.target.closest('.rule-checkbox')) return;
    if (ruleEl) {
      const id = ruleEl.dataset.rule;
      const body = document.getElementById(`body-${id}`);
      if (body) body.classList.toggle('open');
    }

    const act = e.target.dataset.action;
    const rid = e.target.dataset.id;
    const ridx = e.target.dataset.index;

    if (act === 'deleteRule') {
      if (confirm('确定删除此规则？')) {
        rules = rules.filter(r => r.id !== rid);
        await setStorage({ rules });
        renderRules();
      }
      return;
    }
    if (act === 'addAction') { addInlineAction(rid); return; }
    if (act === 'delAction') { delInlineAction(e.target.dataset.rule, parseInt(e.target.dataset.index)); return; }
    if (act === 'cancelEdit') {
      const body = document.getElementById(`body-${rid}`);
      if (body) body.classList.remove('open');
      return;
    }
    if (act === 'saveEdit') { saveInlineEdit(rid); return; }
    if (act === 'ext' || act === 'state') {
      const sel = e.target;
      const rule = rules.find(r => r.id === sel.dataset.rule);
      const idx = parseInt(sel.dataset.index);
      if (rule && rule.actions[idx]) {
        if (act === 'ext') rule.actions[idx].extId = sel.value;
        if (act === 'state') rule.actions[idx].enabled = sel.value === 'true';
      }
    }
  };
}

function openRuleModal(editId = null) {
  editingRuleId = editId;
  const modal = document.getElementById('modalRule');
  const title = document.getElementById('modalRuleTitle');
  const deleteBtn = document.getElementById('btnDeleteRule');
  const patternInput = document.getElementById('inputPattern');
  const actionsList = document.getElementById('ruleActionsList');

  if (editId) {
    const rule = rules.find(r => r.id === editId);
    title.textContent = '编辑规则';
    deleteBtn.style.display = 'inline-block';
    patternInput.value = rule.urlPattern;
    renderActionsList(rule.actions || []);
  } else {
    title.textContent = '添加规则';
    deleteBtn.style.display = 'none';
    patternInput.value = '';
    renderActionsList([{ extId: extensions[0]?.id || '', enabled: true }]);
  }

  modal.style.display = 'flex';
}

function renderActionsList(actions) {
  const list = document.getElementById('ruleActionsList');
  list.innerHTML = actions.map((a, i) => `
    <div class="rule-action-row">
      <select class="form-select" data-modal-ext="${i}">
        ${extensions.map(e => `<option value="${e.id}" ${a.extId === e.id ? 'selected' : ''}>${e.name}</option>`).join('')}
      </select>
      <select class="form-select" data-modal-state="${i}">
        <option value="true" ${a.enabled ? 'selected' : ''}>启用</option>
        <option value="false" ${!a.enabled ? 'selected' : ''}>禁用</option>
      </select>
      <button class="icon-btn" onclick="removeActionRow(${i})" title="删除">🗑</button>
    </div>
  `).join('');
}

function addActionRow() {
  const existing = document.querySelectorAll('#ruleActionsList .rule-action-row');
  const newIdx = existing.length;
  const extId = extensions[0]?.id || '';
  const div = document.createElement('div');
  div.className = 'rule-action-row';
  div.innerHTML = `
    <select class="form-select" data-modal-ext="${newIdx}">
      ${extensions.map(e => `<option value="${e.id}">${e.name}</option>`).join('')}
    </select>
    <select class="form-select" data-modal-state="${newIdx}">
      <option value="true" selected>启用</option>
      <option value="false">禁用</option>
    </select>
    <button class="icon-btn" onclick="removeActionRow(${newIdx})" title="删除">🗑</button>
  `;
  document.getElementById('ruleActionsList').appendChild(div);
}

window.removeActionRow = function(idx) {
  const rows = document.querySelectorAll('#ruleActionsList .rule-action-row');
  if (rows[idx]) rows[idx].remove();
};

// 将网址转换为通配符规则
function convertUrlToPattern() {
  const input = document.getElementById('inputPattern');
  let url = input.value.trim();
  if (!url) return;

  // 补全协议
  if (!url.includes('://')) url = 'https://' + url;

  try {
    const u = new URL(url);
    // 协议用 *，域名保留主域，路径段只保留第一层
    const host = u.hostname;
    const parts = host.split('.');
    let patternHost;
    if (parts.length > 2) {
      // sub.domain.com → *.domain.com
      patternHost = '*.' + parts.slice(-2).join('.');
    } else {
      patternHost = host;
    }

    // 路径：保留到第一层 + 通配
    const pathSegments = u.pathname.split('/').filter(Boolean);
    let patternPath;
    if (pathSegments.length === 0) {
      patternPath = '/*';
    } else {
      patternPath = '/' + pathSegments[0] + '/*';
    }

    const result = `*://${patternHost}${patternPath}`;
    input.value = result;
    input.focus();
    input.select();
  } catch {
    // 不是合法 URL，尝试简单替换
    input.value = '*://' + url.replace(/^https?:\/\//, '') + '/*';
  }
}

function saveRule() {
  const pattern = document.getElementById('inputPattern').value.trim();
  if (!pattern) { alert('请输入 URL 匹配规则'); return; }

  const rows = document.querySelectorAll('#ruleActionsList .rule-action-row');
  const actions = Array.from(rows).map((_, i) => ({
    extId: document.querySelector(`select[data-modal-ext="${i}"]`)?.value || '',
    enabled: document.querySelector(`select[data-modal-state="${i}"]`)?.value === 'true'
  })).filter(a => a.extId);

  if (actions.length === 0) { alert('请至少添加一个操作'); return; }

  if (editingRuleId) {
    const rule = rules.find(r => r.id === editingRuleId);
    if (rule) { rule.urlPattern = pattern; rule.actions = actions; }
  } else {
    rules.push({ id: uid(), urlPattern: pattern, actions, enabled: true });
  }

  setStorage({ rules }).then(() => {
    closeRuleModal();
    renderRules();
  });
}

async function deleteRule() {
  if (!editingRuleId) return;
  rules = rules.filter(r => r.id !== editingRuleId);
  await setStorage({ rules });
  closeRuleModal();
  renderRules();
}

function closeRuleModal() {
  document.getElementById('modalRule').style.display = 'none';
  editingRuleId = null;
}

function addInlineAction(ruleId) {
  const rule = rules.find(r => r.id === ruleId);
  if (!rule) return;
  rule.actions.push({ extId: extensions[0]?.id || '', enabled: true });
  renderRules();
  const body = document.getElementById(`body-${ruleId}`);
  if (body) body.classList.add('open');
}

function delInlineAction(ruleId, idx) {
  const rule = rules.find(r => r.id === ruleId);
  if (!rule) return;
  rule.actions.splice(idx, 1);
  renderRules();
  const body = document.getElementById(`body-${ruleId}`);
  if (body) body.classList.add('open');
}

async function saveInlineEdit(ruleId) {
  const pattern = document.querySelector(`input[data-field="pattern"][data-id="${ruleId}"]`)?.value?.trim();
  if (!pattern) { alert('URL 规则不能为空'); return; }
  const rule = rules.find(r => r.id === ruleId);
  if (!rule) return;
  rule.urlPattern = pattern;
  await setStorage({ rules });
  renderRules();
  const body = document.getElementById(`body-${ruleId}`);
  if (body) body.classList.remove('open');
}

function escapeHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}