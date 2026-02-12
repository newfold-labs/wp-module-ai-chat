<?php

namespace NewfoldLabs\WP\Module\AIChat;

/**
 * Permissions class for AI Chat module.
 *
 * Provides permission checks for AI chat functionality.
 */
class Permissions {

	/**
	 * Check if the current user can use AI chat.
	 *
	 * @return bool True if user has permission.
	 */
	public static function can_use_chat(): bool {
		return \current_user_can( 'edit_posts' );
	}

	/**
	 * Check if the current user is an editor.
	 *
	 * @return bool True if user is an editor.
	 */
	public static function is_editor(): bool {
		return \current_user_can( 'edit_posts' );
	}

	/**
	 * Check if the current user can manage options.
	 *
	 * @return bool True if user can manage options.
	 */
	public static function can_manage(): bool {
		return \current_user_can( 'manage_options' );
	}

	/**
	 * REST API permission callback.
	 *
	 * @return bool True if user has permission to access REST endpoints.
	 */
	public static function rest_permission_callback(): bool {
		return self::can_use_chat();
	}
}
