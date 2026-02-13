<?php

namespace NewfoldLabs\WP\Module\AIChat\Helpers;

/**
 * Simple hashing utilities for site identifiers.
 */
class SiteHashHelper {

	/**
	 * Produce a short hash of a string (e.g. for site_id from site URL).
	 *
	 * @param string $input  Input string to hash.
	 * @param int    $length Length of the returned substring. Default 8.
	 * @return string Hash substring of the given length.
	 */
	public static function short_hash( $input, $length = 8 ) {
		$hash = md5( (string) $input );
		return substr( $hash, 0, max( 0, (int) $length ) );
	}
}
