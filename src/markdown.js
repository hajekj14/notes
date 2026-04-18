const MarkdownIt = require("markdown-it");

const markdown = new MarkdownIt({
  html: false,
  breaks: true,
  linkify: true,
  typographer: false
});

function buildMarkdownPreview(content) {
  const previewSource = buildPreviewSource(content);

  if (!previewSource) {
    return {
      html: "",
      truncated: false
    };
  }

  return {
    html: markdown.render(previewSource),
    truncated: previewSource !== normalizeMarkdownSource(content)
  };
}

function renderMarkdown(content) {
  const normalized = normalizeMarkdownSource(content);

  if (!normalized) {
    return "";
  }

  return markdown.render(normalized);
}

function buildPreviewSource(content) {
  const normalized = normalizeMarkdownSource(content);

  if (!normalized) {
    return "";
  }

  const lineLimited = normalized.split("\n").slice(0, 18).join("\n").trimEnd();
  const charLimited = lineLimited.length > 900
    ? `${lineLimited.slice(0, 900).trimEnd()}\n\n…`
    : lineLimited;

  if (charLimited === normalized) {
    return charLimited;
  }

  return `${charLimited.trimEnd()}\n\n…`;
}

function normalizeMarkdownSource(content) {
  if (typeof content !== "string") {
    return "";
  }

  return content.replace(/\r\n/g, "\n").trim();
}

module.exports = {
  buildMarkdownPreview,
  renderMarkdown
};