<?php

namespace NewfoldLabs\WP\Module\AIChat\RestApi;

use NewfoldLabs\WP\ModuleLoader\Container;

/**
 * REST API registration class.
 */
class RestApi {

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
		\add_action( 'rest_api_init', array( $this, 'register_routes' ) );
	}

	/**
	 * Register REST API routes.
	 *
	 * @return void
	 */
	public function register_routes() {
		$controllers = array(
			new AIChatController(),
			new NfdAgentsChatConfigController( $this->container ),
		);

		foreach ( $controllers as $controller ) {
			$controller->register_routes();
		}
	}
}
