/**
 * WordPress dependencies
 */
import { useState, useEffect, useCallback } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import PropTypes from 'prop-types';
import { APPROVAL } from '../../config/constants';
import { generateSuccessMessage } from '../../utils/messageUtils';

/**
 * InlineApproval Component
 *
 * Displays approval request inline within chat messages (not as modal).
 * Similar to Cursor's approval UI style with excellent UX.
 *
 * Features:
 * - Accessible (keyboard navigation, ARIA labels)
 * - Loading states with visual feedback
 * - Error handling with user-friendly messages
 * - Smooth animations and transitions
 * - Brand-aware styling
 *
 * @param {Object} props Component props
 * @param {Object} props.approvalRequest Approval request data
 * @param {Function} props.onApprove Callback when user approves
 * @param {Function} props.onReject Callback when user rejects
 * @param {Function} props.onExecuteTool Function to execute tool via MCP
 * @param {Function} props.onSendMessage Function to send message back to agent (shows in UI)
 * @param {Function} props.onSendSystemMessage Function to send message to agent (hidden from UI)
 * @param {string} props.conversationId Conversation ID for message correlation
 * @param {Function} props.onClearTyping Callback to clear typing indicator
 * @param {string} props.brandId Brand identifier for styling
 */
const InlineApproval = ({
	approvalRequest,
	onApprove,
	onReject,
	onExecuteTool,
	onSendMessage,
	onSendSystemMessage,
	conversationId,
	onClearTyping,
	brandId,
}) => {
	const [isExecuting, setIsExecuting] = useState(false);
	const [error, setError] = useState(null);

	// Format tool name for display
	const getActionDisplayName = useCallback((toolName) => {
		if (!toolName) return __( 'Execute Action', 'wp-module-ai-chat' );
		return toolName
			.split('/')
			.pop()
			.replace(/-/g, ' ')
			.replace(/\b\w/g, (l) => l.toUpperCase());
	}, []);

	// Format arguments for display
	const formatToolArguments = useCallback((args) => {
		if (!args || typeof args !== 'object' || Object.keys(args).length === 0) {
			return __( 'No arguments provided', 'wp-module-ai-chat' );
		}
		return Object.entries(args)
			.map(([key, value]) => {
				// Mask sensitive data
				if (key.toLowerCase().includes('password') || key.toLowerCase().includes('token')) {
					return `${key}: ••••••••`;
				}
				const displayValue = typeof value === 'object' 
					? JSON.stringify(value, null, 2) 
					: String(value);
				return `${key}: ${displayValue}`;
			})
			.join('\n');
	}, []);

	const handleApprove = useCallback(async () => {
		if (!onExecuteTool || !approvalRequest?.tool_name) {
			// If no tool execution function, just call onApprove
			if (onApprove) {
				onApprove();
			}
			return;
		}

		setIsExecuting(true);
		setError(null);

		try {
			// Parse tool_arguments if it's a JSON string, otherwise use as-is
			let parsedArguments = approvalRequest.tool_arguments || {};
			if (typeof parsedArguments === 'string') {
				try {
					parsedArguments = JSON.parse(parsedArguments);
				} catch {
					parsedArguments = {};
				}
			}

			// Execute tool via MCP client
			const result = await onExecuteTool(
				approvalRequest.tool_name,
				parsedArguments,
				approvalRequest.site_url
			);

			// Clear typing indicator before sending result message
			if (onClearTyping) {
				onClearTyping();
			}

			// Send result to agent via system message (hidden from UI)
			// The agent will process this and respond naturally
			if (onSendSystemMessage) {
				const summary = generateSuccessMessage(approvalRequest.tool_name, result);

				// Extract key details from result for agent context
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
				} catch (e) {
					// If parsing fails, just use the summary
				}

				// Send structured message to agent (hidden from UI)
				const agentMessage = `[Tool Execution Result]\n${summary}${details}`;
				onSendSystemMessage(agentMessage);
			}

			if (onApprove) {
				onApprove(result);
			}
		} catch (err) {
			const errorMessage = err.message || __( 'Tool execution failed', 'wp-module-ai-chat' );
			setError(errorMessage);

			// Clear typing indicator before sending error message
			if (onClearTyping) {
				onClearTyping();
			}

			// Send error to agent via system message (hidden from UI)
			if (onSendSystemMessage) {
				onSendSystemMessage(`[Tool Execution Error]\nFailed to execute ${approvalRequest.tool_name}: ${errorMessage}`);
			}

			// Don't call onApprove on error - let user see the error
		} finally {
			setIsExecuting(false);
		}
	}, [approvalRequest, onApprove, onExecuteTool, onSendSystemMessage, onClearTyping]);

	const handleReject = useCallback((reason = __( 'Action rejected by user.', 'wp-module-ai-chat' )) => {
		// Send rejection to agent via system message (hidden from UI)
		if (onSendSystemMessage) {
			onSendSystemMessage(`[Tool Execution Cancelled]\n${reason}`);
		}
		if (onReject) {
			onReject();
		}
	}, [onReject, onSendSystemMessage]);

	// Handle approval timeout
	useEffect(() => {
		if (approvalRequest) {
			const timeout = setTimeout(() => {
				handleReject( __( 'Approval request timed out.', 'wp-module-ai-chat' ) );
			}, APPROVAL.TIMEOUT);

			return () => clearTimeout(timeout);
		}
	}, [approvalRequest, handleReject]);

	// Handle keyboard navigation
	useEffect(() => {
		const handleKeyDown = (e) => {
			if (e.key === 'Escape' && !isExecuting) {
				handleReject();
			} else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !isExecuting) {
				handleApprove();
			}
		};

		window.addEventListener('keydown', handleKeyDown);
		return () => window.removeEventListener('keydown', handleKeyDown);
	}, [isExecuting, handleReject, handleApprove]);

	if (!approvalRequest) {
		return null;
	}

	const {
		tool_name,
		tool_arguments,
	} = approvalRequest;

	return (
		<div 
			className={`nfd-inline-approval nfd-brand-${brandId || 'default'}`}
			role="region"
			aria-label={ __( 'Action approval required', 'wp-module-ai-chat' ) }
			aria-live="polite"
		>
			<div className="nfd-inline-approval__card">
				{/* Header with icon and title */}
				<div className="nfd-inline-approval__header">
					<span 
						className="nfd-inline-approval__icon" 
						role="img" 
						aria-label={ __( 'Warning', 'wp-module-ai-chat' ) }
					>
						⚠️
					</span>
					<h3 className="nfd-inline-approval__title">{ __( 'Action Required', 'wp-module-ai-chat' ) }</h3>
				</div>
				
				{/* Content section */}
				<div className="nfd-inline-approval__content">
					<p className="nfd-inline-approval__description">
						{ __( 'Approve execution of:', 'wp-module-ai-chat' ) } <strong>{getActionDisplayName(tool_name)}</strong>
					</p>
					
					{tool_arguments && Object.keys(tool_arguments).length > 0 && (
						<div className="nfd-inline-approval__arguments">
							<label className="nfd-inline-approval__arguments-label">
								{ __( 'Arguments:', 'wp-module-ai-chat' ) }
							</label>
							<pre 
								className="nfd-inline-approval__arguments-code"
								role="textbox"
								aria-label={ __( 'Tool arguments', 'wp-module-ai-chat' ) }
							>
								{formatToolArguments(tool_arguments)}
							</pre>
						</div>
					)}
					
					{/* Error message */}
					{error && (
						<div 
							className="nfd-inline-approval__error"
							role="alert"
							aria-live="assertive"
						>
							<span className="nfd-inline-approval__error-icon">✕</span>
							<span className="nfd-inline-approval__error-message">{error}</span>
						</div>
					)}
				</div>
				
				{/* Action buttons */}
				<div className="nfd-inline-approval__actions">
					<button
						type="button"
						onClick={handleReject}
						disabled={isExecuting}
						className="nfd-inline-approval__button nfd-inline-approval__button--secondary"
						aria-label={ __( 'Cancel action', 'wp-module-ai-chat' ) }
					>
						{ __( 'Cancel', 'wp-module-ai-chat' ) }
					</button>
					<button
						type="button"
						onClick={handleApprove}
						disabled={isExecuting}
						className="nfd-inline-approval__button nfd-inline-approval__button--primary"
						aria-label={ __( 'Approve and execute action', 'wp-module-ai-chat' ) }
						aria-busy={isExecuting}
					>
						{isExecuting ? (
							<>
								<span className="nfd-inline-approval__spinner" aria-hidden="true" />
								<span>{ __( 'Executing...', 'wp-module-ai-chat' ) }</span>
							</>
						) : (
							__( 'Approve', 'wp-module-ai-chat' )
						)}
					</button>
				</div>
			</div>
		</div>
	);
};

InlineApproval.propTypes = {
	approvalRequest: PropTypes.shape({
		tool_name: PropTypes.string.isRequired,
		tool_arguments: PropTypes.object,
		site_url: PropTypes.string,
		frontend: PropTypes.string,
	}),
	onApprove: PropTypes.func.isRequired,
	onReject: PropTypes.func.isRequired,
	onExecuteTool: PropTypes.func,
	onSendMessage: PropTypes.func,
	onSendSystemMessage: PropTypes.func,
	conversationId: PropTypes.string,
	onClearTyping: PropTypes.func,
	brandId: PropTypes.string,
};

export default InlineApproval;
