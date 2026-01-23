/**
 * Message Utilities
 * 
 * Utilities for generating user-friendly messages, particularly for tool execution results.
 * Used by approval dialogs and inline approval components.
 */

import { __, sprintf } from '@wordpress/i18n';

/**
 * Generate user-friendly success message based on tool name and result
 * 
 * @param {string} toolName Tool name that was executed
 * @param {Object|string} result Tool execution result
 * @returns {string} User-friendly success message
 */
export const generateSuccessMessage = (toolName, result) => {
	// Normalize tool name for matching
	const normalizedTool = (toolName || '').toLowerCase();

	// Try to extract title/name from result
	let itemTitle = '';

	if (result && typeof result === 'object') {
		itemTitle = result.title?.rendered || result.title || result.name || '';
	} else if (typeof result === 'string') {
		// Try to parse JSON from string result
		try {
			const parsed = JSON.parse(result);
			itemTitle = parsed.title?.rendered || parsed.title || parsed.name || '';
		} catch (e) {
			// Not JSON, use as-is
		}
	}

	// Generate message based on tool type
	if (normalizedTool.includes('posts-create') || normalizedTool.includes('create-post')) {
		return itemTitle
			? sprintf(
				/* translators: %s: post title */
				__('Post "%s" has been created successfully.', 'wp-module-ai-chat'),
				itemTitle
			)
			: __('Post has been created successfully.', 'wp-module-ai-chat');
	}

	if (normalizedTool.includes('posts-update') || normalizedTool.includes('update-post')) {
		return itemTitle
			? sprintf(
				/* translators: %s: post title */
				__('Post "%s" has been updated successfully.', 'wp-module-ai-chat'),
				itemTitle
			)
			: __('Post has been updated successfully.', 'wp-module-ai-chat');
	}

	if (normalizedTool.includes('posts-delete') || normalizedTool.includes('delete-post')) {
		return __('Post has been deleted successfully.', 'wp-module-ai-chat');
	}

	if (normalizedTool.includes('pages-create') || normalizedTool.includes('create-page')) {
		return itemTitle
			? sprintf(
				/* translators: %s: page title */
				__('Page "%s" has been created successfully.', 'wp-module-ai-chat'),
				itemTitle
			)
			: __('Page has been created successfully.', 'wp-module-ai-chat');
	}

	if (normalizedTool.includes('pages-update') || normalizedTool.includes('update-page')) {
		return itemTitle
			? sprintf(
				/* translators: %s: page title */
				__('Page "%s" has been updated successfully.', 'wp-module-ai-chat'),
				itemTitle
			)
			: __('Page has been updated successfully.', 'wp-module-ai-chat');
	}

	if (normalizedTool.includes('pages-delete') || normalizedTool.includes('delete-page')) {
		return __('Page has been deleted successfully.', 'wp-module-ai-chat');
	}

	if (normalizedTool.includes('media-create') || normalizedTool.includes('upload')) {
		return itemTitle
			? sprintf(
				/* translators: %s: media title */
				__('Media "%s" has been uploaded successfully.', 'wp-module-ai-chat'),
				itemTitle
			)
			: __('Media has been uploaded successfully.', 'wp-module-ai-chat');
	}

	if (normalizedTool.includes('media-delete') || normalizedTool.includes('delete-media')) {
		return __('Media has been deleted successfully.', 'wp-module-ai-chat');
	}

	if (normalizedTool.includes('categories-create') || normalizedTool.includes('create-category')) {
		return itemTitle
			? sprintf(
				/* translators: %s: category name */
				__('Category "%s" has been created successfully.', 'wp-module-ai-chat'),
				itemTitle
			)
			: __('Category has been created successfully.', 'wp-module-ai-chat');
	}

	if (normalizedTool.includes('tags-create') || normalizedTool.includes('create-tag')) {
		return itemTitle
			? sprintf(
				/* translators: %s: tag name */
				__('Tag "%s" has been created successfully.', 'wp-module-ai-chat'),
				itemTitle
			)
			: __('Tag has been created successfully.', 'wp-module-ai-chat');
	}

	if (normalizedTool.includes('users-create') || normalizedTool.includes('create-user')) {
		return __('User has been created successfully.', 'wp-module-ai-chat');
	}

	if (normalizedTool.includes('comments-create') || normalizedTool.includes('create-comment')) {
		return __('Comment has been created successfully.', 'wp-module-ai-chat');
	}

	if (normalizedTool.includes('settings-update') || normalizedTool.includes('update-settings')) {
		return __('Settings have been updated successfully.', 'wp-module-ai-chat');
	}

	// Generic fallback based on action verb
	if (normalizedTool.includes('create')) {
		return __('Item has been created successfully.', 'wp-module-ai-chat');
	}
	if (normalizedTool.includes('update')) {
		return __('Item has been updated successfully.', 'wp-module-ai-chat');
	}
	if (normalizedTool.includes('delete')) {
		return __('Item has been deleted successfully.', 'wp-module-ai-chat');
	}

	// Default fallback
	return __('Action completed successfully.', 'wp-module-ai-chat');
};
