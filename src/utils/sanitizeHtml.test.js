/**
 * Tests for the chat HTML sanitizer.
 *
 * Rendered chat content is model output written into the DOM via dangerouslySetInnerHTML, so the
 * sanitizer is a security boundary. These tests pin the allowlist: script/handlers must never survive,
 * and `style`/`id` must be stripped (they enable admin-UI overlay/redress and DOM clobbering) while the
 * `class`-based formatting the chat actually uses is preserved.
 */

import { sanitizeHtml } from "./sanitizeHtml";

describe("sanitizeHtml", () => {
	it("strips the style attribute (blocks CSS overlay / UI redress)", () => {
		const out = sanitizeHtml(
			'<div style="position:fixed;inset:0;z-index:2147483647">overlay</div>'
		);
		expect(out).toContain("overlay");
		expect(out).not.toContain("style");
		expect(out).not.toContain("position:fixed");
	});

	it("strips the id attribute (blocks DOM clobbering)", () => {
		const out = sanitizeHtml('<div id="config">x</div>');
		expect(out).toContain("x");
		expect(out).not.toContain('id="config"');
		expect(out).not.toContain("id=");
	});

	it("keeps class so legitimate chat formatting still renders", () => {
		const out = sanitizeHtml('<span class="callout">hi</span>');
		expect(out).toContain('class="callout"');
		expect(out).toContain("hi");
	});

	it("keeps safe anchor attributes", () => {
		const out = sanitizeHtml(
			'<a href="https://example.com" target="_blank" rel="noopener">link</a>'
		);
		expect(out).toContain('href="https://example.com"');
		expect(out).toContain('target="_blank"');
		expect(out).toContain('rel="noopener"');
	});

	it("still removes scripts and inline event handlers", () => {
		const out = sanitizeHtml('<div onclick="steal()">t</div><script>evil()</script>');
		expect(out).toContain("t");
		expect(out).not.toContain("onclick");
		expect(out).not.toContain("<script");
		expect(out).not.toContain("evil()");
	});
});
