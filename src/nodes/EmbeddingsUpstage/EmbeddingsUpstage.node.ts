import type {
	IExecuteFunctions,
	INodeType,
	INodeTypeDescription,
	INodeExecutionData,
	IHttpRequestOptions,
} from 'n8n-workflow';
import { NodeConnectionType } from 'n8n-workflow';

export class EmbeddingsUpstage implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Upstage Embeddings',
		name: 'embeddingsUpstage',
		icon: 'file:upstage_v2.svg',
		group: ['transform'],
		version: 1,
			description: 'Generate embeddings using Upstage Solar embedding models. Supports up to 100 strings per request with max 204,800 total tokens. Each text should be under 4000 tokens (optimal: under 512 tokens).',
		defaults: {
			name: 'Upstage Embeddings',
		},
		inputs: [NodeConnectionType.Main],
		outputs: [NodeConnectionType.Main],
		credentials: [
			{
				name: 'upstageApi',
				required: true,
			},
		],
		properties: [
			{
				displayName: 'Model',
				name: 'model',
				type: 'options',
				options: [
					{
						name: 'embedding-query',
						value: 'embedding-query',
						description: 'Optimized for search queries and questions',
					},
					{
						name: 'embedding-passage',
						value: 'embedding-passage',
						description: 'Optimized for documents and passages',
					},
				],
				default: 'embedding-query',
				description: 'The Solar embedding model to use',
			},
			{
				displayName: 'Input Type',
				name: 'inputType',
				type: 'options',
				options: [
					{
						name: 'Single Text',
						value: 'single',
						description: 'Process a single text input',
					},
					{
						name: 'Array of Texts',
						value: 'array',
						description: 'Process multiple texts at once',
					},
				],
				default: 'single',
				description: 'How to handle the input data',
			},
			{
				displayName: 'Text',
				name: 'text',
				type: 'string',
				displayOptions: {
					show: {
						inputType: ['single'],
					},
				},
				default: '',
				placeholder: 'e.g. Hello world, How are you?',
				description: 'The text to generate embeddings for',
			},
			{
				displayName: 'Texts',
				name: 'texts',
				type: 'string',
				displayOptions: {
					show: {
						inputType: ['array'],
					},
				},
				typeOptions: {
					rows: 5,
				},
				default: '',
				placeholder: 'e.g. Hello world\nHow are you?\nGood morning',
				description: 'Multiple texts to generate embeddings for (one per line). Max 100 texts, total 204,800 tokens. Each text max 4000 tokens.',
			},
			{
				displayName: 'Text Field',
				name: 'textField',
				type: 'string',
				displayOptions: {
					show: {
						inputType: ['single'],
					},
				},
				default: '',
				placeholder: 'e.g. data, content, message',
				description: 'Field name from input data containing the text to embed (if empty, uses the "text" parameter above)',
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
			try {
				const model = this.getNodeParameter('model', i) as string;
				const inputType = this.getNodeParameter('inputType', i) as string;
				const textField = this.getNodeParameter('textField', i, '') as string;

				let input: string | string[];

				if (inputType === 'single') {
					if (textField && items[i].json[textField]) {
						// Get text from input data field
						input = items[i].json[textField] as string;
					} else {
						// Get text from parameter
						input = this.getNodeParameter('text', i) as string;
					}
				} else {
					// Array input
					const textsParam = this.getNodeParameter('texts', i) as string;
					input = textsParam.split('\n').filter(text => text.trim().length > 0);
				}

				if (!input || (Array.isArray(input) && input.length === 0)) {
					throw new Error('No input text provided');
				}

				// Build request body
				const requestBody = {
					model,
					input,
				};

				// Make API request
				const requestOptions: IHttpRequestOptions = {
					method: 'POST',
					url: 'https://api.upstage.ai/v1/embeddings',
					body: requestBody,
					json: true,
				};

				const response = await this.helpers.httpRequestWithAuthentication.call(
					this,
					'upstageApi',
					requestOptions,
				);

				// Process response
				if (Array.isArray(input)) {
					// Multiple embeddings
					const embeddings = response.data.map((item: any) => ({
						text: input[item.index],
						embedding: item.embedding,
						index: item.index,
					}));

					returnData.push({
						json: {
							embeddings,
							model: response.model,
							usage: response.usage,
							full_response: response,
						},
						pairedItem: { item: i },
					});
				} else {
					// Single embedding
					const embedding = response.data[0]?.embedding || [];

					returnData.push({
						json: {
							text: input,
							embedding,
							model: response.model,
							usage: response.usage,
							dimension: embedding.length,
							full_response: response,
						},
						pairedItem: { item: i },
					});
				}
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: { error: (error as Error).message || 'Unknown error' },
						pairedItem: { item: i },
					});
				} else {
					throw error;
				}
			}
		}

		return [returnData];
	}
}
