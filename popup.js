// Lockin Popup v1.2
// Per-tab activation: master toggle only affects the current tab.
// Feature settings (sliders, sub-toggles) sync globally via chrome.storage.

// ── i18n ──────────────────────────────────────────
const STRINGS = {
  zh: {
    tagline:        'LOCK IN · 专注 · 心流',
    masterOff:      '开始专注',
    masterOn:       '专注中',
    masterStatusOff:'点击为此标签页启动',
    masterStatusOn: '当前标签页 ·',
    bionicDesc:     '加粗词首<br>锚定视线',
    bionicAmtLabel: '加粗比例',
    hlName:         '行<br>高亮',
    hlDesc:         '跟随鼠标<br>标记位置',
    hlHeightLabel:  '范围高度',
    hlOpacityLabel: '透明度',
    hlPrecLabel:    '精细度',
    spacingName:    '行间距',
    spacingDesc:    '降低文字密度，减少压迫感',
    focusName:      '聚焦遮罩',
    focusDesc:      '遮暗上下区域，减少干扰',
    dimLabel:       '遮罩深度',
    bandLabel:      '垂直范围',
    hBandLabel:     '水平范围',
    progressName:   '进度<br>顶栏',
    progressDesc:   '页面顶部<br>滚动进度',
    floatName:      '悬浮<br>进度球',
    floatDesc:      '页面内<br>可拖拽',
    rewardName:     '专注<br>奖励',
    rewardDesc:     '每10分钟<br>即时反馈',
    fontName:       '字体<br>切换',
    fontDesc:       '易读字体<br>减少阅读障碍',
    fontDefault:    '默认',
    fontDyslexic:   '易读体',
    reset:          '↺ 重置',
    langToggle:     'EN',
  },
  en: {
    tagline:        'LOCK IN · READ · FLOW',
    masterOff:      'Start Focus',
    masterOn:       'Focusing',
    masterStatusOff:'Click to activate on this tab',
    masterStatusOn: 'This tab ·',
    bionicDesc:     'Bold word stems<br>anchor your eyes',
    bionicAmtLabel: 'BOLD AMOUNT',
    hlName:         'Line<br>Highlight',
    hlDesc:         'Follows cursor<br>marks position',
    hlHeightLabel:  'HL HEIGHT',
    hlOpacityLabel: 'OPACITY',
    hlPrecLabel:    'PRECISION',
    spacingName:    'Line Spacing',
    spacingDesc:    'Reduce text density and visual pressure',
    focusName:      'Focus Mask',
    focusDesc:      'Dim above & below to cut distractions',
    dimLabel:       'MASK DEPTH',
    bandLabel:      'VERT BAND',
    hBandLabel:     'HORIZ BAND',
    progressName:   'Progress<br>Bar',
    progressDesc:   'Top of page<br>scroll tracker',
    floatName:      'Float<br>Widget',
    floatDesc:      'On-page<br>draggable',
    rewardName:     'Focus<br>Reward',
    rewardDesc:     'Every 10 min<br>instant feedback',
    fontName:       'Font<br>Switcher',
    fontDesc:       'Readable fonts<br>reduce reading friction',
    fontDefault:    'Default',
    fontDyslexic:   'Dyslexic',
    reset:          '↺ Reset',
    langToggle:     '中',
  },
};

const PREC_LABELS = {
  zh: { 1: '标准', 2: '精细', 3: '跟随' },
  en: { 1: 'Normal', 2: 'Fine',  3: 'Exact'  },
};

function applyLang(lang) {
  const T = STRINGS[lang];
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.dataset.i18n;
    if (T[key] !== undefined) el.innerHTML = T[key];
  });
  const langBtn = document.getElementById('langBtn');
  if (langBtn) langBtn.textContent = T.langToggle;
  // update live master label/status
  const label  = document.getElementById('masterLabel');
  const status = document.getElementById('masterStatus');
  if (label)  label.innerHTML  = tabEnabled ? T.masterOn  : T.masterOff;
  if (status) status.innerHTML = tabEnabled ? T.masterStatusOn : T.masterStatusOff;
}

// Global feature defaults (no 'enabled' or 'sessionStart' — those are per-tab)
const defaults = {
  bionic: true,
  bionicAmount: 45,
  highlightLine: true,
  highlightColor: '#FFF9C4',
  highlightHeight: 185,
  highlightOpacity: 52,
  highlightPrecision: 1,
  lineSpacing: true,
  lineSpacingValue: 2.0,
  focusMode: false,
  progressBar: true,
  progressFloat: true,
  dimOpacity: 0.85,
  focusBand: 15,
  focusHBand: 100,
  darkMode: false,
  focusReward: true,
  fontSwitch: false,
  fontChoice: 'nunito',
  lang: 'zh',
};

let S = { ...defaults };

// Per-tab state (queried from content script)
let tabEnabled = false;
let tabSessionStart = null;
let timerInterval = null;

const $ = id => document.getElementById(id);

// elements
const masterBlock  = $('masterBlock');
const masterLabel  = $('masterLabel');
const masterStatus = $('masterStatus');
const sessionTimer = $('sessionTimer');
const bigPill      = $('bigPill');
const features     = $('features');
const themeBtn     = $('themeBtn');
const themeIcon    = $('themeIcon');
const resetBtn     = $('resetBtn');

const togs = {
  bionic:    $('tog-bionic'),
  highlight: $('tog-highlight'),
  spacing:   $('tog-spacing'),
  focus:     $('tog-focus'),
  progress:  $('tog-progress'),
  float:     $('tog-float'),
  reward:    $('tog-reward'),
  font:      $('tog-font'),
};

const subs = {
  spacing:   $('sub-spacing'),
  focus:     $('sub-focus'),
  font:      $('sub-font'),
};

// sliders
const spacingSlider    = $('spacingSlider');
const spacingVal       = $('spacingVal');
const dimSlider        = $('dimSlider');
const dimVal           = $('dimVal');
const bandSlider       = $('bandSlider');
const bandVal          = $('bandVal');
const hBandSlider      = $('hBandSlider');
const hBandVal         = $('hBandVal');
const bionicAmtSlider  = $('bionicAmtSlider');
const bionicAmtVal     = $('bionicAmtVal');
const hlHeightSlider   = $('hlHeightSlider');
const hlHeightVal      = $('hlHeightVal');
const hlOpacitySlider  = $('hlOpacitySlider');
const hlOpacityVal     = $('hlOpacityVal');
const hlPrecSlider     = $('hlPrecSlider');
const hlPrecVal        = $('hlPrecVal');

// ── Helper: get current active tab ────────────
function getCurrentTab(cb) {
  chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    cb(tabs && tabs[0] ? tabs[0] : null);
  });
}

// ── Helper: send message to current tab ───────
function sendToTab(msg, cb) {
  getCurrentTab(tab => {
    if (!tab) { if (cb) cb(null); return; }
    chrome.tabs.sendMessage(tab.id, msg, resp => {
      void chrome.runtime.lastError;
      if (cb) cb(resp);
    });
  });
}

// ── load ─────────────────────────────────────────
chrome.storage.sync.get('lockinSettings', data => {
  if (data.lockinSettings) {
    const { enabled, sessionStart, ...rest } = data.lockinSettings;
    S = { ...defaults, ...rest };
  }

  // suppress flash
  document.body.style.transition = 'none';
  applyTheme();
  applyLang(S.lang || 'zh');

  // Query the current tab's activation state
  sendToTab({ type: 'GET_TAB_STATE' }, resp => {
    if (resp) {
      tabEnabled = !!resp.tabEnabled;
      tabSessionStart = resp.tabSessionStart || null;
    }
    render();
    void document.body.offsetHeight;
    document.body.style.transition = '';
    document.body.style.opacity = '1';
    if (tabEnabled) startTimer();
  });
});

// ── render ────────────────────────────────────────
function render() {
  const T = STRINGS[S.lang || 'zh'];
  bigPill.classList.toggle('on', tabEnabled);
  masterLabel.innerHTML  = tabEnabled ? T.masterOn  : T.masterOff;
  masterStatus.innerHTML = tabEnabled ? T.masterStatusOn : T.masterStatusOff;
  sessionTimer.classList.toggle('show', tabEnabled);
  features.classList.toggle('disabled', !tabEnabled);

  setTog(togs.bionic,    S.bionic);
  setTog(togs.highlight, S.highlightLine);
  setTog(togs.spacing,   S.lineSpacing);
  setTog(togs.focus,     S.focusMode);
  setTog(togs.progress,  S.progressBar);
  setTog(togs.float,     S.progressFloat);
  setTog(togs.reward,    S.focusReward);
  setTog(togs.font,      S.fontSwitch);

  showSub(subs.spacing,   S.lineSpacing);
  showSub(subs.focus,     S.focusMode);
  showSub(subs.font,      S.fontSwitch);

  spacingSlider.value    = Math.round((S.lineSpacingValue || 2.0) * 10);
  spacingVal.textContent = (spacingSlider.value / 10).toFixed(1);

  dimSlider.value        = Math.round((S.dimOpacity || 0.85) * 100);
  dimVal.textContent     = dimSlider.value + '%';
  bandSlider.value       = S.focusBand || 15;
  bandVal.textContent    = bandSlider.value + '%';
  hBandSlider.value      = S.focusHBand !== undefined ? S.focusHBand : 100;
  hBandVal.textContent   = hBandSlider.value + '%';

  bionicAmtSlider.value    = S.bionicAmount || 45;
  bionicAmtVal.textContent = (S.bionicAmount || 45) + '%';

  const hlH = S.highlightHeight || 185;
  hlHeightSlider.value    = hlH;
  hlHeightVal.textContent = (hlH / 100).toFixed(1) + 'em';
  hlOpacitySlider.value    = S.highlightOpacity || 52;
  hlOpacityVal.textContent = (S.highlightOpacity || 52) + '%';
  const precVal = S.highlightPrecision || 1;
  hlPrecSlider.value   = precVal;
  const lang = S.lang || 'zh';
  hlPrecVal.textContent = (PREC_LABELS[lang] || PREC_LABELS.zh)[precVal] || '标准';

  document.querySelectorAll('.sw').forEach(sw =>
    sw.classList.toggle('active', sw.dataset.color === S.highlightColor)
  );

  document.querySelectorAll('.font-opt').forEach(opt =>
    opt.classList.toggle('active', opt.dataset.font === S.fontChoice)
  );
}

function setTog(el, on)    { el && el.classList.toggle('on', !!on); }
function showSub(el, show) { el && el.classList.toggle('show', !!show); }

function applyTheme() {
  document.documentElement.setAttribute('data-theme', S.darkMode ? 'dark' : 'light');
  themeIcon.textContent = S.darkMode ? '☀️' : '🌙';
}

// ── session timer ─────────────────────────────────
function startTimer() {
  if (!tabSessionStart) return;
  clearInterval(timerInterval);
  timerInterval = setInterval(tickTimer, 1000);
  tickTimer();
}
function stopTimer() {
  clearInterval(timerInterval);
  timerInterval = null;
  sessionTimer.textContent = '';
}
function tickTimer() {
  if (!tabSessionStart) return;
  const elapsed = Math.floor((Date.now() - tabSessionStart) / 1000);
  const m = Math.floor(elapsed / 60).toString().padStart(2, '0');
  const s = (elapsed % 60).toString().padStart(2, '0');
  sessionTimer.textContent = m + ':' + s;
}

// ── push feature settings to current tab ──────────
function push() {
  sendToTab({ type: 'UPDATE_SETTINGS', settings: { ...S } });
}

function update(patch) {
  S = { ...S, ...patch };
  chrome.storage.sync.set({ lockinSettings: S });
  push();
  render();
}

// ── ripple ────────────────────────────────────────
function addRipple(el, e) {
  const r = document.createElement('div');
  r.className = 'ripple-el';
  const rect = el.getBoundingClientRect();
  r.style.left = (e.clientX - rect.left - 20) + 'px';
  r.style.top  = (e.clientY - rect.top  - 20) + 'px';
  el.appendChild(r);
  setTimeout(() => r.remove(), 400);
}

// ── master toggle (per-tab) ───────────────────────
masterBlock.addEventListener('click', e => {
  addRipple(masterBlock, e);
  const next = !tabEnabled;
  sendToTab({ type: 'SET_TAB_ENABLED', enabled: next }, resp => {
    if (resp) {
      tabEnabled = !!resp.tabEnabled;
      tabSessionStart = resp.tabSessionStart || null;
    } else {
      // Fallback if content script didn't respond (e.g. chrome:// pages)
      tabEnabled = false;
      tabSessionStart = null;
    }
    render();
    if (tabEnabled) {
      startTimer();
      // Push current feature settings to the newly activated tab
      push();
    } else {
      stopTimer();
    }
  });
});

// ── lang ──────────────────────────────────────────
const langBtn = $('langBtn');
langBtn.addEventListener('click', () => {
  S.lang = (S.lang === 'zh') ? 'en' : 'zh';
  chrome.storage.sync.set({ lockinSettings: S });
  applyLang(S.lang);
  render();
});

// ── theme ─────────────────────────────────────────
themeBtn.addEventListener('click', () => {
  S.darkMode = !S.darkMode;
  applyTheme();
  chrome.storage.sync.set({ lockinSettings: S });
});

// ── feature blocks ────────────────────────────────
function bindBlock(blockId, key) {
  const block = $(blockId);
  if (!block) return;
  block.addEventListener('click', e => {
    if (e.target.closest('input[type=range],.sw,.font-opt,.weight-opt')) return;
    addRipple(block, e);
    update({ [key]: !S[key] });
  });
}

bindBlock('fb-bionic',    'bionic');
bindBlock('fb-highlight', 'highlightLine');
bindBlock('fb-spacing',   'lineSpacing');
bindBlock('fb-focus',     'focusMode');
bindBlock('fb-progress',  'progressBar');
bindBlock('fb-float',     'progressFloat');
bindBlock('fb-reward',    'focusReward');
bindBlock('fb-font',      'fontSwitch');

// ── bionic sliders ────────────────────────────────
bionicAmtSlider.addEventListener('input', e => {
  e.stopPropagation();
  bionicAmtVal.textContent = bionicAmtSlider.value + '%';
  update({ bionicAmount: parseInt(bionicAmtSlider.value) });
});
// ── highlight sliders ─────────────────────────────
hlHeightSlider.addEventListener('input', e => {
  e.stopPropagation();
  const val = parseInt(hlHeightSlider.value);
  hlHeightVal.textContent = (val / 100).toFixed(1) + 'em';
  update({ highlightHeight: val });
});
hlOpacitySlider.addEventListener('input', e => {
  e.stopPropagation();
  hlOpacityVal.textContent = hlOpacitySlider.value + '%';
  update({ highlightOpacity: parseInt(hlOpacitySlider.value) });
});
hlPrecSlider.addEventListener('input', e => {
  e.stopPropagation();
  const lang = S.lang || 'zh';
  const val  = parseInt(hlPrecSlider.value);
  hlPrecVal.textContent = (PREC_LABELS[lang] || PREC_LABELS.zh)[val];
  update({ highlightPrecision: val });
});

// ── spacing / focus sliders ───────────────────────
spacingSlider.addEventListener('input', e => {
  e.stopPropagation();
  spacingVal.textContent = (parseInt(spacingSlider.value) / 10).toFixed(1);
  update({ lineSpacingValue: parseInt(spacingSlider.value) / 10 });
});
dimSlider.addEventListener('input', e => {
  e.stopPropagation();
  dimVal.textContent = dimSlider.value + '%';
  update({ dimOpacity: parseInt(dimSlider.value) / 100 });
});
bandSlider.addEventListener('input', e => {
  e.stopPropagation();
  bandVal.textContent = bandSlider.value + '%';
  update({ focusBand: parseInt(bandSlider.value) });
});
hBandSlider.addEventListener('input', e => {
  e.stopPropagation();
  hBandVal.textContent = hBandSlider.value + '%';
  update({ focusHBand: parseInt(hBandSlider.value) });
});

// ── swatches ──────────────────────────────────────
document.querySelectorAll('.sw').forEach(sw => {
  sw.addEventListener('click', e => {
    e.stopPropagation();
    update({ highlightColor: sw.dataset.color });
  });
});

// ── font pills ────────────────────────────────────
document.querySelectorAll('.font-opt').forEach(opt => {
  opt.addEventListener('click', e => {
    e.stopPropagation();
    update({ fontChoice: opt.dataset.font });
  });
});

// ── reset ─────────────────────────────────────────
resetBtn.addEventListener('click', () => {
  // Deactivate current tab
  sendToTab({ type: 'SET_TAB_ENABLED', enabled: false }, () => {
    tabEnabled = false;
    tabSessionStart = null;
    stopTimer();
    S = { ...defaults };
    applyTheme();
    applyLang(S.lang || 'zh');
    render();
    chrome.storage.sync.set({ lockinSettings: S });
    push();
  });
});
