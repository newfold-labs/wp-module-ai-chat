<?php

namespace NewfoldLabs\WP\Module\AIChat\Helpers;

/**
 * Helper for resolving the NFD AI Chat Jarvis gateway URL.
 */
class NfdAgentsGatewayHelper {

	/**
	 * Get gateway URL (from NFD_AI_CHAT_JARVIS_GATEWAY_URL in wp-config.php).
	 *
	 * @return string Gateway URL, or empty string if not configured.
	 */
	public function get_gateway_url() {
		if ( defined( 'NFD_AI_CHAT_JARVIS_GATEWAY_URL' ) && '' !== NFD_AI_CHAT_JARVIS_GATEWAY_URL ) {
			return NFD_AI_CHAT_JARVIS_GATEWAY_URL;
		}
		return '';
	}
}
