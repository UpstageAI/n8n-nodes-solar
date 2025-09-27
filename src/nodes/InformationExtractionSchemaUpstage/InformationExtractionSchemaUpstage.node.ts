import type {
	IExecuteFunctions,
	INodeType,
	INodeTypeDescription,
	INodeExecutionData,
	IHttpRequestOptions,
} from 'n8n-workflow';

export class InformationExtractionSchemaUpstage implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Upstage Schema Generation',
		name: 'informationExtractionSchemaUpstage',
		icon: 'file:upstage_v2.svg',
		group: ['transform'],
		version: 1,
		description:
			'Generate a JSON schema from a document/image using Upstage Information Extraction (schema-generation)',
		defaults: { name: 'Upstage IE — Schema Generation' },
		inputs: ['main'],
		outputs: ['main'],
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
			},
			{
				displayName: 'Binary Property',
				name: 'binaryPropertyName',
				type: 'string',
				default: 'data', // Change to 'document' if needed
				placeholder: 'e.g. document, data, file',
				description: 'Name of the binary property that contains the file',
				displayOptions: { show: { inputType: ['binary'] } },
			},
			{
				displayName: 'Image URL',
				name: 'imageUrl',
				type: 'string',
				default: '',
				placeholder: 'e.g. https://example.com/sample.png',
				displayOptions: { show: { inputType: ['url'] } },
			},
			{
				displayName: 'Model',
				name: 'model',
				type: 'options',
				options: [
					{
						name: 'information-extract (recommended)',
						value: 'information-extract',
					},
				],
				default: 'information-extract',
			},
			{
				displayName: 'Guidance (optional)',
				name: 'prompt',
				type: 'string',
				typeOptions: { rows: 3 },
				default: '',
				placeholder: 'e.g., Generate a schema suitable for bank statements.',
				description: 'Optional text instruction to influence schema generation',
			},
			{
				displayName: 'Return',
				name: 'returnMode',
				type: 'options',
				options: [
					{ name: 'Schema JSON Only', value: 'schema' },
					{ name: 'Full Response', value: 'full' },
				],
				default: 'schema',
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
				const prompt = (
					this.getNodeParameter('prompt', i, '') as string
				)?.trim();
				const returnMode = this.getNodeParameter('returnMode', i) as string;

				// 1) Prepare image/document source (data URL or http URL)
				let dataUrlOrHttp: string;
				if (inputType === 'binary') {
					const binaryPropertyName = this.getNodeParameter(
						'binaryPropertyName',
						i
					) as string;
					const item = items[i];
					if (!item.binary || !item.binary[binaryPropertyName]) {
						throw new Error(
							`No binary data found in property "${binaryPropertyName}".`
						);
					}
					const binaryData = item.binary[binaryPropertyName];
					const buffer = await this.helpers.getBinaryDataBuffer(
						i,
						binaryPropertyName
					);
					const mime = binaryData.mimeType || 'application/octet-stream';
					const base64 = buffer.toString('base64');
					dataUrlOrHttp = `data:${mime};base64,${base64}`;
				} else {
					dataUrlOrHttp = this.getNodeParameter('imageUrl', i) as string;
					if (!dataUrlOrHttp) throw new Error('Image URL is required.');
				}

				// 2) Compose messages
				const messages: any[] = [];
				if (prompt) {
					messages.push({ role: 'user', content: prompt });
				}
				messages.push({
					role: 'user',
					content: [
						{
							type: 'image_url',
							image_url: { url: dataUrlOrHttp },
						},
					],
				});

				// 3) Request body
				const requestBody: any = {
					model,
					messages,
				};

				const requestOptions: IHttpRequestOptions = {
					method: 'POST',
					url: 'https://api.upstage.ai/v1/information-extraction/schema-generation',
					body: requestBody,
					json: true,
				};

				// 4) Call
				const response = await this.helpers.httpRequestWithAuthentication.call(
					this,
					'upstageApi',
					requestOptions
				);

				// 5) Response parsing + 🔴 binary passthrough
				if (returnMode === 'full') {
					const out: INodeExecutionData = {
						json: response,
						pairedItem: { item: i },
					};
					if (items[i].binary) out.binary = items[i].binary; // ⬅ passthrough
					returnData.push(out);
				} else {
					const contentStr = response?.choices?.[0]?.message?.content ?? '';
					let schemaObj: any;
					try {
						schemaObj = contentStr ? JSON.parse(contentStr) : {};
					} catch {
						schemaObj = { _raw: contentStr };
					}

					const out: INodeExecutionData = {
						json: {
							schema_type: schemaObj?.type ?? null,
							json_schema: schemaObj?.json_schema ?? null,
							raw: schemaObj,
							model: response?.model,
							usage: response?.usage,
						},
						pairedItem: { item: i },
					};
					if (items[i].binary) out.binary = items[i].binary; // ⬅ passthrough
					returnData.push(out);
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
