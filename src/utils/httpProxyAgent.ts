/**
 * Get HTTP proxy agent for requests
 * Note: n8n community nodes should not directly access process.env
 * Proxy configuration should be handled at the n8n instance level
 * This function is kept for compatibility but returns undefined
 * @deprecated Use n8n's global proxy settings instead
 */
export function getHttpProxyAgent(): undefined {
	// n8n community nodes should not directly access process.env
	// Proxy configuration is handled at the n8n instance level
	// Users should configure proxy through n8n's global settings
	return undefined;
}
