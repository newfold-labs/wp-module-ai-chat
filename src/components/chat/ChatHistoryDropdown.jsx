/**
 * Chat History Dropdown Component
 *
 * History icon button that toggles a dropdown panel containing ChatHistoryList.
 * Click outside and Escape close the dropdown. Shows a small dot indicator when
 * any archived conversations exist for the consumer.
 */

import {
	useState,
	useRef,
	useEffect,
	useLayoutEffect,
	useCallback,
	createPortal,
} from "@wordpress/element";
import { __ } from "@wordpress/i18n";
import { Icon, backup } from "@wordpress/icons";
import { getChatHistoryStorageKeys } from "../../constants/nfdAgents/storageKeys";
import ChatHistoryList from "./ChatHistoryList";

/**
 * Read the archive size for a consumer without parsing every entry. Used to
 * show a small dot indicator on the trigger when conversations exist.
 *
 * @param {string} consumer
 * @return {number}
 */
const readArchiveCount = (consumer) => {
	try {
		const keys = getChatHistoryStorageKeys(consumer);
		const raw = window.localStorage.getItem(keys.archive);
		if (!raw) {
			return 0;
		}
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed) ? parsed.length : 0;
	} catch (_err) {
		return 0;
	}
};

/**
 * Dropdown trigger and portal-rendered panel with ChatHistoryList.
 *
 * @param {Object}   props
 * @param {string}   props.consumer             - Must match useNfdAgentsWebSocket for same consumer
 * @param {boolean}  props.open
 * @param {Function} props.onOpenChange
 * @param {Function} props.onSelectConversation
 * @param {Function} [props.onConversationDeleted] - Pass-through to ChatHistoryList; see its docs.
 * @param {number}   [props.refreshTrigger=0]
 * @param {boolean}  [props.disabled=false]
 * @param {number}   [props.maxHistoryItems]
 * @return {JSX.Element} Dropdown trigger and portal-rendered history panel.
 */
const ChatHistoryDropdown = ({
	consumer,
	open,
	onOpenChange,
	onSelectConversation,
	onConversationDeleted,
	refreshTrigger = 0,
	disabled = false,
	maxHistoryItems,
}) => {
	const triggerRef = useRef(null);
	const panelRef = useRef(null);
	const [position, setPosition] = useState({ top: 0, left: 0, openUp: false });
	const [hasItems, setHasItems] = useState(false);

	// Refresh the "has items" indicator on mount, when the panel opens, when an
	// archive change is signalled via refreshTrigger, and when other tabs update storage.
	useEffect(() => {
		setHasItems(readArchiveCount(consumer) > 0);
	}, [consumer, refreshTrigger, open]);

	useEffect(() => {
		const handleStorage = (e) => {
			if (!e.key) {
				return;
			}
			const keys = getChatHistoryStorageKeys(consumer);
			if (e.key === keys.archive) {
				setHasItems(readArchiveCount(consumer) > 0);
			}
		};
		window.addEventListener("storage", handleStorage);
		return () => window.removeEventListener("storage", handleStorage);
	}, [consumer]);

	const updatePosition = useCallback(() => {
		if (!triggerRef.current) {
			return;
		}
		const rect = triggerRef.current.getBoundingClientRect();
		const panelHeight = 320;
		const spaceBelow = window.innerHeight - rect.bottom;
		const openUp = spaceBelow < panelHeight && rect.top > spaceBelow;
		setPosition({
			top: openUp ? rect.top : rect.bottom,
			left: rect.right,
			openUp,
		});
	}, []);

	useLayoutEffect(() => {
		if (open) {
			updatePosition();
		}
	}, [open, updatePosition]);

	useEffect(() => {
		if (!open) {
			return;
		}
		const handleResize = () => updatePosition();
		window.addEventListener("resize", handleResize);
		return () => window.removeEventListener("resize", handleResize);
	}, [open, updatePosition]);

	useEffect(() => {
		if (!open) {
			return;
		}
		const handleClickOutside = (e) => {
			if (triggerRef.current?.contains(e.target) || panelRef.current?.contains(e.target)) {
				return;
			}
			onOpenChange(false);
		};
		const handleEscape = (e) => {
			if (e.key === "Escape") {
				onOpenChange(false);
			}
		};
		document.addEventListener("mousedown", handleClickOutside);
		document.addEventListener("keydown", handleEscape);
		return () => {
			document.removeEventListener("mousedown", handleClickOutside);
			document.removeEventListener("keydown", handleEscape);
		};
	}, [open, onOpenChange]);

	const handleSelect = useCallback(
		(conversation) => {
			onSelectConversation(conversation);
			onOpenChange(false);
		},
		[onSelectConversation, onOpenChange]
	);

	const handleTriggerClick = useCallback(() => {
		if (disabled) {
			return;
		}
		onOpenChange(!open);
	}, [disabled, open, onOpenChange]);

	const dropdownPanel = (
		<div
			ref={panelRef}
			className={`nfd-ai-chat-history-dropdown${position.openUp ? " nfd-ai-chat-history-dropdown--up" : ""}`}
			role="dialog"
			aria-label={__("Recent conversations", "wp-module-ai-chat")}
			style={{
				position: "fixed",
				top: position.openUp ? "auto" : position.top,
				bottom: position.openUp ? window.innerHeight - position.top : "auto",
				left: "auto",
				right: window.innerWidth - position.left,
				zIndex: 100000,
			}}
		>
			<div className="nfd-ai-chat-history-dropdown__header">
				{__("Recent conversations", "wp-module-ai-chat")}
			</div>
			<div className="nfd-ai-chat-history-dropdown-inner">
				<ChatHistoryList
					consumer={consumer}
					onSelectConversation={handleSelect}
					onConversationDeleted={onConversationDeleted}
					disabled={disabled}
					refreshTrigger={open ? refreshTrigger : 0}
					emptyMessage={__("No conversations yet.", "wp-module-ai-chat")}
					maxHistoryItems={maxHistoryItems}
				/>
			</div>
		</div>
	);

	return (
		<div className="nfd-ai-chat-history-dropdown-wrapper">
			<button
				ref={triggerRef}
				type="button"
				className={`nfd-ai-chat-header__btn nfd-ai-chat-history-dropdown-trigger${open ? " is-open" : ""}${hasItems ? " has-items" : ""}`}
				onClick={handleTriggerClick}
				disabled={disabled}
				aria-expanded={open}
				aria-haspopup="dialog"
				aria-label={__("Recent conversations", "wp-module-ai-chat")}
				title={__("Recent conversations", "wp-module-ai-chat")}
			>
				<Icon icon={backup} size={18} />
			</button>
			{open && createPortal(dropdownPanel, document.body)}
		</div>
	);
};

export default ChatHistoryDropdown;
