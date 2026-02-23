<?php

namespace NewfoldLabs\WP\Module\AIChat\Helpers;

use WP_Error;

/**
 * Helper for resolving Jarvis JWT for NFD Agents backend authentication.
 *
 * Returns the Identity Service JWT (jarvis_jwt) from Hiive customer API.
 */
class JarvisJWTHelper {

	/**
	 * Transient key for caching the Jarvis JWT (12-hour TTL).
	 *
	 * @var string
	 */
	const TRANSIENT_KEY_JWT = 'nfd_ai_chat_jarvis_jwt';

	/**
	 * Minimum seconds until expiry to return a cached token; below this we refetch (safety buffer).
	 *
	 * @var int
	 */
	const MIN_SECONDS_UNTIL_EXPIRY = 60;

	/**
	 * Resolve Jarvis JWT: debug constant, transient cache, or Hiive API (jarvis_jwt only).
	 *
	 * @return string|WP_Error Token string or error.
	 */
	public function get_token() {
		if ( defined( 'NFD_AI_CHAT_JARVIS_DEBUG_TOKEN' ) && '' !== NFD_AI_CHAT_JARVIS_DEBUG_TOKEN ) {
			return NFD_AI_CHAT_JARVIS_DEBUG_TOKEN;
		}

		$token = get_transient( self::TRANSIENT_KEY_JWT );
		if ( false !== $token && '' !== $token ) {
			if ( $this->get_seconds_until_expiry( $token ) > self::MIN_SECONDS_UNTIL_EXPIRY ) {
				return $token;
			}
			delete_transient( self::TRANSIENT_KEY_JWT );
		}

		$hiive_helper  = new HiiveHelper( '/sites/v1/customer', array(), 'GET' );
		$customer_data = $hiive_helper->send_request();

		if ( is_wp_error( $customer_data ) ) {
			return new WP_Error(
				'jarvis_jwt_fetch_failed',
				__( 'Failed to fetch authentication token', 'wp-module-ai-chat' ),
				array( 'status' => 500 )
			);
		}

		$token = isset( $customer_data['jarvis_jwt'] ) && is_string( $customer_data['jarvis_jwt'] ) && '' !== $customer_data['jarvis_jwt']
			? $customer_data['jarvis_jwt']
			: '';

		if ( '' === $token ) {
			return new WP_Error(
				'jarvis_jwt_fetch_failed',
				__( 'Failed to fetch authentication token', 'wp-module-ai-chat' ),
				array( 'status' => 500 )
			);
		}

		$ttl               = 12 * HOUR_IN_SECONDS;
		$seconds_until_exp = $this->get_seconds_until_expiry( $token );
		if ( $seconds_until_exp > 0 ) {
			// Optional: expire transient 5 min before JWT so config fetches get a fresh token without relying on on-read expiry.
			$seconds_until_exp_buffered = max( 0, $seconds_until_exp - 300 );
			$ttl                        = min( 12 * HOUR_IN_SECONDS, $seconds_until_exp_buffered );
			// Guard: WordPress treats TTL 0 as "never expire"; keep 12h fallback if TTL would be non-positive.
			if ( $ttl <= 0 ) {
				$ttl = 12 * HOUR_IN_SECONDS;
			}
		}
		set_transient( self::TRANSIENT_KEY_JWT, $token, $ttl );

		return $token;
	}

	/**
	 * Get seconds until JWT expiry from payload exp claim (base64url decode, no full JWT library).
	 *
	 * @param string $token JWT string.
	 * @return int Seconds until expiry; 0 or negative if expired, invalid, or missing exp.
	 */
	private function get_seconds_until_expiry( $token ) {
		if ( ! is_string( $token ) || '' === $token ) {
			return 0;
		}
		$parts = explode( '.', $token );
		if ( count( $parts ) < 2 ) {
			return 0;
		}
		$payload_b64 = $parts[1];
		$payload_b64 = str_replace( array( '-', '_' ), array( '+', '/' ), $payload_b64 );
		$pad         = strlen( $payload_b64 ) % 4;
		if ( $pad ) {
			$payload_b64 .= str_repeat( '=', 4 - $pad );
		}
		// phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.obfuscation_base64_decode -- JWT payload is base64url-encoded; decoding is required and safe.
		$payload_json = base64_decode( $payload_b64, true );
		if ( false === $payload_json ) {
			return 0;
		}
		$payload = json_decode( $payload_json, true );
		if ( ! is_array( $payload ) || ! isset( $payload['exp'] ) || ! is_numeric( $payload['exp'] ) ) {
			return 0;
		}
		return (int) $payload['exp'] - time();
	}
}
