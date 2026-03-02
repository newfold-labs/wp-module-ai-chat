/**
 * JWT utilities for NFD Agents.
 *
 * Decodes JWT payload (no signature verification) for scheduling only.
 * Do not use for security decisions.
 */

/**
 * Base64url-decode a string (JWT segment).
 *
 * @param {string} str Base64url-encoded string
 * @return {string} Decoded string
 */
function base64UrlDecode(str) {
	let base64 = str.replace(/-/g, "+").replace(/_/g, "/");
	// Base64url often omits padding; atob requires length % 4 === 0.
	const pad = base64.length % 4;
	if (pad) {
		base64 += "===".slice(0, 4 - pad);
	}
	try {
		return decodeURIComponent(
			atob(base64)
				.split("")
				.map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
				.join("")
		);
	} catch (e) {
		return atob(base64);
	}
}

/**
 * Get JWT expiration timestamp in milliseconds (Unix ms).
 * Decodes payload without verification; for scheduling only.
 *
 * @param {string} jwt JWT string (header.payload.signature)
 * @return {number|null} exp * 1000, or null if missing/invalid
 */
export function getJwtExpirationMs(jwt) {
	if (!jwt || typeof jwt !== "string") {
		return null;
	}
	const parts = jwt.split(".");
	if (parts.length !== 3) {
		return null;
	}
	try {
		const payloadJson = base64UrlDecode(parts[1]);
		const payload = JSON.parse(payloadJson);
		const exp = payload?.exp;
		if (typeof exp !== "number" || !Number.isFinite(exp)) {
			return null;
		}
		return exp * 1000;
	} catch (e) {
		return null;
	}
}
