"""
search.py — обёртка над duckduckgo-search для инжекта актуальных
данных из интернета в промпт презентации.

Использование:
    from search import search_web, format_for_prompt
    results = search_web("Первая помощь при кровотечении", max_results=5)
    context = format_for_prompt(results, "Первая помощь при кровотечении")

Библиотека: pip install duckduckgo-search
(пакет ddgs — новая версия, но API совместимо)
"""
import sys
import os

# регион по умолчанию — Россия ( российские пользователи получают релевантные результаты)
DEFAULT_REGION = os.environ.get("SEARCH_REGION", "ru-ru")

try:
    # Пытаемся импортировать новый пакет ddgs, потом старый duckduckgo_search
    try:
        from ddgs import DDGS
        _USING_NEW_PKG = True
    except ImportError:
        import warnings
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", RuntimeWarning)
            from duckduckgo_search import DDGS
        _USING_NEW_PKG = False
    _DDGS_AVAILABLE = True
except ImportError:
    _DDGS_AVAILABLE = False
    _USING_NEW_PKG = False
    print(
        "⚠️  Библиотека поиска не установлена. "
        "pip install duckduckgo-search   (или: pip install ddgs)",
        file=sys.stderr,
    )


def search_web(query, max_results=5, region=None):
    """
    Возвращает список словарей: [{title, url, body}, ...].
    При ошибке или отсутствии библиотеки — пустой список.
    """
    if not _DDGS_AVAILABLE:
        return []
    if not query or not query.strip():
        return []
    if region is None:
        region = DEFAULT_REGION
    try:
        with DDGS() as ddgs:
            # Передаём region только если библиотека его поддерживает
            try:
                raw = list(ddgs.text(query, region=region, max_results=max_results))
            except TypeError:
                # Старые версии не принимают region как kwarg
                raw = list(ddgs.text(query, max_results=max_results))
        # Нормализуем ключи: разные версии отдают 'href' или 'url'
        out = []
        for r in raw:
            if not isinstance(r, dict):
                continue
            title = r.get("title") or ""
            body = r.get("body") or r.get("snippet") or r.get("abstract") or ""
            url = r.get("href") or r.get("url") or r.get("link") or ""
            if not (title or body):
                continue
            out.append({
                "title": title.strip(),
                "url": url.strip(),
                "body": body.strip(),
            })
        return out[:max_results]
    except Exception as e:
        print(f"[search] error: {type(e).__name__}: {e}", file=sys.stderr)
        return []


def format_for_prompt(results, query):
    """
    Форматирует результаты в строку для инжекта в system message LLM.
    Если результатов нет — возвращает пустую строку.
    """
    if not results:
        return ""
    lines = [
        f'Актуальные данные из интернета по запросу "{query}" '
        f'(используй их для метрик, фактов, цифр в презентации):'
    ]
    for i, r in enumerate(results, 1):
        title = r["title"][:150]
        body = r["body"][:500]
        url = r["url"]
        lines.append(f"\n{i}. {title}")
        if body:
            lines.append(body)
        if url:
            lines.append(f"Источник: {url}")
    lines.append(
        "\nЕсли данные противоречивые — выбери наиболее правдоподобные и актуальные. "
        "Не выдумывай цифры, если их нет в источниках выше."
    )
    return "\n".join(lines)


def is_available():
    """Возвращает True, если библиотека поиска установлена и готова."""
    return _DDGS_AVAILABLE


def package_name():
    """Какой пакет используется (для отладки)."""
    if not _DDGS_AVAILABLE:
        return None
    return "ddgs" if _USING_NEW_PKG else "duckduckgo_search"
