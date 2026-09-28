/**
 * Tests for link handling in the chat markdown parser.
 */

import { parseMarkdown, linkifyUrls } from "./markdownParser";

const hrefs = (html) => [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);

describe("parseMarkdown links", () => {
	it("renders a markdown link whose text is the same URL", () => {
		const out = parseMarkdown("Verify it at [http://localhost:10003/](http://localhost:10003/)");
		expect(hrefs(out)).toEqual(["http://localhost:10003/"]);
		expect(out).toContain(">http://localhost:10003/</a>");
		expect(out).not.toContain("](");
		expect(out).not.toContain("[");
	});

	it("renders a markdown link with plain text", () => {
		const out = parseMarkdown("Verify it at [your site](http://localhost:10003/)");
		expect(out).toContain('<a href="http://localhost:10003/"');
		expect(out).toContain(">your site</a>");
		expect(out).not.toContain("[your site]");
	});

	it("keeps punctuation after a markdown link", () => {
		const out = parseMarkdown("See [https://example.com](https://example.com).");
		expect(hrefs(out)).toEqual(["https://example.com"]);
		expect(out).toContain("</a>.");
	});

	it("keeps query strings with underscores intact in the href", () => {
		const out = parseMarkdown(
			"Check [Products](https://site.com/wp-admin/edit.php?post_type=product&product_cat=my_cat) now"
		);
		expect(hrefs(out)).toEqual([
			"https://site.com/wp-admin/edit.php?post_type=product&amp;product_cat=my_cat",
		]);
		expect(out).not.toContain("<em>");
	});

	it("handles balanced parentheses in the URL", () => {
		const out = parseMarkdown("Read [Wikipedia](https://en.wikipedia.org/wiki/Foo_(bar)) for more");
		expect(hrefs(out)).toEqual(["https://en.wikipedia.org/wiki/Foo_(bar)"]);
		expect(out).toContain("</a> for more");
	});

	it("renders multiple links on one line", () => {
		const out = parseMarkdown("[Link one](https://a.com/x) and [link two](https://b.com/y)");
		expect(hrefs(out)).toEqual(["https://a.com/x", "https://b.com/y"]);
	});

	it("does not nest anchors when link text contains a URL", () => {
		const out = parseMarkdown("Nested [see https://a.com](https://a.com) yes");
		expect((out.match(/<a /g) || []).length).toBe(1);
	});

	it("still trims leading prose words from URL link text", () => {
		const out = parseMarkdown("Would you like [If https://site.com/page](https://site.com/page)?");
		expect(out).toContain('If <a href="https://site.com/page"');
		expect(out).toContain(">https://site.com/page</a>?");
	});

	it("renders links inside list items", () => {
		const out = parseMarkdown("- Item one: https://a.com/1\n- Item two: [B](https://b.com/2)");
		expect(hrefs(out)).toEqual(["https://a.com/1", "https://b.com/2"]);
		expect(out).toContain(">B</a>");
	});
});

describe("bare URLs", () => {
	it("keeps a trailing period as text", () => {
		const out = parseMarkdown("Visit http://localhost:10003/.");
		expect(hrefs(out)).toEqual(["http://localhost:10003/"]);
		expect(out).toContain("</a>.</p>");
	});

	it("keeps a closing parenthesis as text", () => {
		const out = parseMarkdown("Visit (http://localhost:10003/) today");
		expect(hrefs(out)).toEqual(["http://localhost:10003/"]);
		expect(out).toContain("</a>) today");
	});

	it("does not italicize underscores in bare URLs", () => {
		const out = parseMarkdown("See https://a.com/some_path_here/and_more?x_y=1");
		expect(hrefs(out)).toEqual(["https://a.com/some_path_here/and_more?x_y=1"]);
		expect(out).not.toContain("<em>");
	});

	it("linkifyUrls keeps trailing punctuation", () => {
		expect(linkifyUrls("Go to https://a.com/page, then save.")).toBe(
			'Go to <a href="https://a.com/page" target="_blank" rel="noopener noreferrer">https://a.com/page</a>, then save.'
		);
	});
});
