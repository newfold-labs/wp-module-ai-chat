<?php

namespace NewfoldLabs\WP\Module\AIChat\RestApi;

use NewfoldLabs\WP\Module\Data\SiteCapabilities;
use NewfoldLabs\WP\Module\AIChat\Helpers\HiiveHelper;
use NewfoldLabs\WP\ModuleLoader\Container;
use WP_REST_Controller;
use WP_REST_Request;
use WP_REST_Response;
use WP_Error;

/**
 * NFD Agents Chat Config Controller
 *
 * Provides configuration endpoint for AI chat (Help Center, Editor Chat, etc.)
 * Returns gateway URL, authentication token, and site configuration.
 * Use storage_namespace for capability lookup.
 */
class NfdAgentsChatConfigController extends WP_REST_Controller {
	/**
	 * The namespace for the REST API
	 *
	 * @var string
	 */
	protected $namespace = 'nfd-agents/chat/v1';

	/**
	 * The base for the REST API
	 *
	 * @var string
	 */
	protected $rest_base = 'config';

	/**
	 * Dependency injection container.
	 *
	 * @var Container
	 */
	protected $container;

	/**
	 * Constructor.
	 *
	 * @param Container $container Dependency injection container.
	 */
	public function __construct( Container $container ) {
		$this->container = $container;
	}

	/**
	 * Map of storage namespace (surface) to capability requirements
	 *
	 * @var array
	 */
	protected $namespace_capabilities = array(
		'default'      => 'canAccessAIHelpCenter',
		'help_center'  => 'canAccessAIHelpCenter',
		'editor_chat'  => 'canAccessAIEditorChat',
	);

	/**
	 * Register the routes for the controller.
	 */
	public function register_routes() {
		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base,
			array(
				array(
					'methods'             => \WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_config' ),
					'permission_callback' => array( $this, 'check_permission' ),
					'args'                => array(
						'storage_namespace' => array(
							'description' => 'Client surface for capability lookup (help_center, editor_chat, default)',
							'type'        => 'string',
							'required'    => false,
							'default'     => 'help_center',
							'enum'        => array( 'default', 'help_center', 'editor_chat' ),
						),
					),
				),
			)
		);
	}

	/**
	 * Check if a request has access
	 *
	 * @param WP_REST_Request $request Full details about the request.
	 * @return bool|WP_Error
	 */
	public function check_permission( WP_REST_Request $request ) {
		$namespace = $request->get_param( 'storage_namespace' ) ?: 'help_center';
		$capability = $this->get_capability_for_namespace( $namespace );

		if ( ! $capability ) {
			return new WP_Error(
				'invalid_storage_namespace',
				__( 'Invalid storage_namespace specified', 'wp-module-ai-chat' ),
				array( 'status' => 400 )
			);
		}

		$capabilities = new SiteCapabilities();
		return $capabilities->get( $capability, false );
	}

	/**
	 * Get configuration for AI chat frontend
	 *
	 * @param WP_REST_Request $request Full details about the request.
	 * @return WP_REST_Response|WP_Error
	 */
	public function get_config( WP_REST_Request $request ) {
		// storage_namespace is used only for capability lookup; not included in response

		$gateway_url = $this->get_gateway_url();
		if ( $gateway_url === '' || $gateway_url === null ) {
			return new WP_Error(
				'gateway_url_not_configured',
				__( 'NFD Agents gateway URL is not configured. Set NFD_AGENTS_CHAT_GATEWAY_URL in wp-config.php or use the nfd_agents_chat_gateway_url filter.', 'wp-module-ai-chat' ),
				array( 'status' => 500 )
			);
		}

		// Use NFD_AGENTS_CHAT_DEBUG_TOKEN if defined in wp-config.php (for local/debug when bypassing Hiive)
		// Otherwise, fetch from Hiive API
		if ( defined( 'NFD_AGENTS_CHAT_DEBUG_TOKEN' ) && ! empty( NFD_AGENTS_CHAT_DEBUG_TOKEN ) ) {
			$huapi_token = NFD_AGENTS_CHAT_DEBUG_TOKEN;
		} else {
			// Fetch huapi_token from /sites/v1/customer endpoint (like PlanInfo.php)
			$hiive_helper = new HiiveHelper( '/sites/v1/customer', array(), 'GET' );
			$customer_data = $hiive_helper->send_request();

			if ( is_wp_error( $customer_data ) || ! isset( $customer_data['huapi_token'] ) ) {
				return new WP_Error(
					'huapi_token_fetch_failed',
					__( 'Failed to fetch authentication token', 'wp-module-ai-chat' ),
					array( 'status' => 500 )
				);
			}

			$huapi_token = $customer_data['huapi_token'];
		}

		$site_url    = get_site_url();
		$brand_id    = $this->get_brand_id();
		$agent_type  = 'blu'; // Agent type (must match gateway/backend agent registry, e.g. blu)

		return new WP_REST_Response(
			array(
				'gateway_url' => $gateway_url,
				'huapi_token' => $huapi_token,
				'site_url'    => $site_url,
				'brand_id'    => $brand_id,
				'agent_type'  => $agent_type,
			)
		);
	}

	/**
	 * Get capability name for a given storage namespace (surface)
	 *
	 * @param string $namespace Storage namespace (help_center, editor_chat, default).
	 * @return string|null Capability name or null if invalid.
	 */
	protected function get_capability_for_namespace( $namespace ) {
		return $this->namespace_capabilities[ $namespace ] ?? null;
	}

	/**
	 * Get gateway URL (from NFD_AGENTS_CHAT_GATEWAY_URL, wp-config.php, or nfd_agents_chat_gateway_url filter)
	 *
	 * @return string Gateway URL, or empty string if not configured
	 */
	protected function get_gateway_url() {
		if ( defined( 'NFD_AGENTS_CHAT_GATEWAY_URL' ) && NFD_AGENTS_CHAT_GATEWAY_URL !== '' ) {
			return NFD_AGENTS_CHAT_GATEWAY_URL;
		}
		$url = apply_filters( 'nfd_agents_chat_gateway_url', '' );
		return is_string( $url ) ? $url : '';
	}

	/**
	 * Get brand ID
	 *
	 * @return string Brand identifier
	 */
	protected function get_brand_id() {
		// Get brand from container if available
		if ( $this->container ) {
			try {
				$brand = $this->container->get( 'brand' );
				if ( ! empty( $brand ) ) {
					return $brand;
				}
			} catch ( \Exception $e ) {
				// Container doesn't have brand, fall through to fallback
			}
		}

		// Fallback to WordPress option
		$brand = get_option( 'mm_brand', 'bluehost' );
		// Apply filter to allow override (consistent with bootstrap.php pattern)
		$brand = apply_filters( 'newfold/container/plugin/brand', $brand );
		return $brand;
	}
}
