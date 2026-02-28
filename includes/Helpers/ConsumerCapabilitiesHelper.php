<?php

namespace NewfoldLabs\WP\Module\AIChat\Helpers;

/**
 * Maps chat consumers to WordPress capability names for permission checks.
 */
class ConsumerCapabilitiesHelper {

	/**
	 * Map of consumer identifier to capability name.
	 *
	 * @var array<string, string>
	 */
	protected $consumer_capabilities;

	/**
	 * Constructor.
	 *
	 * @param array<string, string> $consumer_capabilities Optional. Override default map. Keys: consumer id, values: capability name.
	 */
	public function __construct( array $consumer_capabilities = array() ) {
		$this->consumer_capabilities = ! empty( $consumer_capabilities )
			? $consumer_capabilities
			: array(
				'help_center'            => 'canAccessAIHelpCenter',
				'editor_chat'            => 'canAccessAIEditorChat',
				'wordpress_editor_chat'  => 'canAccessAIEditorChat',
			);
	}

	/**
	 * Get the capability name required for a consumer.
	 *
	 * @param string $consumer Consumer identifier.
	 * @return string|null Capability name or null if consumer is not supported.
	 */
	public function get_capability_for_consumer( $consumer ) {
		return $this->consumer_capabilities[ $consumer ] ?? null;
	}

	/**
	 * Get the list of valid consumer identifiers (for REST enum, etc.).
	 *
	 * @return array<int, string>
	 */
	public function get_valid_consumers() {
		return array_keys( $this->consumer_capabilities );
	}
}
