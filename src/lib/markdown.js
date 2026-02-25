/**
 * Agent7 — Markdown rendering wrapper
 * Uses marked.js + highlight.js when available, falls back to plain-text escaping.
 */

function renderMarkdown(text) {
  if (typeof marked !== 'undefined') {
    marked.setOptions({
      highlight: function (code, lang) {
        if (typeof hljs !== 'undefined' && lang && hljs.getLanguage(lang)) {
          return hljs.highlight(code, { language: lang }).value;
        }
        return code;
      },
      breaks: true,
    });
    return marked.parse(text);
  }
  // Fallback: escape HTML entities and convert newlines
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/\n/g, '<br>');
}

window.renderMarkdown = renderMarkdown;
