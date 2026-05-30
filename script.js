/**
 * READER-BOT — script.js  v4 (MVP Polish)
 *
 * Modules:
 *   1.  ThemeManager       — dark/light/sepia + localStorage
 *   2.  UIState            — hero / loading / reader transitions
 *   3.  Uploader           — drag-drop + click, file validation
 *   4.  Parsers            — TXT, PDF (pdf.js), DOCX (mammoth.js)
 *   5.  Reader             — inject content, word count
 *   6.  Toast              — non-blocking notifications
 *   7.  SettingsPanel      — settings drawer + font size + toggles
 *   8.  HistoryManager     — search history via localStorage
 *   9.  HistoryPanel       — sidebar showing recent lookups
 *   10. ReadingProgress    — scroll-based progress bar
 *   11. DictionaryAPI      — Free Dictionary → Datamuse → Urban fallback
 *   12. AssistantPopup     — floating popup, draggable, copy, TTS, positioning
 *   13. SelectionDetect    — double-click, double-tap, text highlight
 *   14. init               — wires everything up
 */

'use strict';

/* ── Selectors ── */
const $ = (id) => document.getElementById(id);

const DOM = {
  html:               document.documentElement,
  body:               document.body,
  themeToggle:        $('themeToggle'),
  settingsBtn:        $('settingsBtn'),
  settingsPanel:      $('settingsPanel'),
  settingsOverlay:    $('settingsOverlay'),
  settingsClose:      $('settingsClose'),
  historyBtn:         $('historyBtn'),
  historyPanel:       $('historyPanel'),
  historyOverlay:     $('historyOverlay'),
  historyClose:       $('historyClose'),
  historyBody:        $('historyBody'),
  clearHistoryBtn:    $('clearHistoryBtn'),
  navUploadBtn:       $('navUploadBtn'),
  logoHome:           $('logoHome'),
  fileInput:          $('fileInput'),
  dropzone:           $('dropzone'),
  heroSection:        $('heroSection'),
  loadingState:       $('loadingState'),
  readerSection:      $('readerSection'),
  readerContent:      $('readerContent'),
  readerFileName:     $('readerFileName'),
  readerWordCount:    $('readerWordCount'),
  changeDocBtn:       $('changeDocBtn'),
  toast:              $('toast'),
  toastMessage:       $('toastMessage'),
  assistantPopup:     $('assistantPopup'),
  assistantTerm:      $('assistantTerm'),
  assistantBody:      $('assistantBody'),
  assistantClose:     $('assistantClose'),
  assistantSpeak:     $('assistantSpeak'),
  assistantCopy:      $('assistantCopy'),
  assistantArrow:     $('assistantArrow'),
  assistantDragHandle:$('assistantDragHandle'),
  assistantToggle:    $('assistantToggle'),
  pronunciationToggle:$('pronunciationToggle'),
  examplesToggle:     $('examplesToggle'),
  autoSpeakToggle:    $('autoSpeakToggle'),
  progressToggle:     $('progressToggle'),
  readingProgress:    $('readingProgress'),
  readingProgressBar: $('readingProgressBar'),
  dictPanel:          $('dictPanel'),
  dictTerm:           $('dictTerm'),
  dictBody:           $('dictBody'),
  dictSpeak:          $('dictSpeak'),
  dictCopy:           $('dictCopy'),
  dictClose:          $('dictClose'),
};

const ACCEPTED_TYPES = [
  'text/plain',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];
const ACCEPTED_EXTS = ['.txt', '.pdf', '.docx'];
const HISTORY_KEY   = 'readerbot-history';
const HISTORY_MAX   = 50;


/* ════════════════════════════════════
   1. THEME MANAGER
════════════════════════════════════ */
const ThemeManager = (() => {
  const KEY = 'readerbot-theme';
  const THEMES = ['light', 'dark', 'sepia'];

  function apply(theme) {
    if (!THEMES.includes(theme)) theme = 'light';
    DOM.html.setAttribute('data-theme', theme);
    try { localStorage.setItem(KEY, theme); } catch (_) {}
    document.querySelectorAll('.theme-option').forEach(btn => {
      btn.classList.toggle('is-active', btn.dataset.themeChoice === theme);
    });
    const isDark = theme === 'dark';
    DOM.themeToggle.querySelector('.icon-moon').style.display = isDark ? 'none'  : 'block';
    DOM.themeToggle.querySelector('.icon-sun').style.display  = isDark ? 'block' : 'none';
  }

  function detect() {
    try {
      const saved = localStorage.getItem(KEY);
      if (THEMES.includes(saved)) return saved;
    } catch (_) {}
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function toggle() {
    const current = DOM.html.getAttribute('data-theme') || 'light';
    apply(current === 'dark' ? 'light' : 'dark');
  }

  function init() {
    apply(detect());
    DOM.themeToggle.addEventListener('click', toggle);
    document.querySelectorAll('.theme-option').forEach(btn => {
      btn.addEventListener('click', () => apply(btn.dataset.themeChoice));
    });
  }

  return { init, apply };
})();


/* ════════════════════════════════════
   2. UI STATE
════════════════════════════════════ */
const UIState = (() => {
  function showHero() {
    DOM.heroSection.hidden   = false;
    DOM.loadingState.hidden  = true;
    DOM.readerSection.hidden = true;
    DOM.readingProgress.classList.remove('is-visible');
    AssistantPopup.hide();
  }

  function showLoading() {
    DOM.heroSection.hidden   = true;
    DOM.loadingState.hidden  = false;
    DOM.readerSection.hidden = true;
    DOM.readingProgress.classList.remove('is-visible');
    AssistantPopup.hide();
  }

  function showReader() {
    DOM.heroSection.hidden   = true;
    DOM.loadingState.hidden  = true;
    DOM.readerSection.hidden = false;
    window.scrollTo({ top: 0, behavior: 'smooth' });
    // Show progress bar if enabled
    if (DOM.progressToggle?.checked !== false) {
      DOM.readingProgress.classList.add('is-visible');
    }
  }

  return { showHero, showLoading, showReader };
})();


/* ════════════════════════════════════
   3. UPLOADER
════════════════════════════════════ */
const Uploader = (() => {

  function isAccepted(file) {
    const ext = '.' + file.name.split('.').pop().toLowerCase();
    return ACCEPTED_TYPES.includes(file.type) || ACCEPTED_EXTS.includes(ext);
  }

  async function handleFile(file) {
    if (!file) return;
    if (!isAccepted(file)) {
      Toast.show('Unsupported file type. Please upload a PDF, DOCX, or TXT file.');
      return;
    }
    UIState.showLoading();
    try {
      const ext = file.name.split('.').pop().toLowerCase();
      let html = '';
      if      (ext === 'txt')  html = await Parsers.parseTxt(file);
      else if (ext === 'pdf')  html = await Parsers.parsePdf(file);
      else if (ext === 'docx') html = await Parsers.parseDocx(file);

      if (!html || !html.trim()) throw new Error('The document appears to be empty or could not be read.');

      Reader.render(html, file.name);
      UIState.showReader();
    } catch (err) {
      console.error('[ReaderBot] Parse error:', err);
      Toast.show(err.message || 'Failed to read the document. Please try another file.');
      UIState.showHero();
    }
  }

  function init() {
    DOM.navUploadBtn.addEventListener('click', () => DOM.fileInput.click());
    DOM.dropzone.addEventListener('click',     () => DOM.fileInput.click());
    DOM.dropzone.addEventListener('keydown',   (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); DOM.fileInput.click(); }
    });
    DOM.fileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) handleFile(file);
      DOM.fileInput.value = '';
    });
    DOM.changeDocBtn.addEventListener('click', () => {
      UIState.showHero();
      DOM.readerContent.innerHTML = '';
      DOM.fileInput.click();
    });
    DOM.logoHome?.addEventListener('click', (e) => {
      if (!DOM.readerSection.hidden) {
        e.preventDefault();
        UIState.showHero();
        DOM.readerContent.innerHTML = '';
      }
    });

    DOM.dropzone.addEventListener('dragover',  (e) => { e.preventDefault(); DOM.dropzone.classList.add('is-dragging'); });
    DOM.dropzone.addEventListener('dragleave', (e) => {
      if (!DOM.dropzone.contains(e.relatedTarget)) DOM.dropzone.classList.remove('is-dragging');
    });
    DOM.dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      DOM.dropzone.classList.remove('is-dragging');
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    });
    document.addEventListener('dragover', (e) => { if (!DOM.heroSection.hidden) e.preventDefault(); });
    document.addEventListener('drop', (e) => {
      if (!DOM.heroSection.hidden) {
        e.preventDefault();
        const file = e.dataTransfer.files[0];
        if (file) handleFile(file);
      }
    });
  }

  return { init };
})();


/* ════════════════════════════════════
   4. PARSERS
════════════════════════════════════ */
const Parsers = (() => {

  function esc(str) {
    return str
      .replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
  }

  function parseTxt(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload  = (e) => {
        const text = e.target.result || '';
        const paras = text.split(/\n{2,}/)
          .map(p => p.replace(/\n/g,' ').trim())
          .filter(Boolean)
          .map(p => `<p>${esc(p)}</p>`);
        resolve(paras.join('\n') || `<p>${esc(text)}</p>`);
      };
      reader.onerror = () => reject(new Error('Could not read the text file.'));
      reader.readAsText(file, 'UTF-8');
    });
  }

  async function parsePdf(file) {
    if (typeof pdfjsLib === 'undefined') throw new Error('PDF.js failed to load. Please check your internet connection.');
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    const buf  = await file.arrayBuffer();
    const pdf  = await pdfjsLib.getDocument({ data: buf }).promise;
    const parts = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      const page    = await pdf.getPage(p);
      const content = await page.getTextContent();
      let text = '', lastY = null;
      for (const item of content.items) {
        if (lastY !== null && Math.abs(item.transform[5] - lastY) > 5) text += '\n';
        text += item.str;
        lastY = item.transform[5];
      }
      text.split(/\n{2,}/)
        .map(s => s.replace(/\n/g,' ').trim())
        .filter(Boolean)
        .forEach(para => parts.push(`<p>${esc(para)}</p>`));
      if (p < pdf.numPages) parts.push('<hr />');
    }
    return parts.join('\n');
  }

  async function parseDocx(file) {
    if (typeof mammoth === 'undefined') throw new Error('Mammoth.js failed to load. Please check your internet connection.');
    const buf    = await file.arrayBuffer();
    const result = await mammoth.convertToHtml({ arrayBuffer: buf });
    if (result.messages?.length) console.warn('[ReaderBot] Mammoth:', result.messages);
    return result.value || '';
  }

  return { parseTxt, parsePdf, parseDocx };
})();


/* ════════════════════════════════════
   5. READER RENDERER
════════════════════════════════════ */
const Reader = (() => {

  function wordCount(text) { return text.trim().split(/\s+/).filter(Boolean).length; }

  function formatWC(n) {
    if (!n) return '';
    const mins = Math.max(1, Math.round(n / 200));
    return `${n.toLocaleString()} words · ${mins} min read`;
  }

  function render(html, fileName) {
    DOM.readerContent.innerHTML = html;
    DOM.readerFileName.textContent = fileName;
    const wc = wordCount(DOM.readerContent.innerText || DOM.readerContent.textContent || '');
    DOM.readerWordCount.textContent = formatWC(wc);
    // Reset scroll-linked stuff
    ReadingProgress.reset();
  }

  return { render };
})();


/* ════════════════════════════════════
   6. TOAST
════════════════════════════════════ */
const Toast = (() => {
  let timer = null;

  function show(msg, type = 'error', duration = 4500) {
    if (timer) clearTimeout(timer);
    DOM.toastMessage.textContent = msg;
    DOM.toast.hidden = false;
    DOM.toast.classList.remove('toast--success');
    if (type === 'success') DOM.toast.classList.add('toast--success');
    requestAnimationFrame(() => requestAnimationFrame(() => DOM.toast.classList.add('is-visible')));
    timer = setTimeout(hide, duration);
  }

  function hide() {
    DOM.toast.classList.remove('is-visible');
    setTimeout(() => { DOM.toast.hidden = true; }, 400);
  }

  return { show, hide };
})();


/* ════════════════════════════════════
   7. SETTINGS PANEL
════════════════════════════════════ */
const SettingsPanel = (() => {
  const FONT_KEY = 'readerbot-fontsize';
  let isOpen = false;

  function open() {
    isOpen = true;
    DOM.settingsPanel.hidden = false;
    DOM.settingsOverlay.classList.add('is-open');
    requestAnimationFrame(() => requestAnimationFrame(() => {
      DOM.settingsPanel.classList.add('is-open');
    }));
    DOM.settingsPanel.removeAttribute('aria-hidden');
    DOM.settingsClose.focus();
  }

  function close() {
    isOpen = false;
    DOM.settingsPanel.classList.remove('is-open');
    DOM.settingsOverlay.classList.remove('is-open');
    setTimeout(() => {
      DOM.settingsPanel.hidden = true;
      DOM.settingsPanel.setAttribute('aria-hidden', 'true');
    }, 320);
  }

  function applyFontSize(size) {
    DOM.body.dataset.fontSize = size;
    try { localStorage.setItem(FONT_KEY, size); } catch (_) {}
    document.querySelectorAll('.font-size-btn').forEach(btn => {
      btn.classList.toggle('btn--active', btn.dataset.size === size);
    });
  }

  function loadPreferences() {
    // Font size
    const savedSize = (() => { try { return localStorage.getItem(FONT_KEY) || 'medium'; } catch (_) { return 'medium'; } })();
    applyFontSize(savedSize);

    // Toggles
    const prefs = (() => { try { return JSON.parse(localStorage.getItem('readerbot-prefs') || '{}'); } catch (_) { return {}; } })();
    if (DOM.pronunciationToggle)  DOM.pronunciationToggle.checked  = prefs.pronunciation  !== false;
    if (DOM.examplesToggle)       DOM.examplesToggle.checked       = prefs.examples        !== false;
    if (DOM.assistantToggle)      DOM.assistantToggle.checked      = prefs.assistant       !== false;
    if (DOM.autoSpeakToggle)      DOM.autoSpeakToggle.checked      = prefs.autoSpeak       === true;
    if (DOM.progressToggle)       DOM.progressToggle.checked       = prefs.progress        !== false;
  }

  function savePref(key, value) {
    try {
      const prefs = JSON.parse(localStorage.getItem('readerbot-prefs') || '{}');
      prefs[key] = value;
      localStorage.setItem('readerbot-prefs', JSON.stringify(prefs));
    } catch (_) {}
  }

  function init() {
    DOM.settingsBtn.addEventListener('click', () => isOpen ? close() : open());
    DOM.settingsClose.addEventListener('click', close);
    DOM.settingsOverlay.addEventListener('click', close);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && isOpen) close(); });

    // Font size buttons
    loadPreferences();
    document.querySelectorAll('.font-size-btn').forEach(btn => {
      btn.addEventListener('click', () => applyFontSize(btn.dataset.size));
    });

    // Save toggle preferences
    DOM.pronunciationToggle?.addEventListener('change',  (e) => savePref('pronunciation', e.target.checked));
    DOM.examplesToggle?.addEventListener('change',       (e) => savePref('examples',      e.target.checked));
    DOM.assistantToggle?.addEventListener('change',      (e) => savePref('assistant',     e.target.checked));
    DOM.autoSpeakToggle?.addEventListener('change',      (e) => savePref('autoSpeak',     e.target.checked));
    DOM.progressToggle?.addEventListener('change', (e) => {
      savePref('progress', e.target.checked);
      if (!DOM.readerSection.hidden) {
        DOM.readingProgress.classList.toggle('is-visible', e.target.checked);
      }
    });

    // Clear history button in settings
    DOM.clearHistoryBtn?.addEventListener('click', () => {
      HistoryManager.clear();
      HistoryPanel.render();
      Toast.show('Search history cleared.', 'success', 2500);
    });
  }

  return { init, open, close };
})();


/* ════════════════════════════════════
   8. HISTORY MANAGER
════════════════════════════════════ */
const HistoryManager = (() => {

  function load() {
    try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); } catch (_) { return []; }
  }

  function save(items) {
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(items)); } catch (_) {}
  }

  function add(word, def, source) {
    const items = load();
    // Remove duplicate
    const filtered = items.filter(i => i.word.toLowerCase() !== word.toLowerCase());
    filtered.unshift({
      word,
      def: (def || '').slice(0, 120),
      source: source || '',
      ts: Date.now(),
    });
    save(filtered.slice(0, HISTORY_MAX));
    // Update badge
    updateBadge();
    // Re-render if panel is open
    if (DOM.historyPanel.classList.contains('is-open')) {
      HistoryPanel.render();
    }
  }

  function clear() {
    save([]);
    updateBadge();
  }

  function updateBadge() {
    const items = load();
    DOM.historyBtn?.classList.toggle('has-badge', items.length > 0);
  }

  function getAll() { return load(); }

  function formatTs(ts) {
    const now = Date.now();
    const diff = now - ts;
    if (diff < 60_000)  return 'just now';
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
    return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  return { add, clear, getAll, updateBadge, formatTs };
})();


/* ════════════════════════════════════
   9. HISTORY PANEL
════════════════════════════════════ */
const HistoryPanel = (() => {
  let isOpen = false;

  function open() {
    isOpen = true;
    DOM.historyPanel.hidden = false;
    DOM.historyOverlay.classList.add('is-open');
    requestAnimationFrame(() => requestAnimationFrame(() => {
      DOM.historyPanel.classList.add('is-open');
    }));
    DOM.historyPanel.removeAttribute('aria-hidden');
    render();
    DOM.historyClose.focus();
  }

  function close() {
    isOpen = false;
    DOM.historyPanel.classList.remove('is-open');
    DOM.historyOverlay.classList.remove('is-open');
    setTimeout(() => {
      DOM.historyPanel.hidden = true;
      DOM.historyPanel.setAttribute('aria-hidden', 'true');
    }, 320);
  }

  function render() {
    const items = HistoryManager.getAll();
    if (!items.length) {
      DOM.historyBody.innerHTML = `
        <div class="history-empty">
          <div class="history-empty__icon" aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 8v4l3 3"/><circle cx="12" cy="12" r="9"/>
            </svg>
          </div>
          <p>No recent lookups yet.<br/>Double-tap or highlight a word to start.</p>
        </div>`;
      return;
    }

    let html = '<div class="history-section-label">Recent Lookups</div>';
    items.forEach((item, idx) => {
      const type = item.word.includes(' ') ? 'phrase' : 'word';
      html += `
        <div class="history-item" role="button" tabindex="0" data-word="${escHtml(item.word)}" style="animation-delay:${idx * 30}ms" aria-label="Look up ${escHtml(item.word)}">
          <div class="history-item__content">
            <div class="history-item__word">${escHtml(item.word)}</div>
            <div class="history-item__meta">${escHtml(item.def || '')}${item.source ? ` · ${escHtml(item.source)}` : ''} · ${HistoryManager.formatTs(item.ts)}</div>
          </div>
          <span class="history-item__type">${type}</span>
        </div>`;
    });

    html += `<div class="history-clear">
      <button class="btn btn--ghost btn--sm" id="historyClearInline" style="width:100%;justify-content:center;" aria-label="Clear all history">
        Clear all history
      </button>
    </div>`;

    DOM.historyBody.innerHTML = html;

    // Click/keydown on history items
    DOM.historyBody.querySelectorAll('.history-item').forEach(el => {
      const handler = () => {
        const word = el.dataset.word;
        if (!word) return;
        close();
        DictPanel.show(word);
      };
      el.addEventListener('click', handler);
      el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handler(); } });
    });

    $('historyClearInline')?.addEventListener('click', () => {
      HistoryManager.clear();
      render();
      Toast.show('Search history cleared.', 'success', 2500);
    });
  }

  function init() {
    DOM.historyBtn.addEventListener('click', () => isOpen ? close() : open());
    DOM.historyClose.addEventListener('click', close);
    DOM.historyOverlay.addEventListener('click', close);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && isOpen) close(); });
    HistoryManager.updateBadge();
  }

  return { init, open, close, render };
})();


/* ════════════════════════════════════
   10. READING PROGRESS
════════════════════════════════════ */
const ReadingProgress = (() => {
  let rafId = null;

  function update() {
    if (DOM.readerSection.hidden) return;
    const docH  = document.documentElement.scrollHeight - window.innerHeight;
    const scrolled = window.scrollY;
    const pct = docH > 0 ? Math.min(100, (scrolled / docH) * 100) : 0;
    DOM.readingProgressBar.style.width = `${pct}%`;
  }

  function reset() {
    DOM.readingProgressBar.style.width = '0%';
  }

  function init() {
    window.addEventListener('scroll', () => {
      if (rafId) return;
      rafId = requestAnimationFrame(() => {
        update();
        rafId = null;
      });
    }, { passive: true });
  }

  return { init, reset };
})();


/* ════════════════════════════════════
   11. DICTIONARY API
════════════════════════════════════ */
const DictionaryAPI = (() => {
  const TIMEOUT = 6000;

  async function fetchWithTimeout(url) {
    const ctrl = new AbortController();
    const tid  = setTimeout(() => ctrl.abort(), TIMEOUT);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      clearTimeout(tid);
      return res;
    } catch (e) {
      clearTimeout(tid);
      throw e;
    }
  }

  async function freeDictionary(word) {
    const res = await fetchWithTimeout(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`);
    if (!res.ok) return null;
    const data = await res.json();
    if (!Array.isArray(data) || !data.length) return null;

    const entry    = data[0];
    const phonetic = entry.phonetics?.find(p => p.text)?.text || '';
    const audioUrl = entry.phonetics?.find(p => p.audio)?.audio || '';
    const showExamples = DOM.examplesToggle?.checked !== false;
    const showPhonetic = DOM.pronunciationToggle?.checked !== false;

    const meanings = (entry.meanings || []).slice(0, 3).map(m => {
      const defs = m.definitions.slice(0, 2);
      return {
        pos: m.partOfSpeech,
        definitions: defs.map(d => ({
          text: d.definition,
          example: showExamples ? (d.example || '') : '',
        })),
        synonyms: (m.synonyms || []).slice(0, 5),
      };
    });

    return {
      source: 'Free Dictionary',
      phonetic: showPhonetic ? phonetic : '',
      audioUrl,
      meanings,
      isPhrase: false,
    };
  }

  async function datamuse(query) {
    const isPhrase = query.trim().includes(' ');
    const endpoint = isPhrase
      ? `https://api.datamuse.com/words?ml=${encodeURIComponent(query)}&max=5`
      : `https://api.datamuse.com/words?sp=${encodeURIComponent(query)}&md=d&max=3`;

    const res = await fetchWithTimeout(endpoint);
    if (!res.ok) return null;
    const data = await res.json();
    if (!Array.isArray(data) || !data.length) return null;

    if (isPhrase) {
      const words = data.slice(0, 5).map(w => w.word);
      return {
        source: 'Datamuse',
        phonetic: '',
        audioUrl: '',
        meanings: [{
          pos: 'related words',
          definitions: [{ text: `Words and concepts related to "${query}": ${words.join(', ')}.`, example: '' }],
          synonyms: [],
        }],
        isPhrase: true,
        phraseNote: `"${query}" is a multi-word phrase. Showing related concepts.`,
      };
    }

    const defs = data.flatMap(w => (w.defs || []).slice(0, 2).map(d => {
      const [pos, ...rest] = d.split('\t');
      return { pos, text: rest.join(' ') };
    })).slice(0, 4);

    if (!defs.length) return null;

    const grouped = {};
    defs.forEach(d => {
      if (!grouped[d.pos]) grouped[d.pos] = [];
      grouped[d.pos].push({ text: d.text, example: '' });
    });

    return {
      source: 'Datamuse',
      phonetic: '',
      audioUrl: '',
      meanings: Object.entries(grouped).map(([pos, definitions]) => ({ pos, definitions, synonyms: [] })),
      isPhrase: false,
    };
  }

  async function urban(query) {
    try {
      const res = await fetchWithTimeout(`https://api.urbandictionary.com/v0/define?term=${encodeURIComponent(query)}`);
      if (!res.ok) return null;
      const data = await res.json();
      if (!data.list?.length) return null;

      const entry = data.list[0];
      const def   = (entry.definition || '').replace(/\[|\]/g, '').slice(0, 300);
      const ex    = (entry.example    || '').replace(/\[|\]/g, '').slice(0, 200);
      const showExamples = DOM.examplesToggle?.checked !== false;

      return {
        source: 'Urban Dictionary',
        phonetic: '',
        audioUrl: '',
        meanings: [{
          pos: 'informal / slang',
          definitions: [{ text: def, example: showExamples ? ex : '' }],
          synonyms: [],
        }],
        isPhrase: query.trim().includes(' '),
        phraseNote: query.trim().includes(' ') ? 'Idiom or informal phrase.' : '',
      };
    } catch { return null; }
  }

  async function lookup(query) {
    const word  = query.trim();
    const multi = word.includes(' ');

    if (!multi) {
      const r1 = await freeDictionary(word).catch(() => null);
      if (r1) return r1;
      const r2 = await datamuse(word).catch(() => null);
      if (r2) return r2;
      const r3 = await urban(word).catch(() => null);
      if (r3) return r3;
    } else {
      const r1 = await datamuse(word).catch(() => null);
      if (r1) return r1;
      const r2 = await urban(word).catch(() => null);
      if (r2) return r2;
    }

    return null;
  }

  return { lookup };
})();


/* ════════════════════════════════════
   12a. DICTIONARY SIDE PANEL
════════════════════════════════════ */
const DictPanel = (() => {
  let isOpen = false;
  let currentAudioUrl   = '';
  let currentDefinition = '';
  let currentTerm       = '';

  function escHtml(str) {
    return (str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function open() {
    if (!DOM.dictPanel) return;
    isOpen = true;
    DOM.dictPanel.hidden = false;
    DOM.body.classList.add('dict-open');
    requestAnimationFrame(() => requestAnimationFrame(() => {
      DOM.dictPanel.classList.add('is-open');
    }));
  }

  function close() {
    if (!DOM.dictPanel) return;
    isOpen = false;
    DOM.dictPanel.classList.remove('is-open');
    DOM.body.classList.remove('dict-open');
    setTimeout(() => { if (!isOpen) DOM.dictPanel.hidden = true; }, 320);
  }

  function renderLoading(term) {
    DOM.dictTerm.textContent = term;
    if (DOM.dictSpeak) DOM.dictSpeak.style.display = 'none';
    if (DOM.dictCopy)  DOM.dictCopy.style.display  = 'none';
    DOM.dictBody.innerHTML = `
      <div class="popup-loading" style="margin-top:16px">
        <div class="popup-spin" aria-hidden="true"></div>
        <span>Looking up…</span>
      </div>
      <div class="popup-skeleton" style="margin-top:16px" aria-hidden="true">
        <div class="popup-skeleton__line"></div>
        <div class="popup-skeleton__line"></div>
        <div class="popup-skeleton__line"></div>
        <div class="popup-skeleton__line"></div>
      </div>`;
  }

  function renderResult(term, data) {
    DOM.dictTerm.textContent = term;
    currentAudioUrl = data.audioUrl || '';
    currentTerm     = term;

    const plainParts = [];
    data.meanings?.forEach(m => {
      if (m.pos) plainParts.push(`[${m.pos}]`);
      m.definitions?.forEach(d => {
        plainParts.push(d.text);
        if (d.example) plainParts.push(`  "${d.example}"`);
      });
    });
    currentDefinition = `${term}\n${data.phonetic ? data.phonetic + '\n' : ''}${plainParts.join('\n')}`;

    if (DOM.dictSpeak) DOM.dictSpeak.style.display = 'flex';
    if (DOM.dictCopy)  DOM.dictCopy.style.display  = 'flex';

    let html = '<div class="popup-result">';

    if (data.isPhrase && data.phraseNote) {
      html += `<div class="popup-result__phrase-note">${escHtml(data.phraseNote)}</div>`;
    }
    if (data.phonetic) {
      html += `<div class="popup-result__phonetic">${escHtml(data.phonetic)}</div>`;
    }
    html += `<div class="popup-result__type">${escHtml(data.source)}</div>`;
    html += `<div class="popup-result__meanings">`;

    data.meanings.forEach((m, mi) => {
      if (mi > 0) html += '<hr class="popup-result__divider" />';
      html += `<div class="popup-result__meaning">`;
      if (m.pos) html += `<span class="popup-result__pos">${escHtml(m.pos)}</span>`;
      m.definitions.forEach(d => {
        html += `<div class="popup-result__def">${escHtml(d.text)}</div>`;
        if (d.example) {
          html += `<div class="popup-result__example">"${escHtml(d.example)}"</div>`;
        }
      });
      if (m.synonyms?.length) {
        html += `<div class="popup-result__synonyms"><span class="popup-result__syn-label">Synonyms</span>`;
        m.synonyms.forEach(s => {
          html += `<span class="popup-syn-chip" data-word="${escHtml(s)}" role="button" tabindex="0">${escHtml(s)}</span>`;
        });
        html += `</div>`;
      }
      html += `</div>`;
    });

    html += '</div></div>';
    DOM.dictBody.innerHTML = html;

    DOM.dictBody.querySelectorAll('.popup-syn-chip').forEach(chip => {
      chip.addEventListener('click', () => { const w = chip.dataset.word; if (w) show(w, null); });
    });

    if (DOM.autoSpeakToggle?.checked) {
      if (currentAudioUrl) { new Audio(currentAudioUrl).play().catch(() => speakText(term)); }
      else { speakText(term); }
    }

    const firstDef = data.meanings?.[0]?.definitions?.[0]?.text || '';
    HistoryManager.add(term, firstDef, data.source);
  }

  function renderError(term, message) {
    DOM.dictTerm.textContent = term;
    if (DOM.dictSpeak) DOM.dictSpeak.style.display = 'none';
    if (DOM.dictCopy)  DOM.dictCopy.style.display  = 'none';
    DOM.dictBody.innerHTML = `
      <div class="popup-error" style="margin-top:24px">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
        <span>${escHtml(message)}</span>
      </div>`;
  }

  function speakText(text) {
    if (!text || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const utt = new SpeechSynthesisUtterance(text);
    utt.lang = 'en-US';
    if (DOM.dictSpeak) DOM.dictSpeak.classList.add('is-speaking');
    utt.onend = utt.onerror = () => { if (DOM.dictSpeak) DOM.dictSpeak.classList.remove('is-speaking'); };
    window.speechSynthesis.speak(utt);
  }

  function copyDefinition() {
    if (!currentDefinition) return;
    navigator.clipboard?.writeText(currentDefinition).then(() => {
      if (DOM.dictCopy) { DOM.dictCopy.classList.add('copied'); setTimeout(() => DOM.dictCopy.classList.remove('copied'), 2000); }
      Toast.show('Definition copied.', 'success', 2000);
    }).catch(() => {});
  }

  async function show(term) {
    if (!term || !term.trim()) return;
    open();
    renderLoading(term.trim());
    try {
      const data = await DictionaryAPI.lookup(term.trim());
      if (!data) renderError(term, `No definition found for "${term.slice(0, 30)}".`);
      else renderResult(term, data);
    } catch (err) {
      renderError(term, err.name === 'AbortError' || !navigator.onLine
        ? 'No internet connection. Please check your network.'
        : 'Could not fetch definition. Please try again.');
    }
  }

  function init() {
    if (!DOM.dictPanel) return;
    DOM.dictClose?.addEventListener('click', close);
    DOM.dictSpeak?.addEventListener('click', () => {
      if (currentAudioUrl) new Audio(currentAudioUrl).play().catch(() => speakText(currentTerm));
      else speakText(currentTerm);
    });
    DOM.dictCopy?.addEventListener('click', copyDefinition);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && isOpen) close(); });
  }

  return { init, show, close, isOpen: () => isOpen };
})();


/* ════════════════════════════════════
   12. ASSISTANT POPUP
════════════════════════════════════ */
const AssistantPopup = (() => {
  let visible = false;
  let currentAudioUrl   = '';
  let currentDefinition = '';
  let currentTerm       = '';

  /* ── Show / Hide ── */
  function show() {
    if (DOM.assistantPopup.hidden) DOM.assistantPopup.hidden = false;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      DOM.assistantPopup.classList.add('is-visible');
    }));
    visible = true;
  }

  function hide() {
    DOM.assistantPopup.classList.remove('is-visible');
    visible = false;
    currentAudioUrl   = '';
    currentDefinition = '';
    setTimeout(() => {
      if (!visible) DOM.assistantPopup.hidden = true;
    }, 250);
  }

  function isVisible() { return visible; }

  /* ── Position ── */
  function position(rect) {
    const popup   = DOM.assistantPopup;
    const pw      = 310;
    const margin  = 12;
    const vw      = window.innerWidth;
    const vh      = window.innerHeight;
    const scrollY = window.scrollY || document.documentElement.scrollTop;

    let left = rect.left + rect.width / 2 - pw / 2;
    left = Math.max(margin, Math.min(left, vw - pw - margin));

    const spaceAbove = rect.top;
    const spaceBelow = vh - rect.bottom;
    const POPUP_H    = 280;
    let top, arrowClass;

    if (spaceAbove >= POPUP_H + margin || spaceAbove >= spaceBelow) {
      top = rect.top + scrollY - POPUP_H - margin;
      arrowClass = 'assistant-popup--above';
    } else {
      top = rect.bottom + scrollY + margin;
      arrowClass = 'assistant-popup--below';
    }

    popup.style.left = `${left}px`;
    popup.style.top  = `${top}px`;
    popup.classList.remove('assistant-popup--above', 'assistant-popup--below');
    popup.classList.add(arrowClass);

    const arrowX = (rect.left + rect.width / 2) - left - 6;
    DOM.assistantArrow.style.left = `${Math.max(8, Math.min(arrowX, pw - 24))}px`;
  }

  /* ── Render: loading ── */
  function renderLoading(term) {
    DOM.assistantTerm.textContent = term;
    DOM.assistantBody.innerHTML = `
      <div class="popup-loading">
        <div class="popup-spin" aria-hidden="true"></div>
        <span>Looking up…</span>
      </div>
      <div class="popup-skeleton" aria-hidden="true">
        <div class="popup-skeleton__line"></div>
        <div class="popup-skeleton__line"></div>
        <div class="popup-skeleton__line"></div>
        <div class="popup-skeleton__line"></div>
      </div>`;
    DOM.assistantSpeak.style.display = 'none';
    DOM.assistantCopy.style.display  = 'none';
  }

  /* ── Render: result ── */
  function renderResult(term, data) {
    DOM.assistantTerm.textContent = term;
    currentAudioUrl = data.audioUrl || '';
    currentTerm     = term;

    // Build plain-text definition for copy
    const plainParts = [];
    data.meanings?.forEach(m => {
      if (m.pos) plainParts.push(`[${m.pos}]`);
      m.definitions?.forEach(d => {
        plainParts.push(d.text);
        if (d.example) plainParts.push(`  "${d.example}"`);
      });
    });
    currentDefinition = `${term}\n${data.phonetic ? data.phonetic + '\n' : ''}${plainParts.join('\n')}`;

    DOM.assistantSpeak.style.display = 'flex';
    DOM.assistantCopy.style.display  = 'flex';

    let html = '<div class="popup-result">';

    if (data.isPhrase && data.phraseNote) {
      html += `<div class="popup-result__phrase-note">${escHtml(data.phraseNote)}</div>`;
    }

    if (data.phonetic) {
      html += `<div class="popup-result__phonetic">${escHtml(data.phonetic)}</div>`;
    }

    html += `<div class="popup-result__meanings">`;

    data.meanings.forEach((m, mi) => {
      if (mi > 0) html += '<hr class="popup-result__divider" />';
      html += `<div class="popup-result__meaning">`;
      if (m.pos) html += `<span class="popup-result__pos">${escHtml(m.pos)}</span>`;
      m.definitions.forEach(d => {
        html += `<div class="popup-result__def">${escHtml(d.text)}</div>`;
        if (d.example) {
          html += `<div class="popup-result__example">"${escHtml(d.example)}"</div>`;
        }
      });
      if (m.synonyms?.length) {
        html += `<div class="popup-result__synonyms">
          <span class="popup-result__syn-label">Synonyms</span>`;
        m.synonyms.forEach(s => {
          html += `<span class="popup-syn-chip" data-word="${escHtml(s)}" role="button" tabindex="0">${escHtml(s)}</span>`;
        });
        html += `</div>`;
      }
      html += `</div>`;
    });

    html += '</div>';
    html += `<div class="popup-result__source">via ${escHtml(data.source)}</div>`;
    html += '</div>';

    DOM.assistantBody.innerHTML = html;

    // Synonym chips
    DOM.assistantBody.querySelectorAll('.popup-syn-chip').forEach(chip => {
      const handler = () => {
        const w = chip.dataset.word;
        if (w) triggerLookup(w, getLastRect());
      };
      chip.addEventListener('click', handler);
      chip.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handler(); } });
    });

    // Auto-speak if enabled
    if (DOM.autoSpeakToggle?.checked) {
      if (currentAudioUrl) {
        new Audio(currentAudioUrl).play().catch(() => speakText(term));
      } else {
        speakText(term);
      }
    }

    // Save to history
    const firstDef = data.meanings?.[0]?.definitions?.[0]?.text || '';
    HistoryManager.add(term, firstDef, data.source);
  }

  /* ── Render: error ── */
  function renderError(term, message) {
    DOM.assistantTerm.textContent = term;
    DOM.assistantSpeak.style.display = 'none';
    DOM.assistantCopy.style.display  = 'none';
    DOM.assistantBody.innerHTML = `
      <div class="popup-error">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
        <span>${escHtml(message)}</span>
      </div>`;
  }

  function escHtml(str) {
    return (str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  let _lastRect = null;
  function getLastRect() { return _lastRect; }

  /* ── Main entry: look up selected text ── */
  async function triggerLookup(term, rect) {
    if (!term || !term.trim()) return;
    // Route to side dictionary panel instead of floating popup
    DictPanel.show(term.trim());
  }

  /* ── Copy to clipboard ── */
  function copyDefinition() {
    if (!currentDefinition) return;
    navigator.clipboard?.writeText(currentDefinition).then(() => {
      DOM.assistantCopy.classList.add('copied');
      DOM.assistantCopy.title = 'Copied!';
      setTimeout(() => {
        DOM.assistantCopy.classList.remove('copied');
        DOM.assistantCopy.title = 'Copy definition';
      }, 2000);
      Toast.show('Definition copied.', 'success', 2000);
    }).catch(() => {
      // Fallback
      const ta = document.createElement('textarea');
      ta.value = currentDefinition;
      ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0;';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); Toast.show('Definition copied.', 'success', 2000); } catch (_) {}
      document.body.removeChild(ta);
    });
  }

  /* ── Text-to-speech ── */
  function speakText(text) {
    if (!text || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const utt = new SpeechSynthesisUtterance(text);
    utt.lang = 'en-US';
    DOM.assistantSpeak.classList.add('is-speaking');
    utt.onend = utt.onerror = () => DOM.assistantSpeak.classList.remove('is-speaking');
    window.speechSynthesis.speak(utt);
  }

  /* ── Draggable popup ── */
  function initDraggable() {
    const popup  = DOM.assistantPopup;
    const handle = DOM.assistantDragHandle;
    let dragging = false, startX, startY, origLeft, origTop;

    function onPointerDown(e) {
      if (e.button !== 0 && e.type !== 'touchstart') return;
      dragging = true;
      handle.classList.add('is-dragging');
      const pt = e.touches ? e.touches[0] : e;
      startX = pt.clientX;
      startY = pt.clientY;
      const rect = popup.getBoundingClientRect();
      origLeft = rect.left;
      origTop  = rect.top + window.scrollY;
      popup.style.transition = 'none';
      e.preventDefault();
    }

    function onPointerMove(e) {
      if (!dragging) return;
      const pt = e.touches ? e.touches[0] : e;
      const dx = pt.clientX - startX;
      const dy = pt.clientY - startY;
      const newLeft = Math.max(8, Math.min(origLeft + dx, window.innerWidth  - popup.offsetWidth  - 8));
      const newTop  = Math.max(8, Math.min(origTop  + dy, window.scrollY + window.innerHeight - popup.offsetHeight - 8));
      popup.style.left = `${newLeft}px`;
      popup.style.top  = `${newTop}px`;
      DOM.assistantArrow.style.display = 'none';
    }

    function onPointerUp() {
      if (!dragging) return;
      dragging = false;
      handle.classList.remove('is-dragging');
      popup.style.transition = '';
    }

    handle.addEventListener('mousedown',  onPointerDown);
    handle.addEventListener('touchstart', onPointerDown, { passive: false });
    document.addEventListener('mousemove',  onPointerMove);
    document.addEventListener('touchmove',  onPointerMove, { passive: false });
    document.addEventListener('mouseup',  onPointerUp);
    document.addEventListener('touchend', onPointerUp);
  }

  function init() {
    DOM.assistantClose.addEventListener('click', (e) => {
      e.stopPropagation();
      hide();
    });

    // Speak button
    DOM.assistantSpeak.addEventListener('click', () => {
      if (currentAudioUrl) {
        const audio = new Audio(currentAudioUrl);
        audio.play().catch(() => speakText(currentTerm || DOM.assistantTerm.textContent));
      } else {
        speakText(currentTerm || DOM.assistantTerm.textContent);
      }
    });

    // Copy button
    DOM.assistantCopy.addEventListener('click', copyDefinition);

    // Close on outside click
    document.addEventListener('mousedown', (e) => {
      if (visible && !DOM.assistantPopup.contains(e.target)) hide();
    });

    // Close on scroll
    let scrollTimer;
    window.addEventListener('scroll', () => {
      if (!visible) return;
      clearTimeout(scrollTimer);
      scrollTimer = setTimeout(hide, 120);
    }, { passive: true });

    // Keyboard: Escape closes
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && visible) hide();
    });

    // Draggable
    initDraggable();
  }

  return { init, show, hide, isVisible, triggerLookup };
})();


/* ════════════════════════════════════
   13. SELECTION DETECTION
════════════════════════════════════ */
const SelectionDetect = (() => {

  let doubleTapTimer   = null;
  let doubleTapCount   = 0;
  let lastTapTarget    = null;
  const DOUBLE_TAP_GAP = 350;

  function isAssistantEnabled() {
    return DOM.assistantToggle ? DOM.assistantToggle.checked : true;
  }

  function isInsideReader(node) {
    return DOM.readerContent && DOM.readerContent.contains(node);
  }

  function getSelectionRect() {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    const range = sel.getRangeAt(0);
    return range.getBoundingClientRect();
  }

  function getSelectedText() {
    const sel = window.getSelection();
    if (!sel) return '';
    return sel.toString().trim().replace(/\s+/g, ' ');
  }

  /* Desktop: mouseup after selection */
  function handleMouseUp(e) {
    if (!isAssistantEnabled()) return;
    if (DOM.assistantPopup.contains(e.target)) return;

    setTimeout(() => {
      const text = getSelectedText();
      if (!text || text.length < 2) return;
      if (!isInsideReader(window.getSelection()?.anchorNode)) return;

      const rect = getSelectionRect();
      if (!rect || (rect.width === 0 && rect.height === 0)) return;

      AssistantPopup.triggerLookup(text, rect);
    }, 10);
  }

  /* Desktop: double-click on a word */
  function handleDblClick(e) {
    if (!isAssistantEnabled()) return;
    if (DOM.assistantPopup.contains(e.target)) return;
    if (!isInsideReader(e.target)) return;

    setTimeout(() => {
      const text = getSelectedText();
      if (!text || text.length < 2) return;
      const rect = getSelectionRect();
      if (!rect) return;
      AssistantPopup.triggerLookup(text, rect);
    }, 10);
  }

  /* Mobile: double-tap detection */
  function handleTouchStart(e) {
    if (!isAssistantEnabled()) return;
    if (DOM.assistantPopup.contains(e.target)) return;

    const target = e.target;

    if (lastTapTarget === target) {
      doubleTapCount++;
    } else {
      doubleTapCount = 1;
      lastTapTarget  = target;
    }

    clearTimeout(doubleTapTimer);

    if (doubleTapCount === 2) {
      doubleTapCount = 0;
      lastTapTarget  = null;
      setTimeout(() => {
        const text = getSelectedText();
        if (!text || text.length < 2) return;
        if (!isInsideReader(window.getSelection()?.anchorNode)) return;
        const rect = getSelectionRect();
        if (!rect) return;
        AssistantPopup.triggerLookup(text, rect);
      }, 50);
    } else {
      doubleTapTimer = setTimeout(() => {
        doubleTapCount = 0;
        lastTapTarget  = null;
      }, DOUBLE_TAP_GAP);
    }
  }

  /* Mobile: selection change (long-press or text handle drag) */
  let selChangeTimer;
  function handleSelectionChange() {
    if (!isAssistantEnabled()) return;
    clearTimeout(selChangeTimer);
    selChangeTimer = setTimeout(() => {
      const text = getSelectedText();
      if (!text || text.length < 2) return;
      if (!isInsideReader(window.getSelection()?.anchorNode)) return;
      const rect = getSelectionRect();
      if (!rect || (rect.width === 0 && rect.height === 0)) return;
      if (window.innerWidth <= 768) {
        AssistantPopup.triggerLookup(text, rect);
      }
    }, 300);
  }

  function init() {
    document.addEventListener('mouseup',         handleMouseUp);
    document.addEventListener('dblclick',        handleDblClick);
    document.addEventListener('touchstart',      handleTouchStart, { passive: true });
    document.addEventListener('selectionchange', handleSelectionChange);
  }

  return { init };
})();


/* ════════════════════════════════════
   SHARED UTILITY
════════════════════════════════════ */
function escHtml(str) {
  return (str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}


/* ════════════════════════════════════
   14. INIT
════════════════════════════════════ */
function init() {
  ThemeManager.init();
  UIState.showHero();
  Uploader.init();
  SettingsPanel.init();
  HistoryPanel.init();
  ReadingProgress.init();
  DictPanel.init();
  AssistantPopup.init();
  SelectionDetect.init();
  console.info('%c ReaderBot v4 loaded ✓', 'color:#d97706;font-weight:700;font-size:12px;');
}

document.readyState === 'loading'
  ? document.addEventListener('DOMContentLoaded', init)
  : init();