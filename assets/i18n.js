/* assets/i18n.js */
(function () {
  const LS_KEY = 'lang';

  // 偵測預設語言（localStorage > 瀏覽器語言）
  function detectLang() {
    const ls = localStorage.getItem(LS_KEY);
    if (ls) return ls;
    const n = (navigator.language || 'zh-TW').toLowerCase();
    return n.startsWith('en') ? 'en' : 'zh-Hant';
  }

  // 載入對應語言包（en / zh-Hant）
  async function loadBundle(lang) {
    const map = {
      'zh': 'zh-Hant', 'zh-tw': 'zh-Hant', 'zh-hant': 'zh-Hant',
      'en': 'en', 'en-us': 'en'
    };
    const key = map[lang] || 'zh-Hant';
    const url = 'assets/i18n/' + (key === 'en' ? 'en.json' : 'zh-Hant.json');
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error('i18n fetch failed: ' + res.status);
    return await res.json();
  }

  // 將字典套到畫面上（data-i18n / data-i18n-attr）
  function apply(dict) {
    // 文字節點
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const k = el.getAttribute('data-i18n');
      if (k && dict[k] != null) el.textContent = dict[k];
    });
    // 屬性（如 placeholder、title...）
    document.querySelectorAll('[data-i18n-attr]').forEach(el => {
      const k = el.getAttribute('data-i18n');
      const attrs = (el.getAttribute('data-i18n-attr') || '')
        .split('|').map(s => s.trim()).filter(Boolean);
      if (!k) return;
      const v = dict[k];
      if (v == null) return;
      attrs.forEach(a => el.setAttribute(a, v));
    });
  }

  // 設定語言 + 套字 + 廣播事件
  async function setLang(lang) {
    localStorage.setItem(LS_KEY, lang);
    document.documentElement.setAttribute('lang', lang);

    try {
      const dict = await loadBundle(lang);

      // 供程式碼（如 main.js）動態取字：t('some.key', 'fallback')
      window.i18n = {
        dict,
        t: (key) => (dict && dict[key] != null ? dict[key] : undefined)
      };

      apply(dict);

      // 通知頁面語言已切換：讓動態內容就地重繪（不必重新查詢）
      document.dispatchEvent(new CustomEvent('i18n:changed', { detail: { lang } }));
    } catch (e) {
      console.error(e);
    }
  }

  // Public APIs
  window.setLang = setLang;
  window.getLang = () => localStorage.getItem(LS_KEY) || detectLang();

  // 首頁載入時套用預設語言
  document.addEventListener('DOMContentLoaded', () => setLang(detectLang()));
})();
