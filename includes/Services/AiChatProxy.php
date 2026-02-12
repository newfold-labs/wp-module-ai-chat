<?php
/**
 * OpenAI Proxy Service
 *
 * Handles proxying requests to the cloud-patterns AI endpoint,
 * which in turn proxies to OpenAI API or Cloudflare AI Gateway.
 * Supports both streaming and non-streaming requests.
 *
 * @package NewfoldLabs\WP\Module\AIChat\Services
 */

namespace NewfoldLabs\WP\Module\AIChat\Services;

use NewfoldLabs\WP\Module\Data\HiiveConnection;
use WP_Error;

/**
 * OpenAI Proxy class
 */
class AiChatProxy {

	/**
	 * Whether a streaming response is currently active.
	 * Used by the shutdown handler to detect fatal errors during streaming.
	 *
	 * @var bool
	 */
	private $streaming_active = false;

	/**
	 * Production base URL for the AI proxy
	 *
	 * @var string
	 */
	const PRODUCTION_BASE_URL = 'https://patterns.hiive.cloud';

	/**
	 * Local base URL for development
	 *
	 * @var string
	 */
	const LOCAL_BASE_URL = 'https://localhost:8888';

	/**
	 * Default model to use
	 *
	 * @var string
	 */
	const DEFAULT_MODEL = 'gpt-4o-mini';

	/**
	 * API path for chat completions endpoint
	 *
	 * @var string
	 */
	const API_PATH = '/api/v1/ai/chat/completions';

	/**
	 * Get the AI proxy URL based on environment
	 *
	 * @return string The AI proxy URL
	 */
	private function get_proxy_url(): string {
		// Check for custom URL override (can be full URL or just base URL)
		if ( defined( 'NFD_AI_PROXY_URL' ) && ! empty( NFD_AI_PROXY_URL ) ) {
			$url = NFD_AI_PROXY_URL;
			// Append API path if not already included
			if ( strpos( $url, self::API_PATH ) === false ) {
				$url = rtrim( $url, '/' ) . self::API_PATH;
			}
			return $url;
		}

		// Determine base URL based on dev mode
		if ( defined( 'NFD_DATA_WB_DEV_MODE' ) && NFD_DATA_WB_DEV_MODE ) {
			$base_url = defined( 'NFD_WB_LOCAL_BASE_URL' ) ? NFD_WB_LOCAL_BASE_URL : self::LOCAL_BASE_URL;
		} else {
			$base_url = defined( 'NFD_WB_PRODUCTION_BASE_URL' ) ? NFD_WB_PRODUCTION_BASE_URL : self::PRODUCTION_BASE_URL;
		}

		return rtrim( $base_url, '/' ) . self::API_PATH;
	}

	/**
	 * Get the API configuration (URL and headers)
	 *
	 * @return array Configuration array with 'url' and 'headers'
	 */
	public function get_api_config() {
		return array(
			'url'     => $this->get_proxy_url(),
			'headers' => array(
				'Authorization' => 'Bearer ' . HiiveConnection::get_auth_token(),
				'Content-Type'  => 'application/json',
			),
		);
	}

	/**
	 * Proxy a chat completion request
	 *
	 * @param array $request_data Request data including messages, tools, etc.
	 * @return array|WP_Error Response data or error
	 */
	public function proxy_request( array $request_data ) {
		$config = $this->get_api_config();

		// Prepare the request body
		$body = array(
			'model'    => $request_data['model'] ?? self::DEFAULT_MODEL,
			'messages' => $request_data['messages'] ?? array(),
			'stream'   => false,
			'mode'     => $request_data['mode'] ?? 'help',
		);

		// Add optional parameters
		if ( ! empty( $request_data['tools'] ) ) {
			$body['tools'] = $request_data['tools'];
		}

		if ( isset( $request_data['tool_choice'] ) ) {
			$body['tool_choice'] = $request_data['tool_choice'];
		}

		if ( isset( $request_data['max_tokens'] ) ) {
			$body['max_tokens'] = (int) $request_data['max_tokens'];
		}

		if ( isset( $request_data['temperature'] ) ) {
			$body['temperature'] = (float) $request_data['temperature'];
		}

		if ( isset( $request_data['max_completion_tokens'] ) ) {
			$body['max_completion_tokens'] = (int) $request_data['max_completion_tokens'];
		}

		if ( isset( $request_data['stream_options'] ) ) {
			$body['stream_options'] = $request_data['stream_options'];
		}

		$response = wp_remote_post(
			$config['url'],
			array(
				'headers'     => $config['headers'],
				'body'        => wp_json_encode( $body ),
				'timeout'     => 120,
				'data_format' => 'body',
				'sslverify'   => $this->should_verify_ssl(),
			)
		);

		if ( is_wp_error( $response ) ) {
			return new WP_Error(
				'api_request_failed',
				$response->get_error_message(),
				array( 'status' => 500 )
			);
		}

		$response_code = wp_remote_retrieve_response_code( $response );
		$response_body = wp_remote_retrieve_body( $response );
		$data          = json_decode( $response_body, true );

		if ( 200 !== $response_code ) {
			$error_message = $data['error']['message'] ?? 'AI API request failed';
			return new WP_Error(
				'api_error',
				$error_message,
				array( 'status' => $response_code )
			);
		}

		return $data;
	}

	/**
	 * Stream a chat completion request
	 *
	 * This outputs SSE events directly to the response.
	 *
	 * @param array $request_data Request data including messages, tools, etc.
	 * @return void|WP_Error Outputs stream or returns error
	 */
	public function stream_request( array $request_data ) {
		$config = $this->get_api_config();

		// Prepare the request body
		$body = array(
			'model'    => $request_data['model'] ?? self::DEFAULT_MODEL,
			'messages' => $request_data['messages'] ?? array(),
			'stream'   => true,
			'mode'     => $request_data['mode'] ?? 'help',
		);

		// Add optional parameters
		if ( ! empty( $request_data['tools'] ) ) {
			$body['tools'] = $request_data['tools'];
		}

		if ( isset( $request_data['tool_choice'] ) ) {
			$body['tool_choice'] = $request_data['tool_choice'];
		}

		if ( isset( $request_data['max_tokens'] ) ) {
			$body['max_tokens'] = (int) $request_data['max_tokens'];
		}

		if ( isset( $request_data['temperature'] ) ) {
			$body['temperature'] = (float) $request_data['temperature'];
		}

		if ( isset( $request_data['max_completion_tokens'] ) ) {
			$body['max_completion_tokens'] = (int) $request_data['max_completion_tokens'];
		}

		if ( isset( $request_data['stream_options'] ) ) {
			$body['stream_options'] = $request_data['stream_options'];
		}

		// Set up streaming headers
		$this->setup_streaming_headers();

		// Make the streaming request using cURL
		$this->make_streaming_request( $config, $body );
	}

	/**
	 * Set up headers for streaming response
	 *
	 * @return void
	 */
	private function setup_streaming_headers() {
		// Disable output buffering
		while ( ob_get_level() > 0 ) {
			ob_end_flush();
		}

		// Set SSE headers
		header( 'Content-Type: text/event-stream' );
		header( 'Cache-Control: no-cache' );
		header( 'Connection: keep-alive' );
		header( 'X-Accel-Buffering: no' ); // Disable nginx buffering
	}

	/**
	 * Make a streaming request to the AI API
	 *
	 * @param array $config API configuration.
	 * @param array $body   Request body.
	 * @return void
	 */
	private function make_streaming_request( array $config, array $body ) {
		// Raise memory limit for streaming — large block markup responses need headroom.
		// phpcs:ignore WordPress.PHP.IniSet.memory_limit_Disallowed
		@ini_set( 'memory_limit', '512M' );

		// Extend execution time — complex page edits can produce long AI responses.
		// phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged
		@set_time_limit( 300 );

		// Register a shutdown handler so PHP fatal errors produce a clean SSE
		// error event instead of dumping an HTML error page into the stream.
		$this->streaming_active = true;
		register_shutdown_function( array( $this, 'handle_streaming_shutdown' ) );

		// phpcs:ignore WordPress.WP.AlternativeFunctions.curl_curl_init
		$ch = curl_init( $config['url'] );

		// Build headers array for cURL
		$curl_headers = array();
		foreach ( $config['headers'] as $key => $value ) {
			$curl_headers[] = "{$key}: {$value}";
		}

		$curl_options = array(
			CURLOPT_POST           => true,
			CURLOPT_POSTFIELDS     => wp_json_encode( $body ),
			CURLOPT_HTTPHEADER     => $curl_headers,
			CURLOPT_RETURNTRANSFER => false,
			CURLOPT_TIMEOUT        => 120,
			CURLOPT_WRITEFUNCTION  => array( $this, 'handle_stream_chunk' ),
		);

		// Disable SSL verification in development
		if ( ! $this->should_verify_ssl() ) {
			$curl_options[ CURLOPT_SSL_VERIFYPEER ] = false;
			$curl_options[ CURLOPT_SSL_VERIFYHOST ] = 0;
		}

		// phpcs:ignore WordPress.WP.AlternativeFunctions.curl_curl_setopt_array
		curl_setopt_array( $ch, $curl_options );

		// phpcs:ignore WordPress.WP.AlternativeFunctions.curl_curl_exec
		$result = curl_exec( $ch );

		if ( false === $result ) {
			// phpcs:ignore WordPress.WP.AlternativeFunctions.curl_curl_error
			$error = curl_error( $ch );
			$this->send_error_event( 'cURL error: ' . $error );
		}

		// phpcs:ignore WordPress.WP.AlternativeFunctions.curl_curl_close
		curl_close( $ch );

		$this->streaming_active = false;

		// Send final done event
		echo "data: [DONE]\n\n";

		if ( ob_get_level() > 0 ) {
			ob_flush();
		}
		flush();
	}

	/**
	 * Handle streaming chunk from cURL
	 *
	 * @param resource $ch   cURL handle.
	 * @param string   $data Chunk data.
	 * @return int Number of bytes handled
	 */
	public function handle_stream_chunk( $ch, $data ) {
		// Guard against non-SSE data leaking into the stream (e.g. HTML error
		// pages from the upstream proxy or PHP itself). Detect full HTML pages,
		// Symfony/Laravel error handler output, and PHP fatal error text.
		if ( preg_match( '/<!DOCTYPE|<html|sf-dump|<style|Fatal\s+Error|Maximum execution time/i', $data ) ) {
			// Extract a useful error snippet from the HTML.
			$snippet = strip_tags( $data );
			$snippet = preg_replace( '/\s+/', ' ', trim( $snippet ) );
			$snippet = substr( $snippet, 0, 200 );
			$this->send_error_event( 'Upstream error: ' . $snippet );
			// Return the full length so cURL considers the chunk consumed.
			return strlen( $data );
		}

		// Forward the data as-is (it's already in SSE format)
		echo $data;

		if ( ob_get_level() > 0 ) {
			ob_flush();
		}
		flush();

		return strlen( $data );
	}

	/**
	 * Send an error event via SSE
	 *
	 * @param string $message Error message.
	 * @return void
	 */
	private function send_error_event( string $message ) {
		$error_data = wp_json_encode(
			array(
				'error' => array(
					'message' => $message,
				),
			)
		);

		// Terminate any previously flushed incomplete SSE data line.
		// Without this, the error event would be concatenated with a partial
		// "data: {...}" line that was already sent to the client, producing
		// unparseable JSON.
		echo "\n\n";
		echo "data: {$error_data}\n\n";
		echo "data: [DONE]\n\n";

		if ( ob_get_level() > 0 ) {
			ob_flush();
		}
		flush();
	}

	/**
	 * Shutdown handler for streaming requests.
	 *
	 * Catches PHP fatal errors that occur during streaming and sends a clean
	 * SSE error event instead of letting raw HTML error output corrupt the
	 * event stream.
	 *
	 * @return void
	 */
	public function handle_streaming_shutdown() {
		if ( ! $this->streaming_active ) {
			return;
		}

		$error = error_get_last();
		if ( null === $error || ! in_array( $error['type'], array( E_ERROR, E_CORE_ERROR, E_COMPILE_ERROR, E_PARSE ), true ) ) {
			return;
		}

		// Clean any partial output that may have been buffered.
		while ( ob_get_level() > 0 ) {
			ob_end_clean();
		}

		$message = sprintf(
			'PHP Fatal Error: %s in %s on line %d',
			$error['message'],
			basename( $error['file'] ),
			$error['line']
		);

		$error_data = wp_json_encode(
			array(
				'error' => array(
					'message' => $message,
				),
			)
		);

		echo "data: {$error_data}\n\n";
		echo "data: [DONE]\n\n";

		if ( ob_get_level() > 0 ) {
			ob_flush();
		}
		flush();
	}

	/**
	 * Determine if SSL should be verified
	 *
	 * @return bool
	 */
	private function should_verify_ssl() {
		// Allow explicitly disabling SSL verification via a dedicated constant.
		// This should only be used in controlled development environments
		// where self-signed certificates or similar setups are in use.
		if ( defined( 'NFD_AI_DISABLE_SSL_VERIFY' ) && NFD_AI_DISABLE_SSL_VERIFY ) {
			return false;
		}

		// By default, always verify SSL.
		return true;
	}
}
