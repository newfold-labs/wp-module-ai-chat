/**
 * Chat History Dropdown Component
 *
 * Clock icon button that toggles a dropdown panel containing ChatHistoryList.
 * Click outside and Escape close the dropdown.
 */

import {
	useState,
	useRef,
	useEffect,
	useLayoutEffect,
	useCallback,
	createPortal,
} from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import ChatHistoryList from './ChatHistoryList';

/** Clock / history icon - inline SVG */
const ClockIcon = (props) => (
	<svg
		width="16"
		height="16"
		viewBox="0 0 24 24"
		fill="none"
		xmlns="http://www.w3.org/2000/svg"
		aria-hidden="true"
		focusable="false"
		{...props}
	>
		<circle
			cx="12"
			cy="12"
			r="9"
			stroke="currentColor"
			strokeWidth="2"
		/>
		<path
			d="M12 7v5l3 3"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
		/>
	</svg>
);

/**
 * @param {Object}   props
 * @param {string}   props.storageNamespace   - Must match useNfdAgentsWebSocket for same consumer
 * @param {boolean}  props.open
 * @param {Function} props.onOpenChange
 * @param {Function} props.onSelectConversation
 * @param {number}   [props.refreshTrigger=0]
 * @param {boolean}  [props.disabled=false]
 * @param {number}   [props.maxHistoryItems]
 */
const ChatHistoryDropdown = ({
	storageNamespace,
	open,
	onOpenChange,
	onSelectConversation,
	refreshTrigger = 0,
	disabled = false,
	maxHistoryItems,
}) => {
	const triggerRef = useRef(null);
	const panelRef = useRef(null);
	const [position, setPosition] = useState({ top: 0, left: 0, openUp: false });

	const updatePosition = useCallback(() => {
		if (!triggerRef.current) return;
		const rect = triggerRef.current.getBoundingClientRect();
		const panelHeight = 240;
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
		if (!open) return;
		const handleResize = () => updatePosition();
		window.addEventListener('resize', handleResize);
		return () => window.removeEventListener('resize', handleResize);
	}, [open, updatePosition]);

	useEffect(() => {
		if (!open) return;
		const handleClickOutside = (e) => {
			if (
				triggerRef.current?.contains(e.target) ||
				panelRef.current?.contains(e.target)
			) {
				return;
			}
			onOpenChange(false);
		};
		const handleEscape = (e) => {
			if (e.key === 'Escape') {
				onOpenChange(false);
			}
		};
		document.addEventListener('mousedown', handleClickOutside);
		document.addEventListener('keydown', handleEscape);
		return () => {
			document.removeEventListener('mousedown', handleClickOutside);
			document.removeEventListener('keydown', handleEscape);
		};
	}, [open, onOpenChange]);

	const handleSelect = useCallback(
		(conversation) => {
			onSelectConversation(conversation);
			onOpenChange(false);
		},
		[onSelectConversation, onOpenChange]
	);

	const handleTriggerClick = () => {
		if (disabled) return;
		onOpenChange(!open);
	};

	const dropdownPanel = (
		<div
			ref={panelRef}
			className="nfd-ai-chat-history-dropdown"
			role="dialog"
			aria-label={__('Chat history', 'wp-module-ai-chat')}
			style={{
				position: 'fixed',
				top: position.openUp ? 'auto' : position.top,
				bottom: position.openUp ? window.innerHeight - position.top : 'auto',
				left: 'auto',
				right: window.innerWidth - position.left,
				zIndex: 100000,
			}}
		>
			<div className="nfd-ai-chat-history-dropdown-inner">
				<ChatHistoryList
					storageNamespace={storageNamespace}
					onSelectConversation={handleSelect}
					disabled={disabled}
					refreshTrigger={open ? refreshTrigger : 0}
					emptyMessage={__('No conversations yet.', 'wp-module-ai-chat')}
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
				className={`nfd-ai-chat-history-dropdown-trigger ${open ? 'is-open' : ''}`}
				onClick={handleTriggerClick}
				disabled={disabled}
				aria-expanded={open}
				aria-haspopup="true"
				aria-label={__('Chat history', 'wp-module-ai-chat')}
				title={__('Chat history', 'wp-module-ai-chat')}
			>
				<ClockIcon />
			</button>
			{open && createPortal(dropdownPanel, document.body)}
		</div>
	);
};

export default ChatHistoryDropdown;
