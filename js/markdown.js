/**
 * Tiny dependency-free Markdown renderer.
 * Supports: fenced code, headings, lists, quotes, tables, hr,
 * inline code / bold / italic / strike / links / images.
 * Always escapes HTML — model output is never trusted.
 */

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);

/** Only allow protocols that cannot execute script. */
function safeUrl(url) {
  const u = String(url).trim();
  if (/^(https?:|mailto:|tel:|#|\/|\.{1,2}\/)/i.test(u)) return escapeHtml(u);
  if (/^data:image\/(png|jpe?g|gif|webp|svg\+xml|avif);/i.test(u)) return escapeHtml(u);
  return '#';
}

function renderInline(text) {
  const codes = [];
  // Pull code spans out first so their contents are never re-processed.
  let s = String(text).replace(/(`+)([\s\S]*?)\1/g, (_, _ticks, body) => {
    codes.push(body.trim());
    return `\u0000${codes.length - 1}\u0000`;
  });

  s = escapeHtml(s);

  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g,
    (_, alt, url, title) =>
      `<img class="md-img" src="${safeUrl(url)}" alt="${alt}"${title ? ` title="${title}"` : ''} loading="lazy">`);

  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g,
    (_, label, url, title) =>
      `<a href="${safeUrl(url)}" target="_blank" rel="noopener noreferrer"${title ? ` title="${title}"` : ''}>${label}</a>`);

  // Bare autolinks
  s = s.replace(/(^|[\s(])((?:https?:\/\/)[^\s<>"')]+)/g,
    (_, pre, url) => `${pre}<a href="${safeUrl(url)}" target="_blank" rel="noopener noreferrer">${url}</a>`);

  s = s.replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>');
  s = s.replace(/\*\*([\s\S]+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^\w*])\*([^*\n]+)\*(?![\w*])/g, '$1<em>$2</em>');
  s = s.replace(/(^|[^\w_])_([^_\n]+)_(?![\w_])/g, '$1<em>$2</em>');
  s = s.replace(/~~([\s\S]+?)~~/g, '<del>$1</del>');

  // Restore code spans
  s = s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${escapeHtml(codes[Number(i)])}</code>`);
  return s;
}

function codeBlock(lang, body) {
  const label = (lang || 'text').toLowerCase();
  return (
    `<div class="codeblock">` +
      `<div class="codeblock__head"><span>${escapeHtml(label)}</span>` +
      `<button type="button" data-copy>Copy</button></div>` +
      `<pre><code>${escapeHtml(body.replace(/\n$/, ''))}</code></pre>` +
    `</div>`
  );
}

/** Render Markdown to an HTML string. */
export function renderMarkdown(src) {
  if (!src) return '';
  const lines = String(src).replace(/\r\n?/g, '\n').split('\n');
  const out = [];

  let i = 0;
  const isBlank = (l) => !l || !l.trim();

  while (i < lines.length) {
    const line = lines[i];

    if (isBlank(line)) { i++; continue; }

    // ── Fenced code ──────────────────────────────────────
    const fence = line.match(/^\s*(```+|~~~+)\s*([\w+#.-]*)\s*$/);
    if (fence) {
      const marker = fence[1][0].repeat(3);
      const lang = fence[2] || '';
      const buf = [];
      i++;
      while (i < lines.length && !new RegExp(`^\\s*${marker}\\s*$`).test(lines[i])) {
        buf.push(lines[i]);
        i++;
      }
      i++; // closing fence (may be missing while streaming — that's fine)
      out.push(codeBlock(lang, buf.join('\n')));
      continue;
    }

    // ── Heading ─────────────────────────────────────────
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      const lvl = h[1].length;
      out.push(`<h${lvl}>${renderInline(h[2].trim())}</h${lvl}>`);
      i++;
      continue;
    }

    // ── Horizontal rule ─────────────────────────────────
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      out.push('<hr>');
      i++;
      continue;
    }

    // ── Table ───────────────────────────────────────────
    if (/^\s*\|.*\|\s*$/.test(line) && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1] || '')) {
      const cells = (row) => row.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));
      const head = cells(lines[i]);
      i += 2;
      const body = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
        body.push(cells(lines[i]));
        i++;
      }
      out.push(
        '<table><thead><tr>' + head.map((c) => `<th>${renderInline(c)}</th>`).join('') +
        '</tr></thead><tbody>' +
        body.map((r) => '<tr>' + head.map((_, n) => `<td>${renderInline(r[n] ?? '')}</td>`).join('') + '</tr>').join('') +
        '</tbody></table>'
      );
      continue;
    }

    // ── Blockquote ──────────────────────────────────────
    if (/^\s*>\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*>\s?/, ''));
        i++;
      }
      out.push(`<blockquote>${renderMarkdown(buf.join('\n'))}</blockquote>`);
      continue;
    }

    // ── Lists ───────────────────────────────────────────
    const bullet = line.match(/^\s*([-*+])\s+(.*)$/);
    const ordered = line.match(/^\s*(\d{1,9})[.)]\s+(.*)$/);
    if (bullet || ordered) {
      const isOrdered = !!ordered;
      const items = [];
      while (i < lines.length) {
        const l = lines[i];
        const b = l.match(/^\s*([-*+])\s+(.*)$/);
        const o = l.match(/^\s*(\d{1,9})[.)]\s+(.*)$/);
        if (isOrdered && o) { items.push(o[2]); i++; }
        else if (!isOrdered && b) { items.push(b[2]); i++; }
        else if (!isBlank(l) && items.length && /^\s{2,}\S/.test(l)) {
          items[items.length - 1] += ' ' + l.trim(); // continuation line
          i++;
        } else break;
      }
      const tag = isOrdered ? 'ol' : 'ul';
      out.push(`<${tag}>` + items.map((t) => `<li>${renderInline(t)}</li>`).join('') + `</${tag}>`);
      continue;
    }

    // ── Paragraph ───────────────────────────────────────
    const buf = [];
    while (i < lines.length && !isBlank(lines[i]) &&
           !/^\s*(```+|~~~+)/.test(lines[i]) &&
           !/^#{1,6}\s/.test(lines[i]) &&
           !/^\s*>\s?/.test(lines[i]) &&
           !/^\s*([-*+])\s+/.test(lines[i]) &&
           !/^\s*\d{1,9}[.)]\s+/.test(lines[i])) {
      buf.push(lines[i]);
      i++;
    }
    if (buf.length) out.push(`<p>${renderInline(buf.join('\n')).replace(/\n/g, '<br>')}</p>`);
    else i++; // safety valve against an infinite loop
  }

  return out.join('\n');
}

/** Strip markdown down to plain text (used for titles and exports). */
export function toPlainText(src) {
  return String(src || '')
    .replace(/```[\s\S]*?```/g, ' [code] ')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_`~#>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}