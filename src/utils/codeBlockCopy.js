/**
 * Attach a small "copy" button to every <pre> code block inside a container.
 *
 * Idempotent: safe to call repeatedly (e.g. from a useEffect that re-runs when content
 * changes). Each <pre> is marked with `data-copy-attached="1"` so subsequent calls
 * skip already-decorated blocks.
 *
 * Markup it injects (kept minimal so styling lives in SCSS, not JS):
 *
 *   <button class="nfd-ai-chat-codeblock-copy" type="button" aria-label="Copy code">
 *     <span class="nfd-ai-chat-codeblock-copy__label">Copy</span>
 *   </button>
 */

import { __ } from "@wordpress/i18n";

const COPIED_RESET_MS = 1500;

/**
 * Best-effort clipboard write with a legacy fallback for non-secure contexts.
 *
 * @param {string} text
 * @return {Promise<boolean>}
 */
const copyToClipboard = async (text) => {
	if (!text) {
		return false;
	}
	try {
		if (navigator?.clipboard && window.isSecureContext) {
			await navigator.clipboard.writeText(text);
			return true;
		}
	} catch {
		// fall through
	}
	try {
		const ta = document.createElement("textarea");
		ta.value = text;
		ta.setAttribute("readonly", "");
		ta.style.position = "absolute";
		ta.style.left = "-9999px";
		document.body.appendChild(ta);
		ta.select();
		const ok = document.execCommand("copy");
		document.body.removeChild(ta);
		return ok;
	} catch {
		return false;
	}
};

/**
 * Decorate all <pre> elements within `container` with a copy button. Returns a cleanup
 * function that detaches event listeners (does not remove the buttons themselves —
 * those are torn down naturally when the container's HTML is replaced).
 *
 * @param {HTMLElement|null} container
 * @return {() => void} cleanup
 */
export function attachCodeBlockCopy(container) {
	if (!container || typeof container.querySelectorAll !== "function") {
		return () => {};
	}

	const labelCopy = __("Copy", "wp-module-ai-chat");
	const labelCopied = __("Copied", "wp-module-ai-chat");
	const ariaLabel = __("Copy code", "wp-module-ai-chat");

	const teardowns = [];

	container.querySelectorAll("pre").forEach((pre) => {
		if (pre.dataset.copyAttached === "1") {
			return;
		}
		pre.dataset.copyAttached = "1";

		const btn = document.createElement("button");
		btn.type = "button";
		btn.className = "nfd-ai-chat-codeblock-copy";
		btn.setAttribute("aria-label", ariaLabel);

		const label = document.createElement("span");
		label.className = "nfd-ai-chat-codeblock-copy__label";
		label.textContent = labelCopy;
		btn.appendChild(label);

		let resetTimer = null;
		const handleClick = async (e) => {
			// Stop click bubbling out into any message-level handlers.
			e.preventDefault();
			e.stopPropagation();
			const code = pre.querySelector("code");
			const text = (code ? code.innerText : pre.innerText) || "";
			const ok = await copyToClipboard(text);
			if (!ok) {
				return;
			}
			btn.classList.add("is-copied");
			label.textContent = labelCopied;
			if (resetTimer) {
				clearTimeout(resetTimer);
			}
			resetTimer = setTimeout(() => {
				btn.classList.remove("is-copied");
				label.textContent = labelCopy;
				resetTimer = null;
			}, COPIED_RESET_MS);
		};

		btn.addEventListener("click", handleClick);
		teardowns.push(() => {
			btn.removeEventListener("click", handleClick);
			if (resetTimer) {
				clearTimeout(resetTimer);
			}
		});

		pre.appendChild(btn);
	});

	return () => {
		teardowns.forEach((fn) => fn());
	};
}
