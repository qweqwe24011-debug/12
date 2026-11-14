/* ============================================================
   layouts-extra.js — дополнительные layouts для SlideCraft.
   Загружается ПОСЛЕ render.js и патчит SC.slideInnerHtml:
   - старые layouts (title, bullets, two_columns, metrics, chart,
     table, quote, closing) — вызывается оригинальный рендер из render.js;
   - новые layouts (pie, timeline, big_stat, text_heavy, steps) —
     рендерятся здесь.
   Также патчит SC.contentClasses, чтобы big_stat был центрирован.

   В index.html подключить ПОСЛЕ render.js:
   <script src="src/render.js"></script>
   <script src="src/layouts-extra.js"></script>
   ============================================================ */
window.SC = window.SC || {};

(function () {
  const e = SC.escapeHtml || (v => String(v ?? ""));
  const PIE_COLORS = ["#4a7cff", "#ff8c42", "#34d399", "#a78bfa", "#fbbf24", "#f472b6"];

  // ---------- CSS для новых layouts ----------
  const css = `
.pie-wrap { display: flex; gap: 32px; align-items: center; margin-top: 24px; }
.pie {
  width: 240px; height: 240px; border-radius: 50%; flex-shrink: 0;
  box-shadow: 0 0 0 4px rgba(255,255,255,0.06), 0 8px 32px rgba(0,0,0,0.25);
}
.legend { display: flex; flex-direction: column; gap: 10px; flex: 1; }
.legend-item { display: flex; align-items: center; gap: 12px; font-size: 16px; }
.legend-color { width: 14px; height: 14px; border-radius: 3px; flex-shrink: 0; }
.legend-label { flex: 1; }
.legend-value { font-weight: 600; }

.timeline {
  display: flex; flex-direction: column; gap: 18px;
  margin-top: 20px; padding-left: 28px;
  border-left: 2px solid rgba(122,134,153,0.35);
}
.event { display: flex; gap: 18px; align-items: baseline; position: relative; }
.event::before {
  content: ""; position: absolute; left: -34px; top: 8px;
  width: 12px; height: 12px; border-radius: 50%;
  background: #4a7cff; box-shadow: 0 0 0 3px rgba(74,124,255,0.2);
}
.event-year { font-weight: 700; min-width: 90px; color: #4a7cff; font-size: 18px; }
.event-text { flex: 1; line-height: 1.5; }

.big-stat { text-align: center; padding: 30px 0; }
.big-value {
  font-size: 128px; font-weight: 800; line-height: 1;
  background: linear-gradient(135deg, #4a7cff, #ff8c42);
  -webkit-background-clip: text; background-clip: text;
  -webkit-text-fill-color: transparent; color: transparent;
}
.big-caption { font-size: 18px; max-width: 640px; margin: 20px auto 0; line-height: 1.5; }

.text-heavy { max-width: 820px; margin-top: 16px; }
.text-heavy p { margin: 0 0 18px; line-height: 1.65; font-size: 17px; }
.text-heavy p:last-child { margin-bottom: 0; }

.steps { display: flex; flex-direction: column; gap: 16px; margin-top: 20px; }
.step { display: flex; gap: 18px; align-items: flex-start; }
.step-num {
  width: 36px; height: 36px; border-radius: 50%;
  background: linear-gradient(135deg, #4a7cff, #6e8fff);
  color: #fff; display: flex; align-items: center; justify-content: center;
  font-weight: 700; flex-shrink: 0; box-shadow: 0 4px 12px rgba(74,124,255,0.3);
}
.step-content { flex: 1; }
.step-title { font-weight: 600; font-size: 17px; margin-bottom: 4px; }
.step-text { opacity: 0.85; line-height: 1.5; }
`;

  const styleEl = document.createElement("style");
  styleEl.id = "layouts-extra-css";
  styleEl.textContent = css;
  (document.head || document.documentElement).appendChild(styleEl);

  // ---------- Рендеры новых layouts ----------
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

  const renderBigStat = (slide, idx, total) => {
    return `<div class="kicker">Ключевой показатель</div>
      <h2 data-edit="title">${e(slide.title)}</h2>
      <div class="big-stat">
        <div class="big-value" data-edit="value">${e(slide.value)}</div>
        <div class="big-caption" data-edit="caption">${e(slide.caption || "")}</div>
      </div>
      ${SC.footerHtml(idx, total)}`;
  };

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

  // ---------- Патч SC.slideInnerHtml ----------
  const _originalSlideInnerHtml = SC.slideInnerHtml;
  SC.slideInnerHtml = (slide, idx, total) => {
    switch (slide.layout) {
      case "pie":        return renderPie(slide, idx, total);
      case "timeline":   return renderTimeline(slide, idx, total);
      case "big_stat":   return renderBigStat(slide, idx, total);
      case "text_heavy": return renderTextHeavy(slide, idx, total);
      case "steps":      return renderSteps(slide, idx, total);
      default:           return _originalSlideInnerHtml(slide, idx, total);
    }
  };

  // ---------- Патч SC.contentClasses: big_stat центрируем ----------
  const _originalContentClasses = SC.contentClasses;
  SC.contentClasses = (s) => {
    if (s?.layout === "big_stat") return "centered";
    if (s?.layout === "text_heavy") return "";  // левая выключка для длинного текста
    return _originalContentClasses(s);
  };

  // При изменении значения pie в режиме редактирования — перерисуем слайд,
  // потому что сегменты зависят от всех values сразу.
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
})();
