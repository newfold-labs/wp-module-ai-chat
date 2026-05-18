/**
 * WordPress dependencies
 */
import { useEffect, useLayoutEffect, useRef, useState } from "@wordpress/element";

/**
 * Chars revealed per tick and tick interval — kept in sync with the prior
 * implementation so the perceived typing speed doesn't change.
 */
const CHARS_PER_TICK = 2;
const TICK_MS = 35;

/**
 * Block-level tags emitted by the markdown parser. Their visibility is gated
 * on the reveal cursor reaching their first descendant text (or, for textless
 * blocks like <hr>, the next text node in document order) so the bubble grows
 * in place instead of snapping to its final layout up front.
 */
const BLOCK_TAGS = [
	"P",
	"H1",
	"H2",
	"H3",
	"H4",
	"H5",
	"H6",
	"UL",
	"OL",
	"LI",
	"PRE",
	"BLOCKQUOTE",
	"HR",
	"TABLE",
	"TR",
	"TD",
	"TH",
	"DIV",
];
const BLOCK_TAG_SET = new Set(BLOCK_TAGS);
const BLOCK_SELECTOR = BLOCK_TAGS.map((t) => t.toLowerCase()).join(",");

/**
 * Attribute set on every block ancestor whose first descendant text node has
 * not yet been revealed. Paired with a CSS rule that collapses the element
 * (`display: none`) until removed.
 */
const PENDING_ATTR = "data-nfd-typewriter-pending";

const collectRevealableTextNodes = (root) => {
	const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
		acceptNode: (node) =>
			/\S/.test(node.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT,
	});
	const nodes = [];
	let current = walker.nextNode();
	while (current) {
		nodes.push(current);
		current = walker.nextNode();
	}
	return nodes;
};

const collectBlockAncestors = (node, root) => {
	const chain = [];
	let element = node.parentElement;
	while (element && element !== root && root.contains(element)) {
		if (BLOCK_TAG_SET.has(element.tagName)) {
			chain.push(element);
		}
		element = element.parentElement;
	}
	return chain;
};

/**
 * For every block element under root that has no descendant text node, find
 * the nearest text node that follows it in document order and append the block
 * to that text node's ancestor list. This way "structural" blocks like <hr>
 * unmark in sync with the next chunk of revealed prose instead of floating in
 * before any context.
 *
 * Blocks with no text after them (trailing orphans) attach to the last text
 * node so they reveal when the message finishes.
 */
const attachOrphanBlocks = (root, textNodes, nodeAncestors) => {
	if (textNodes.length === 0) {
		return [];
	}
	const ancestorSet = new Set();
	nodeAncestors.forEach((chain) => chain.forEach((el) => ancestorSet.add(el)));

	const orphans = [];
	root.querySelectorAll(BLOCK_SELECTOR).forEach((block) => {
		if (ancestorSet.has(block)) {
			return;
		}
		orphans.push(block);
	});

	for (const orphan of orphans) {
		let attachIdx = textNodes.length - 1;
		for (let i = 0; i < textNodes.length; i++) {
			const pos = orphan.compareDocumentPosition(textNodes[i]);
			// eslint-disable-next-line no-bitwise
			if (pos & Node.DOCUMENT_POSITION_FOLLOWING) {
				attachIdx = i;
				break;
			}
		}
		nodeAncestors[attachIdx].push(orphan);
	}
	return orphans;
};

const prefersReducedMotion = () => {
	if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
		return false;
	}
	return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
};

/**
 * useTypewriterReveal
 *
 * Reveals the text inside `ref.current` character-by-character without re-parsing.
 *
 * The container is expected to already hold its final, fully-formatted HTML
 * (lists, headings, links, callouts — all in place). The hook walks the
 * rendered text nodes once, marks every block-level descendant as pending,
 * then ticks a counter that grows each text node in DOM order. As the cursor
 * enters a block its pending marker is cleared so it appears in the layout.
 *
 * This avoids the prior approach of re-running the markdown parser on every
 * tick, which produced an end-of-stream reflow whenever a structural transform
 * (inline-list detection, key/value fold, status badges) crossed its threshold
 * partway through the animation.
 *
 * @param {Object}      params
 * @param {Object}      params.ref        Ref to the container holding the formatted HTML.
 * @param {string}      params.contentKey Stable identity for the content — when it
 *                                        changes, the reveal restarts. Prefer a small,
 *                                        stable value (e.g. the raw message string or
 *                                        a message id) over the rendered HTML.
 * @param {boolean}     params.enabled    When false, no animation runs and content stays
 *                                        fully visible.
 * @param {Function}    [params.onTick]   Optional callback after each reveal tick (e.g.
 *                                        for auto-scroll).
 * @return {boolean} `true` while the reveal is in progress, `false` otherwise.
 */
const useTypewriterReveal = ({ ref, contentKey, enabled, onTick }) => {
	// Initialize to `enabled` so the very first render reports the correct
	// state. If the layout effect later short-circuits (no text / reduced
	// motion), it flips to false before paint. The alternative (`useState(false)`)
	// causes any effect that depends on `isRevealing` to fire on render 1 with
	// a stale value — which broke `attachCodeBlockCopy` (it attached a click
	// listener that the next render's cleanup then orphaned).
	const [isRevealing, setIsRevealing] = useState(() => Boolean(enabled));

	// Latest onTick is read through a ref so changing the callback identity
	// doesn't restart the animation.
	const onTickRef = useRef(onTick);
	useEffect(() => {
		onTickRef.current = onTick;
	}, [onTick]);

	useLayoutEffect(() => {
		const root = ref.current;
		if (!enabled || !root) {
			setIsRevealing(false);
			return undefined;
		}
		if (prefersReducedMotion()) {
			setIsRevealing(false);
			return undefined;
		}

		const textNodes = collectRevealableTextNodes(root);
		if (textNodes.length === 0) {
			setIsRevealing(false);
			return undefined;
		}

		const originalTexts = textNodes.map((node) => node.nodeValue);
		const totalLength = originalTexts.reduce((sum, text) => sum + text.length, 0);
		if (totalLength === 0) {
			setIsRevealing(false);
			return undefined;
		}

		const nodeAncestors = textNodes.map((node) => collectBlockAncestors(node, root));
		attachOrphanBlocks(root, textNodes, nodeAncestors);

		const pendingBlocks = new Set();
		nodeAncestors.forEach((chain) => chain.forEach((el) => pendingBlocks.add(el)));

		pendingBlocks.forEach((el) => el.setAttribute(PENDING_ATTR, ""));
		textNodes.forEach((node) => {
			node.nodeValue = "";
		});

		setIsRevealing(true);

		let nodeIdx = 0;
		let withinNode = 0;
		let revealedTotal = 0;

		const advance = (budget) => {
			let remaining = budget;
			while (remaining > 0 && nodeIdx < textNodes.length) {
				const original = originalTexts[nodeIdx];
				if (original.length === 0) {
					nodeIdx += 1;
					withinNode = 0;
					continue;
				}
				if (withinNode === 0) {
					nodeAncestors[nodeIdx].forEach((el) => el.removeAttribute(PENDING_ATTR));
				}
				const take = Math.min(original.length - withinNode, remaining);
				withinNode += take;
				textNodes[nodeIdx].nodeValue = original.slice(0, withinNode);
				remaining -= take;
				revealedTotal += take;
				if (withinNode === original.length) {
					nodeIdx += 1;
					withinNode = 0;
				}
			}
		};

		const finalize = () => {
			// If the bubble's DOM has been replaced (content swap, unmount), the
			// captured nodes are detached. Restoring them is a no-op visually,
			// but skip to avoid the wasted writes and to keep debug traces clean.
			if (!root.isConnected) {
				return;
			}
			textNodes.forEach((node, i) => {
				node.nodeValue = originalTexts[i];
			});
			pendingBlocks.forEach((el) => el.removeAttribute(PENDING_ATTR));
		};

		const intervalId = setInterval(() => {
			advance(CHARS_PER_TICK);
			if (onTickRef.current) {
				onTickRef.current();
			}
			if (revealedTotal >= totalLength) {
				clearInterval(intervalId);
				finalize();
				setIsRevealing(false);
			}
		}, TICK_MS);

		return () => {
			clearInterval(intervalId);
			// Restore the DOM to match the source HTML so React's next render
			// (or a content swap) sees a clean slate. Idempotent across re-runs.
			finalize();
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [enabled, contentKey]);

	return isRevealing;
};

export default useTypewriterReveal;
