/**
 * Simple Markdown Parser
 *
 * Converts common markdown syntax to HTML for chat messages.
 * Handles: headers, bold, italic, code, lists, links, and line breaks.
 */

/**
 * Check if a string contains markdown syntax
 *
 * @param {string} text - The text to check
 * @return {boolean} True if markdown is detected
 */
export function containsMarkdown(text) {
	if (!text || typeof text !== "string") {
		return false;
	}

	// Check for common markdown patterns
	const markdownPatterns = [
		/^#{1,6}\s/m, // Headers
		/\*\*[^*]+\*\*/, // Bold
		/\*[^*]+\*/, // Italic
		/__[^_]+__/, // Bold (underscore)
		/_[^_]+_/, // Italic (underscore)
		/`[^`]+`/, // Inline code
		/```[\s\S]*?```/, // Code blocks
		/^\s*[-*+]\s/m, // Unordered lists
		/^\s*\d+\.\s/m, // Ordered lists
		/\[([^\]]+)\]\(([^)]+)\)/, // Links
	];

	return markdownPatterns.some((pattern) => pattern.test(text));
}

/**
 * Parse markdown text to HTML
 *
 * @param {string} text - The markdown text to parse
 * @return {string} HTML string
 */
export function parseMarkdown(text) {
	if (!text || typeof text !== "string") {
		return "";
	}

	let html = text;

	// Escape HTML entities first (but preserve existing HTML)
	html = html
		.replace(/&(?![\w#]+;)/g, "&amp;")
		.replace(/<(?![a-zA-Z/])/g, "&lt;")
		.replace(/(?<![a-zA-Z"])>/g, "&gt;");

	// Code blocks (``` ... ```) - must be done before other processing
	html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, (match, lang, code) => {
		const escapedCode = code.trim().replace(/</g, "&lt;").replace(/>/g, "&gt;");
		return `<pre><code class="language-${lang || "plaintext"}">${escapedCode}</code></pre>`;
	});

	// Inline code (` ... `)
	html = html.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');

	// Headers (### ... )
	html = html.replace(/^######\s+(.+)$/gm, '<h6 class="chat-h6">$1</h6>');
	html = html.replace(/^#####\s+(.+)$/gm, '<h5 class="chat-h5">$1</h5>');
	html = html.replace(/^####\s+(.+)$/gm, '<h4 class="chat-h4">$1</h4>');
	html = html.replace(/^###\s+(.+)$/gm, '<h3 class="chat-h3">$1</h3>');
	html = html.replace(/^##\s+(.+)$/gm, '<h2 class="chat-h2">$1</h2>');
	html = html.replace(/^#\s+(.+)$/gm, '<h1 class="chat-h1">$1</h1>');

	// Bold (**text** or __text__)
	html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
	html = html.replace(/__([^_]+)__/g, "<strong>$1</strong>");

	// Italic (*text* or _text_) - but not inside URLs or code
	html = html.replace(/(?<![*_])\*(?!\*)([^*\n]+)(?<!\*)\*(?!\*)/g, "<em>$1</em>");
	html = html.replace(/(?<![_*])_(?!_)([^_\n]+)(?<!_)_(?!_)/g, "<em>$1</em>");

	// Links [text](url)
	html = html.replace(
		/\[([^\]]+)\]\(([^)]+)\)/g,
		'<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>'
	);

	// Unordered lists - collect consecutive list items
	html = html.replace(/^(\s*)[-*+]\s+(.+)$/gm, (match, indent, content) => {
		const level = Math.floor(indent.length / 2);
		return `<li class="chat-li" data-level="${level}">${content}</li>`;
	});

	// Wrap consecutive list items in <ul>
	html = html.replace(/((?:<li[^>]*>.*?<\/li>\s*)+)/g, (match) => {
		const cleanedItems = match.replace(/(<\/li>)\s+(<li)/g, "$1$2");
		return `<ul class="chat-ul">${cleanedItems}</ul>`;
	});

	// Ordered lists
	html = html.replace(/^(\s*)\d+\.\s+(.+)$/gm, (match, indent, content) => {
		const level = Math.floor(indent.length / 2);
		return `<oli class="chat-oli" data-level="${level}">${content}</oli>`;
	});

	// Wrap consecutive ordered list items in <ol>
	html = html.replace(/((?:<oli[^>]*>.*?<\/oli>\s*)+)/g, (match) => {
		const cleanedItems = match
			.replace(/(<\/oli>)\s+(<oli)/g, "$1$2")
			.replace(/<\/?oli/g, (m) => m.replace("oli", "li"));
		return `<ol class="chat-ol">${cleanedItems}</ol>`;
	});

	// Horizontal rules
	html = html.replace(/^---+$/gm, '<hr class="chat-hr" />');

	// Blockquotes
	html = html.replace(/^>\s+(.+)$/gm, '<blockquote class="chat-blockquote">$1</blockquote>');

	// Paragraphs - wrap text blocks that aren't already wrapped
	const blocks = html.split(/\n\n+/);
	html = blocks
		.map((block) => {
			const trimmed = block.trim();
			if (
				trimmed.startsWith("<h") ||
				trimmed.startsWith("<ul") ||
				trimmed.startsWith("<ol") ||
				trimmed.startsWith("<pre") ||
				trimmed.startsWith("<blockquote") ||
				trimmed.startsWith("<hr") ||
				trimmed.startsWith("<p")
			) {
				return trimmed;
			}
			if (trimmed) {
				return `<p class="chat-p">${trimmed}</p>`;
			}
			return "";
		})
		.filter(Boolean)
		.join("");

	// Convert single line breaks within paragraphs to <br>
	html = html.replace(/<p([^>]*)>([\s\S]*?)<\/p>/g, (match, attrs, content) => {
		const processedContent = content.trim().replace(/\n/g, "<br>");
		return `<p${attrs}>${processedContent}</p>`;
	});

	// Clean up stray <br> tags between block elements
	html = html.replace(/<br\s*\/?>\s*(<\/?(ul|ol|li|p|h[1-6]|pre|blockquote|hr))/gi, "$1");
	html = html.replace(/(<\/(ul|ol|li|p|h[1-6]|pre|blockquote)>)\s*<br\s*\/?>/gi, "$1");

	// Remove empty paragraphs
	html = html.replace(/<p[^>]*>\s*<\/p>/g, "");

	// Clean up multiple consecutive <br> tags
	html = html.replace(/(<br\s*\/?>){2,}/g, "<br>");

	// Linkify any remaining bare URLs in text content (e.g. inside list items)
	html = linkifyBareUrlsInHtml(html);

	return html;
}

/**
 * Linkify bare http(s) URLs that appear in HTML text nodes (between > and <).
 * Avoids touching URLs inside existing href attributes.
 *
 * @param {string} html - HTML string (e.g. from parseMarkdown)
 * @return {string} HTML with bare URLs in text wrapped in <a> tags
 */
function linkifyBareUrlsInHtml(html) {
	if (!html || typeof html !== "string") {
		return "";
	}
	return html.replace(/>([^<]*)</g, (match, textNode) => ">" + linkifyUrls(textNode) + "<");
}

/**
 * Replace bare http(s) URLs in plain text with clickable anchor tags.
 * Use only on plain text (no existing HTML) so we don't double-wrap or break attributes.
 *
 * @param {string} text - Plain text that may contain URLs
 * @return {string} Text with URLs wrapped in <a href="..." target="_blank" rel="noopener noreferrer">...</a>
 */
export function linkifyUrls(text) {
	if (!text || typeof text !== "string") {
		return "";
	}
	// Match http(s) URLs, including when broken across lines (optional \n + continuation)
	const urlPattern = /(https?:\/\/[^\s<>"]*(?:\n[^\s<>"]*)*)/g;
	return text.replace(urlPattern, (fullMatch) => {
		// Normalize: remove internal whitespace/newlines so href is valid
		const normalized = fullMatch.replace(/\s+/g, "").trim();
		let trimmed = normalized.replace(/[.,;:!?)\]]+$/, "");
		// Strip trailing /Word when Word looks like start of next sentence (e.g. "...testing/If you"); keep the word for output
		const sentenceStarterMatch = trimmed.match(
			/\/(If|It|To|We|So|Or|In|On|At|By|Do|Be|As|An|The|You)$/i
		);
		const wordAfterLink = sentenceStarterMatch ? sentenceStarterMatch[1] : "";
		if (wordAfterLink) {
			trimmed = trimmed.replace(/\/(If|It|To|We|So|Or|In|On|At|By|Do|Be|As|An|The|You)$/i, "");
		}
		if (!trimmed) {
			return fullMatch;
		}
		const safeHref = trimmed.replace(/"/g, "&quot;");
		const safeText = trimmed
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;")
			.replace(/"/g, "&quot;");
		return `<a href="${safeHref}" target="_blank" rel="noopener noreferrer">${safeText}</a>${wordAfterLink ? " " + wordAfterLink : ""}`;
	});
}

export default {
	containsMarkdown,
	parseMarkdown,
	linkifyUrls,
};
