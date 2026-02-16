<?php

namespace NewfoldLabs\WP\Module\AIChat\Helpers;

/**
 * Helper for resolving the NFD AI Chat Jarvis gateway URL.
 */
class NfdAgentsGatewayHelper {

	/**
	 * Get gateway URL (from NFD_AI_CHAT_JARVIS_GATEWAY_URL, or default if not defined).
	 *
	 * @return string Gateway URL.
	 */
	public function get_gateway_url() {
		if ( ! defined( 'NFD_AI_CHAT_JARVIS_GATEWAY_URL' ) ) {
			define( 'NFD_AI_CHAT_JARVIS_GATEWAY_URL', 'http://localhost:8080' );
		}
		return constant( 'NFD_AI_CHAT_JARVIS_GATEWAY_URL' );
	}
}
