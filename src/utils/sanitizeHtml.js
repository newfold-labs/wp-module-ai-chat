/**
 * External dependencies
 */
import DOMPurify from "dompurify";

/**
 * Sanitize HTML content using DOMPurify to prevent XSS attacks
 *
 * @param {string} html - The HTML string to sanitize.
 * @return {string} The sanitized HTML string.
 */
export const sanitizeHtml = (html) => {
	return DOMPurify.sanitize(html, {
		ALLOWED_TAGS: [
			"section",
			"div",
			"h1",
			"h2",
			"h3",
			"h4",
			"h5",
			"h6",
			"p",
			"span",
			"strong",
			"em",
			"b",
			"i",
			"u",
			"s",
			"mark",
			"small",
			"sub",
			"sup",
			"a",
			"br",
			"ul",
			"ol",
			"li",
			"dl",
			"dt",
			"dd",
			"blockquote",
			"code",
			"pre",
			"table",
			"thead",
			"tbody",
			"tr",
			"th",
			"td",
			"hr",
			"address",
			"time",
		],
		// `style` and `id` are intentionally omitted. Rendered chat content is model output passed
		// to dangerouslySetInnerHTML, so an inline `style` allows a CSS overlay/redress of the admin
		// UI and `id` allows DOM clobbering. The chat's own rich formatting uses `class`, so dropping
		// these removes attacker reach without affecting legitimate rendering.
		ALLOWED_ATTR: ["class", "href", "datetime", "target", "rel"],
		ALLOW_DATA_ATTR: false,
		FORBID_TAGS: [
			"script",
			"object",
			"embed",
			"iframe",
			"form",
			"fieldset",
			"legend",
			"label",
			"input",
			"textarea",
			"select",
			"option",
			"button",
			"details",
			"summary",
			"progress",
			"meter",
		],
		FORBID_ATTR: ["onerror", "onload", "onclick", "onmouseover", "onfocus", "onblur"],
	});
};

/**
 * Check if content contains HTML tags
 *
 * @param {string} content - The content to check.
 * @return {boolean} True if content contains HTML tags.
 */
export const containsHtml = (content) => {
	return /<[a-z][\s\S]*>/i.test(content);
};

export default {
	sanitizeHtml,
	containsHtml,
};
