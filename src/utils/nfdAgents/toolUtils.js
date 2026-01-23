/**
 * NFD Agents Tool Utilities
 * 
 * Utilities for detecting tool types and patterns related to NFD Agents functionality.
 * These utilities help determine if tools are read-only/non-destructive.
 */

/**
 * Determine if a tool is non-destructive (read-only operation)
 * 
 * @param {string} toolName Tool name to check
 * @returns {boolean} True if tool is non-destructive, false otherwise
 */
export const isNonDestructiveTool = (toolName) => {
	if (!toolName) return false;
	
	// Pattern-based detection for read-only operations
	const readOnlyPatterns = [
		/-search$/i,                      // e.g., posts-search, users-search
		/^nfd-agents\/get-/i,             // e.g., get-post, get-page (NFD Agents tool prefix)
		/^nfd-agents\/list-/i,             // e.g., list-categories, list-tags (NFD Agents tool prefix)
		/^newfold-agents\/get-/i,         // Legacy: e.g., get-post, get-page (backward compatibility)
		/^newfold-agents\/list-/i,         // Legacy: e.g., list-categories, list-tags (backward compatibility)
		/^blu\/get-/i,                    // Legacy: e.g., get-post, get-page (backward compatibility)
		/^blu\/list-/i,                   // Legacy: e.g., list-categories, list-tags (backward compatibility)
	];
	
	return readOnlyPatterns.some(pattern => pattern.test(toolName));
};
