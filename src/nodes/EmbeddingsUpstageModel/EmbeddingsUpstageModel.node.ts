import type {
	ISupplyDataFunctions,
	INodeType,
	INodeTypeDescription,
	SupplyData,
} from 'n8n-workflow';

import { logWrapper } from '../../utils/logWrapper';
import { getConnectionHintNoticeField } from '../../utils/sharedFields';

export class EmbeddingsUpstageModel implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Upstage Embeddings Model',
		name: 'embeddingsUpstageModel',
		icon: 'file:upstage_v2.svg',
		group: ['transform'],
		version: 1,
		description:
			'Embedding Model for Vector DB - Upstage Solar Embeddings. Supports up to 100 strings per request with max 204,800 total tokens. Each text should be under 4000 tokens (optimal: under 512 tokens).',
		defaults: {
			name: 'Upstage Embeddings Model',
		},
		codex: {
			categories: ['AI'],
			subcategories: {
				AI: ['Embeddings'],
			},
			resources: {
				primaryDocumentation: [
					{
						url: 'https://js.langchain.com/docs/modules/data_connection/text_embedding/',
					},
				],
			},
		},
		inputs: [],
		outputs: ['ai_embedding'],
		outputNames: ['Embeddings'],
		credentials: [
			{
				name: 'upstageApi',
				required: true,
			},
		],
		properties: [
			getConnectionHintNoticeField(['ai_vectorStore']),
			{
				displayName: 'Model',
				name: 'model',
				type: 'options',
				description: 'The Upstage embedding model to use',
				default: 'embedding-query',
				options: [
					{
						name: 'Embedding Query',
						value: 'embedding-query',
						description: 'Optimized for search queries and questions',
					},
					{
						name: 'Embedding Passage',
						value: 'embedding-passage',
						description: 'Optimized for documents and passages',
					},
				],
			},
		],
	};

	async supplyData(
		this: ISupplyDataFunctions,
		itemIndex: number
	): Promise<SupplyData> {
		this.logger.debug('Supply data for embeddings');
		const credentials = await this.getCredentials('upstageApi');
		const model = this.getNodeParameter('model', itemIndex) as string;

		// Create a custom embedding model that implements LangChain's interface
		const embeddingModel = new UpstageEmbeddings({
			apiKey: credentials.apiKey as string,
			model,
		});

		return {
			response: logWrapper(embeddingModel, this),
		};
	}
}

// Custom LangChain Embeddings implementation for Upstage Solar
import { Embeddings, EmbeddingsParams } from '@langchain/core/embeddings';

interface UpstageEmbeddingsParams extends EmbeddingsParams {
	apiKey: string;
	model: string;
	baseURL?: string;
	batchSize?: number;
	stripNewLines?: boolean;
}

class UpstageEmbeddings extends Embeddings {
	public apiKey: string;
	public model: string;
	public baseURL: string;
	public batchSize: number;
	public stripNewLines: boolean;

	constructor(fields: UpstageEmbeddingsParams) {
		const { apiKey, model, baseURL, batchSize, stripNewLines, ...rest } =
			fields;
		super(rest);

		this.apiKey = apiKey;
		this.model = model;
		this.baseURL = baseURL ?? 'https://api.upstage.ai/v1';
		this.batchSize = batchSize ?? 100; // Upstage API limit
		this.stripNewLines = stripNewLines ?? true; // LangChain default
	}

	/**
	 * Embed documents (batch processing)
	 */
	async embedDocuments(texts: string[]): Promise<number[][]> {
		// Preprocess texts (strip newlines if enabled)
		const processedTexts = this.stripNewLines
			? texts.map(text => text.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim())
			: texts;

		// Process in batches to respect API limits
		const results: number[][] = [];
		for (let i = 0; i < processedTexts.length; i += this.batchSize) {
			const batch = processedTexts.slice(i, i + this.batchSize);
			const batchResults = await this.callUpstageAPI(batch);
			results.push(...batchResults);
		}

		return results;
	}

	/**
	 * Embed a single query
	 */
	async embedQuery(text: string): Promise<number[]> {
		// Preprocess text
		const processedText = this.stripNewLines
			? text.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim()
			: text;

		const result = await this.callUpstageAPI([processedText]);
		return result[0];
	}

	private async callUpstageAPI(input: string[]): Promise<number[][]> {
		try {
			// Validate and clean input
			const cleanInput = input
				.filter(
					text => text && typeof text === 'string' && text.trim().length > 0
				)
				.map(text => text.trim());

			if (cleanInput.length === 0) {
				throw new Error('No valid input texts provided for embedding');
			}

			// Check individual text length (Upstage limit: 4000 tokens per text)
			for (const text of cleanInput) {
				if (text.length > 16000) {
					// Rough estimate: ~4 chars per token
					// Text length might exceed token limit
				}
			}

			// Check batch size (Upstage limit: 100 strings)
			if (cleanInput.length > 100) {
				throw new Error(
					`Too many texts: ${cleanInput.length}. Upstage API supports max 100 strings per request`
				);
			}

			// Use single string for single input, array for multiple
			const requestBody = {
				model: this.model,
				input: cleanInput.length === 1 ? cleanInput[0] : cleanInput,
			};

			const response = await fetch(`${this.baseURL}/embeddings`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${this.apiKey}`,
				},
				body: JSON.stringify(requestBody),
			});

			if (!response.ok) {
				const errorBody = await response.text();
				throw new Error(`Upstage API error: ${response.status} - ${errorBody}`);
			}

			const data: any = await response.json();

			if (!data.data || !Array.isArray(data.data)) {
				throw new Error('Invalid response format from Upstage API');
			}

			// Sort by index to ensure correct order
			const sortedData = data.data.sort((a: any, b: any) => a.index - b.index);

			// Ensure we return the same number of embeddings as input texts
			if (sortedData.length !== cleanInput.length) {
				throw new Error(
					`Expected ${cleanInput.length} embeddings, got ${sortedData.length}`
				);
			}

			return sortedData.map((item: any) => item.embedding);
		} catch (error) {
			throw new Error(
				`Failed to generate embeddings: ${error instanceof Error ? error.message : String(error)}`
			);
		}
	}
}
