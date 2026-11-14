window.SC = window.SC || {};
SC.state = { presentation: null, currentSlide: 0, editMode: false };
SC.config = null;  // загружается с /config при старте, ключа здесь нет

SC.$ = id => document.getElementById(id);
SC.setStatus = t => { SC.$("status").textContent = t; };
SC.escapeHtml = v => String(v ?? "")
  .replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;")
  .replaceAll('"',"&quot;").replaceAll("'","&#39;");
SC.parseNum = v => {
  const n = parseFloat(String(v ?? "").replace(",", ".").replace(/[^\d.]/g, ""));
  return isFinite(n) ? n : 0;
};
SC.extractJson = text => {
  if (!text) return "{}";
  let c = text.trim();
  const a = c.indexOf("{"), b = c.lastIndexOf("}");
  if (a !== -1 && b !== -1 && b > a) c = c.slice(a, b + 1);
  return c;
};
SC.sanitizeFilename = t =>
  (String(t || "presentation").replace(/[^\wа-яА-ЯёЁ\s-]/g, "").trim().replace(/\s+/g, "_")) || "presentation";
SC.downloadBlob = (blob, name) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
};

/* ---------- загрузка конфига с сервера (без ключа) ---------- */
SC.loadConfig = async () => {
  const res = await fetch("/config");
  if (!res.ok) throw new Error(`/config вернул ${res.status}`);
  SC.config = await res.json();
};

/* ---------- namespacing localStorage по пользователю ---------- */
// После авторизации SC.config.user содержит имя пользователя.
// Все ключи localStorage получают суффикс _<user>, чтобы у разных
// пользователей были разные презентации, галереи и настройки.
SC.userKey = (suffix) => {
  const u = SC.config?.user || "anon";
  // нормализуем username для использования в localStorage key
  const safe = String(u).replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 32);
  return `${suffix}__${safe}`;
};

/* ============================================================
   Стилевые оверрайды: более угловатый интерфейс + чисто белый
   текст вместо светло-серого. Инжектится один раз в <head>.
   ============================================================ */
SC.injectStyleOverrides = () => {
  if (document.getElementById("sc-style-overrides")) return;

  // Подключаем Oswald (конденсированный display) + Caveat (рукописный акцент)
  const fontLink = document.createElement("link");
  fontLink.rel = "stylesheet";
  fontLink.href = "https://fonts.googleapis.com/css2?family=Oswald:wght@400;500;600;700&family=Caveat:wght@600;700&display=swap";
  document.head.appendChild(fontLink);

  const css = document.createElement("style");
  css.id = "sc-style-overrides";
  css.textContent = `
/* ===== Угловатый интерфейс ===== */
.slide, .slide-content { border-radius: 6px !important; }
.kicker, .badge, .metric, .legend-item, .step-num, .event::before,
.g-card, .plan, .gallery-close, .pricing-close { border-radius: 4px !important; }
.bar, .bar-col, .bar-value, .bar-label { border-radius: 2px !important; }
.pie { border-radius: 4px !important; }
.gallery-overlay, .pricing-overlay { border-radius: 0 !important; }
button, input, select, textarea { border-radius: 4px !important; }
#scUserBadge { border-radius: 4px !important; }
.step-num { border-radius: 4px !important; }
.event::before { border-radius: 2px !important; }

/* ===== Phase 1: НОВЫЙ ВИЗУАЛЬНЫЙ СТИЛЬ ===== */

/* Конденсированные шрифты для заголовков */
.slide h1, .slide h2, .slide h3 {
  font-family: 'Oswald','Arial Narrow',sans-serif !important;
  font-weight: 600 !important;
  text-transform: uppercase !important;
  letter-spacing: .02em !important;
  line-height: 1.05 !important;
}
.slide h1 em, .slide h2 em {
  font-style: normal !important;
  color: var(--accent) !important;
}

/* Kicker с линией-акцентом */
.kicker {
  font-family: 'Manrope',sans-serif !important;
  font-size: 11px !important;
  font-weight: 800 !important;
  letter-spacing: 3px !important;
  text-transform: uppercase !important;
  color: var(--accent) !important;
  display: inline-flex !important;
  align-items: center !important;
  gap: 12px !important;
  margin-bottom: 10px !important;
}
.kicker::before {
  content: "" !important;
  width: 30px !important;
  height: 2px !important;
  background: linear-gradient(90deg, var(--accent), var(--accent2)) !important;
  border-radius: 2px !important;
}

/* Ghost number — огромный полупрозрачный номер слайда */
.slide-content { position: relative !important; }
.slide-content::after {
  content: attr(data-slide-num) !important;
  position: absolute !important;
  top: 2px !important; right: 18px !important;
  z-index: 0 !important;
  font-family: 'Oswald',sans-serif !important;
  font-size: clamp(90px,13vw,170px) !important;
  line-height: 1 !important;
  color: transparent !important;
  -webkit-text-stroke: 1px rgba(255,255,255,.07) !important;
  pointer-events: none !important; user-select: none !important;
}
.slide-content > * { position: relative !important; z-index: 1 !important; }

/* Карточки с цветным бордюром */
.point, .metric, .col, .fact {
  background: rgba(255,255,255,.04) !important;
  border: 1px solid rgba(255,255,255,.08) !important;
  border-left: 4px solid var(--accent) !important;
  border-radius: 4px !important;
  padding: 14px 16px !important;
  transition: transform .22s ease, border-color .22s, box-shadow .22s !important;
}
.point:hover, .metric:hover, .col:hover, .fact:hover {
  transform: translateY(-3px) !important;
  border-color: rgba(255,255,255,.15) !important;
  box-shadow: 0 10px 24px rgba(0,0,0,.3) !important;
}

/* Staggered reveal — контент появляется по очереди */
.slide-content > * {
  opacity: 0 !important;
  transform: translateY(20px) !important;
  transition: opacity .55s ease, transform .6s cubic-bezier(.2,.7,.2,1) !important;
}
.slide-content > *:nth-child(1) { transition-delay: 80ms !important; }
.slide-content > *:nth-child(2) { transition-delay: 160ms !important; }
.slide-content > *:nth-child(3) { transition-delay: 240ms !important; }
.slide-content > *:nth-child(4) { transition-delay: 320ms !important; }
.slide-content > *:nth-child(5) { transition-delay: 400ms !important; }
.slide-content > *:nth-child(6) { transition-delay: 480ms !important; }
.slide-content > *:nth-child(7) { transition-delay: 560ms !important; }
.slide-content > *:nth-child(8) { transition-delay: 640ms !important; }
.slide-content.sc-animate > * {
  opacity: 1 !important;
  transform: none !important;
}

/* Timeline — ромбовидные маркеры */
.event::before {
  border-radius: 0 !important;
  transform: rotate(45deg) !important;
  width: 10px !important; height: 10px !important;
  background: var(--bg1) !important;
  border: 2px solid var(--accent) !important;
}

/* Quote — рукописный шрифт */
.quote-text {
  font-family: 'Caveat',cursive !important;
  font-size: clamp(18px,2.2vw,24px) !important;
  line-height: 1.4 !important;
}

/* Bar charts с градиентом */
.bar { background: linear-gradient(180deg, var(--accent), var(--accent2)) !important; }

/* Big stat — display font */
.big-value { font-family: 'Oswald',sans-serif !important; font-weight: 700 !important; }

/* Footer */
.slide-footer {
  font-size: 10px !important;
  letter-spacing: 1.5px !important;
  text-transform: uppercase !important;
  opacity: .6 !important;
}

/* Иконки из Iconify */
.sc-slide-icon svg { display: block; }
.sc-slide-icon { filter: drop-shadow(0 0 8px rgba(255,255,255,.1)); }

/* Metric values — для animated counters */
.metric .value { font-variant-numeric: tabular-nums; }
.big-value { font-variant-numeric: tabular-nums; }

/* ===== Белый текст ===== */
body { color: #ffffff !important; }
h1, h2, h3, h4, h5, h6, p, span, li, td, th, label { color: #ffffff !important; }
.subtitle, .kicker, .badge, .bar-value, .bar-label,
.legend-label, .step-title, .step-text, .event-text, .big-caption,
.text-heavy p, .quote-text, .quote-author, .point, .points,
.slide-footer, .metric .label { color: #ffffff !important; }
.metric .value, .big-value { color: #ffffff !important; }
button, .btn, a, input, select, textarea { color: #ffffff !important; }
input, select, textarea {
  background: #15171f !important;
  border: 1px solid #3a3f4f !important;
}
input:focus, select:focus, textarea:focus {
  border-color: #ff8c42 !important;
  box-shadow: 0 0 0 2px rgba(255,140,66,0.2) !important;
}
select {
  -webkit-appearance: none !important; appearance: none !important;
  background-image: url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23aab1c0' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E") !important;
  background-repeat: no-repeat !important;
  background-position: right 10px center !important;
  background-size: 14px !important;
  padding-right: 32px !important;
}
option { background: #1f2330 !important; color: #ffffff !important; }
input::placeholder, textarea::placeholder { color: #cfd3dd !important; opacity: 1 !important; }

/* ===== Адаптив для телефонов ===== */

/* --- Планшеты и телефоны (< 1000px): гамбургер-меню + slide-in drawer --- */
/* Кнопка-гамбургер, затемнённый фон и кнопка закрытия — видны только на мобильном.
   На десктопе все три элемента скрыты через display:none вне media query. */
#scMobileToggle {
  display: none;
}
#scMobileBackdrop {
  display: none;
}
.sc-drawer-close {
  display: none;
}

@media (max-width: 1000px) {
  main {
    grid-template-columns: 1fr !important;
    grid-template-rows: auto 1fr !important;
    gap: 8px !important;
    padding: 8px !important;
  }

  /* Кнопка-гамбургер сверху */
  #scMobileToggle {
    display: flex !important;
    align-items: center;
    justify-content: center;
    gap: 10px;
    width: 100% !important;
    padding: 12px 16px !important;
    background: linear-gradient(135deg, #2d3346, #1f2330) !important;
    color: #ffffff !important;
    border: 1px solid #3a3f4f !important;
    border-radius: 4px !important;
    cursor: pointer !important;
    font: 600 14px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif !important;
    min-height: 44px !important;  /* touch-цель */
    order: 1 !important;
    margin: 0 !important;
  }
  #scMobileToggle:active {
    background: linear-gradient(135deg, #3a4156, #2d3346) !important;
  }
  #scMobileToggle .sc-burger-icon {
    font-size: 18px;
    line-height: 1;
  }

  /* Слайд — занимает оставшуюся высоту */
  .viewer {
    order: 2 !important;
    padding: 8px !important;
    min-height: 0 !important;
  }
  .stage { min-height: 0 !important; }

  /* Сайдбар — slide-in drawer слева, по умолчанию спрятан.
     Ширина 70vw / max 280px — чтобы справа была видна полоска слайда
     и пользователь понимал, что за drawer'ом что-то есть. */
  .panel {
    position: fixed !important;
    top: 48px !important;
    left: 0 !important;
    bottom: 0 !important;
    width: min(280px, 70vw) !important;
    max-width: 280px !important;
    max-height: none !important;
    height: calc(100vh - 48px) !important;
    background: #15171f !important;
    border-right: 1px solid #3a3f4f !important;
    border-radius: 0 !important;
    z-index: 10001 !important;
    transform: translateX(-100%) !important;
    transition: transform 0.25s ease !important;
    overflow-y: auto !important;
    -webkit-overflow-scrolling: touch;
    order: unset !important;
    padding: 44px 16px 16px 16px !important;  /* top padding = место под кнопку × */
    box-shadow: none !important;
  }
  .panel.sc-mobile-open {
    transform: translateX(0) !important;
    box-shadow: 4px 0 24px rgba(0, 0, 0, 0.5) !important;
  }
  .panel-scroll {
    overflow-y: visible !important;  /* внутри drawer'а весь поток виден */
  }

  /* Кнопка "×" в верхнем правом углу drawer'а */
  .sc-drawer-close {
    position: fixed !important;
    top: 56px !important;
    left: calc(min(280px, 70vw) - 44px) !important;
    width: 32px !important;
    height: 32px !important;
    border: none !important;
    background: rgba(31, 35, 48, 0.95) !important;
    color: #aab1c0 !important;
    font-size: 20px !important;
    line-height: 1 !important;
    cursor: pointer !important;
    border-radius: 4px !important;
    z-index: 10002 !important;
    display: none !important;
    align-items: center;
    justify-content: center;
    border: 1px solid #3a3f4f !important;
  }
  .sc-drawer-close.sc-mobile-open {
    display: flex !important;
  }
  .sc-drawer-close:active {
    background: #2d3346 !important;
    color: #ffffff !important;
  }

  /* Затемнённый фон под drawer'ом + подсказка */
  #scMobileBackdrop {
    position: fixed !important;
    inset: 0 !important;
    top: 48px !important;
    background: rgba(0, 0, 0, 0.55) !important;
    z-index: 10000 !important;
    cursor: pointer !important;
    display: none !important;
  }
  #scMobileBackdrop.sc-mobile-open {
    display: block !important;
  }
  #scMobileBackdrop .sc-backdrop-hint {
    position: absolute;
    top: 50%;
    right: 12px;
    transform: translateY(-50%) rotate(-90deg);
    transform-origin: right center;
    color: rgba(255, 255, 255, 0.55);
    font: 600 12px system-ui, sans-serif;
    white-space: nowrap;
    pointer-events: none;
    letter-spacing: 0.5px;
  }
}

/* --- Телефоны (< 900px): nav-links компактные, бейдж плавающий --- */
@media (max-width: 900px) {
  /* nav-links в index.html скрыты на < 900px — показываем снова, но компактно */
  .nav-links {
    display: flex !important;
    margin-left: 0 !important;
    gap: 14px !important;
    font-size: 12px !important;
    overflow-x: auto !important;
    flex-wrap: nowrap !important;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: none;
  }
  .nav-links::-webkit-scrollbar { display: none; }
  .nav-links a {
    padding: 4px 0 !important;
    white-space: nowrap !important;
    border-bottom-width: 2px !important;
  }
  .brand-name { font-size: 13px !important; }
  .brand-badge { display: none !important; }
  .topbar { padding: 0 12px !important; gap: 10px !important; height: 48px !important; }

  /* Бейдж профиля — плавающий в верхнем правом углу */
  #scUserBadge {
    position: fixed !important;
    top: 8px !important;
    right: 10px !important;
    z-index: 9999 !important;
  }

  /* Плавающая панель «Доп. настройки» — почти на весь экран */
  #scExtraPanel {
    width: calc(100vw - 20px) !important;
    max-width: 380px !important;
    right: 10px !important;
    left: 10px !important;
    top: 55px !important;
    max-height: 78vh !important;
    margin-left: auto !important;
  }

  /* AI-edit панель — внизу, почти на весь экран */
  #aiEditPanel {
    width: calc(100vw - 20px) !important;
    max-width: 380px !important;
    right: 10px !important;
    left: 10px !important;
    bottom: 10px !important;
    top: auto !important;
    margin-left: auto !important;
  }

  /* Модалка галереи — меньше отступов, одна колонка */
  .gallery-overlay { padding: 24px 12px !important; padding-top: 60px !important; }
  .gallery-box { width: 100% !important; }
  .gallery-grid { grid-template-columns: 1fr !important; gap: 10px !important; }
  .gallery-head h2 { font-size: 18px !important; }

  /* Модалка тарифов — карточки друг под другом */
  .pricing-overlay { padding: 24px 12px !important; padding-top: 60px !important; }
  .pricing-box { width: 100% !important; }
  .pricing-grid { grid-template-columns: 1fr !important; gap: 12px !important; }
  .pricing-head h2 { font-size: 18px !important; }
  .plan { padding: 18px !important; }
  .plan-price { font-size: 32px !important; }
}

/* --- Узкие телефоны (< 600px): ещё компактнее, крупнее touch-цели --- */
@media (max-width: 600px) {
  main { padding: 6px !important; gap: 6px !important; }
  .viewer { padding: 6px !important; }
  .panel { padding: 12px !important; width: min(320px, 88vw) !important; }

  /* Бейдж — ещё компактнее, метку «Профиль:» скрываем */
  #scUserBadge .sc-name { padding: 6px 10px !important; }
  #scUserBadge .sc-name-label { display: none !important; }
  #scUserBadge .sc-btn { padding: 6px 10px !important; }

  /* Кнопки крупнее для touch (минимум 40px) */
  button, .btn, .btn-row button {
    min-height: 40px !important;
    font-size: 13px !important;
    padding: 10px 12px !important;
  }
  input, select, textarea {
    min-height: 40px !important;
    font-size: 16px !important;
    padding: 10px 12px !important;
  }

  /* Слайд занимает всю ширину */
  .slide { width: 100% !important; border-radius: 8px !important; }

  /* Уменьшаем шрифты слайда */
  .slide-content { padding: 18px 18px 14px !important; }
  .slide h1 { font-size: clamp(18px, 5.5vw, 26px) !important; }
  .slide h2 { font-size: clamp(15px, 4vw, 20px) !important; padding-left: 14px !important; }
  .subtitle { font-size: clamp(11px, 2.8vw, 14px) !important; max-width: 95% !important; }
  .kicker { font-size: 10px !important; margin-bottom: 6px !important; }
  .badge { font-size: 10px !important; padding: 4px 10px !important; margin-bottom: 10px !important; }

  /* Метадки и графики компактнее */
  .metrics { gap: 8px !important; }
  .metric { padding: 10px !important; }
  .metric .value { font-size: clamp(18px, 4vw, 24px) !important; }
  .metric .label { font-size: clamp(10px, 2.2vw, 12px) !important; }
  .point { padding: 8px 12px !important; font-size: clamp(12px, 2.8vw, 14px) !important; }
  .point .num { width: 22px !important; height: 22px !important; font-size: 11px !important; }

  /* Графики и таблицы — компактнее */
  .chart { gap: 10px !important; min-height: 120px !important; }
  .bar { width: min(38px, 60%) !important; }
  .bar-value { font-size: clamp(10px, 2.5vw, 13px) !important; }
  .bar-label { font-size: clamp(9px, 2vw, 11px) !important; }

  /* Таймлайн, шаги — меньше отступов */
  .timeline { gap: 10px !important; padding-left: 20px !important; }
  .event-year { min-width: 60px !important; font-size: 13px !important; }
  .event-text { font-size: clamp(11px, 2.6vw, 13px) !important; line-height: 1.4 !important; }
  .steps { gap: 10px !important; }
  .step-num { width: 26px !important; height: 26px !important; font-size: 12px !important; }
  .step-title { font-size: clamp(12px, 2.8vw, 14px) !important; }
  .step-text { font-size: clamp(11px, 2.6vw, 13px) !important; line-height: 1.4 !important; }

  /* Длинный текст — меньше шрифт, уже ширина */
  .text-heavy { max-width: 100% !important; }
  .text-heavy p { font-size: clamp(11px, 2.7vw, 14px) !important; line-height: 1.45 !important; margin-bottom: 8px !important; }

  /* big_stat — крупная цифра меньше */
  .big-value { font-size: clamp(48px, 18vw, 80px) !important; }
  .big-caption { font-size: clamp(12px, 3vw, 15px) !important; max-width: 100% !important; }

  /* Pie диаграмма — меньше */
  .pie-wrap { gap: 16px !important; flex-direction: column !important; align-items: stretch !important; }
  .pie { width: 160px !important; height: 160px !important; margin: 0 auto !important; }
  .legend-item { font-size: 12px !important; }

  /* Таблицы — горизонтальный скролл */
  .table-wrap { overflow-x: auto !important; -webkit-overflow-scrolling: touch; }
  table { font-size: 11px !important; }
  th, td { padding: 6px 8px !important; }

  /* Подпись внизу слайда — компактнее */
  .slide-footer { font-size: 10px !important; }
}
`;
  (document.head || document.documentElement).appendChild(css);
};

/* ---------- автосохранение ---------- */
SC.persist = () => {
  const p = SC.state.presentation;
  if (!p) return;
  localStorage.setItem(SC.userKey("ai_pres_data"), JSON.stringify(p));
  localStorage.setItem(SC.userKey("ai_pres_slide"), String(SC.state.currentSlide));
};
SC.restore = () => {
  try {
    const raw = localStorage.getItem(SC.userKey("ai_pres_data"));
    if (!raw) return false;
    const data = JSON.parse(raw);
    if (!data?.slides?.length) return false;
    SC.state.presentation = data;
    SC.state.currentSlide = Math.min(
      Number(localStorage.getItem(SC.userKey("ai_pres_slide")) || 0), data.slides.length - 1);
    return true;
  } catch { return false; }
};

/* ---------- ИИ ---------- */
// Модель знает сервер (из .env). Клиент присылает только режим: "fast" | "think".
SC.getMode     = () => SC.$("modeSelect")?.value === "think" ? "think" : "fast";
SC.apiUrl      = () => SC.config?.proxyUrl || "/api/chat";
SC.apiHeaders  = () => ({ "Content-Type": "application/json" });  // ключ живёт на сервере

/* ============================================================
   Промпты лежат в отдельном файле prompt.txt в корне проекта.
   Файл содержит две секции, разделённые маркерами:
     ===MAIN===   — промпт для генерации всей презентации
     ===EDIT===   — промпт для ИИ-редактирования слайда
   Шаблоны используют плейсхолдеры {{varName}}, которые подставляются
   в JS. Это позволяет редактировать промпт как обычный текст, не
   трогая core.js.
   ============================================================ */
SC._promptTpl = null;       // основной промпт (после загрузки)
SC._editPromptTpl = null;   // промпт для редактирования слайда

// Минимальные fallback-промпты на случай, если prompt.txt не загрузится.
// Они короче основных, но позволяют приложению работать.
SC._FALLBACK_MAIN = `Ты — дизайнер презентаций. Создай презентацию на тему: "{{topic}}".
Количество слайдов: {{n}} (максимум 15). Язык: русский. {{accent}}. {{thinkMode}}
{{authorBlock}}
{{compareBlock}}
{{designBlock}}
Верни ТОЛЬКО валидный JSON. Каждый слайд может содержать "icon" — имя иконки из Iconify (например "mdi:chart-line", "ph:book-open").
НЕ генерируй SVG-код — только имя иконки.
{ "title": "...", "slides": [{ "layout": "title", "title": "...", "subtitle": "...", "icon": "mdi:presentation" }, ...] }.
Первый слайд — "title", последний — "closing". Включай ровно один "text_heavy".
Layouts: title, bullets, two_columns, metrics, chart, pie, table, timeline, big_stat, steps, quote, text_heavy, closing.
Используй реальные данные из контекста выше, не выдумывай цифры.`;

SC._FALLBACK_EDIT = `Ты — дизайнер презентаций. Пользователь редактирует один слайд и просит изменить его.
Текущий слайд (JSON):
{{slideJson}}
Инструкция: "{{instruction}}".
Верни ТОЛЬКО валидный JSON — обновлённый слайд.
Сохраняй layout "{{currentLayout}}" если инструкция не просит другой.
Все обязательные поля должны быть заполнены. Не выдумывай цифры без необходимости.`;

// Подстановка плейсхолдеров {{var}} в шаблоне
SC._substitute = (tpl, vars) =>
  String(tpl).replace(/\{\{(\w+)\}\}/g, (m, key) =>
    (vars[key] !== undefined && vars[key] !== null) ? String(vars[key]) : "");

// Загрузка prompt.txt с сервера. Парсит по маркерам ===MAIN=== и ===EDIT===,
// которые должны стоять в НАЧАЛЕ строки (чтобы не путать с упоминаниями в комментариях).
SC.loadPromptTemplates = async () => {
  if (SC._promptTpl !== null) return;  // уже загружено
  try {
    const res = await fetch("/prompt.txt", { cache: "no-cache" });
    if (!res.ok) throw new Error(`/prompt.txt вернул ${res.status}`);
    const text = await res.text();
    // Маркеры должны быть в начале строки — ищем их построчно.
    // m-флаг = multiline, ^ = начало строки.
    const mainMatch = text.match(/^===MAIN===\s*$/m);
    const editMatch = text.match(/^===EDIT===\s*$/m);
    if (!mainMatch) throw new Error("в prompt.txt нет секции ===MAIN=== (в начале строки)");
    const mainStart = mainMatch.index + mainMatch[0].length;
    const editStart = editMatch ? (editMatch.index + editMatch[0].length) : text.length;
    SC._promptTpl = text.slice(mainStart, editMatch ? editMatch.index : text.length).trim();
    if (editMatch) {
      SC._editPromptTpl = text.slice(editStart).trim();
    }
    console.log(
      "[SlideCraft] prompt.txt загружен:",
      "main =", SC._promptTpl ? `${SC._promptTpl.length} симв.` : "нет",
      "| edit =", SC._editPromptTpl ? `${SC._editPromptTpl.length} симв.` : "нет"
    );
  } catch (e) {
    console.warn("[SlideCraft] loadPromptTemplates failed, будут использованы fallback-промпты:", e);
    // Оставляем SC._promptTpl = null — buildPrompt использует fallback
  }
};

SC.buildPrompt = (topic, n) => {
  // Жёсткий лимит: не больше 15 слайдов
  n = Math.min(Math.max(Number(n) || 8, 1), 15);
  const accents = [
    "сделай акцент на практическом применении и реальных кейсах",
    "сделай акцент на трендах и будущем развитии",
    "сделай акцент на проблемах и их решениях",
    "сделай акцент на данных, статистике и результатах",
    "сделай акцент на инновациях и технологиях",
    "сделай акцент на человеческом факторе и опыте"
  ];
  const accent = accents[Math.floor(Math.random() * accents.length)];
  const isThink = SC.$("modeSelect").value === "think";
  const x = SC.extra || {};
  const hasAuthor = !!(x.authorName || x.authorDate || x.authorCompany);
  const hasCompare = !!(x.compareCompanies && x.compareCompanies.trim());
  const hasDesign = !!(x.designHint && x.designHint.trim());

  // Готовим условные блоки (подставятся в шаблон как готовые строки)
  const thinkMode = isThink
    ? 'Режим "Раздумия": добавь МАКСИМУМ деталей, данных, примеров и развёрнутых текстов.'
    : "";
  const authorBlock = hasAuthor ? `
Информация об авторе (ОБЯЗАТЕЛЬНО на первом слайде title):
- author: "${(x.authorName || "").trim()}"
- date: "${(x.authorDate || "").trim()}"
- company: "${(x.authorCompany || "").trim()}"
В объекте первого слайда добавь поля author, date, company с этими значениями.
` : "";
  const compareBlock = hasCompare ? `
Компании для сравнения: ${x.compareCompanies.trim()}
Включи в презентацию 1-2 слайда со сравнением ЭТИХ компаний (не выдумывай другие).
Используй layout "table" или "two_columns" с реальными или правдоподобными метриками
(выручка, доля рынка, количество сотрудников, рост и т.п.). Заголовок слайда должен
отражать суть сравнения, например «Сравнение: Apple, Google, Microsoft».
` : "";
  const designBlock = hasDesign ? `
Дополнительные указания пользователя: "${x.designHint.trim()}"
- Если пользователь указал цвета или стиль — используй ТОЛЬКО их.
- Если указал контекст (для урока, для коллег, для экзамена) — подстрой тон и глубину.
- Если указал автора/класс/школу — включи в презентацию.
` : `
САМ выбери подходящую цветовую палитру и визуальный стиль под тему.
Каждая генерация должна быть визуально уникальной — варьируй акценты, layouts, структуру.
`;

  const tpl = SC._promptTpl || SC._FALLBACK_MAIN;
  return SC._substitute(tpl, {
    topic, n, accent, thinkMode, authorBlock, compareBlock, designBlock,
  }).trim();
};

SC.callOllama = async messages => {
  const res = await fetch(SC.apiUrl(), {
    method: "POST",
    headers: SC.apiHeaders(),
    body: JSON.stringify({
      _mode: SC.getMode(),     // прокси подставит model из .env
      stream: false,
      format: "json",
      messages,
      options: { temperature: 0.6 }
    })
  });
  if (res.status === 401) {
    // 401 от НАШЕГО сервера = сессия истекла (не от AI-провайдера —
    // upstream 401/402/403 теперь пересылается как 502, см. main.py)
    setTimeout(() => { window.location.href = "/login"; }, 800);
    throw new Error("Сессия истекла. Перенаправление на /login…");
  }
  if (res.status === 502) {
    // 502 = AI провайдер вернул ошибку (нет кредитов, неверный ключ, и т.д.)
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "AI провайдер недоступен");
  }
  if (!res.ok) throw new Error(`API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  return data?.message?.content || "";
};

SC.generate = async () => {
  if (!SC.config) {
    SC.setStatus("Конфиг не загружен. Запущен ли main.py на 127.0.0.1:8787?");
    return;
  }
  const topic = SC.$("topic").value.trim();
  if (!topic) { alert("Введи тему презентации"); return; }
  const mode = SC.$("modeSelect").value;
  SC.setStatus(`Генерируем... Режим: ${mode === "fast" ? "быстро" : "раздумия"}.`);
  try {
    const text = await SC.callOllama([
      { role: "system", content: "Ты дизайнер презентаций. Возвращай только валидный JSON без markdown." },
      { role: "user", content: SC.buildPrompt(topic, Number(SC.$("slideCount").value || 8)) }
    ]);
    SC.state.presentation = JSON.parse(SC.extractJson(text));
    SC.state.currentSlide = 0;
    SC._patchNewLayouts?.();  // гарантия: новые layouts умеют рендериться
    SC.render();
    SC.persist();
    SC.setStatus("Готово. Презентация сохранена автоматически.");
  } catch (e) {
    console.error(e);
    SC.setStatus(`Ошибка: ${e.message}`);
  }
};

/* ============================================================
   ИИ-редактирование одного слайда
   Пользователь пишет инструкцию — ИИ переписывает текущий слайд.
   ============================================================ */
SC.VALID_LAYOUTS = ["title", "bullets", "two_columns", "metrics", "chart", "pie", "table", "timeline", "big_stat", "steps", "quote", "text_heavy", "closing"];

// Минимальные требования к полям для каждого layout.
// Если ИИ вернёт слайд, не соответствующий этим правилам, — правка НЕ применяется.
SC._SLIDE_REQUIREMENTS = {
  title:        [["title", 3], ["subtitle", 10]],
  closing:      [["title", 3], ["subtitle", 10]],
  bullets:      [["title", 3], ["points", 3]],
  two_columns:  [["title", 3], ["left_title", 3], ["left_points", 2],
                 ["right_title", 3], ["right_points", 2]],
  metrics:      [["title", 3], ["metrics", 3]],
  chart:        [["title", 3], ["items", 3]],
  pie:          [["title", 3], ["items", 3]],
  table:        [["title", 3], ["headers", 2], ["rows", 2]],
  timeline:     [["title", 3], ["events", 3]],
  big_stat:     [["title", 3], ["value", 1], ["caption", 10]],
  steps:        [["title", 3], ["steps", 3]],
  quote:        [["text", 10], ["author", 3]],
  text_heavy:   [["title", 3], ["paragraphs", 3]],
};

// Возвращает { ok: true } либо { ok: false, error: "..." }.
SC.validateSlide = (slide) => {
  if (!slide || typeof slide !== "object" || Array.isArray(slide)) {
    return { ok: false, error: "ответ не является объектом" };
  }
  if (!SC.VALID_LAYOUTS.includes(slide.layout)) {
    return { ok: false, error: `неизвестный layout "${slide.layout}"` };
  }
  const reqs = SC._SLIDE_REQUIREMENTS[slide.layout] || [];
  for (const [field, minLen] of reqs) {
    const v = slide[field];
    if (typeof v === "string") {
      if (v.trim().length < minLen) {
        return { ok: false, error: `поле "${field}" пустое или короче ${minLen} символов` };
      }
    } else if (Array.isArray(v)) {
      if (v.length < minLen) {
        return { ok: false, error: `массив "${field}" пуст или короче ${minLen} (вернул ${v.length})` };
      }
    } else {
      return { ok: false, error: `нет поля "${field}"` };
    }
  }
  return { ok: true };
};

/* ============================================================
   Патч новых layouts (pie, timeline, big_stat, text_heavy, steps).
   Self-patching: вызывает себя перед каждым рендером, чтобы
   не зависеть от порядка загрузки скриптов и не требовать
   правок index.html.
   ============================================================ */
SC._newLayoutsPatched = false;
SC._patchNewLayouts = () => {
  if (SC._newLayoutsPatched) return;
  if (typeof SC.slideInnerHtml !== "function") return; // render.js ещё не загрузился
  if (typeof SC.footerHtml !== "function") return;

  const e = SC.escapeHtml || (v => String(v ?? ""));
  const PIE_COLORS = ["#4a7cff", "#ff8c42", "#34d399", "#a78bfa", "#fbbf24", "#f472b6"];

  // --- CSS для новых layouts ---
  if (!document.getElementById("layouts-extra-css")) {
    const css = `
.pie-wrap { display: flex; gap: 32px; align-items: center; margin-top: 24px; }
.pie { width: 240px; height: 240px; border-radius: 50%; flex-shrink: 0; box-shadow: 0 0 0 4px rgba(255,255,255,0.06), 0 8px 32px rgba(0,0,0,0.25); }
.legend { display: flex; flex-direction: column; gap: 10px; flex: 1; }
.legend-item { display: flex; align-items: center; gap: 12px; font-size: 16px; }
.legend-color { width: 14px; height: 14px; border-radius: 3px; flex-shrink: 0; }
.legend-label { flex: 1; }
.legend-value { font-weight: 600; }
.timeline { display: flex; flex-direction: column; gap: 14px; margin-top: 16px; padding-left: 26px; border-left: 2px solid rgba(122,134,153,0.35); font-size: 15px; }
.event { display: flex; gap: 16px; align-items: baseline; position: relative; }
.event::before { content: ""; position: absolute; left: -32px; top: 6px; width: 10px; height: 10px; border-radius: 50%; background: #4a7cff; box-shadow: 0 0 0 3px rgba(74,124,255,0.2); }
.event-year { font-weight: 700; min-width: 80px; color: #4a7cff; font-size: 1em; }
.event-text { flex: 1; line-height: 1.45; font-size: 1em; }
.big-stat { text-align: center; padding: 30px 0; }
.big-value { font-size: 128px; font-weight: 800; line-height: 1; background: linear-gradient(135deg, #4a7cff, #ff8c42); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; color: transparent; }
.big-caption { font-size: 18px; max-width: 640px; margin: 20px auto 0; line-height: 1.5; }
.text-heavy { max-width: 760px; margin-top: 12px; font-size: 15px; }
.text-heavy p { margin: 0 0 10px; line-height: 1.5; font-size: 1em; }
.text-heavy p:last-child { margin-bottom: 0; }
.steps { display: flex; flex-direction: column; gap: 12px; margin-top: 16px; font-size: 15px; }
.step { display: flex; gap: 16px; align-items: flex-start; }
.step-num { width: 32px; height: 32px; border-radius: 50%; background: linear-gradient(135deg, #4a7cff, #6e8fff); color: #fff; display: flex; align-items: center; justify-content: center; font-weight: 700; flex-shrink: 0; box-shadow: 0 4px 12px rgba(74,124,255,0.3); }
.step-content { flex: 1; }
.step-title { font-weight: 600; font-size: 1em; margin-bottom: 3px; }
.step-text { opacity: 0.85; line-height: 1.45; font-size: 1em; }
.title-author { margin-top: 28px; opacity: 0.92; }
.title-author-name { font-weight: 600; font-size: 18px; }
.title-author-meta { font-size: 14px; opacity: 0.7; margin-top: 4px; }
`;
    const styleEl = document.createElement("style");
    styleEl.id = "layouts-extra-css";
    styleEl.textContent = css;
    (document.head || document.documentElement).appendChild(styleEl);
  }

  // --- Рендеры ---
  const renderPie = (slide, idx, total) => {
    const items = slide.items || [];
    const nums = items.map(it => SC.parseNum(it.value));
    const sum = nums.reduce((a, b) => a + b, 0) || 1;
    let cum = 0;
    const stops = items.map((it, i) => {
      const v = nums[i];
      const start = (cum / sum) * 360;
      cum += v;
      const end = (cum / sum) * 360;
      return `${PIE_COLORS[i % PIE_COLORS.length]} ${start}deg ${end}deg`;
    }).join(", ");
    return `<div class="kicker">Круговая диаграмма</div>
      <h2 data-edit="title">${e(slide.title)}</h2>
      <div class="pie-wrap">
        <div class="pie" style="background: conic-gradient(${stops});"></div>
        <div class="legend">
          ${items.map((it, i) => `<div class="legend-item">
            <span class="legend-color" style="background:${PIE_COLORS[i % PIE_COLORS.length]}"></span>
            <span class="legend-label" data-edit="items.${i}.label">${e(it.label)}</span>
            <span class="legend-value" data-edit="items.${i}.value">${e(it.value)}</span>
          </div>`).join("")}
        </div>
      </div>
      ${SC.footerHtml(idx, total)}`;
  };

  const renderTimeline = (slide, idx, total) => {
    const events = slide.events || [];
    return `<div class="kicker">Хронология</div>
      <h2 data-edit="title">${e(slide.title)}</h2>
      <div class="timeline">
        ${events.map((ev, i) => `<div class="event">
          <div class="event-year" data-edit="events.${i}.year">${e(ev.year)}</div>
          <div class="event-text" data-edit="events.${i}.text">${e(ev.text)}</div>
        </div>`).join("")}
      </div>
      ${SC.footerHtml(idx, total)}`;
  };

  const renderBigStat = (slide, idx, total) => `<div class="kicker">Ключевой показатель</div>
      <h2 data-edit="title">${e(slide.title)}</h2>
      <div class="big-stat">
        <div class="big-value" data-edit="value">${e(slide.value)}</div>
        <div class="big-caption" data-edit="caption">${e(slide.caption || "")}</div>
      </div>
      ${SC.footerHtml(idx, total)}`;

  const renderTextHeavy = (slide, idx, total) => {
    const paragraphs = slide.paragraphs || [];
    return `<div class="kicker">Детальный разбор</div>
      <h2 data-edit="title">${e(slide.title)}</h2>
      <div class="text-heavy">
        ${paragraphs.map((p, i) => `<p data-edit="paragraphs.${i}">${e(p)}</p>`).join("")}
      </div>
      ${SC.footerHtml(idx, total)}`;
  };

  const renderSteps = (slide, idx, total) => {
    const steps = slide.steps || [];
    return `<div class="kicker">Процесс</div>
      <h2 data-edit="title">${e(slide.title)}</h2>
      <div class="steps">
        ${steps.map((st, i) => `<div class="step">
          <div class="step-num">${i + 1}</div>
          <div class="step-content">
            <div class="step-title" data-edit="steps.${i}.title">${e(st.title)}</div>
            <div class="step-text" data-edit="steps.${i}.text">${e(st.text)}</div>
          </div>
        </div>`).join("")}
      </div>
      ${SC.footerHtml(idx, total)}`;
  };

  // --- Патч SC.slideInnerHtml ---
  const _origSlideInnerHtml = SC.slideInnerHtml;
  SC.slideInnerHtml = (slide, idx, total) => {
    // Если у title-слайда есть данные автора — рендерим с блоком автора
    if (slide.layout === "title" && (slide.author || slide.date || slide.company)) {
      return renderTitleWithAuthor(slide, idx, total);
    }
    switch (slide.layout) {
      case "pie":        return renderPie(slide, idx, total);
      case "timeline":   return renderTimeline(slide, idx, total);
      case "big_stat":   return renderBigStat(slide, idx, total);
      case "text_heavy": return renderTextHeavy(slide, idx, total);
      case "steps":      return renderSteps(slide, idx, total);
      default:           return _origSlideInnerHtml(slide, idx, total);
    }
  };

  // Рендер title с блоком автора: берём оригинальный HTML и вставляем
  // блок .title-author ПЕРЕД футером.
  const renderTitleWithAuthor = (slide, idx, total) => {
    const orig = _origSlideInnerHtml(slide, idx, total);
    const footer = SC.footerHtml(idx, total);
    const authorBits = [];
    if (slide.author) {
      authorBits.push(`<div class="title-author-name" data-edit="author">${e(slide.author)}</div>`);
    }
    const metaBits = [];
    if (slide.company) metaBits.push(`<span data-edit="company">${e(slide.company)}</span>`);
    if (slide.date)   metaBits.push(`<span data-edit="date">${e(slide.date)}</span>`);
    if (metaBits.length) {
      authorBits.push(`<div class="title-author-meta">${metaBits.join(" · ")}</div>`);
    }
    const authorBlock = authorBits.length
      ? `<div class="title-author">${authorBits.join("")}</div>`
      : "";
    if (footer && orig.includes(footer)) {
      return orig.replace(footer, authorBlock + footer);
    }
    return orig + authorBlock;
  };

  // --- Патч SC.contentClasses ---
  const _origCC = SC.contentClasses;
  SC.contentClasses = (s) => {
    if (s?.layout === "big_stat") return "centered";
    if (s?.layout === "text_heavy") return "";
    return _origCC(s);
  };

  // --- Перерисовка pie при правке значения (сегменты зависят от всех values) ---
  const _origHandleEdit = SC.handleEdit;
  if (typeof _origHandleEdit === "function") {
    SC.handleEdit = (el, commit) => {
      _origHandleEdit(el, commit);
      const path = el?.dataset?.edit;
      const slide = SC.state.presentation?.slides?.[SC.state.currentSlide];
      if (commit && slide && (slide.layout === "pie" || slide.layout === "chart")
          && path && path.endsWith(".value")) {
        SC.render();
      }
    };
  }

  // --- Auto-fit: если контент не влезает в слайд — масштабируем шрифт вниз ---
  SC._fitContentToSlide = () => {
    const slide = SC.$("slide");
    if (!slide) return;
    const content = slide.querySelector(".slide-content");
    if (!content) return;
    // Сбрасываем предыдущее масштабирование
    content.querySelectorAll(".text-heavy, .steps, .timeline, .table-wrap")
      .forEach(el => { el.style.fontSize = ""; });
    // Если влезло — выходим
    if (content.scrollHeight <= content.clientHeight + 2) return;
    // Ищем масштабируемый контейнер и шаг за шагом уменьшаем шрифт
    const scalable = content.querySelector(".text-heavy, .steps, .timeline, .table-wrap");
    if (!scalable) return;
    let size = parseFloat(window.getComputedStyle(scalable).fontSize);
    for (let i = 0; i < 8 && content.scrollHeight > content.clientHeight + 2; i++) {
      size -= 1;
      if (size < 10) { size = 10; break; }
      scalable.style.fontSize = size + "px";
    }
  };

  // Патчим SC.render, чтобы вызывать auto-fit + staggered animation + иконки + counters
  const _origRender = SC.render;
  SC.render = function () {
    // Ставим тему из JSON презентации (ИИ выбирает сам)
    const theme = SC.state.presentation?.theme || "graphite";
    const themeSelect = SC.$("themeSelect");
    if (themeSelect) themeSelect.value = theme;
    _origRender.apply(this, arguments);
    setTimeout(() => {
      try {
        SC._fitContentToSlide();
        const slideEl = SC.$("slide");
        if (slideEl) {
          const content = slideEl.querySelector(".slide-content");
          if (content) {
            const idx = SC.state.currentSlide;
            content.setAttribute("data-slide-num", String(idx + 1).padStart(2, "0"));
            content.classList.remove("sc-animate");
            void content.offsetWidth;
            content.classList.add("sc-animate");
          }
        }
        SC.injectSlideIcons?.();
        setTimeout(() => SC.animateCounters?.(), 200);
      } catch (e) { console.warn("post-render:", e); }
    }, 0);
  };

  SC._newLayoutsPatched = true;
};

/* ============================================================
   Система иконок: загрузка готовых SVG из Iconify API.
   ИИ указывает "icon": "mdi:chart-line" — мы грузим SVG
   с https://api.iconify.design/{name}.svg?color={accent}
   и вставляем inline в слайд.
   Кэш в памяти — повторные запросы не дёргают API.
   ============================================================ */
SC._iconCache = {};
SC._iconColor = () => {
  // Берём accent из текущей темы слайда
  const slide = SC.$("slide");
  if (slide) {
    const cs = getComputedStyle(slide);
    return encodeURIComponent(cs.getPropertyValue("--accent").trim() || "#f97316");
  }
  return "%23f97316";
};

SC.fetchIcon = async (name) => {
  if (!name) return null;
  if (SC._iconCache[name]) return SC._iconCache[name];
  const color = SC._iconColor();
  const url = `https://api.iconify.design/${encodeURIComponent(name)}.svg?color=${color}&width=48&height=48`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const svg = await res.text();
    if (svg.startsWith("<svg")) {
      SC._iconCache[name] = svg;
      return svg;
    }
  } catch (e) { console.warn("fetchIcon:", name, e); }
  return null;
};

SC.injectSlideIcons = async () => {
  const slide = SC.state.presentation?.slides?.[SC.state.currentSlide];
  if (!slide || !slide.icon) return;
  const content = document.querySelector(".slide-content");
  if (!content) return;
  // Если иконка уже вставлена — не дублируем
  if (content.querySelector(".sc-slide-icon")) return;
  const svg = await SC.fetchIcon(slide.icon);
  if (!svg) return;
  const wrapper = document.createElement("div");
  wrapper.className = "sc-slide-icon";
  wrapper.innerHTML = svg;
  wrapper.style.cssText = "position:absolute;top:12px;left:12px;z-index:2;opacity:.85;pointer-events:none;";
  wrapper.querySelector("svg")?.setAttribute("width", "36");
  wrapper.querySelector("svg")?.setAttribute("height", "36");
  content.appendChild(wrapper);
};

/* ============================================================
   Animated counters — цифры в metrics и big_stat
   анимированно считают от 0 до значения.
   ============================================================ */
SC.animateCounters = () => {
  const slide = SC.$("slide");
  if (!slide) return;
  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
  if (reduced) return;

  // Находим все .value и .big-value с числами
  const targets = slide.querySelectorAll(".metric .value, .big-value");
  targets.forEach(el => {
    const raw = el.textContent.trim();
    // Парсим число (может быть "85%", "×4", "$2.5M", "1.2 млн")
    const m = raw.match(/^([^\d]*)([\d.,]+)(.*)$/);
    if (!m) return;
    const prefix = m[1] || "";
    const numStr = m[2].replace(",", ".");
    const target = parseFloat(numStr);
    if (!isFinite(target) || target === 0) return;
    const suffix = m[3] || "";
    const isDecimal = numStr.includes(".");
    const dec = isDecimal ? (numStr.split(".")[1] || "").length : 0;

    const t0 = performance.now();
    const dur = 1100;
    const fmt = (n) => {
      const r = isDecimal ? n.toFixed(dec) : Math.round(n).toString();
      return prefix + r.replace(".", ",") + suffix;
    };
    const step = (t) => {
      const p = Math.min(1, (t - t0) / dur);
      const eased = 1 - Math.pow(1 - p, 3); // ease-out cubic
      el.textContent = fmt(target * eased);
      if (p < 1) requestAnimationFrame(step);
      else el.textContent = raw; // финал — точно как было
    };
    requestAnimationFrame(step);
  });
};

/* ============================================================
   «Дополнительно» — textarea прямо в сайдбаре (главный экран).
   Заменяет плавающую ⚙️ Доп. панель.
   Также скрывает «Тема оформления» — ИИ выбирает тему сам.
   ============================================================ */
SC.extra = { authorName: "", authorDate: "", authorCompany: "", compareCompanies: "", designHint: "" };

SC.loadExtra = () => {
  try {
    const raw = localStorage.getItem(SC.userKey("sc_extra"));
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        SC.extra = Object.assign(SC.extra, parsed);
      }
    }
  } catch (e) { console.warn("loadExtra:", e); }
};

SC.saveExtra = () => {
  try { localStorage.setItem(SC.userKey("sc_extra"), JSON.stringify(SC.extra)); }
  catch (e) { console.warn("saveExtra:", e); }
};

SC.injectDesignHintToSidebar = () => {
  if (document.getElementById("scDesignHintInput")) return;

  // 1. Скрываем «Тема оформления» — ИИ выбирает сам
  const themeSelect = SC.$("themeSelect");
  if (themeSelect) {
    // Скрываем и label и select — ищем родительский контейнер
    let el = themeSelect;
    // Поднимаемся вверх, пока не найдём label + select группу
    const label = themeSelect.closest("label") || themeSelect.previousElementSibling;
    if (label) label.style.display = "none";
    themeSelect.style.display = "none";
    // Скрываем group-title «ОФОРМЛЕНИЕ» если есть
    document.querySelectorAll(".group-title, .divider").forEach(g => {
      if (g.textContent.includes("ОФОРМ") || g.textContent.includes("оформ")) {
        g.style.display = "none";
      }
    });
  }

  // 2. Вставляем «Дополнительно» textarea после modeSelect
  const anchor = SC.$("modeSelect") || SC.$("slideCount") || SC.$("topic");
  if (!anchor) return;

  const e = SC.escapeHtml || (v => String(v ?? ""));
  const x = SC.extra;
  const wrap = document.createElement("div");
  wrap.id = "scDesignHintInput";
  wrap.style.cssText = "margin-bottom:12px;";
  wrap.innerHTML = `
    <label style="display:block;margin-bottom:6px;font-weight:700;font-size:13px;color:#ffffff;">
      Дополнительно
    </label>
    <textarea id="scDesignHintInline" rows="2"
      placeholder="Например: чёрный и белый, для урока английского, покажи автора..."
      style="width:100%;box-sizing:border-box;padding:10px 12px;border-radius:4px;border:1px solid #3a3f4f;background:#15171f;color:#ffffff;font:inherit;font-size:14px;resize:vertical;min-height:44px;"
    >${e(x.designHint)}</textarea>
    <div style="font-size:11px;color:#aab1c0;margin-top:4px;line-height:1.4;">
      Цвета, контекст, аудитория — ИИ подстроит дизайн.<br>
      Если не указать — ИИ выберет сам.
    </div>
  `;

  // Вставляем после anchor (modeSelect)
  anchor.parentNode.insertBefore(wrap, anchor.nextSibling);

  // Wire up
  const ta = document.getElementById("scDesignHintInline");
  if (ta) {
    ta.addEventListener("input", ev => {
      SC.extra.designHint = ev.target.value;
      SC.saveExtra();
    });
  }
};

/* ============================================================
   Бейдж пользователя + кнопка «Выйти».
   СТРАТЕГИЯ:
   1. Найти верхнюю навигацию (по ссылке «Помощь» / «Тарифы» /
      «Галерея» / «Создать») и встроить бейдж ВНУТРЬ неё — тогда
      он наследует позиционирование навигации, не конфликтует с
      transform-контекстами и не вылезает за экран.
   2. Использовать <div role="button"> вместо <button> — дивы не
      попадают под внешние CSS-правила для кнопок (которые могли
      красить кнопку в красный).
   3. Если навигация не нашлась — fallback на position:fixed
      справа сверху.
   Все стили — через <style> с !important.
   ============================================================ */
SC.injectUserBadge = () => {
  if (document.getElementById("scUserBadge")) return;
  const user = SC.config?.user;
  if (!user) return;

  const displayName = user.length > 10 ? user.slice(0, 10) + "…" : user;

  // CSS — один раз, с !important
  if (!document.getElementById("sc-user-badge-css")) {
    const css = document.createElement("style");
    css.id = "sc-user-badge-css";
    css.textContent = `
#scUserBadge{
  display:inline-flex !important;
  align-items:stretch !important;
  gap:0 !important;
  padding:0 !important;
  margin:0 0 0 12px !important;
  border-radius:20px !important;
  background:rgba(31,35,48,0.95) !important;
  border:1px solid rgba(255,255,255,0.08) !important;
  color:#e6e6e6 !important;
  font:12px/1 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif !important;
  box-shadow:0 4px 14px rgba(0,0,0,0.35) !important;
  overflow:hidden !important;
  user-select:none !important;
  white-space:nowrap !important;
  vertical-align:middle !important;
  flex-shrink:0 !important;
  max-width:calc(100vw - 32px) !important;
}
#scUserBadge.sc-badge-fixed{
  position:fixed !important;
  top:18px !important;
  right:16px !important;
  z-index:9998 !important;
  -webkit-backdrop-filter:blur(10px) !important;
  backdrop-filter:blur(10px) !important;
}
#scUserBadge .sc-name{
  padding:8px 14px !important;
  display:inline-flex !important;
  align-items:center !important;
  font-weight:500 !important;
  color:#ffffff !important;
  background:transparent !important;
  border:none !important;
}
#scUserBadge .sc-name-label{
  opacity:0.65 !important;
  font-weight:400 !important;
  margin-right:6px !important;
  color:#cfd3dd !important;
}
#scUserBadge .sc-name-user{
  font-weight:600 !important;
  color:#ffffff !important;
}
#scUserBadge .sc-sep{
  width:1px !important;
  flex-shrink:0 !important;
  background:rgba(255,255,255,0.1) !important;
  align-self:stretch !important;
}
#scUserBadge .sc-btn{
  padding:8px 14px !important;
  border:none !important;
  background:transparent !important;
  color:#aab1c0 !important;
  cursor:pointer !important;
  font:inherit !important;
  font-size:12px !important;
  flex-shrink:0 !important;
  transition:none !important;
  margin:0 !important;
  outline:none !important;
  display:inline-flex !important;
  align-items:center !important;
  -webkit-appearance:none !important;
  appearance:none !important;
}
#scUserBadge .sc-btn:hover{
  background:rgba(248,113,113,0.18) !important;
  color:#f87171 !important;
}
#scUserBadge .sc-btn:active{
  background:rgba(248,113,113,0.28) !important;
}
#scUserBadge .sc-btn[aria-disabled="true"]{
  opacity:0.55 !important;
  cursor:default !important;
}
`;
    (document.head || document.documentElement).appendChild(css);
  }

  const wrap = document.createElement("div");
  wrap.id = "scUserBadge";

  // Левая часть: метка "Профиль" + имя пользователя
  const name = document.createElement("span");
  name.className = "sc-name";
  const nameLabel = document.createElement("span");
  nameLabel.className = "sc-name-label";
  nameLabel.textContent = "Профиль:";
  const nameUser = document.createElement("span");
  nameUser.className = "sc-name-user";
  nameUser.textContent = " " + displayName;
  nameUser.title = user;  // полный username в tooltip
  name.appendChild(nameLabel);
  name.appendChild(nameUser);

  const sep = document.createElement("span");
  sep.className = "sc-sep";

  // div role="button" вместо <button> — не попадает под внешний CSS для кнопок
  const btn = document.createElement("div");
  btn.className = "sc-btn";
  btn.setAttribute("role", "button");
  btn.setAttribute("tabindex", "0");
  btn.textContent = "Выйти";
  const doLogout = async () => {
    if (btn.getAttribute("aria-disabled") === "true") return;
    btn.setAttribute("aria-disabled", "true");
    btn.textContent = "…";
    try { await fetch("/logout", { method: "POST" }); } catch {}
    window.location.href = "/login";
  };
  btn.addEventListener("click", doLogout);
  btn.addEventListener("keydown", e => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      doLogout();
    }
  });

  wrap.appendChild(name);
  wrap.appendChild(sep);
  wrap.appendChild(btn);

  // Пытаемся встроить в существующую верхнюю навигацию — В НАЧАЛО
  // (перед первой ссылкой «Создать» / «Галерея» / «Тарифы» / «Помощь»),
  // чтобы порядок был: Профиль → Создать → Галерея → Тарифы → Помощь
  const navLink = Array.from(document.querySelectorAll("a"))
    .find(a => {
      const t = a.textContent.trim().toLowerCase();
      return ["создать", "галерея", "тарифы", "помощь"].includes(t);
    });

  let injected = false;
  if (navLink && navLink.parentElement) {
    try {
      navLink.parentElement.insertBefore(wrap, navLink);  // вставляем ПЕРЕД первой ссылкой
      injected = true;
      console.log("[SlideCraft] user badge встроен в начало навигации");
    } catch (e) {
      console.warn("[SlideCraft] не удалось встроить в навигацию:", e);
    }
  }

  if (!injected) {
    // Fallback: плавающий справа сверху
    wrap.classList.add("sc-badge-fixed");
    document.body.appendChild(wrap);
    console.log("[SlideCraft] user badge: fallback на position:fixed");
  }
};

/* ============================================================
   Тарифы — модалка с описанием планов Free и Pro.
   Пока БЕЗ оплаты — просто визуальная демонстрация.
   Открывается по клику на «Тарифы» в верхнем меню.
   ============================================================ */
SC.ensurePricingUi = () => {
  if (SC.$("pricingOverlay")) return;

  const st = document.createElement("style");
  st.textContent = `
    .pricing-overlay{position:fixed;inset:0;z-index:1100;background:rgba(9,10,13,.85);
      backdrop-filter:blur(8px);overflow-y:auto;padding:48px 24px}
    .pricing-overlay.g-hidden{display:none}
    .pricing-box{width:min(880px,100%);margin:0 auto}
    .pricing-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:24px}
    .pricing-head h2{margin:0;font-size:24px;color:#e8eaf0;font-weight:700}
    .pricing-close{width:38px;height:38px;border-radius:10px;
      border:1px solid #3a3f4b;background:transparent;color:#aab1c0;
      font-size:18px;line-height:1;padding:0;cursor:pointer;
      display:inline-flex;align-items:center;justify-content:center;
      font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
      transition:background .15s,color .15s}
    .pricing-close:hover{background:#22242c;color:#e8eaf0}
    .pricing-grid{display:grid;grid-template-columns:1fr 1fr;gap:18px}
    @media (max-width:720px){.pricing-grid{grid-template-columns:1fr}}
    .plan{background:#171920;border:1px solid #2a2d38;border-radius:16px;padding:24px;
      display:flex;flex-direction:column;position:relative}
    .plan.pro{border-color:#4a7cff;
      box-shadow:0 0 0 1px rgba(74,124,255,0.3),0 12px 40px rgba(74,124,255,0.18)}
    .plan-name{font-size:13px;text-transform:uppercase;letter-spacing:1.5px;
      opacity:0.7;margin-bottom:10px;font-weight:600}
    .plan.pro .plan-name{color:#4a7cff;opacity:1}
    .plan-price{font-size:40px;font-weight:800;margin-bottom:6px;line-height:1;
      color:#e8eaf0}
    .plan-price .unit{font-size:14px;font-weight:500;opacity:0.55;margin-left:4px}
    .plan-tagline{opacity:0.65;font-size:13px;margin-bottom:22px;min-height:38px;line-height:1.5}
    .plan-features{list-style:none;padding:0;margin:0 0 24px;flex:1}
    .plan-features li{padding:9px 0;border-top:1px solid #2a2d38;font-size:14px;
      display:flex;gap:10px;align-items:flex-start;line-height:1.45}
    .plan-features li:first-child{border-top:none}
    .plan-features .check{color:#34d399;flex-shrink:0;font-weight:700}
    .plan-features .cross{color:#7f8595;flex-shrink:0}
    .plan-features .cross + span{text-decoration:line-through;opacity:0.5}
    .plan-btn{padding:13px;border:none;border-radius:10px;font:inherit;font-weight:600;
      font-size:14px;cursor:pointer;width:100%;transition:transform .05s,box-shadow .15s}
    .plan-btn.free{background:#2a2f3d;color:#cfd3dd}
    .plan-btn.pro{background:linear-gradient(135deg,#4a7cff,#6e8fff);color:#fff;
      box-shadow:0 4px 14px rgba(74,124,255,0.35)}
    .plan-btn.pro:hover{box-shadow:0 6px 20px rgba(74,124,255,0.5)}
    .plan-btn:active{transform:translateY(1px)}
    .plan-btn:disabled{cursor:not-allowed;opacity:0.7}
    .plan-badge{display:inline-block;background:rgba(74,124,255,0.2);color:#4a7cff;
      padding:2px 8px;border-radius:10px;font-size:10px;font-weight:700;
      letter-spacing:0.8px;margin-left:8px;vertical-align:middle}
    .pricing-note{margin-top:24px;text-align:center;font-size:12px;opacity:0.5;line-height:1.6}
  `;
  document.head.appendChild(st);

  const ov = document.createElement("div");
  ov.id = "pricingOverlay";
  ov.className = "pricing-overlay g-hidden";
  ov.innerHTML = `
    <div class="pricing-box">
      <div class="pricing-head">
        <h2>💳 Тарифы</h2>
        <button id="pricingCloseBtn" class="pricing-close" title="Закрыть (Esc)">✕</button>
      </div>
      <div class="pricing-grid">
        <div class="plan free">
          <div class="plan-name">Бесплатно</div>
          <div class="plan-price">0 ₽</div>
          <div class="plan-tagline">Попробовать без обязательств — хватит для знакомства с инструментом</div>
          <ul class="plan-features">
            <li><span class="check">✓</span><span>1 генерация в день</span></li>
            <li><span class="check">✓</span><span>Режим «Быстро»</span></li>
            <li><span class="check">✓</span><span>Базовые layouts (title, bullets, quote и др.)</span></li>
            <li><span class="check">✓</span><span>Просмотр и навигация</span></li>
            <li><span class="check">✓</span><span>Экспорт в PDF</span></li>
            <li><span class="cross">✗</span><span>Режим «Раздумия»</span></li>
            <li><span class="cross">✗</span><span>Редактирование слайдов</span></li>
            <li><span class="cross">✗</span><span>Экспорт в PPTX/ODP</span></li>
            <li><span class="cross">✗</span><span>Галерея презентаций</span></li>
            <li><span class="cross">✗</span><span>До 8 слайдов</span></li>
          </ul>
          <button class="plan-btn free" disabled>Текущий план</button>
        </div>
        <div class="plan pro">
          <div class="plan-name">Pro <span class="plan-badge">ПОПУЛЯРНЫЙ</span></div>
          <div class="plan-price">750 ₽<span class="unit">/ мес</span></div>
          <div class="plan-tagline">Для регулярной работы с презентациями и командой</div>
          <ul class="plan-features">
            <li><span class="check">✓</span><span>10 генераций «Быстро» в месяц</span></li>
            <li><span class="check">✓</span><span>5 генераций «Раздумия» в месяц</span></li>
            <li><span class="check">✓</span><span>Доступ к редактированию слайдов</span></li>
            <li><span class="check">✓</span><span>Экспорт в PPTX и ODP</span></li>
            <li><span class="check">✓</span><span>Галерея презентаций</span></li>
            <li><span class="check">✓</span><span>До 35 слайдов в презентации</span></li>
            <li><span class="check">✓</span><span>Все layouts: pie, timeline, big_stat, steps, text_heavy</span></li>
            <li><span class="check">✓</span><span>ИИ-редактор отдельного слайда</span></li>
            <li><span class="check">✓</span><span>Сравнение компаний через ИИ</span></li>
          </ul>
          <button class="plan-btn pro" id="chooseProBtn">Выбрать Pro</button>
        </div>
      </div>
      <div class="pricing-note">
        Оплата скоро будет доступна. Сейчас планы показаны для информации —
        все функции открыты для залогиненных пользователей.
      </div>
    </div>
  `;
  document.body.appendChild(ov);

  SC.$("pricingCloseBtn").addEventListener("click", SC.closePricing);
  ov.addEventListener("click", e => { if (e.target === ov) SC.closePricing(); });
  SC.$("chooseProBtn").addEventListener("click", () => {
    alert("Оплата скоро будет доступна. Спасибо за интерес к Pro!");
  });
};

SC.openPricing = () => {
  SC.ensurePricingUi();
  SC.$("pricingOverlay")?.classList.remove("g-hidden");
};

SC.closePricing = () => {
  SC.$("pricingOverlay")?.classList.add("g-hidden");
};

SC.pricingIsOpen = () =>
  !!SC.$("pricingOverlay") && !SC.$("pricingOverlay").classList.contains("g-hidden");

// Хук навигации «Тарифы» + Esc-обработчик.
// Кнопку в сайдбар НЕ добавляем — только верхняя навигация.
SC.injectPricingHook = () => {
  if (SC._pricingHookInjected) return;
  SC._pricingHookInjected = true;

  // 1. Ссылка «Тарифы» в верхнем меню
  document.querySelectorAll("a").forEach(a => {
    const t = a.textContent.trim().toLowerCase();
    if (t === "тарифы") {
      a.addEventListener("click", e => {
        e.preventDefault();
        SC.openPricing();
      });
      a.style.cursor = "pointer";
    }
  });

  // 2. Esc закрывает модалку тарифов
  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && SC.pricingIsOpen()) SC.closePricing();
  });
};

/* ============================================================
   Гамбургер-меню для мобильного.
   Кнопка «☰ Настройки» сверху, при тапе открывает сайдбар
   как slide-in drawer слева. На десктопе кнопка скрыта.
   ============================================================ */
SC.injectMobileSidebarToggle = () => {
  if (document.getElementById("scMobileToggle")) return;

  // Кнопка-гамбургер (короткий текст)
  const btn = document.createElement("button");
  btn.id = "scMobileToggle";
  btn.type = "button";
  btn.innerHTML = "<span class='sc-burger-icon'>☰</span> Настройки";
  btn.addEventListener("click", () => SC.toggleMobileSidebar());

  // Затемнённый фон + подсказка "Тапни здесь, чтобы закрыть"
  const backdrop = document.createElement("div");
  backdrop.id = "scMobileBackdrop";
  const hint = document.createElement("div");
  hint.className = "sc-backdrop-hint";
  hint.textContent = "← Тапни здесь, чтобы закрыть";
  backdrop.appendChild(hint);
  backdrop.addEventListener("click", () => SC.toggleMobileSidebar(false));

  // Кнопка "×" в верхнем правом углу drawer'а (когда открыт)
  const closeBtn = document.createElement("button");
  closeBtn.className = "sc-drawer-close";
  closeBtn.type = "button";
  closeBtn.setAttribute("aria-label", "Закрыть настройки");
  closeBtn.textContent = "×";
  closeBtn.addEventListener("click", () => SC.toggleMobileSidebar(false));

  // Вставляем кнопку-гамбургер в начало main
  const main = document.querySelector("main");
  if (main) {
    main.insertBefore(btn, main.firstChild);
  } else {
    btn.style.position = "fixed";
    btn.style.top = "60px";
    btn.style.left = "8px";
    btn.style.right = "8px";
    btn.style.zIndex = "9997";
    document.body.appendChild(btn);
  }
  document.body.appendChild(backdrop);
  document.body.appendChild(closeBtn);

  // При клике на «Сгенерировать» — закрыть drawer автоматически
  const genBtn = SC.$("generateBtn");
  if (genBtn) {
    genBtn.addEventListener("click", () => {
      setTimeout(() => SC.toggleMobileSidebar(false), 200);
    });
  }
};

SC.toggleMobileSidebar = (open) => {
  const panel = document.querySelector(".panel");
  const backdrop = document.getElementById("scMobileBackdrop");
  const closeBtn = document.querySelector(".sc-drawer-close");
  if (!panel) return;
  const isOpen = panel.classList.contains("sc-mobile-open");
  const shouldOpen = (open === undefined) ? !isOpen : open;
  panel.classList.toggle("sc-mobile-open", shouldOpen);
  if (backdrop) backdrop.classList.toggle("sc-mobile-open", shouldOpen);
  if (closeBtn) closeBtn.classList.toggle("sc-mobile-open", shouldOpen);
  // Блокируем скролл body когда drawer открыт
  document.body.style.overflow = shouldOpen ? "hidden" : "";
};

SC.buildEditPrompt = (slide, instruction) => {
  const tpl = SC._editPromptTpl || SC._FALLBACK_EDIT;
  return SC._substitute(tpl, {
    slideJson: JSON.stringify(slide, null, 2),
    instruction,
    currentLayout: slide.layout || "—",
  }).trim();
};

SC.askAiEdit = async (instruction) => {
  if (!SC.config) {
    SC.setStatus("Конфиг не загружен. Запущен ли main.py на 127.0.0.1:8787?");
    return;
  }
  const p = SC.state.presentation;
  if (!p) { alert("Сначала сгенерируй или загрузи презентацию"); return; }
  const slide = p.slides?.[SC.state.currentSlide];
  if (!slide) return;
  const instr = String(instruction || "").trim();
  if (!instr) {
    SC.setStatus("Введи инструкцию для ИИ в поле справа");
    return;
  }

  const submitBtn = SC.$("aiEditSubmit");
  const undoBtn   = SC.$("aiEditUndo");
  const ta = SC.$("aiEditInstruction");
  if (submitBtn) submitBtn.disabled = true;
  if (ta) ta.disabled = true;
  SC.setStatus("ИИ правит слайд…");

  try {
    const text = await SC.callOllama([
      { role: "system", content: "Ты дизайнер презентаций. Возвращай только валидный JSON без markdown." },
      { role: "user", content: SC.buildEditPrompt(slide, instr) }
    ]);
    const newSlide = JSON.parse(SC.extractJson(text));

    // Строгая валидация: если ИИ вернул фигню — НЕ трогаем оригинал
    const validation = SC.validateSlide(newSlide);
    if (!validation.ok) {
      throw new Error(
        `ИИ вернул некорректный слайд (${validation.error}). ` +
        `Оригинал сохранён. Попробуй переформулировать инструкцию.`
      );
    }

    // Сохраняем предыдущую версию для отмены
    SC._lastBeforeAiEdit = {
      index: SC.state.currentSlide,
      slide: JSON.parse(JSON.stringify(slide)),
    };

    // Применяем новый слайд
    p.slides[SC.state.currentSlide] = newSlide;
    SC._patchNewLayouts?.();  // патч мог ещё не сработать (мало ли)
    SC.render();
    SC.persist();
    SC.setStatus("Слайд обновлён ИИ. Если не понравилось — жми «↩ Отменить».");
    if (undoBtn) undoBtn.style.display = "";
  } catch (e) {
    console.error(e);
    // Оригинал не трогаем — он остался в p.slides[SC.state.currentSlide]
    SC.setStatus(`Ошибка: ${e.message}`);
  } finally {
    if (submitBtn) submitBtn.disabled = false;
    if (ta) ta.disabled = false;
  }
};

// Отмена последней ИИ-правки (один уровень назад)
SC.undoAiEdit = () => {
  const last = SC._lastBeforeAiEdit;
  if (!last) {
    SC.setStatus("Отменять нечего — ИИ-правок ещё не было.");
    return;
  }
  const p = SC.state.presentation;
  if (p?.slides?.[last.index]) {
    p.slides[last.index] = last.slide;
    SC.state.currentSlide = last.index;
    SC.render();
    SC.persist();
    SC.setStatus("Последняя ИИ-правка отменена. Оригинал восстановлен.");
  }
  SC._lastBeforeAiEdit = null;
  const undoBtn = SC.$("aiEditUndo");
  if (undoBtn) undoBtn.style.display = "none";
};
