/**
 * Default failed attempt handler for n8n LLM requests
 * Provides basic retry logic and error handling
 */
export const n8nDefaultFailedAttemptHandler = (error: any) => {
	// Basic retry logic - if the error indicates we should retry, don't throw
	if (error?.code === 'ECONNRESET' || error?.code === 'ETIMEDOUT') {
		// Network errors that might be temporary
		return;
	}

	if (error?.status >= 500 && error?.status < 600) {
		// Server errors that might be temporary
		return;
	}

	if (error?.status === 429) {
		// Rate limiting - should retry
		return;
	}

	// For all other errors, throw to stop retrying
	throw error;
};
