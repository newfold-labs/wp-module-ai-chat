<?php

namespace NewfoldLabs\WP\Module\AIChat;

use NewfoldLabs\WP\ModuleLoader\Container;

/**
 * Main Application class for the AI Chat module.
 */
class Application {

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
}
