/**
 * Message enhancers — small composable transforms that improve the rendering
 * of chat messages whose backend output isn't quite presentation-ready.
 *
 * Two pipelines:
 *
 *   enhanceText(rawText) → text
 *     Runs on raw message text BEFORE markdown parsing. Reshape text so that
 *     the markdown parser can do its job (e.g. promote "Note: ..." lines into
 *     blockquotes, rewrite inline `Key: value, Key: value` runs as bullet
 *     lists).
 *
 *   enhanceHtml(html) → html
 *     Runs on parsed HTML BEFORE sanitization. Decorate structural elements
 *     the parser produced (e.g. render WP statuses as colored pills, linkify
 *     `/wp-admin/...` paths, attach a typed class to callout blockquotes).
 *
 * Each enhancer is a pure (text|html) → (text|html) function. Add one by
 * implementing it and listing it in the corresponding pipeline below.
 */

// -------- shared utilities --------

function escapeForRegex(str) {
	return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeHtml(str) {
	// Use an entity-preserving escape so we don't double-encode strings that
	// already contain &amp;/&lt;/&gt;/&quot; (e.g. URLs found in text nodes
	// after the parser's escape step has already run).
	return str
		.replace(/&(?![\w#]+;)/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

/**
 * Transform every text node in an HTML string. The chat parser produces
 * well-formed HTML where text only appears between `>` and `<`, so this
 * regex-based walk is sufficient (we don't need a real DOM parser).
 */
function eachTextNode(html, transform) {
	return html.replace(/>([^<]*)</g, (match, text) => {
		if (!text) {
			return match;
		}
		return ">" + transform(text) + "<";
	});
}

// -------- status badges --------
// Closed vocabulary of WP/WooCommerce/plugin states, mapped to visual tones.
// We only badge words from this list, which keeps false positives near zero.

const STATUS_TONES = {
	published: "success",
	publish: "success",
	active: "success",
	enabled: "success",
	approved: "success",
	completed: "success",
	live: "success",
	connected: "success",
	installed: "success",
	draft: "neutral",
	inactive: "neutral",
	disabled: "neutral",
	"auto-draft": "neutral",
	uninstalled: "neutral",
	disconnected: "neutral",
	pending: "warn",
	processing: "warn",
	"on-hold": "warn",
	scheduled: "info",
	private: "info",
	refunded: "info",
	future: "info",
	trash: "danger",
	trashed: "danger",
	failed: "danger",
	cancelled: "danger",
	canceled: "danger",
	rejected: "danger",
	banned: "danger",
	suspended: "danger",
	expired: "danger",
	error: "danger",
};

const STATUS_WORDS_ALT = Object.keys(STATUS_TONES).map(escapeForRegex).join("|");
// Match a separator (em-/en-dash, hyphen, pipe, colon) followed by a known
// status word. We require a separator so we don't badge bare words appearing
// mid-sentence ("the post is published").
const STATUS_RE = new RegExp(
	`(\\s+[—–\\-|:]\\s+)(${STATUS_WORDS_ALT})\\b`,
	"gi"
);

function renderStatusBadges(html) {
	return eachTextNode(html, (text) =>
		text.replace(STATUS_RE, (match, sep, word) => {
			const tone = STATUS_TONES[word.toLowerCase()];
			return `${sep}<span class="nfd-ai-chat-status nfd-ai-chat-status--${tone}">${escapeHtml(
				word.toLowerCase()
			)}</span>`;
		})
	);
}

// -------- WP-admin path linkifier --------
// Bare paths like "/wp-admin/edit.php?post=42" arrive unlinkified because the
// underlying linkifier only recognizes http(s):// URLs. We resolve them as
// site-relative links so they're clickable in both wp-admin and front-end
// embeds.

const WP_PATH_RE =
	/(^|[\s(\["'])(\/wp-(?:admin|content|json|includes)\/[^\s<>"')]+)/g;

function linkifyAdminPaths(html) {
	return eachTextNode(html, (text) => {
		// Skip text nodes that are short or definitely don't contain a path,
		// to avoid running the regex on every list item.
		if (text.length < 8 || text.indexOf("/wp-") === -1) {
			return text;
		}
		return text.replace(WP_PATH_RE, (full, before, path) => {
			// Trim trailing punctuation that's almost certainly not part of the URL.
			const trimmed = path.replace(/[.,;:!?)\]]+$/, "");
			if (!trimmed) {
				return full;
			}
			const tail = path.slice(trimmed.length);
			const safe = escapeHtml(trimmed);
			return `${before}<a href="${safe}" target="_blank" rel="noopener noreferrer">${safe}</a>${tail}`;
		});
	});
}

// -------- callouts --------
// A paragraph that begins with "Note:", "Warning:", "Tip:", etc. becomes a
// typed callout box. We detect this in the HTML stage rather than the text
// stage because the markdown parser's HTML-escape step mangles a literal `>`
// at line start (which would otherwise be the natural blockquote route).

const CALLOUT_TYPES = {
	note: "info",
	tip: "info",
	fyi: "info",
	info: "info",
	reminder: "info",
	"heads up": "info",
	warning: "warn",
	caution: "warn",
	important: "warn",
};

const CALLOUT_KINDS_ALT = Object.keys(CALLOUT_TYPES)
	.map(escapeForRegex)
	.join("|");
const CALLOUT_HTML_RE = new RegExp(
	`<p([^>]*)>\\s*(${CALLOUT_KINDS_ALT}):\\s+([\\s\\S]*?)<\\/p>`,
	"gi"
);

function decorateCallouts(html) {
	return html.replace(CALLOUT_HTML_RE, (match, attrs, kind, rest) => {
		const tone = CALLOUT_TYPES[kind.toLowerCase()] || "info";
		const cls = `nfd-ai-chat-callout nfd-ai-chat-callout--${tone}`;
		// Drop any pre-existing class on the <p> — the callout class supersedes
		// the generic chat-p paragraph styling.
		return `<div class="${cls}"><strong>${kind}:</strong> ${rest}</div>`;
	});
}

// -------- key-value pair lists --------
// "Title: Hello, Status: draft, Author: Arun, Date: 2026-05-12" → bullet list
// with bold keys. Triggers when a single line carries 3+ "Key: value" pairs
// separated by commas or semicolons.

const KV_PAIR_RE = /^([A-Z][A-Za-z0-9 _-]{0,30}):\s+(.+)$/;

function normalizeKeyValuePairs(text) {
	return text
		.split("\n")
		.map(transformKvLine)
		.join("\n");
}

function transformKvLine(line) {
	if (line.length < 24) {
		return line;
	}
	// Don't touch lines that already look like a list or block.
	if (/^[\s>]*([-*+•]|\d+[.)])\s/.test(line)) {
		return line;
	}
	const parts = line.split(/[,;]\s+/);
	if (parts.length < 3) {
		return line;
	}
	const pairs = [];
	for (const part of parts) {
		const m = part.match(KV_PAIR_RE);
		if (!m) {
			return line;
		}
		pairs.push({ key: m[1].trim(), value: m[2].trim() });
	}
	return pairs.map((p) => `- **${p.key}:** ${p.value}`).join("\n");
}

// -------- pipelines --------

const TEXT_ENHANCERS = [
	normalizeKeyValuePairs,
];

const HTML_ENHANCERS = [
	decorateCallouts,
	renderStatusBadges,
	linkifyAdminPaths,
];

// Cheap raw-text signals that any enhancer would do something with. The
// markdown gatekeeper (containsMarkdown) consults this so that messages
// that contain ONLY enhancer-eligible content (no other markdown cues) are
// still routed through the markdown render path.
const CALLOUT_SIGNAL_RE = new RegExp(
	`^(${CALLOUT_KINDS_ALT}):\\s+`,
	"im"
);
const STATUS_SIGNAL_RE = new RegExp(
	`\\s+[—–\\-|:]\\s+(${STATUS_WORDS_ALT})\\b`,
	"i"
);
const WP_PATH_SIGNAL_RE = /\/wp-(?:admin|content|json|includes)\//;

/**
 * True when any enhancer (text- or HTML-stage) would change the output for
 * `text`. Used as a routing hint, not a transform — keep it cheap.
 *
 * @param {string} text
 * @return {boolean}
 */
export function hasEnhancementSignal(text) {
	if (!text || typeof text !== "string") {
		return false;
	}
	return (
		CALLOUT_SIGNAL_RE.test(text) ||
		STATUS_SIGNAL_RE.test(text) ||
		WP_PATH_SIGNAL_RE.test(text) ||
		enhanceText(text) !== text
	);
}

/**
 * Apply every text-stage enhancer in sequence. Order matters — see the array
 * above. Each enhancer should be a pure string → string function and must be
 * a no-op when its pattern isn't present.
 *
 * @param {string} text
 * @return {string}
 */
export function enhanceText(text) {
	if (!text || typeof text !== "string") {
		return text;
	}
	return TEXT_ENHANCERS.reduce((acc, fn) => fn(acc), text);
}

/**
 * Apply every HTML-stage enhancer in sequence. Runs after markdown parsing,
 * before DOMPurify. The output goes to the sanitizer, so any markup added
 * here must use tags/attributes the sanitizer allows (see sanitizeHtml.js).
 *
 * @param {string} html
 * @return {string}
 */
export function enhanceHtml(html) {
	if (!html || typeof html !== "string") {
		return html;
	}
	return HTML_ENHANCERS.reduce((acc, fn) => fn(acc), html);
}

export default {
	enhanceText,
	enhanceHtml,
	hasEnhancementSignal,
};
