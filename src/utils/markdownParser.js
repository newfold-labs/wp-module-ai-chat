/**
 * Simple Markdown Parser
 *
 * Converts common markdown syntax to HTML for chat messages.
 * Handles: headers, bold, italic, code, lists, links, and line breaks.
 *
 * Sits inside a small pipeline:
 *
 *   raw text → enhanceText → normalizeInlineLists → markdown → enhanceHtml → sanitize
 *
 * The enhancers (./messageEnhancers.js) are responsible for non-markdown UX
 * improvements (callout boxes, status badges, key/value pair lists, WP-admin
 * path linkification). This file owns the markdown core itself.
 */

import {
	enhanceHtml,
	enhanceText,
	hasEnhancementSignal,
} from "./messageEnhancers";

/**
 * Words to strip from the end of a URL when they were incorrectly included
 * (e.g. ?p=58Is, path/If, or after newline). Primary fix: words *after* the URL.
 * Also used for leading cases: Wordhttp:// and markdown [Word http](url).
 */
const SENTENCE_STARTER_WORDS_AFTER_URL = [
	"Would",
	"If",
	"Word",
	"Like",
	"And",
	"But",
	"Or",
	"So",
	"Maybe",
	"Perhaps",
	"Well",
	"Yes",
	"No",
	"When",
	"Where",
	"How",
	"Why",
	"It",
	"To",
	"We",
	"Do",
	"Be",
	"As",
	"An",
	"The",
	"You",
	"In",
	"On",
	"At",
	"By",
	"Is",
];

/** Word immediately followed by http(s) (no space) - pre-pass insert space. */
const WORD_BEFORE_URL_NO_SPACE = new RegExp(
	`\\b(${SENTENCE_STARTER_WORDS_AFTER_URL.join("|")})(https?:\\/\\/)`,
	"gi"
);

/** One or more prose words + spaces, then rest - for trimming markdown link text. */
const PROSE_WORDS_THEN_URL = new RegExp(
	`^((${SENTENCE_STARTER_WORDS_AFTER_URL.join("|")})\\s+)+(.+)$`,
	"i"
);

/** Trailing /Word at end of URL (e.g. path/If) - strip Word from URL. */
const TRAILING_SLASH_WORD = new RegExp(
	`\\/(${SENTENCE_STARTER_WORDS_AFTER_URL.join("|")})$`,
	"i"
);

/** Trailing digit+Word at end of URL (e.g. ?p=58Is) - strip Word from URL. */
const TRAILING_DIGIT_WORD = new RegExp(
	`(\\d)(${SENTENCE_STARTER_WORDS_AFTER_URL.join("|")})$`,
	"i"
);

const URL_ONLY_PATTERN = /^https?:\/\/[^\s<>"]+$/;

// ---------- Inline list normalization ----------
// Some backends emit lists as a single paragraph, e.g.
//   "Here are the posts: - A — published - B — draft - C — draft You can view ..."
// Standard markdown list rules are line-anchored, so the paragraph renders as
// one run-on sentence. The helpers below detect inline list patterns and
// rewrite them as proper newline-separated markdown before parsing.

const INLINE_LIST_MIN_ITEMS = 3;
// Markers we accept as inline list separators. Em-dash (—) is included but
// handled cautiously — see detectBulletedList — because it is also commonly
// used WITHIN items (e.g. "Title — status").
const INLINE_BULLET_MARKERS = ["-", "*", "•", "—"];
const EM_DASH_MIN_ITEMS = 5; // higher bar for em-dash to suppress false positives

// Closing-sentence cues. Used only as a fallback after pattern-based trailing
// detection (which learns the recurring item shape from the other items)
// fails to find a match.
const TRAILING_CUE_SOURCES = [
	"You can\\b",
	"You may\\b",
	"You'?ll\\b",
	"You should\\b",
	"You'?ve\\b",
	"Click (?:here|the)\\b",
	"Visit\\b",
	"Go to\\b",
	"Check (?:out|it|them)\\b",
	"Let me know\\b",
	"Would you (?:like|want)\\b",
	"Open (?:them|the)\\b",
	"See (?:them|the|more|all)\\b",
	"View (?:them|the|all|more)\\b",
	"Find (?:them|the|all|more)\\b",
	"Manage (?:them|the)\\b",
	"Edit (?:them|the)\\b",
	"Browse (?:them|the)\\b",
	"Need (?:help|anything)\\b",
	"If you (?:want|need|'?d|'?re|like)\\b",
	"Want me to\\b",
	"Shall I\\b",
	"Should I\\b",
	"Tell me\\b",
];
const TRAILING_CUE_RE = new RegExp(
	`\\s((?:${TRAILING_CUE_SOURCES.join("|")}).*)$`,
	"i"
);

// Tail shape we look for in items when learning the closing pattern:
// " <separator> <word>" at end of an item, e.g. " — published".
const ITEM_TAIL_RE = /(\s+[—–\-|]\s+)([A-Za-z][A-Za-z0-9_-]*)\s*$/;

function escapeForRegex(str) {
	return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function detectBulletedList(line) {
	// Build candidates: each marker that hits its required item threshold.
	const candidates = [];
	for (const marker of INLINE_BULLET_MARKERS) {
		// " <marker> " preceded by a non-space character. The lookbehind
		// prevents counting a marker that sits at the very start of the line.
		const re = new RegExp(`(?<=\\S) ${escapeForRegex(marker)} `, "g");
		const raw = [...line.matchAll(re)];
		const minSeps =
			(marker === "—" ? EM_DASH_MIN_ITEMS : INLINE_LIST_MIN_ITEMS) - 1;
		if (raw.length >= minSeps) {
			candidates.push({ marker, raw });
		}
	}
	if (candidates.length === 0) {
		return null;
	}
	// Em-dash collides with content (items often contain " — " internally),
	// so prefer any other marker when one qualifies. Em-dash is only chosen
	// when nothing else does.
	const nonEmDash = candidates.filter((c) => c.marker !== "—");
	const pool = nonEmDash.length > 0 ? nonEmDash : candidates;
	const best = pool.reduce((a, b) => (a.raw.length >= b.raw.length ? a : b));
	const matches = best.raw.map((m) => ({ index: m.index, width: m[0].length }));
	// Em-dash safeguard: after splitting, verify no item contains another " — ".
	// If it does, em-dash is being used as both separator and content, ambiguous.
	if (best.marker === "—" && hasInternalEmDash(line, matches)) {
		return null;
	}
	return { type: "bullet", marker: best.marker, matches };
}

function hasInternalEmDash(line, matches) {
	let cursor = matches[0].index + matches[0].width;
	for (let i = 1; i < matches.length; i++) {
		if (line.slice(cursor, matches[i].index).includes(" — ")) {
			return true;
		}
		cursor = matches[i].index + matches[i].width;
	}
	return line.slice(cursor).includes(" — ");
}

function detectNumberedList(line) {
	const re = /(?:^|[^\d])(\d+)([.)])\s/g;
	const raw = [...line.matchAll(re)];
	if (raw.length < INLINE_LIST_MIN_ITEMS) {
		return null;
	}
	// Numbers must be strictly sequential (1,2,3,...) to count as a list.
	const nums = raw.map((m) => parseInt(m[1], 10));
	for (let i = 1; i < nums.length; i++) {
		if (nums[i] !== nums[i - 1] + 1) {
			return null;
		}
	}
	// Each match's [0] includes a leading non-digit char (consumed by the
	// non-lookbehind alternative `[^\d]`). We need the index of the digit
	// itself so we can slice items cleanly.
	const matches = raw.map((m) => {
		const markerWidth = m[1].length + m[2].length + 1;
		const leadLen = m[0].length - markerWidth;
		return {
			index: m.index + leadLen,
			width: markerWidth,
		};
	});
	return { type: "number", matches, nums };
}

function detectInlineList(line) {
	if (!line || line.length < 24) {
		return null;
	}
	return detectNumberedList(line) || detectBulletedList(line);
}

/**
 * Learn the recurring "<sep> <word>" tail from items 0..n-2, then split the
 * last item at that boundary. Catches cases the hardcoded cue list can't,
 * e.g. "Nvidia RTX 2090 — published View them in WooCommerce: <url>" — items
 * 0..8 all end with " — published" or " — draft", so we know "published"
 * marks the end of an item and anything after it in the last item is trailing.
 */
function trailingByLearnedPattern(items) {
	if (items.length < INLINE_LIST_MIN_ITEMS) {
		return null;
	}
	// Walk items collecting tails. Stop at the first item that doesn't end with
	// the tail pattern — that item is either a true list ender (split below) or
	// a "broken" item whose end-of-tail is buried mid-content (a single
	// paragraph carrying both a list item AND the closing prose / second list).
	const tails = [];
	let stopIdx = items.length;
	for (let i = 0; i < items.length - 1; i++) {
		const m = items[i].match(ITEM_TAIL_RE);
		if (!m) {
			stopIdx = i;
			break;
		}
		tails.push({ sep: m[1].trim(), word: m[2] });
	}
	if (tails.length < INLINE_LIST_MIN_ITEMS - 1) {
		return null;
	}
	const sep = tails[0].sep;
	if (!tails.every((t) => t.sep === sep)) {
		return null;
	}
	const vocab = new Set(tails.map((t) => t.word.toLowerCase()));
	const wordsAlt = [...vocab].map(escapeForRegex).join("|");
	const splitRe = new RegExp(
		`(\\s+${escapeForRegex(sep)}\\s+)(${wordsAlt})\\b\\s+(\\S.*)$`,
		"i"
	);

	if (stopIdx === items.length) {
		// All but last matched — split the last item at the tail boundary.
		const lastItem = items[items.length - 1];
		const lm = lastItem.match(splitRe);
		if (!lm) {
			return null;
		}
		const wordEnd = lm.index + lm[1].length + lm[2].length;
		return {
			items: items.slice(0, -1).concat(lastItem.slice(0, wordEnd).trim()),
			trailing: lm[3].trim(),
		};
	}

	// Interior broken item: split it at the tail, and roll the overflow plus
	// every remaining item back into a raw "<overflow> - <item> - <item>"
	// string so the outer normalizer can re-detect it as a second inline list.
	const brokenItem = items[stopIdx];
	const lm = brokenItem.match(splitRe);
	if (!lm) {
		return null;
	}
	const wordEnd = lm.index + lm[1].length + lm[2].length;
	const cleanBroken = brokenItem.slice(0, wordEnd).trim();
	const overflow = lm[3].trim();
	const rest = items.slice(stopIdx + 1);
	const trailing =
		rest.length > 0 ? `${overflow} - ${rest.join(" - ")}` : overflow;
	return {
		items: items.slice(0, stopIdx).concat(cleanBroken),
		trailing,
	};
}

function trailingByCue(items) {
	const last = items[items.length - 1];
	const match = last.match(TRAILING_CUE_RE);
	if (!match || match.index <= 0) {
		return null;
	}
	return {
		items: items.slice(0, -1).concat(last.slice(0, match.index).trim()),
		trailing: match[1].trim(),
	};
}

/**
 * When every non-last item ends with a URL, the last item's URL is also
 * presumed to be the end of that item, and anything that follows it is
 * trailing content. Targets shapes like:
 *   "Title — status — edit: <url>" repeated, with a closing sentence after
 *   the last URL.
 */
const URL_RE = /https?:\/\/[^\s<>"]+/g;
const URL_AT_END_RE = /https?:\/\/[^\s<>"]+\s*$/;

function trailingByUrlBoundary(items) {
	if (items.length < INLINE_LIST_MIN_ITEMS) {
		return null;
	}
	for (let i = 0; i < items.length - 1; i++) {
		if (!URL_AT_END_RE.test(items[i])) {
			return null;
		}
	}
	const lastItem = items[items.length - 1];
	const matches = [...lastItem.matchAll(URL_RE)];
	if (matches.length === 0) {
		return null;
	}
	const firstUrl = matches[0];
	const urlEnd = firstUrl.index + firstUrl[0].length;
	const after = lastItem.slice(urlEnd).trim();
	if (!after) {
		return null;
	}
	return {
		items: items.slice(0, -1).concat(lastItem.slice(0, urlEnd).trim()),
		trailing: after,
	};
}

/**
 * Detect and split off any closing sentence appended to the last list item.
 * Tries pattern-based detection first (scales without a hardcoded vocabulary),
 * then a URL-boundary heuristic, and falls back to closing-phrase cues.
 */
function applyTrailingSplit(items) {
	return (
		trailingByLearnedPattern(items) ||
		trailingByUrlBoundary(items) ||
		trailingByCue(items) || { items, trailing: "" }
	);
}

function assembleOutput(preamble, listLines, trailing) {
	const parts = [];
	if (preamble) {
		parts.push(preamble);
	}
	parts.push(listLines.join("\n"));
	if (trailing) {
		// Trailing may itself be a single-line paragraph holding a second inline
		// list (e.g. "Tip: - a - b - c"); re-run the normalizer so it gets
		// bullet-ified instead of rendering as one run-on paragraph. Recursion
		// terminates because each rewrite replaces inline " - " separators with
		// newlines, after which the inner-line detector finds nothing to do.
		parts.push(normalizeInlineLists(trailing));
	}
	return parts.join("\n\n");
}

function extractItems(line, matches) {
	// matches[i] describes a separator at `index` spanning `width` characters.
	// Items live between consecutive separators.
	const items = [];
	let cursor = matches[0].index + matches[0].width;
	for (let i = 1; i < matches.length; i++) {
		items.push(line.slice(cursor, matches[i].index).trim());
		cursor = matches[i].index + matches[i].width;
	}
	items.push(line.slice(cursor).trim());
	return items.filter((s) => s.length > 0);
}

function rewriteInlineListLine(line, detection) {
	const firstIdx = detection.matches[0].index;
	let preamble = line.slice(0, firstIdx).trimEnd();
	let rawItems = extractItems(line, detection.matches);
	// Allow a 2-item inline list when every item ends with a URL — this is the
	// classic "Label: URL" pair shape (e.g. "- Category: <url> - Tag: <url>")
	// and the URL ending is a strong enough signal to override the 3-item bar.
	const isUrlPairList =
		detection.type === "bullet" &&
		rawItems.length >= 2 &&
		rawItems.every((it) => URL_AT_END_RE.test(it));
	if (rawItems.length < INLINE_LIST_MIN_ITEMS && !isUrlPairList) {
		return line;
	}
	// When the backend omits the leading separator (e.g.
	//   "Posts: A — published - B — draft - C — draft")
	// the first item lands in the preamble. If the preamble's tail matches the
	// shape of the other items, fold it back in as the first item.
	if (preamble && preambleSharesItemShape(preamble, rawItems)) {
		const intro = preamble.match(/^(.*?[:!?]\s*)(\S.*)$/);
		if (intro) {
			rawItems = [intro[2].trim(), ...rawItems];
			preamble = intro[1].trimEnd();
		} else {
			rawItems = [preamble, ...rawItems];
			preamble = "";
		}
	}
	const { items, trailing } = applyTrailingSplit(rawItems);

	const formatted =
		detection.type === "number"
			? items.map((it, i) => `${detection.nums[0] + i}. ${it}`)
			: items.map((it) => `- ${it}`);
	return assembleOutput(preamble, formatted, trailing);
}

function preambleSharesItemShape(preamble, items) {
	// Rule A: preamble ends with the same separator+word tail as the other
	// items (e.g. "Posts: A — published" vs items ending "— draft"/"— published").
	const pm = preamble.match(ITEM_TAIL_RE);
	if (pm) {
		const sep = pm[1].trim();
		let matches = 0;
		for (const it of items.slice(0, 4)) {
			const m = it.match(ITEM_TAIL_RE);
			if (m && m[1].trim() === sep) {
				matches += 1;
			}
		}
		if (matches >= 2) {
			return true;
		}
	}
	// Rule B: preamble has an "Intro: content" structure where content is
	// roughly the same scale as the items (e.g. "Tools: hammer" with items
	// "screwdriver", "wrench", "saw").
	const intro = preamble.match(/^.*?[:!?]\s+(\S.*)$/);
	if (intro) {
		const remainder = intro[1].trim();
		if (remainder) {
			const lens = items
				.slice(0, 4)
				.map((s) => s.length)
				.sort((a, b) => a - b);
			const median = lens[Math.floor(lens.length / 2)] || 0;
			if (remainder.length <= Math.max(median * 2, 12)) {
				return true;
			}
		}
	}
	return false;
}

/**
 * True when `text` contains an inline list that the standard markdown rules
 * would miss. Used by containsMarkdown so messages without other markdown
 * cues (bold, headers, etc.) still enter the markdown render path.
 *
 * @param {string} text
 * @return {boolean}
 */
export function containsInlineList(text) {
	if (!text || typeof text !== "string") {
		return false;
	}
	return normalizeInlineLists(text) !== text;
}

/**
 * Rewrite inline lists in `text` as newline-separated markdown so the rest of
 * the parsing pipeline can render them as <ul>/<ol>. Lines without a
 * recognized inline list pattern are returned unchanged.
 *
 * @param {string} text
 * @return {string}
 */
export function normalizeInlineLists(text) {
	if (!text || typeof text !== "string") {
		return text;
	}
	return text
		.split("\n")
		.map((line) => {
			const detection = detectInlineList(line);
			return detection ? rewriteInlineListLine(line, detection) : line;
		})
		.join("\n");
}

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

	if (markdownPatterns.some((pattern) => pattern.test(text))) {
		return true;
	}
	if (containsInlineList(text)) {
		return true;
	}
	// Enhancer-only inputs (callouts, status words, WP-admin paths,
	// key/value pair lists) — route through the markdown path so the
	// enhancers in the pipeline can do their work.
	return hasEnhancementSignal(text);
}

/**
 * Parse markdown text to HTML.
 *
 * @param {string} text - The markdown text to parse.
 * @param {object} [options]
 * @param {boolean} [options.streaming=false] - True while the message is
 *   still being typewriter-streamed. Skips the structural transforms
 *   (inline-list reshape, key/value pair fold, HTML-stage enhancers like
 *   status badges and callouts) so the visible text doesn't snap layouts
 *   mid-stream. The text renders as basic markdown during streaming and
 *   re-parses with the full pipeline once the caller passes streaming=false.
 * @return {string} HTML string.
 */
export function parseMarkdown(text, options = {}) {
	if (!text || typeof text !== "string") {
		return "";
	}
	const { streaming = false } = options;

	// Text-stage enhancers + inline-list reshape run before the line-anchored
	// markdown rules. Skipped during streaming to avoid the paragraph→list
	// snap that happens once a detection threshold is crossed.
	let html = streaming ? text : enhanceText(text);
	if (!streaming) {
		html = normalizeInlineLists(html);
	}

	// Escape HTML entities first (but preserve existing HTML)
	html = html
		.replace(/&(?![\w#]+;)/g, "&amp;")
		.replace(/<(?![a-zA-Z/])/g, "&lt;")
		.replace(/(?<![a-zA-Z"])>/g, "&gt;");

	// Stash bare URLs as placeholder tokens so embedded `_` and `*` (e.g. WP
	// admin URLs with `?taxonomy=product_cat&post_type=product`) don't get
	// picked up by the bold/italic regexes below. Restored just before the
	// final bare-URL linkification pass.
	const urlPlaceholders = [];
	html = html.replace(/https?:\/\/[^\s<>"]+/g, (url) => {
		const idx = urlPlaceholders.length;
		urlPlaceholders.push(url);
		return `U${idx}`;
	});

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

	// Links [text](url) - trim leading prose words from link text when rest is a URL
	html = html.replace(
		/\[([^\]]+)\]\(([^)]+)\)/g,
		(match, text, url) => {
			const trimmedText = text.trim();
			const leadingMatch = trimmedText.match(PROSE_WORDS_THEN_URL);
			const rest = leadingMatch ? leadingMatch[3].trim() : "";
			const isRestUrl =
				rest && (URL_ONLY_PATTERN.test(rest) || /^https?:\/\//.test(rest));
			const safeHref = url.replace(/"/g, "&quot;");
			if (leadingMatch && isRestUrl) {
				const leadingWords = leadingMatch[1];
				const safeUrlText = rest
					.replace(/&(?![\w#]+;)/g, "&amp;")
					.replace(/</g, "&lt;")
					.replace(/>/g, "&gt;")
					.replace(/"/g, "&quot;");
				return `${leadingWords}<a href="${safeHref}" target="_blank" rel="noopener noreferrer">${safeUrlText}</a>`;
			}
			const safeText = text
				.replace(/&/g, "&amp;")
				.replace(/</g, "&lt;")
				.replace(/>/g, "&gt;")
				.replace(/"/g, "&quot;");
			return `<a href="${safeHref}" target="_blank" rel="noopener noreferrer">${safeText}</a>`;
		}
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

	// Restore the URL placeholders stashed before bold/italic processing.
	// Tokens may appear in href attributes (markdown links) and in plain text
	// (bare URLs); both get the original URL string back. Bare ones are then
	// wrapped by linkifyBareUrlsInHtml below.
	if (urlPlaceholders.length > 0) {
		html = html.replace(/U(\d+)/g, (_match, idx) => {
			const stored = urlPlaceholders[Number(idx)];
			return stored === undefined ? _match : stored;
		});
	}

	// Linkify any remaining bare URLs in text content (e.g. inside list items)
	html = linkifyBareUrlsInHtml(html);

	// HTML-stage enhancers (status badges, WP-admin paths, callout decoration)
	// run last, just before the result is handed off for sanitization.
	if (!streaming) {
		html = enhanceHtml(html);
	}

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
	// Pre-pass: insert space between leading word and "http(s)://" so "Wouldhttp://" -> "Would http://"
	let normalizedText = text.replace(
		WORD_BEFORE_URL_NO_SPACE,
		"$1 $2"
	);
	// Match URL only at start or after whitespace/opening punctuation (word boundary)
	const urlPatternWithBoundary =
		/(^|[\s(\["'])(https?:\/\/[^\s<>"]*(?:\n[^\s<>"]*)*)/g;
	return normalizedText.replace(
		urlPatternWithBoundary,
		(fullMatch, before, url) => {
			// Normalize: remove internal whitespace/newlines so href is valid
			const normalized = url.replace(/\s+/g, "").trim();
			let trimmed = normalized.replace(/[.,;:!?)\]]+$/, "");
			let wordAfterLink = "";
			// Strip trailing /Word or digit+Word (words after URL glued in - e.g. ".../If" or "?p=58Is")
			const slashMatch = trimmed.match(TRAILING_SLASH_WORD);
			if (slashMatch) {
				wordAfterLink = slashMatch[1];
				trimmed = trimmed.replace(TRAILING_SLASH_WORD, "");
			}
			const digitWordMatch = trimmed.match(TRAILING_DIGIT_WORD);
			if (digitWordMatch) {
				wordAfterLink = digitWordMatch[2];
				trimmed = trimmed.replace(TRAILING_DIGIT_WORD, "$1");
			}
			if (!trimmed) {
				return fullMatch;
			}
			const safeHref = trimmed.replace(/"/g, "&quot;");
			// Entity-preserving escape: don't re-encode existing entities like
			// the `&amp;` that the parser's HTML escape pass has already
			// produced for query strings (e.g. "?post=51&action=edit").
			const safeText = trimmed
				.replace(/&(?![\w#]+;)/g, "&amp;")
				.replace(/</g, "&lt;")
				.replace(/>/g, "&gt;")
				.replace(/"/g, "&quot;");
			return `${before ?? ""}<a href="${safeHref}" target="_blank" rel="noopener noreferrer">${safeText}</a>${wordAfterLink ? " " + wordAfterLink : ""}`;
		}
	);
}

export default {
	containsMarkdown,
	containsInlineList,
	normalizeInlineLists,
	parseMarkdown,
	linkifyUrls,
};
