/**
 * Approval Dialog Component
 * 
 * Displays approval dialog for tool execution requests from the agent.
 * Based on ActionConfirmationModal from agents-prototype.
 */

import { useState, useEffect, useCallback } from '@wordpress/element';
import { __, sprintf } from '@wordpress/i18n';
import { APPROVAL, UI } from '../../config/constants';
import { generateSuccessMessage } from '../../utils/messageUtils';

/**
 * ApprovalDialog Component
 *
 * @param {Object} props Component props
 * @param {boolean} props.isOpen Whether dialog is open
 * @param {Object} props.approvalRequest Approval request data
 * @param {Function} props.onApprove Callback when user approves
 * @param {Function} props.onReject Callback when user rejects
 * @param {Function} props.onExecuteTool Function to execute tool via MCP
 * @param {Function} props.onSendMessage Function to send message back to agent (shows in UI)
 * @param {Function} props.onSendSystemMessage Function to send message to agent (hidden from UI)
 * @param {string} props.conversationId Conversation ID for message correlation
 * @param {Function} props.onClearTyping Callback to clear typing indicator
 */
const ApprovalDialog = ({
	isOpen,
	approvalRequest,
	onApprove,
	onReject,
	onExecuteTool,
	onSendMessage,
	onSendSystemMessage,
	conversationId,
	onClearTyping,
}) => {
	const [isExecuting, setIsExecuting] = useState(false);
	const [error, setError] = useState(null);

	const handleReject = useCallback((reason = __( 'Action rejected by user.', 'wp-module-ai-chat' )) => {
		// Send rejection to agent via system message (hidden from UI)
		if (onSendSystemMessage) {
			onSendSystemMessage(`[Tool Execution Cancelled]\n${reason}`);
		}
		onReject();
	}, [onReject, onSendSystemMessage]);

	const handleApprove = useCallback(async () => {
		const name = approvalRequest?.tool_name;
		if (!onExecuteTool || !name) {
			onApprove();
			return;
		}

		setIsExecuting(true);
		setError(null);

		try {
			let parsedArguments = approvalRequest?.tool_arguments || {};
			if (typeof parsedArguments === 'string') {
				try {
					parsedArguments = JSON.parse(parsedArguments);
				} catch {
					parsedArguments = {};
				}
			}

			const result = await onExecuteTool(name, parsedArguments);

			if (onClearTyping) {
				onClearTyping();
			}

			if (onSendSystemMessage) {
				const summary = generateSuccessMessage(name, result);
				let details = '';
				try {
					const parsed = typeof result === 'string' ? JSON.parse(result) : result;
					if (parsed) {
						const title = parsed.title?.rendered || parsed.title || parsed.name || '';
						const id = parsed.id || '';
						const link = parsed.link || parsed.guid?.rendered || '';
						const status = parsed.status || '';

						if (title || id || link) {
							details = '\nDetails: ';
							if (title) details += `Title: "${title}"`;
							if (id) details += `${title ? ', ' : ''}ID: ${id}`;
							if (status) details += `, Status: ${status}`;
							if (link) details += `\nLink: ${link}`;
						}
					}
				} catch {
					// If parsing fails, just use the summary
				}

				const agentMessage = `[Tool Execution Result]\n${summary}${details}`;
				onSendSystemMessage(agentMessage);
			}

			onApprove(result);
		} catch (err) {
			const errorMessage = err.message || __( 'Tool execution failed', 'wp-module-ai-chat' );
			setError(errorMessage);

			if (onClearTyping) {
				onClearTyping();
			}

			if (onSendSystemMessage) {
				onSendSystemMessage(`[Tool Execution Error]\nFailed to execute ${name}: ${errorMessage}`);
			}
		} finally {
			setIsExecuting(false);
		}
	}, [approvalRequest, onApprove, onExecuteTool, onSendSystemMessage, onClearTyping]);

	// Handle approval timeout
	useEffect(() => {
		if (isOpen && approvalRequest) {
			const timeout = setTimeout(() => {
				handleReject( __( 'Approval request timed out.', 'wp-module-ai-chat' ) );
			}, APPROVAL.TIMEOUT);

			return () => clearTimeout(timeout);
		}
	}, [isOpen, approvalRequest, handleReject]);

	if (!isOpen || !approvalRequest) {
		return null;
	}

	const {
		tool_name,
		tool_arguments,
		action,
	} = approvalRequest;

	const getActionDisplayName = (actionType) => {
		if (actionType) {
			return actionType.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase());
		}
		if (tool_name) {
			// Format tool name: "nfd-agents/posts-create", "newfold-agents/posts-create", or "blu/posts-create" -> "Create Post"
			return tool_name
				.split('/')
				.pop()
				.replace(/-/g, ' ')
				.replace(/\b\w/g, (l) => l.toUpperCase());
		}
		return __( 'Execute Action', 'wp-module-ai-chat' );
	};

	const formatToolArguments = (args) => {
		if (!args || typeof args !== 'object') {
			return __( 'No arguments provided', 'wp-module-ai-chat' );
		}

		return Object.entries(args)
			.map(([key, value]) => {
				// Mask sensitive data
				if (key.toLowerCase().includes('password') || key.toLowerCase().includes('token')) {
					return `${key}: ••••••••`;
				}
				// Format value for display
				const displayValue = typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value);
				return `${key}: ${displayValue}`;
			})
			.join('\n');
	};

	return (
		<div
			className="nfd-approval-dialog-overlay"
			style={{
				position: 'fixed',
				top: 0,
				left: 0,
				right: 0,
				bottom: 0,
				backgroundColor: 'rgba(0, 0, 0, 0.5)',
				display: 'flex',
				alignItems: 'center',
				justifyContent: 'center',
				zIndex: UI.Z_INDEX_MODAL,
			}}
			onClick={(e) => {
				// Close on overlay click
				if (e.target === e.currentTarget) {
					handleReject();
				}
			}}
		>
			<div
				className="nfd-approval-dialog"
				style={{
					backgroundColor: '#fff',
					borderRadius: '12px',
					padding: '24px',
					maxWidth: UI.MAX_WIDTH_DIALOG,
					width: '90%',
					boxShadow: '0 7px 29px rgba(100, 100, 111, 0.3)',
				}}
				onClick={(e) => e.stopPropagation()}
			>
				<div style={{ marginBottom: '20px' }}>
					<h2
						style={{
							fontSize: '20px',
							fontWeight: 'bold',
							marginBottom: '8px',
							color: '#1d2327',
						}}
					>
						{ __( 'Please Confirm', 'wp-module-ai-chat' ) }
					</h2>
					<p style={{ color: '#646970', fontSize: '14px' }}>
						{ sprintf(
							__( "You'd like to %s", 'wp-module-ai-chat' ),
							getActionDisplayName(action || tool_name).toLowerCase()
						) }
					</p>
				</div>

				<div
					style={{
						backgroundColor: '#f6f7f7',
						borderRadius: '8px',
						padding: '16px',
						marginBottom: '20px',
					}}
				>
					<h3
						style={{
							fontSize: '14px',
							fontWeight: '600',
							marginBottom: '12px',
							color: '#1d2327',
						}}
					>
						{ __( 'Action Details:', 'wp-module-ai-chat' ) }
					</h3>
					<div style={{ fontSize: '13px', color: '#50575e' }}>
						<div style={{ marginBottom: '8px' }}>
							<strong>{ __( 'Tool:', 'wp-module-ai-chat' ) }</strong> {tool_name || __( 'N/A', 'wp-module-ai-chat' )}
						</div>
						{tool_arguments && Object.keys(tool_arguments).length > 0 && (
							<div>
								<strong>{ __( 'Arguments:', 'wp-module-ai-chat' ) }</strong>
								<pre
									style={{
										marginTop: '8px',
										padding: '8px',
										backgroundColor: '#fff',
										borderRadius: '4px',
										fontSize: '12px',
										overflow: 'auto',
										maxHeight: '200px',
									}}
								>
									{formatToolArguments(tool_arguments)}
								</pre>
							</div>
						)}
					</div>
				</div>

				{error && (
					<div
						style={{
							padding: '12px',
							backgroundColor: '#fcf0f1',
							border: '1px solid #d63638',
							borderRadius: '4px',
							marginBottom: '16px',
							color: '#d63638',
							fontSize: '13px',
						}}
					>
						{error}
					</div>
				)}

				<div style={{ display: 'flex', gap: '12px' }}>
					<button
						type="button"
						onClick={() => handleReject()}
						disabled={isExecuting}
						style={{
							flex: 1,
							padding: '10px 16px',
							backgroundColor: '#f0f0f1',
							border: 'none',
							borderRadius: '4px',
							cursor: isExecuting ? 'not-allowed' : 'pointer',
							fontSize: '14px',
							fontWeight: UI.FONT_WEIGHT_MEDIUM,
							color: '#2c3338',
							opacity: isExecuting ? 0.6 : 1,
						}}
					>
						{ __( 'Cancel', 'wp-module-ai-chat' ) }
					</button>
					<button
						type="button"
						onClick={handleApprove}
						disabled={isExecuting}
						style={{
							flex: 1,
							padding: '10px 16px',
							backgroundColor: isExecuting ? '#c3c4c7' : '#2271b1',
							border: 'none',
							borderRadius: '4px',
							cursor: isExecuting ? 'not-allowed' : 'pointer',
							fontSize: '14px',
							fontWeight: UI.FONT_WEIGHT_MEDIUM,
							color: '#fff',
						}}
					>
						{isExecuting ? __( 'Executing...', 'wp-module-ai-chat' ) : __( 'Confirm', 'wp-module-ai-chat' )}
					</button>
				</div>
			</div>
		</div>
	);
};

export default ApprovalDialog;
