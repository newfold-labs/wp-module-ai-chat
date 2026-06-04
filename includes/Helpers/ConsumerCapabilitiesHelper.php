<?php

namespace NewfoldLabs\WP\Module\AIChat\Helpers;

/**
 * Maps chat consumers to WordPress capability names for permission checks.
 */
class ConsumerCapabilitiesHelper {

	/**
	 * Authoritative consumer → capability map. Controls Jarvis JWT issuance — not filterable.
	 */
	private const CONSUMER_CAPABILITIES = array(
		'help_center' => 'canAccessAIHelpCenter',
		'editor_chat' => 'canAccessAIEditorChat',
		'blustore'    => 'canAccessAIBluStore',
	);

	/**
	 * Authoritative consumer → agent type map. Derived server-side; clients cannot override.
	 */
	private const CONSUMER_AGENT_TYPES = array(
		'help_center' => 'blu',
		'editor_chat' => 'blu',
		'blustore'    => 'blu_store',
	);

	/**
	 * Get the capability name required for a consumer.
	 *
	 * @param string $consumer Consumer identifier.
	 * @return string|null Capability name or null if consumer is not supported.
	 */
	public function get_capability_for_consumer( $consumer ) {
		return self::CONSUMER_CAPABILITIES[ $consumer ] ?? null;
	}

	/**
	 * Get the agent type for a consumer.
	 *
	 * @param string $consumer Consumer identifier.
	 * @return string|null Agent type or null if consumer is not supported.
	 */
	public function get_agent_type_for_consumer( $consumer ) {
		return self::CONSUMER_AGENT_TYPES[ $consumer ] ?? null;
	}

	/**
	 * Get the list of valid consumer identifiers (for REST enum, etc.).
	 *
	 * @return array<int, string>
	 */
	public function get_valid_consumers() {
		return array_keys( self::CONSUMER_CAPABILITIES );
	}
}
