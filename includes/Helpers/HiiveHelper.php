<?php

namespace NewfoldLabs\WP\Module\AIChat\Helpers;

use NewfoldLabs\WP\Module\Data\HiiveConnection;

/**
 * Helper class for interacting with Hiive APIs.
 */
class HiiveHelper {
	/**
	 * Base URL for Hiive APIs.
	 *
	 * @var string
	 */
	private $api_base_url;

	/**
	 * API endpoint.
	 *
	 * @var string
	 */
	private $endpoint;

	/**
	 * Request body.
	 *
	 * @var array
	 */
	private $body;

	/**
	 * HTTP method (GET, POST, etc).
	 *
	 * @var string
	 */
	private $method;

	/**
	 * Constructor.
	 *
	 * @param string $endpoint API endpoint.
	 * @param array  $body     Request body.
	 * @param string $method   HTTP method.
	 */
	public function __construct( $endpoint = '', $body = array(), $method = 'POST' ) {
		if ( ! defined( 'NFD_HIIVE_URL' ) ) {
			define( 'NFD_HIIVE_URL', 'https://hiive.cloud/api' );
		}

		$this->api_base_url = constant( 'NFD_HIIVE_URL' );
		$this->endpoint     = $endpoint;
		$this->body         = $body;
		$this->method       = strtoupper( $method );
	}

	/**
	 * Sends the request to Hiive.
	 *
	 * @param string $method   Optional HTTP method (overrides constructor).
	 * @param string $endpoint Optional endpoint (overrides constructor).
	 * @param array  $body     Optional body (overrides constructor).
	 * @return mixed|string|\WP_Error JSON-decoded data or WP_Error.
	 */
	public function send_request( $method = null, $endpoint = null, $body = null ) {
		if ( ! HiiveConnection::is_connected() ) {
			return new \WP_Error(
				'nfd_hiive_error',
				__( 'Failed to connect to Hiive API.', 'wp-module-ai-chat' )
			);
		}

		// Use provided parameters or fall back to constructor values
		$method   = $method ? strtoupper( $method ) : $this->method;
		$endpoint = $endpoint ?: $this->endpoint;
		$body     = $body !== null ? $body : $this->body;

		$url = $this->api_base_url . $endpoint;

		$args = array(
			'method'  => $method,
			'headers' => array(
				'Content-Type'  => 'application/json',
				'Authorization' => 'Bearer ' . HiiveConnection::get_auth_token(),
			),
			'timeout' => 30,
		);

		if ( in_array( $method, array( 'POST', 'PUT', 'PATCH' ), true ) ) {
			$args['body'] = wp_json_encode( $body );
		}

		if ( in_array( $method, array( 'GET', 'DELETE' ), true ) && ! empty( $body ) ) {
			$url = add_query_arg( $body, $url );
		}

		$response = wp_remote_request( $url, $args );

		if ( is_wp_error( $response ) ) {
			return $response;
		}

		$code = wp_remote_retrieve_response_code( $response );
		if ( $code < 200 || $code >= 300 ) {
			return new \WP_Error( 'nfd_hiive_error', \sprintf( __( 'Hiive API returned HTTP %d.', 'wp-module-ai-chat' ), $code ) );
		}

		$response_body = wp_remote_retrieve_body( $response );

		// Decode JSON response
		$decoded = json_decode( $response_body, true );

		// Return decoded data if valid JSON, otherwise return raw body
		return json_last_error() === JSON_ERROR_NONE ? $decoded : $response_body;
	}
}
