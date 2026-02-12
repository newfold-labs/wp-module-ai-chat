<?php

namespace NewfoldLabs\WP\Module\AIChat\RestApi;

/**
 * REST API registration class.
 */
class RestApi {

	/**
	 * Constructor.
	 */
	public function __construct() {
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
		);

		foreach ( $controllers as $controller ) {
			$controller->register_routes();
		}
	}
}
