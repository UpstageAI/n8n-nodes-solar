import { Embeddings } from '@langchain/core/embeddings';
import {
	IExecuteFunctions,
	ISupplyDataFunctions,
	NodeConnectionType,
	NodeOperationError,
} from 'n8n-workflow';

import { logAiEvent } from './helpers';

export async function callMethodAsync<T>(
	this: T,
	parameters: {
		executeFunctions: IExecuteFunctions | ISupplyDataFunctions;
		connectionType: NodeConnectionType;
		currentNodeRunIndex: number;
		method: (...args: any[]) => Promise<unknown>;
		arguments: unknown[];
	}
): Promise<unknown> {
	try {
		return await parameters.method.call(this, ...parameters.arguments);
	} catch (e) {
		const connectedNode = parameters.executeFunctions.getNode();

		const error = new NodeOperationError(connectedNode, e as Error, {
			functionality: 'configuration-node',
		});

		throw error;
	}
}

export function logWrapper<T extends Embeddings>(
	originalInstance: T,
	executeFunctions: IExecuteFunctions | ISupplyDataFunctions
): T {
	return new Proxy(originalInstance, {
		get: (target, prop) => {
			// ========== Embeddings ==========
			if (originalInstance instanceof Embeddings) {
				// Docs -> Embeddings
				if (prop === 'embedDocuments' && 'embedDocuments' in target) {
					return async (documents: string[]): Promise<number[][]> => {
						const connectionType = 'ai_embedding';
						const { index } = executeFunctions.addInputData(connectionType, [
							[{ json: { documents } }],
						]);

						const response = (await callMethodAsync.call(target, {
							executeFunctions,
							connectionType,
							currentNodeRunIndex: index,
							method: target[prop] as (...args: any[]) => Promise<number[][]>,
							arguments: [documents],
						})) as number[][];

						logAiEvent(executeFunctions, 'ai-document-embedded');
						executeFunctions.addOutputData(connectionType, index, [
							[{ json: { response } }],
						]);
						return response;
					};
				}
				// Query -> Embeddings
				if (prop === 'embedQuery' && 'embedQuery' in target) {
					return async (query: string): Promise<number[]> => {
						const connectionType = 'ai_embedding';
						const { index } = executeFunctions.addInputData(connectionType, [
							[{ json: { query } }],
						]);

						const response = (await callMethodAsync.call(target, {
							executeFunctions,
							connectionType,
							currentNodeRunIndex: index,
							method: target[prop] as (...args: any[]) => Promise<number[]>,
							arguments: [query],
						})) as number[];
						logAiEvent(executeFunctions, 'ai-query-embedded');
						executeFunctions.addOutputData(connectionType, index, [
							[{ json: { response } }],
						]);
						return response;
					};
				}
			}

			// eslint-disable-next-line @typescript-eslint/no-unsafe-return
			return (target as any)[prop];
		},
	});
}
