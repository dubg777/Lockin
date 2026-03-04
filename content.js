// Lockin - Content Script v1.2
// Per-tab activation: each tab manages its own enabled state in memory.
// Global settings (feature toggles, slider values) still sync via chrome.storage.
(function () {
  'use strict';

  // ══ SITE-SPECIFIC CONFIG ═════════════════════
  const hostname = location.hostname.replace(/^www\./, '');

  const SITE_CONFIGS = {
    'twitter.com': {
      spacingExtra: [
        '[data-testid="tweetText"]',
        '[data-testid="tweet"] span',
        '[role="article"] p',
        '[data-testid="card.layoutSmall.detail"] span',
      ].join(','),
      observeSelector: '[data-testid="primaryColumn"]',
    },
    'x.com': {
      spacingExtra: [
        '[data-testid="tweetText"]',
        '[data-testid="tweet"] span',
        '[role="article"] p',
      ].join(','),
      observeSelector: '[data-testid="primaryColumn"]',
    },
    'xiaohongshu.com': {
      spacingExtra: [
        '.note-content',
        '.desc',
        '#detail-desc',
        '.comment-item .content',
        '.note-item',
        '.feed-item-content',
      ].join(','),
      observeSelector: '#app',
    },
    'xhslink.com': {
      spacingExtra: '.note-content,.desc,#detail-desc',
      observeSelector: '#app',
    },
  };

  const siteConfig = SITE_CONFIGS[hostname] || null;

  // ══ SETTINGS (global, synced) ════════════════
  let S = {
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
    fontChoice: 'default',
  };

  // ══ PER-TAB STATE (in memory only) ═══════════
  let tabEnabled = false;
  let tabSessionStart = null;

  // ══ DOM STATE ════════════════════════════════
  let styleEl        = null;
  let fontStyleEl    = null;
  let highlightEl    = null;
  let progressBar    = null;
  let floatWidget    = null;
  let focusTop       = null;
  let focusBottom    = null;
  let focusLeft      = null;
  let focusRight     = null;
  let bionicApplied  = false;
  let lastMouseY     = null;
  let rewardTimer    = null;
  let rewardToast    = null;
  let rewardMins     = 0;
  let bionicObserver = null;

  // ══ INIT ═════════════════════════════════════
  // Load global settings only — do NOT auto-activate
  chrome.storage.sync.get('lockinSettings', (data) => {
    if (data.lockinSettings) {
      const { enabled, sessionStart, ...rest } = data.lockinSettings;
      S = { ...S, ...rest };
    }
    // tabEnabled stays false — user must activate per tab via popup
  });

  // ══ MESSAGE HANDLER ══════════════════════════
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    // ── Popup queries this tab's activation state ──
    if (msg.type === 'GET_TAB_STATE') {
      sendResponse({
        tabEnabled: tabEnabled,
        tabSessionStart: tabSessionStart,
      });
      return true;
    }

    // ── Popup toggles this tab on/off ──
    if (msg.type === 'SET_TAB_ENABLED') {
      const wasEnabled = tabEnabled;
      tabEnabled = !!msg.enabled;
      if (tabEnabled && !wasEnabled) {
        tabSessionStart = Date.now();
        activate();
      } else if (!tabEnabled && wasEnabled) {
        tabSessionStart = null;
        deactivate();
      }
      sendResponse({ ok: true, tabEnabled, tabSessionStart });
      return true;
    }

    // ── Popup pushes updated feature settings ──
    if (msg.type === 'UPDATE_SETTINGS') {
      const prev = { ...S };
      const { enabled, sessionStart, ...rest } = msg.settings;
      S = { ...S, ...rest };
      if (tabEnabled) {
        handleChange(prev);
      }
      sendResponse({ ok: true });
      return true;
    }

    return true;
  });

  // ══ CHANGE HANDLER ═══════════════════════════
  function handleChange(prev) {
    if (!tabEnabled) return;

    if (S.lineSpacing !== prev.lineSpacing ||
        S.lineSpacingValue !== prev.lineSpacingValue) applyLineSpacing();

    if (highlightEl) {
      if (S.highlightColor !== prev.highlightColor)
        highlightEl.style.background = S.highlightColor;
      if (S.highlightOpacity !== prev.highlightOpacity)
        highlightEl.style.opacity = (S.highlightOpacity || 52) / 100;
      if (S.highlightHeight !== prev.highlightHeight)
        highlightEl.style.height = (S.highlightHeight || 185) / 100 + 'em';
    }

    if (S.highlightLine && !prev.highlightLine)  attachLineHighlight();
    if (!S.highlightLine && prev.highlightLine)  removeLineHighlight();

    if (S.bionic && !prev.bionic)  { applyBionicReading(); startBionicObserver(); return; }
    if (!S.bionic && prev.bionic)  { removeBionicReading(); stopBionicObserver(); return; }
    if (S.bionic && S.bionicAmount !== prev.bionicAmount) {
      removeBionicReading();
      applyBionicReading();
    }

    if (S.focusMode && !prev.focusMode)  attachFocusMode();
    if (!S.focusMode && prev.focusMode)  removeFocusMode();
    if (S.focusMode && (
      S.dimOpacity !== prev.dimOpacity ||
      S.focusBand  !== prev.focusBand  ||
      S.focusHBand !== prev.focusHBand
    )) {
      const bg = `rgba(0,0,0,${S.dimOpacity})`;
      if (focusTop)    focusTop.style.background    = bg;
      if (focusBottom) focusBottom.style.background = bg;
      if (focusLeft)   focusLeft.style.background   = bg;
      if (focusRight)  focusRight.style.background  = bg;
      applyFocusMask(lastMouseY !== null ? lastMouseY : window.innerHeight / 2);
    }

    if (S.progressBar && !prev.progressBar)   createProgressBar();
    if (!S.progressBar && prev.progressBar)   removeProgressBar();
    if (S.progressFloat && !prev.progressFloat) createFloatWidget();
    if (!S.progressFloat && prev.progressFloat) removeFloatWidget();

    if (S.focusReward && !prev.focusReward)  startRewardTimer();
    if (!S.focusReward && prev.focusReward)  stopRewardTimer();

    if (S.fontSwitch && !prev.fontSwitch)    applyFont();
    if (!S.fontSwitch && prev.fontSwitch)    removeFont();
    if (S.fontSwitch && S.fontChoice !== prev.fontChoice) applyFont();
  }

  // ══ ACTIVATE / DEACTIVATE ════════════════════
  function activate() {
    applyLineSpacing();
    if (S.bionic)         applyBionicReading();
    if (S.highlightLine)  attachLineHighlight();
    if (S.focusMode)      attachFocusMode();
    if (S.progressBar)    createProgressBar();
    if (S.progressFloat)  createFloatWidget();
    if (S.focusReward)    startRewardTimer();
    if (S.fontSwitch)     applyFont();
    window.addEventListener('scroll', onScroll, { passive: true });
    startBionicObserver();
  }

  function deactivate() {
    removeLineSpacing(); removeBionicReading(); removeLineHighlight();
    removeFocusMode(); removeProgressBar(); removeFloatWidget();
    stopRewardTimer(); removeFont();
    window.removeEventListener('scroll', onScroll);
    stopBionicObserver();
  }

  // ══ 1. LINE SPACING ══════════════════════════
  function applyLineSpacing() {
    if (styleEl) { styleEl.remove(); styleEl = null; }
    if (!tabEnabled || !S.lineSpacing) return;
    const lh = S.lineSpacingValue || 2.0;
    const extra = siteConfig && siteConfig.spacingExtra ? ',' + siteConfig.spacingExtra : '';
    styleEl = document.createElement('style');
    styleEl.id = 'lockin-spacing';
    styleEl.textContent = `
      p,li,td,dd,blockquote,
      [class*="article"],[class*="content"],[class*="post"],[class*="body"]
      ${extra} {
        line-height:${lh} !important; letter-spacing:0.025em !important;
      }
      p { margin-bottom:${(lh * 0.65).toFixed(2)}em !important; }
    `;
    document.head.appendChild(styleEl);
  }
  function removeLineSpacing() { if (styleEl) { styleEl.remove(); styleEl = null; } }

  // ══ 2. BIONIC READING ════════════════════════
  function applyBionicReading() {
    if (bionicApplied) return;
    bionicApplied = true;
    applyBionicToRoot(document.body);
  }

  function applyBionicToRoot(root) {
    if (!root) return;
    const skip   = new Set(['SCRIPT','STYLE','CODE','PRE','TEXTAREA','INPUT','SELECT','NOSCRIPT']);
    const amount = (S.bionicAmount || 45) / 100;
    const weight = 800;

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const p = node.parentElement;
        if (!p || skip.has(p.tagName)) return NodeFilter.FILTER_REJECT;
        if (p.closest('code,pre,[data-adhd]')) return NodeFilter.FILTER_REJECT;
        if (!node.textContent.trim()) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });

    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(textNode => {
      const text = textNode.textContent;
      if (!text.trim()) return;
      const span = document.createElement('span');
      span.setAttribute('data-adhd', '1');
      span.innerHTML = text.replace(/(\S+)/g, word => {
        if (word.length <= 1 || !/[\u4e00-\u9fffA-Za-z]/.test(word)) return word;
        const n = Math.max(1, Math.ceil(word.length * amount));
        return `<b style="font-weight:${weight}">${word.slice(0, n)}</b>${word.slice(n)}`;
      });
      textNode.parentNode && textNode.parentNode.replaceChild(span, textNode);
    });
  }

  function removeBionicReading() {
    if (!bionicApplied) return;
    bionicApplied = false;
    document.querySelectorAll('[data-adhd]').forEach(span => {
      span.parentNode && span.parentNode.replaceChild(
        document.createTextNode(span.textContent), span
      );
    });
  }

  function startBionicObserver() {
    if (!siteConfig || !S.bionic) return;
    stopBionicObserver();
    const getTarget = () => {
      if (siteConfig.observeSelector)
        return document.querySelector(siteConfig.observeSelector) || document.body;
      return document.body;
    };
    const tryObserve = () => {
      const target = getTarget();
      bionicObserver = new MutationObserver(mutations => {
        if (!S.bionic || !tabEnabled) return;
        mutations.forEach(({ addedNodes }) => {
          addedNodes.forEach(node => {
            if (node.nodeType === Node.ELEMENT_NODE) applyBionicToRoot(node);
          });
        });
      });
      bionicObserver.observe(target, { childList: true, subtree: true });
    };
    if (document.readyState === 'complete') {
      tryObserve();
    } else {
      window.addEventListener('load', tryObserve, { once: true });
    }
  }

  function stopBionicObserver() {
    if (bionicObserver) { bionicObserver.disconnect(); bionicObserver = null; }
  }

  // ══ 3. LINE HIGHLIGHT ════════════════════════
  function attachLineHighlight() {
    if (highlightEl) return;
    highlightEl = document.createElement('div');
    highlightEl.id = 'adhd-hl';
    Object.assign(highlightEl.style, {
      position:'fixed', left:'0', right:'0', height: (S.highlightHeight || 185) / 100 + 'em',
      background: S.highlightColor,
      opacity: (S.highlightOpacity || 52) / 100,
      pointerEvents:'none', zIndex:'999996',
      transition:'top 0.05s linear, background 0.2s ease, opacity 0.2s ease',
      borderRadius:'2px', mixBlendMode:'multiply', top:'-200px',
    });
    document.body.appendChild(highlightEl);
    document.addEventListener('mousemove', onMouseMove, { passive: true });
  }

  function onMouseMove(e) {
    if (!highlightEl) return;
    const lh   = parseFloat(getComputedStyle(document.body).lineHeight) || 24;
    const prec = S.highlightPrecision || 1;
    let top;
    if (prec >= 3) {
      top = e.clientY - lh * 0.5;
    } else if (prec === 2) {
      const snap = lh / 2;
      top = Math.floor(e.clientY / snap) * snap;
    } else {
      top = Math.floor(e.clientY / lh) * lh;
    }
    highlightEl.style.top = top + 'px';
  }

  function removeLineHighlight() {
    if (highlightEl) { highlightEl.remove(); highlightEl = null; }
    document.removeEventListener('mousemove', onMouseMove);
  }

  // ══ 4. FOCUS MASK ════════════════════════════
  function attachFocusMode() {
    if (focusTop) return;
    const bg = `rgba(0,0,0,${S.dimOpacity})`;
    const common = { position:'fixed', pointerEvents:'none', zIndex:'999997', background:bg };
    focusTop    = document.createElement('div'); focusTop.id    = 'adhd-ft';
    focusBottom = document.createElement('div'); focusBottom.id = 'adhd-fb';
    focusLeft   = document.createElement('div'); focusLeft.id   = 'adhd-fl';
    focusRight  = document.createElement('div'); focusRight.id  = 'adhd-fr';
    Object.assign(focusTop.style,    common, { left:'0', right:'0', top:'0',    height:'0' });
    Object.assign(focusBottom.style, common, { left:'0', right:'0', bottom:'0', height:'0' });
    Object.assign(focusLeft.style,   common, { left:'0',  top:'0', bottom:'0', width:'0' });
    Object.assign(focusRight.style,  common, { right:'0', top:'0', bottom:'0', width:'0' });
    document.body.appendChild(focusTop);
    document.body.appendChild(focusBottom);
    document.body.appendChild(focusLeft);
    document.body.appendChild(focusRight);
    applyFocusMask(window.innerHeight / 2);
    document.addEventListener('mousemove', onFocusMove, { passive: true });
  }

  function applyFocusMask(y) {
    if (!focusTop) return;
    const H    = window.innerHeight;
    const W    = window.innerWidth;
    const vBand = H * ((S.focusBand  || 15)  / 100);
    const hPct  = S.focusHBand !== undefined ? S.focusHBand : 100;
    const hSide = Math.max(0, W * ((100 - hPct) / 200));

    const topH = Math.max(0, y - vBand);
    const botH = Math.max(0, H - y - vBand);

    focusTop.style.height    = topH + 'px';
    focusBottom.style.height = botH + 'px';

    focusLeft.style.top     = topH + 'px';
    focusLeft.style.bottom  = botH + 'px';
    focusLeft.style.width   = hSide + 'px';
    focusRight.style.top    = topH + 'px';
    focusRight.style.bottom = botH + 'px';
    focusRight.style.width  = hSide + 'px';
  }

  function onFocusMove(e) { lastMouseY = e.clientY; applyFocusMask(e.clientY); }
  function removeFocusMode() {
    if (focusTop)    { focusTop.remove();    focusTop    = null; }
    if (focusBottom) { focusBottom.remove(); focusBottom = null; }
    if (focusLeft)   { focusLeft.remove();   focusLeft   = null; }
    if (focusRight)  { focusRight.remove();  focusRight  = null; }
    document.removeEventListener('mousemove', onFocusMove);
    lastMouseY = null;
  }

  // ══ 5. PROGRESS BAR ══════════════════════════
  function createProgressBar() {
    if (progressBar) return;
    progressBar = document.createElement('div');
    Object.assign(progressBar.style, {
      position:'fixed', top:'0', left:'0', height:'3px', width:'0%',
      background:'linear-gradient(90deg,#5E00CC,#0044CC)',
      zIndex:'999999', pointerEvents:'none', transition:'width 0.12s ease',
    });
    document.body.appendChild(progressBar);
    updateProgress();
  }
  function removeProgressBar() { if (progressBar) { progressBar.remove(); progressBar = null; } }

  // ══ 6. FLOAT WIDGET ══════════════════════════
  function createFloatWidget() {
    if (floatWidget) return;
    floatWidget = document.createElement('div');
    floatWidget.id = 'adhd-float';
    Object.assign(floatWidget.style, {
      position:'fixed', bottom:'24px', right:'20px',
      width:'64px', height:'64px', borderRadius:'16px',
      background:'#007799',
      boxShadow:'4px 4px 0 rgba(0,0,0,0.18), inset 0 0 0 1px rgba(255,255,255,0.55)',
      zIndex:'999999', cursor:'grab', userSelect:'none',
      overflow:'hidden', display:'flex', flexDirection:'column',
      alignItems:'center', justifyContent:'center', gap:'2px',
      transition:'box-shadow 0.1s',
    });
    const glass = document.createElement('div');
    Object.assign(glass.style, {
      position:'absolute', inset:'0',
      background:'rgba(255,255,255,0.28)', backdropFilter:'blur(14px)',
      borderRadius:'16px', border:'1px solid rgba(255,255,255,0.55)', pointerEvents:'none',
    });
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 36 36');
    svg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;transform:rotate(-90deg);';
    svg.innerHTML = `
      <circle cx="18" cy="18" r="14" fill="none" stroke="rgba(255,255,255,0.15)" stroke-width="2.5"/>
      <circle id="adhd-ring" cx="18" cy="18" r="14" fill="none" stroke="#fff" stroke-width="2.5"
        stroke-dasharray="87.96" stroke-dashoffset="87.96" stroke-linecap="round"
        style="transition:stroke-dashoffset 0.2s ease"/>
    `;
    const pctEl = document.createElement('div');
    pctEl.id = 'adhd-pct';
    Object.assign(pctEl.style, {
      position:'relative', zIndex:'1',
      fontFamily:"'DM Mono',monospace", fontSize:'11px', fontWeight:'500',
      color:'#fff', letterSpacing:'-0.02em', lineHeight:'1',
    });
    pctEl.textContent = '0%';
    const lblEl = document.createElement('div');
    Object.assign(lblEl.style, {
      position:'relative', zIndex:'1', fontSize:'9px',
      color:'rgba(255,255,255,0.6)', letterSpacing:'0.06em',
      fontFamily:'system-ui,sans-serif', marginTop:'1px',
    });
    lblEl.textContent = 'READ';
    floatWidget.appendChild(glass); floatWidget.appendChild(svg);
    floatWidget.appendChild(pctEl); floatWidget.appendChild(lblEl);
    let drag = false, ox = 0, oy = 0;
    floatWidget.addEventListener('mousedown', e => {
      drag = true; ox = e.offsetX; oy = e.offsetY;
      floatWidget.style.cursor = 'grabbing';
      floatWidget.style.transition = 'none';
      e.preventDefault();
    });
    document.addEventListener('mousemove', e => {
      if (!drag || !floatWidget) return;
      floatWidget.style.right = floatWidget.style.bottom = 'auto';
      floatWidget.style.left = (e.clientX - ox) + 'px';
      floatWidget.style.top  = (e.clientY - oy) + 'px';
    });
    document.addEventListener('mouseup', () => {
      if (!drag) return;
      drag = false;
      if (floatWidget) { floatWidget.style.cursor = 'grab'; floatWidget.style.transition = 'box-shadow 0.1s'; }
    });
    document.body.appendChild(floatWidget);
    updateProgress();
  }
  function removeFloatWidget() { if (floatWidget) { floatWidget.remove(); floatWidget = null; } }

  // ══ 7. FOCUS REWARD ══════════════════════════
  const REWARD_MESSAGES = {
    zh: [
      { emoji:'🎉', text:'专注 10 分钟！继续！' },
      { emoji:'⚡', text:'棒极了！又 10 分钟！' },
      { emoji:'🔥', text:'你在燃烧！不可思议！' },
      { emoji:'🏆', text:'40 分钟专注！传奇！' },
      { emoji:'🌟', text:'你就是超级英雄！' },
    ],
    en: [
      { emoji:'🎉', text:'10 minutes focused! Keep going!' },
      { emoji:'⚡', text:'Amazing! Another 10 minutes!' },
      { emoji:'🔥', text:"You're on fire! Incredible!" },
      { emoji:'🏆', text:'40 min focus streak! Legend!' },
      { emoji:'🌟', text:'You are a superhero!' },
    ],
  };

  function startRewardTimer() {
    stopRewardTimer();
    rewardMins = 0;
    rewardTimer = setInterval(() => {
      rewardMins++;
      if (rewardMins % 10 === 0) {
        const lang = S.lang || 'zh';
        const msgs = REWARD_MESSAGES[lang];
        const msg  = msgs[Math.min(Math.floor(rewardMins / 10) - 1, msgs.length - 1)];
        showReward(msg.emoji, msg.text);
      }
    }, 60000);
  }

  function stopRewardTimer() {
    if (rewardTimer) { clearInterval(rewardTimer); rewardTimer = null; }
    if (rewardToast) { rewardToast.remove(); rewardToast = null; }
    rewardMins = 0;
  }

  function showReward(emoji, text) {
    if (rewardToast) rewardToast.remove();
    rewardToast = document.createElement('div');
    rewardToast.id = 'adhd-reward';
    Object.assign(rewardToast.style, {
      position:'fixed', bottom:'100px', left:'50%',
      transform:'translateX(-50%) translateY(20px)',
      background:'#1a1612', color:'#f0ece4',
      borderRadius:'16px', padding:'14px 24px',
      fontFamily:"'Syne',system-ui,sans-serif", fontWeight:'800',
      fontSize:'15px', letterSpacing:'-0.02em',
      boxShadow:'4px 4px 0 rgba(0,0,0,0.25), inset 0 0 0 1px rgba(255,255,255,0.1)',
      zIndex:'9999999', display:'flex', alignItems:'center', gap:'10px',
      opacity:'0', transition:'opacity 0.2s, transform 0.2s',
      pointerEvents:'none',
    });
    const emojiEl = document.createElement('span');
    emojiEl.style.cssText = 'font-size:22px;line-height:1;';
    emojiEl.textContent = emoji;
    const textEl = document.createElement('span');
    textEl.textContent = text;
    rewardToast.appendChild(emojiEl);
    rewardToast.appendChild(textEl);
    document.body.appendChild(rewardToast);
    requestAnimationFrame(() => {
      rewardToast.style.opacity = '1';
      rewardToast.style.transform = 'translateX(-50%) translateY(0)';
    });
    setTimeout(() => {
      if (!rewardToast) return;
      rewardToast.style.opacity = '0';
      rewardToast.style.transform = 'translateX(-50%) translateY(10px)';
      setTimeout(() => { if (rewardToast) { rewardToast.remove(); rewardToast = null; } }, 250);
    }, 3500);
  }

  // ══ 8. FONT SWITCH ═══════════════════════════
  const FONT_DEFS = {
    default:  { gfont: null, face: null, stack: 'inherit' },
    nunito:   { gfont: 'https://fonts.googleapis.com/css2?family=Nunito:wght@400;500;700&display=swap', face: null, stack: "'Nunito','Varela Round',sans-serif" },
    atkinson: { gfont: 'https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:wght@400;700&display=swap', face: null, stack: "'Atkinson Hyperlegible',sans-serif" },
    iawriter: { gfont: 'https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&display=swap', face: null, stack: "'IBM Plex Mono','Courier New',monospace" },
    dyslexic: {
      gfont: null,
      face: "@font-face{font-family:'OpenDyslexic';src:url('https://cdn.jsdelivr.net/gh/antijingoist/opendyslexic@master/compiled/OpenDyslexic-Regular.otf')format('opentype');font-weight:400;}@font-face{font-family:'OpenDyslexic';src:url('https://cdn.jsdelivr.net/gh/antijingoist/opendyslexic@master/compiled/OpenDyslexic-Bold.otf')format('opentype');font-weight:700;}",
      stack: "'OpenDyslexic','Comic Sans MS',cursive",
    },
  };

  function applyFont() {
    const oldLink = document.getElementById('lockin-font-link');
    if (oldLink) oldLink.remove();
    if (fontStyleEl) { fontStyleEl.remove(); fontStyleEl = null; }
    if (!S.fontSwitch || S.fontChoice === 'default') return;
    const def = FONT_DEFS[S.fontChoice] || FONT_DEFS.default;
    if (def.gfont) {
      const link = document.createElement('link');
      link.id = 'lockin-font-link';
      link.rel = 'stylesheet';
      link.href = def.gfont;
      document.head.appendChild(link);
    }
    fontStyleEl = document.createElement('style');
    fontStyleEl.id = 'lockin-font';
    fontStyleEl.textContent = (def.face || '') + `
      *:not(script):not(style):not(head):not(noscript):not(svg):not(path):not(#lockin-font-link) {
        font-family: ${def.stack} !important;
      }
    `;
    document.head.appendChild(fontStyleEl);
  }

  function removeFont() {
    const oldLink = document.getElementById('lockin-font-link');
    if (oldLink) oldLink.remove();
    if (fontStyleEl) { fontStyleEl.remove(); fontStyleEl = null; }
  }

  // ══ PROGRESS ═════════════════════════════════
  function getProgress() {
    const d = document.documentElement;
    const scrolled = d.scrollTop || document.body.scrollTop;
    const total = d.scrollHeight - d.clientHeight;
    return total > 0 ? Math.round(scrolled / total * 100) : 0;
  }

  function updateProgress() {
    const pct = getProgress();
    if (progressBar) progressBar.style.width = pct + '%';
    if (floatWidget) {
      const ring  = document.getElementById('adhd-ring');
      const label = document.getElementById('adhd-pct');
      if (ring)  ring.style.strokeDashoffset = (87.96 * (1 - pct / 100)).toFixed(1);
      if (label) label.textContent = pct + '%';
    }
  }

  function onScroll() { updateProgress(); }

})();
