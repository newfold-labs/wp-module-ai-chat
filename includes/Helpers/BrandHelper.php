<?php

namespace NewfoldLabs\WP\Module\AIChat\Helpers;

use NewfoldLabs\WP\ModuleLoader\Container;

/**
 * Helper for resolving the current brand identifier.
 */
class BrandHelper {

	/**
	 * Dependency injection container (optional).
	 *
	 * @var Container|null
	 */
	protected $container;

	/**
	 * Constructor.
	 *
	 * @param Container|null $container Optional. Container for brand lookup.
	 */
	public function __construct( Container $container ) {
		$this->container = $container;
	}

	/**
	 * Get the current brand ID (from container or option).
	 *
	 * @return string Brand identifier.
	 */
	public function get_brand_id() {
		if ( $this->container ) {
			try {
				$brand = $this->container->get( 'brand' );
				if ( is_string( $brand ) && '' !== $brand ) {
					return $brand;
				}
			} catch ( \Exception $e ) {
				// Container missing or brand not set; fall through.
			}
		}

		return get_option( 'mm_brand', 'bluehost' );
	}
}
