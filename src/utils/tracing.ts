import type { ISupplyDataFunctions } from 'n8n-workflow';
import { N8nLlmTracing } from './N8nLlmTracing';
import { makeN8nLlmFailedAttemptHandler } from './n8nLlmFailedAttemptHandler';
import { getHttpProxyAgent as getHttpProxyAgentImpl } from './httpProxyAgent';
import { getConnectionHintNoticeField as getConnectionHintNoticeFieldImpl } from './sharedFields';

/**
 * Creates N8nLlmTracing using our implementation
 */
export function createN8nLlmTracing(
	context: ISupplyDataFunctions,
	options: { tokensUsageParser?: (llmOutput: any) => any } = {}
) {
	try {
		return new N8nLlmTracing(context, options);
	} catch (error) {
		console.warn('Failed to create N8nLlmTracing:', error);
		return null;
	}
}

/**
 * Creates failure attempt handler using our implementation
 */
export function createN8nLlmFailedAttemptHandler(
	context: ISupplyDataFunctions
) {
	try {
		return makeN8nLlmFailedAttemptHandler(context);
	} catch (error) {
		console.warn('Failed to create failure handler:', error);
		return undefined;
	}
}

/**
 * Gets HTTP proxy agent using our implementation
 */
export function getHttpProxyAgent() {
	try {
		return getHttpProxyAgentImpl();
	} catch (error) {
		console.warn('Failed to get HTTP proxy agent:', error);
		return undefined;
	}
}

/**
 * Gets connection hint notice field using our implementation
 */
export function getConnectionHintNoticeField(connectionTypes: any[]) {
	try {
		return getConnectionHintNoticeFieldImpl(connectionTypes);
	} catch (error) {
		console.warn('Failed to get connection hint notice field:', error);
		return null;
	}
}
