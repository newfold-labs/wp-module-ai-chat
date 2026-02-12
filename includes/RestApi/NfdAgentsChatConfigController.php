<?php

namespace NewfoldLabs\WP\Module\AIChat\RestApi;

use NewfoldLabs\WP\Module\Data\SiteCapabilities;
use NewfoldLabs\WP\Module\AIChat\Helpers\BrandHelper;
use NewfoldLabs\WP\Module\AIChat\Helpers\ConsumerCapabilitiesHelper;
use NewfoldLabs\WP\Module\AIChat\Helpers\HuapiHelper;
use NewfoldLabs\WP\Module\AIChat\Helpers\NfdAgentsGatewayHelper;
use NewfoldLabs\WP\Module\AIChat\Helpers\SiteHashHelper;
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
 * Use consumer for capability lookup.
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
	 * HUAPI JWT helper.
	 *
	 * @var HuapiHelper
	 */
	protected $huapi_helper;

	/**
	 * Brand resolution helper.
	 *
	 * @var BrandHelper
	 */
	protected $brand_helper;

	/**
	 * Consumer-to-capability mapping helper.
	 *
	 * @var ConsumerCapabilitiesHelper
	 */
	protected $capabilities_helper;

	/**
	 * Gateway URL helper.
	 *
	 * @var NfdAgentsGatewayHelper
	 */
	protected $gateway_helper;

	/**
	 * Constructor.
	 *
	 * @param Container $container Dependency injection container.
	 */
	public function __construct( Container $container ) {
		$this->container           = $container;
		$this->huapi_helper        = new HuapiHelper();
		$this->brand_helper        = new BrandHelper( $container );
		$this->capabilities_helper = new ConsumerCapabilitiesHelper();
		$this->gateway_helper      = new NfdAgentsGatewayHelper();
	}

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
						'consumer' => array(
							'description' => 'Consumer identifier for capability lookup. Required. Valid values are defined by the controller.',
							'type'        => 'string',
							'required'    => true,
							'enum'        => $this->capabilities_helper->get_valid_consumers(),
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
		$consumer   = $request->get_param( 'consumer' );
		$capability = $this->capabilities_helper->get_capability_for_consumer( $consumer );

		if ( ! $capability ) {
			return new WP_Error(
				'invalid_consumer',
				__( 'Invalid consumer specified', 'nfd-editor-chat' ),
				array( 'status' => 400 )
			);
		}

		$capabilities = new SiteCapabilities();
		return $capabilities->get( $capability, false );
	}

	/**
	 * Get configuration for AI chat frontend
	 *
	 * @param WP_REST_Request $request Full details about the request. Required by REST API callback signature; consumer is validated in permission_callback.
	 * @return WP_REST_Response|WP_Error
	 */
	public function get_config( WP_REST_Request $request ) {
		$gateway_url = $this->gateway_helper->get_gateway_url();
		if ( '' === $gateway_url ) {
			return new WP_Error(
				'gateway_url_not_configured',
				__( 'NFD AI Chat Jarvis gateway URL is not configured. Set NFD_AI_CHAT_JARVIS_GATEWAY_URL in wp-config.php.', 'nfd-editor-chat' ),
				array( 'status' => 500 )
			);
		}

		$huapi_token = $this->huapi_helper->get_token();
		if ( is_wp_error( $huapi_token ) ) {
			return $huapi_token;
		}

		$site_url = get_site_url();

		return new WP_REST_Response(
			array(
				'gateway_url' => $gateway_url,
				'huapi_token' => $huapi_token,
				'site_url'    => $site_url,
				'brand_id'    => $this->brand_helper->get_brand_id(),
				'agent_type'  => 'blu',
				'site_id'     => SiteHashHelper::short_hash( $site_url, 8 ),
			)
		);
	}
}
