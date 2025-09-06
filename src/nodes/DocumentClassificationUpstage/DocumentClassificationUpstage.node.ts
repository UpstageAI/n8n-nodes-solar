import type {
	IExecuteFunctions,
	INodeType,
	INodeTypeDescription,
	INodeExecutionData,
	IHttpRequestOptions,
} from 'n8n-workflow';
import { NodeConnectionType } from 'n8n-workflow';

export class DocumentClassificationUpstage implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Upstage Document Classification',
		name: 'documentClassificationUpstage',
		icon: 'file:upstage_v2.svg',
		group: ['transform', '@n8n/n8n-nodes-langchain'],
		version: 1,
		description: 'Classify documents into predefined categories using Upstage Document Classification',
		defaults: { name: 'Upstage Document Classification' },
		inputs: [NodeConnectionType.Main],
		outputs: [NodeConnectionType.Main],
		credentials: [{ name: 'upstageApi', required: true }],
		properties: [
			{
				displayName: 'Input Type',
				name: 'inputType',
				type: 'options',
				options: [
					{ name: 'Binary (from previous node)', value: 'binary' },
					{ name: 'Image URL', value: 'url' },
				],
				default: 'binary',
				description: 'How to provide the document for classification',
			},
			{
				displayName: 'Binary Property',
				name: 'binaryPropertyName',
				type: 'string',
				default: 'data',
				placeholder: 'e.g. data, document, file',
				description: 'Name of the input item binary property that contains the file',
				displayOptions: { show: { inputType: ['binary'] } },
			},
			{
				displayName: 'Image URL',
				name: 'imageUrl',
				type: 'string',
				default: '',
				placeholder: 'https://example.com/document.jpg',
				description: 'URL of the image to classify',
				displayOptions: { show: { inputType: ['url'] } },
			},
			{
				displayName: 'Model',
				name: 'model',
				type: 'hidden',
				default: 'document-classify',
			},
			{
				displayName: 'Schema Name',
				name: 'schemaName',
				type: 'hidden',
				default: 'document-classify',
			},
			{
				displayName: 'Schema Input Type',
				name: 'schemaInputType',
				type: 'options',
				options: [
					{ name: 'Form Input', value: 'form' },
					{ name: 'Raw JSON', value: 'json' },
				],
				default: 'form',
				description: 'How to define the classification categories',
			},
			{
				displayName: 'Classification Categories',
				name: 'categories',
				type: 'fixedCollection',
				typeOptions: {
					multipleValues: true,
				},
				default: {},
				description: 'Define the categories for document classification',
				displayOptions: { show: { schemaInputType: ['form'] } },
				options: [
					{
						displayName: 'Add',
						name: 'values',
						values: [
							{
								displayName: 'Label',
								name: 'label',
								type: 'string',
								default: '',
								placeholder: 'e.g. invoice, receipt, contract',
								description: 'The exact label string the model must return',
							},
							{
								displayName: 'Description',
								name: 'description',
								type: 'string',
								typeOptions: {
									rows: 2,
								},
								default: '',
								placeholder: 'Brief description of this document type',
								description: 'Natural language description to clarify the label',
							},
						],
					},
				],
			},
			{
				displayName: 'Raw JSON Schema',
				name: 'rawJsonSchema',
				type: 'string',
				typeOptions: {
					rows: 10,
				},
				default: '',
				placeholder: '[\n  {\n    "const": "invoice",\n    "description": "A document requesting payment for goods or services"\n  },\n  {\n    "const": "receipt",\n    "description": "A document confirming payment has been made"\n  }\n]',
				description: 'Raw JSON array defining the oneOf schema for classification',
				displayOptions: { show: { schemaInputType: ['json'] } },
			},
			{
				displayName: 'Return',
				name: 'returnMode',
				type: 'options',
				options: [
					{ name: 'Classification Result Only', value: 'classification' },
					{ name: 'Full Response', value: 'full' },
				],
				default: 'classification',
				description: 'What to return from the node',
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
			try {
				const inputType = this.getNodeParameter('inputType', i) as string;
				const model = this.getNodeParameter('model', i) as string;
				const schemaName = this.getNodeParameter('schemaName', i) as string;
				const schemaInputType = this.getNodeParameter('schemaInputType', i) as string;
				const categories = this.getNodeParameter('categories', i) as { values: Array<{ label: string; description: string }> };
				const rawJsonSchema = this.getNodeParameter('rawJsonSchema', i) as string;
				const returnMode = this.getNodeParameter('returnMode', i) as string;

				// Prepare content array based on input type
				let content: any[] = [];

				if (inputType === 'binary') {
					const binaryPropertyName = this.getNodeParameter('binaryPropertyName', i) as string;
					const item = items[i];
					
					if (!item.binary || !item.binary[binaryPropertyName]) {
						throw new Error(`No binary data found in property "${binaryPropertyName}".`);
					}

					const binaryData = item.binary[binaryPropertyName];
					const buffer = await this.helpers.getBinaryDataBuffer(i, binaryPropertyName);
					const base64Data = buffer.toString('base64');
					
					content = [
						{
							type: 'image_url',
							image_url: {
								url: `data:${binaryData.mimeType || 'application/octet-stream'};base64,${base64Data}`,
							},
						},
					];
				} else {
					const imageUrl = this.getNodeParameter('imageUrl', i) as string;
					if (!imageUrl) {
						throw new Error('Image URL is required when input type is URL.');
					}
					
					content = [
						{
							type: 'image_url',
							image_url: {
								url: imageUrl,
							},
						},
					];
				}

				// Build the JSON schema from categories or raw JSON
				let oneOf: any[];
				
				if (schemaInputType === 'form') {
					// Use form input categories
					oneOf = categories.values.map(cat => ({
						const: cat.label,
						description: cat.description,
					}));
				} else {
					// Use raw JSON input
					if (!rawJsonSchema) {
						throw new Error('Raw JSON schema is required when input type is JSON.');
					}
					
					try {
						oneOf = JSON.parse(rawJsonSchema);
						if (!Array.isArray(oneOf)) {
							throw new Error('Raw JSON schema must be an array.');
						}
					} catch (parseError) {
						throw new Error(`Invalid JSON format: ${(parseError as Error).message}`);
					}
				}

				// Prepare request body
				const requestBody = {
					model,
					messages: [
						{
							role: 'user',
							content,
						},
					],
					response_format: {
						type: 'json_schema',
						json_schema: {
							name: schemaName,
							schema: {
								type: 'string',
								oneOf,
							},
						},
					},
				};

				const requestOptions: IHttpRequestOptions = {
					method: 'POST',
					url: 'https://api.upstage.ai/v1/document-classification',
					body: requestBody,
					headers: {
						'Content-Type': 'application/json',
					},
				};

				const response = await this.helpers.httpRequestWithAuthentication.call(
					this,
					'upstageApi',
					requestOptions,
				);

				// Process response based on return mode
				if (returnMode === 'classification') {
					const classification = response?.choices?.[0]?.message?.content || '';
					returnData.push({
						json: {
							classification,
							confidence: response?.choices?.[0]?.finish_reason === 'stop' ? 'high' : 'low',
						},
						pairedItem: { item: i },
					});
				} else {
					returnData.push({
						json: response,
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
