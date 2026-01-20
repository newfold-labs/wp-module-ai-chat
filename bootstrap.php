<?php

namespace NewfoldLabs\WP\Module\AIChat;

use NewfoldLabs\WP\ModuleLoader\Container;
use NewfoldLabs\WP\Module\AIChat\Application;

if ( \function_exists( 'add_action' ) ) {
	\add_action(
		'newfold_container_set',
		function ( Container $container ) {

			// Set Global Constants
			if ( ! \defined( 'NFD_AI_CHAT_VERSION' ) ) {
				\define( 'NFD_AI_CHAT_VERSION', '1.0.0' );
			}
			if ( ! \defined( 'NFD_AI_CHAT_DIR' ) ) {
				\define( 'NFD_AI_CHAT_DIR', __DIR__ );
			}

			new Application( $container );
		}
	);
}