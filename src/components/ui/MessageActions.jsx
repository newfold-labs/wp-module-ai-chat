/**
 * WordPress dependencies
 */
import { useCallback, useEffect, useRef, useState } from "@wordpress/element";
import { __ } from "@wordpress/i18n";

/**
 * Internal dependencies
 */
import classnames from "classnames";
import { CheckIcon, CopyIcon } from "../icons";

/** How long the "Copied" success state is visible before reverting. */
const COPIED_RESET_MS = 1500;

/**
 * Copy plain text to the clipboard, with a fallback for non-secure / older contexts.
 * Resolves to true on success, false otherwise.
 *
 * @param {string} text - Text to copy.
 * @return {Promise<boolean>} Whether the copy succeeded.
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
		// fall through to legacy path below
	}
	try {
		const textarea = document.createElement("textarea");
		textarea.value = text;
		textarea.setAttribute("readonly", "");
		textarea.style.position = "absolute";
		textarea.style.left = "-9999px";
		document.body.appendChild(textarea);
		textarea.select();
		const ok = document.execCommand("copy");
		document.body.removeChild(textarea);
		return ok;
	} catch {
		return false;
	}
};

/**
 * MessageActions Component
 *
 * Renders a small action bar below an assistant message. Built as a generic container so callers
 * can extend with their own actions (Like / Regenerate / Share) without forking this file.
 *
 * Action shape: { id, label, icon, onClick, isActive? }
 * - `id` is used as the React key.
 * - `label` is announced to assistive tech and shown as the native tooltip.
 * - `icon` is any node (typically a small SVG).
 * - `isActive` toggles the `.is-active` class for success/state styling.
 *
 * When `actions` is omitted, a single Copy action is rendered using `text`.
 *
 * @param {Object}   props
 * @param {string}   [props.text]      - Source text for the default Copy action.
 * @param {Array}    [props.actions]   - Custom actions; replaces the default Copy.
 * @param {string}   [props.className]
 * @return {JSX.Element|null} The action bar, or null when there is nothing to render.
 */
const MessageActions = ({ text, actions, className = "" }) => {
	const [copied, setCopied] = useState(false);
	const resetTimerRef = useRef(null);

	useEffect(
		() => () => {
			if (resetTimerRef.current) {
				clearTimeout(resetTimerRef.current);
			}
		},
		[]
	);

	const handleCopy = useCallback(async () => {
		const ok = await copyToClipboard(text);
		if (!ok) {
			return;
		}
		setCopied(true);
		if (resetTimerRef.current) {
			clearTimeout(resetTimerRef.current);
		}
		resetTimerRef.current = setTimeout(() => setCopied(false), COPIED_RESET_MS);
	}, [text]);

	const resolvedActions =
		actions && actions.length > 0
			? actions
			: [
					{
						id: "copy",
						label: copied
							? __("Copied", "wp-module-ai-chat")
							: __("Copy message", "wp-module-ai-chat"),
						icon: copied ? <CheckIcon width={12} height={12} /> : <CopyIcon width={12} height={12} />,
						onClick: handleCopy,
						isActive: copied,
						disabled: !text,
					},
				];

	if (resolvedActions.length === 0) {
		return null;
	}

	return (
		<div className={classnames("nfd-ai-chat-message-actions", className)}>
			{resolvedActions.map((action) => (
				<button
					key={action.id}
					type="button"
					className={classnames("nfd-ai-chat-message-actions__btn", {
						"is-active": action.isActive,
					})}
					onClick={action.onClick}
					aria-label={action.label}
					title={action.label}
					disabled={action.disabled}
				>
					{action.icon}
				</button>
			))}
		</div>
	);
};

export default MessageActions;
