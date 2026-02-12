<?php

namespace NewfoldLabs\WP\Module\AIChat\Helpers;

use WP_Error;

/**
 * Helper for resolving HUAPI JWT (debug constant, transient cache, or Hiive API).
 */
class HuapiHelper {

	/**
	 * Transient key for caching the HUAPI JWT (12-hour TTL).
	 *
	 * @var string
	 */
	const TRANSIENT_KEY_JWT = 'nfd_ai_chat_jarvis_jwt';

	/**
	 * Resolve HUAPI JWT: debug constant, transient cache, or Hiive API.
	 *
	 * @return string|WP_Error Token string or error.
	 */
	public function get_token() {
		if ( defined( 'NFD_AI_CHAT_JARVIS_DEBUG_TOKEN' ) && '' !== NFD_AI_CHAT_JARVIS_DEBUG_TOKEN ) {
			return NFD_AI_CHAT_JARVIS_DEBUG_TOKEN;
		}

		$token = get_transient( self::TRANSIENT_KEY_JWT );
		if ( false !== $token && '' !== $token ) {
			return $token;
		}

		$hiive_helper  = new HiiveHelper( '/sites/v1/customer', array(), 'GET' );
		$customer_data = $hiive_helper->send_request();

		if ( is_wp_error( $customer_data ) ) {
			return new WP_Error(
				'huapi_token_fetch_failed',
				__( 'Failed to fetch authentication token', 'nfd-editor-chat' ),
				array( 'status' => 500 )
			);
		}

		if ( empty( $customer_data['huapi_token'] ) ) {
			return new WP_Error(
				'huapi_token_fetch_failed',
				__( 'Failed to fetch authentication token', 'nfd-editor-chat' ),
				array( 'status' => 500 )
			);
		}

		$token = $customer_data['huapi_token'];
		set_transient( self::TRANSIENT_KEY_JWT, $token, 12 * HOUR_IN_SECONDS );

		return $token;
	}
}
