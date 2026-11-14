window.SC = window.SC || {};
SC.next = () => {
  const n = SC.state.presentation?.slides?.length;
  if (!n) return;
  SC.state.currentSlide = (SC.state.currentSlide + 1) % n;
  SC.render(); SC.persist();
};
SC.prev = () => {
  const n = SC.state.presentation?.slides?.length;
  if (!n) return;
  SC.state.currentSlide = (SC.state.currentSlide - 1 + n) % n;
  SC.render(); SC.persist();
};
window.SC = window.SC || {};
/* ---------- навигация ---------- */
SC.next = () => {
  const p = SC.state.presentation;
  if (!p) return;
  if (SC.state.currentSlide < p.slides.length - 1) {
    SC.state.currentSlide++;
    SC.render();
    SC.persist();
  }
  SC.toggleAiEditPanel?.(SC.state.editMode); // обновить номер слайда в панели ИИ
};
SC.prev = () => {
  if (SC.state.currentSlide > 0) {
    SC.state.currentSlide--;
    SC.render();
    SC.persist();
  }
  SC.toggleAiEditPanel?.(SC.state.editMode); // обновить номер слайда в панели ИИ
};
/* ---------- демо ---------- */
SC.loadDemo = () => {
  SC.state.presentation = {
    title: "Демо-презентация",
    slides: [
      {
        layout: "title",
        title: "Как ИИ меняет образование",
        subtitle: "Демо-режим: смотри дизайн без обращения к API. Узнай, как искусственный интеллект сокращает время подготовки уроков в 4 раза и повышает вовлечённость учеников на 87%."
      },
      {
        layout: "bullets",
        title: "Проблемы старого подхода",
        points: [
          "Учителя тратят до 3 часов на подготовку одного урока, собирая материалы из десятков источников",
          "Учебные пособия устаревают быстрее, чем их успевают напечатать — данные двухлетней давности уже неактуальны",
          "Невозможно учесть уровень каждого ученика в классе из 30 человек — кто-то отстаёт, кому-то скучно",
          "Проверка домашних работ занимает 2-3 дня, обратная связь приходит слишком поздно",
          "Отсутствует персонализация: все ученики получают одинаковые задания независимо от их способностей"
        ]
      },
      {
        layout: "chart",
        title: "Рост внедрения ИИ в школах, %",
        items: [
          { label: "2021", value: "5" },
          { label: "2022", value: "8" },
          { label: "2023", value: "12" },
          { label: "2024", value: "34" },
          { label: "2025", value: "61" },
          { label: "2026", value: "88" }
        ]
      },
      {
        layout: "table",
        title: "Сравнение подходов",
        headers: ["Критерий", "Обычно", "С ИИ", "Экономия"],
        rows: [
          ["Подготовка урока", "3 часа ручной работы", "25 минут с ИИ", "87% времени"],
          ["Проверка работ", "2 дня на класс", "4 часа автоматом", "75% времени"],
          ["Персонализация", "Нет, все одинаково", "Да, под каждого", "Невозможно без ИИ"],
          ["Обратная связь", "Через 2-3 дня", "Мгновенно", "В 50 раз быстрее"],
          ["Адаптация материалов", "Раз в год", "В реальном времени", "Постоянная актуальность"]
        ]
      },
      {
        layout: "metrics",
        title: "Результаты пилота в 50 школах",
        metrics: [
          { value: "×4", label: "быстрее подготовка уроков — учителя экономят до 10 часов в неделю" },
          { value: "87%", label: "рост вовлечённости учеников благодаря персонализированным заданиям" },
          { value: "−30%", label: "времени на проверку работ — ИИ берёт рутину на себя" },
          { value: "2.5x", label: "ускорение онбординга новых разработчиков в проект" },
          { value: "55%", label: "среднее сокращение времени написания рутинного кода" },
          { value: "92%", label: "учителей рекомендуют инструмент коллегам после месяца использования" }
        ]
      },
      {
        layout: "quote",
        text: "Технология не заменяет учителя — она возвращает ему время для главного: живого общения с учениками, творческого подхода и индивидуальной работы с теми, кому нужна помощь.",
        author: "Мария Иванова, учитель математики, школа №42, участник пилота"
      },
      {
        layout: "closing",
        title: "Спасибо!",
        subtitle: "Сгенерируй свою презентацию через кнопку выше. Введи тему, выбери количество слайдов — ИИ напишет текст, построит диаграммы и соберёт слайды за минуту."
      }
    ]
  };
  SC.state.currentSlide = 0;
  SC._patchNewLayouts?.();
  SC.render();
  SC.persist();
  SC.setStatus("Демо загружено. Попробуй экспорт в PPTX и ODP.");
};
/* ---------- редактирование ---------- */
// ВНИМАНИЕ: SC.applyEditing и SC.handleEdit живут в render.js с ПРАВИЛЬНОЙ
// сигнатурой (берут boolean / (el, commit) соответственно). Здесь их НЕ определяем —
// иначе app.js перекроет версии из render.js и редактирование сломается.
SC.toggleEdit = () => {
  SC.state.editMode = !SC.state.editMode;
  SC.$("editBtn").textContent = SC.state.editMode ? "Редактирование: вкл" : "Редактирование: выкл";
  SC.render();
};
/* ---------- инициализация ---------- */
SC.init = () => {
  SC._patchNewLayouts?.();            // патч рендера + новые layouts + иконки + counters
  SC.injectStyleOverrides?.();        // угловатый интерфейс + белый текст + Phase 1 стиль
  SC.injectMobileSidebarToggle?.();   // кнопка-гамбургер для мобильного
  SC.loadPromptTemplates?.();         // грузим prompt.txt
  SC.galleryLoadCurrentId?.();        // подгружаем «текущую» презентацию из галереи
  SC.loadExtra?.();                   // грузим сохранённые настройки
  SC.injectDesignHintToSidebar?.();   // «Дополнительно» в сайдбар + скрываем тему оформления
  SC.injectUserBadge?.();             // бейдж профиля + кнопка Выйти
  SC.injectPricingHook?.();           // хук «Тарифы» + Esc
  SC.$("generateBtn").addEventListener("click", SC.generate);
  SC.$("pdfBtn").addEventListener("click", SC.exportPdf);
  SC.$("pptxBtn").addEventListener("click", SC.exportPptx);
  SC.$("odpBtn").addEventListener("click", SC.exportOdp);
  SC.$("nextBtn").addEventListener("click", SC.next);
  SC.$("prevBtn").addEventListener("click", SC.prev);
  SC.$("demoBtn").addEventListener("click", SC.loadDemo);
  SC.$("fullscreenBtn").addEventListener("click", () => SC.$("viewer").requestFullscreen?.());
  SC.$("exitFsBtn").addEventListener("click", () => document.exitFullscreen?.());
  SC.$("editBtn").addEventListener("click", () => {
    SC.state.editMode = !SC.state.editMode;
    SC.$("editBtn").textContent = `Редактирование: ${SC.state.editMode ? "вкл" : "выкл"}`;
    SC.$("editBtn").classList.toggle("active", SC.state.editMode);
    // Перерисовываем слайд: render.js по editMode вешает contenteditable на текст.
    // Без этого клик по тексту ничего не даёт.
    SC.render();
    SC.toggleAiEditPanel?.(SC.state.editMode);
    SC.setStatus(SC.state.editMode
      ? "Кликай по тексту и правь вручную, либо опиши изменение ИИ в панели справа."
      : "Редактирование выключено.");
  });
  const slideBox = SC.$("slide");
  slideBox.addEventListener("input", e => SC.handleEdit(e.target, false));
  slideBox.addEventListener("blur", e => SC.handleEdit(e.target, true), true);
  document.addEventListener("keydown", e => {
    if (SC.state.editMode && document.activeElement?.isContentEditable) return;
    if (e.key === "ArrowRight") SC.next();
    if (e.key === "ArrowLeft") SC.prev();
  });
  if (SC.restore()) {
    SC.render();
    SC.setStatus("Восстановлена прошлая презентация.");
  }
  // Инжектим панель ИИ-редактирования (самостоятельно, без правок index.html)
  SC.injectAiEditUI?.();
};

/* ============================================================
   ИИ-редактирование — плавающая панель с полем ввода инструкции.
   UI инжектится из JS, чтобы не трогать index.html.
   Видна только в режиме редактирования.
   ============================================================ */
SC.injectAiEditUI = () => {
  if (document.getElementById("aiEditPanel")) return; // уже инжектили

  const panel = document.createElement("div");
  panel.id = "aiEditPanel";
  panel.style.cssText = [
    "position:fixed", "right:16px", "bottom:16px", "z-index:9999",
    "display:none", "flex-direction:column", "gap:8px",
    "width:340px", "padding:12px", "border-radius:10px",
    "background:#1f2330", "color:#e6e6e6",
    "box-shadow:0 8px 24px rgba(0,0,0,0.35)",
    "font:13px/1.4 system-ui,-apple-system,Segoe UI,Roboto,sans-serif",
  ].join(";");
  panel.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
      <span style="font-weight:600;">ИИ-редактор слайда</span>
      <span id="aiEditSlideNum" style="opacity:0.6;font-size:11px;">—</span>
    </div>
    <textarea id="aiEditInstruction" rows="3"
      placeholder="Опиши изменение: «сделай формальнее и добавь цифр», «переведи на английский», «сократи вдвое», «преврати в таблицу»…"
      style="width:100%;box-sizing:border-box;padding:8px;border-radius:6px;border:1px solid #3a3f4f;background:#15171f;color:#fff;font:inherit;resize:vertical;"></textarea>
    <div style="display:flex;gap:6px;flex-wrap:wrap;">
      <button data-quick="Сделай текст формальнее и добавь конкретных цифр" style="padding:4px 8px;border:none;border-radius:6px;background:#2d3346;color:#fff;cursor:pointer;font:inherit;">+цифр</button>
      <button data-quick="Сократи текст вдвое, сохранив суть" style="padding:4px 8px;border:none;border-radius:6px;background:#2d3346;color:#fff;cursor:pointer;font:inherit;">Короче</button>
      <button data-quick="Добавь больше деталей, примеров и кейсов" style="padding:4px 8px;border:none;border-radius:6px;background:#2d3346;color:#fff;cursor:pointer;font:inherit;">Подробнее</button>
      <button data-quick="Переведи слайд на английский" style="padding:4px 8px;border:none;border-radius:6px;background:#2d3346;color:#fff;cursor:pointer;font:inherit;">EN</button>
      <button data-quick="Преврати в таблицу с 4 колонками" style="padding:4px 8px;border:none;border-radius:6px;background:#2d3346;color:#fff;cursor:pointer;font:inherit;">→таблица</button>
    </div>
    <button id="aiEditSubmit" style="padding:8px 12px;border:none;border-radius:6px;background:#4a7cff;color:#fff;cursor:pointer;font-weight:600;">Изменить слайд</button>
    <button id="aiEditUndo" style="display:none;padding:8px 12px;border:none;border-radius:6px;background:#3a3f4f;color:#fff;cursor:pointer;">↩ Отменить последнюю ИИ-правку</button>
    <div style="font-size:11px;opacity:0.55;">Ctrl+Enter — отправить. ИИ переписывает текущий слайд, сохраняя layout. Если вернёт слайд с пустыми полями — правка не применится, оригинал останется.</div>
  `;
  // Внутрь viewer — чтобы панель была видна и в полноэкранном режиме
  const container = document.getElementById("viewer") || document.body;
  container.appendChild(panel);

  // Кнопки быстрых инструкций — подставляют текст в поле
  panel.querySelectorAll("[data-quick]").forEach(btn => {
    btn.addEventListener("click", () => {
      const ta = document.getElementById("aiEditInstruction");
      ta.value = btn.dataset.quick;
      ta.focus();
    });
  });

  // Сабмит
  document.getElementById("aiEditSubmit").addEventListener("click", () => {
    const instr = document.getElementById("aiEditInstruction").value;
    SC.askAiEdit(instr);
  });

  // Ctrl+Enter в текстовом поле
  document.getElementById("aiEditInstruction").addEventListener("keydown", e => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      SC.askAiEdit(e.target.value);
    }
  });

  // Кнопка отмены последней ИИ-правки
  const undoBtn = document.getElementById("aiEditUndo");
  if (undoBtn) undoBtn.addEventListener("click", () => SC.undoAiEdit());
};

SC.toggleAiEditPanel = (show) => {
  const panel = document.getElementById("aiEditPanel");
  if (!panel) return;
  panel.style.display = show ? "flex" : "none";
  if (show) {
    const num = document.getElementById("aiEditSlideNum");
    const p = SC.state.presentation;
    if (num && p?.slides?.length) {
      num.textContent = `слайд ${SC.state.currentSlide + 1} / ${p.slides.length}`;
    }
  }
};

// Сначала тянем безопасный конфиг с сервера (без ключа), потом инициализируем UI.
// 401 → сессия протухла / не залогинен → редирект на /login.
SC.loadConfig()
  .then(() => SC.init())
  .catch(err => {
    console.error("loadConfig failed:", err);
    // Если /config вернул 401 — пользователь не авторизован, на /login
    if (err.message && err.message.includes("401")) {
      window.location.href = "/login";
      return;
    }
    const status = document.getElementById("status");
    if (status) {
      status.textContent =
        `Не удалось загрузить конфиг: ${err.message}. ` +
        `Запущен ли main.py на http://127.0.0.1:8787 ?`;
    }
  });
