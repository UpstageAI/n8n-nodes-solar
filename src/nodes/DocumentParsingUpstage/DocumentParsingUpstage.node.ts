import type {
	IExecuteFunctions,
	INodeType,
	INodeTypeDescription,
	INodeExecutionData,
	IHttpRequestOptions,
} from 'n8n-workflow';
import { NodeConnectionType } from 'n8n-workflow';
import FormData from 'form-data';

export class DocumentParsingUpstage implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Upstage Document Parsing',
		name: 'documentParsingUpstage',
		icon: 'file:upstage_v2.svg',
		group: ['transform', '@n8n/n8n-nodes-langchain'],
		version: 1,
		description: 'Convert documents into structured HTML/Markdown using Upstage Document Parse',
		defaults: { name: 'Upstage Document Parsing' },
		inputs: [NodeConnectionType.Main],
		outputs: [NodeConnectionType.Main],
		credentials: [{ name: 'upstageApi', required: true }],
		properties: [
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				options: [
					{ name: 'Sync Parse (Upload File)', value: 'sync' },
					{ name: 'Async Submit (Upload File)', value: 'asyncSubmit' },
					{ name: 'Async Get Result (By Request ID)', value: 'asyncGet' },
					{ name: 'Async List Requests', value: 'asyncList' },
				],
				default: 'sync',
			},
			{
				displayName: 'Binary Property',
				name: 'binaryPropertyName',
				type: 'string',
				default: 'data',
				placeholder: 'e.g. data, document, file',
				description: 'Name of the input item binary property that contains the file',
				displayOptions: { show: { operation: ['sync', 'asyncSubmit'] } },
			},
			{
				displayName: 'Model',
				name: 'model',
				type: 'options',
				options: [
					{ name: 'document-parse (recommended)', value: 'document-parse' },
					{ name: 'document-parse-nightly', value: 'document-parse-nightly' },
				],
				default: 'document-parse',
				displayOptions: { show: { operation: ['sync', 'asyncSubmit'] } },
			},
			{
				displayName: 'OCR',
				name: 'ocr',
				type: 'options',
				options: [
					{ name: 'Auto', value: 'auto' },
					{ name: 'Force', value: 'force' },
					{ name: 'Off', value: 'off' },
				],
				default: 'auto',
				displayOptions: { show: { operation: ['sync', 'asyncSubmit'] } },
			},
			{
				displayName: 'Base64 Encoding Categories',
				name: 'base64Categories',
				type: 'multiOptions',
				options: [
					{ name: 'figure', value: 'figure' },
					{ name: 'table', value: 'table' },
					{ name: 'equation', value: 'equation' },
					{ name: 'chart', value: 'chart' },
				],
				default: [],
				description: 'Return cropped base64 images for selected categories',
				displayOptions: { show: { operation: ['sync', 'asyncSubmit'] } },
			},
			{
				displayName: 'Merge Multipage Tables',
				name: 'merge_multipage_tables',
				type: 'boolean',
				default: false,
				displayOptions: { show: { operation: ['sync', 'asyncSubmit'] } },
			},
			{
				displayName: 'Return',
				name: 'returnMode',
				type: 'options',
				options: [
					{ name: 'Full Response', value: 'full' },
					{ name: 'Content → HTML', value: 'content_html' },
					{ name: 'Content → Markdown', value: 'content_markdown' },
					{ name: 'Content → Text', value: 'content_text' },
					{ name: 'Elements Array', value: 'elements' },
				],
				default: 'full',
				displayOptions: { show: { operation: ['sync'] } },
			},
			{
				displayName: 'Request ID',
				name: 'requestId',
				type: 'string',
				default: '',
				placeholder: 'e.g. e7b1b3b0-....',
				displayOptions: { show: { operation: ['asyncGet'] } },
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
			try {
				const operation = this.getNodeParameter('operation', i) as string;

				if (operation === 'sync' || operation === 'asyncSubmit') {
					const binaryPropertyName = this.getNodeParameter('binaryPropertyName', i) as string;
					const model = this.getNodeParameter('model', i) as string;
					const ocr = this.getNodeParameter('ocr', i) as string;
					const base64Categories = this.getNodeParameter('base64Categories', i, []) as string[];
					const mergeMultipage = this.getNodeParameter('merge_multipage_tables', i, false) as boolean;

					const item = items[i];
					if (!item.binary || !item.binary[binaryPropertyName]) {
						throw new Error(`No binary data found in property "${binaryPropertyName}".`);
					}

					const binaryData = item.binary[binaryPropertyName];
					const buffer = await this.helpers.getBinaryDataBuffer(i, binaryPropertyName);

					// --- FormData stream configuration ---
					const form = new FormData();
					form.append('document', buffer, {
						filename: binaryData.fileName || 'upload',
						contentType: binaryData.mimeType || 'application/octet-stream',
					});
					form.append('model', model);
					form.append('ocr', ocr);
					if (base64Categories.length > 0) {
						form.append('base64_encoding', JSON.stringify(base64Categories));
					}
					if (mergeMultipage) {
						form.append('merge_multipage_tables', 'true');
					}

					const url =
						operation === 'sync'
							? 'https://api.upstage.ai/v1/document-digitization'
							: 'https://api.upstage.ai/v1/document-digitization/async';

					const requestOptions: IHttpRequestOptions = {
						method: 'POST',
						url,
						body: form as unknown as any,      // stream
						headers: form.getHeaders(),        // include boundary
						json: false,                       // not JSON
					};

					const response = await this.helpers.httpRequestWithAuthentication.call(
						this,
						'upstageApi',
						requestOptions,
					);

					if (operation === 'sync') {
						const returnMode = this.getNodeParameter('returnMode', i) as string;
						if (returnMode === 'content_html') {
							returnData.push({ json: { html: response?.content?.html ?? '' }, pairedItem: { item: i } });
						} else if (returnMode === 'content_markdown') {
							returnData.push({ json: { markdown: response?.content?.markdown ?? '' }, pairedItem: { item: i } });
						} else if (returnMode === 'content_text') {
							returnData.push({ json: { text: response?.content?.text ?? '' }, pairedItem: { item: i } });
						} else if (returnMode === 'elements') {
							returnData.push({ json: { elements: response?.elements ?? [] }, pairedItem: { item: i } });
						} else {
							returnData.push({ json: response, pairedItem: { item: i } });
						}
					} else {
						returnData.push({
							json: { request_id: response?.request_id, submitted: true },
							pairedItem: { item: i },
						});
					}
				} else if (operation === 'asyncGet') {
					const requestId = this.getNodeParameter('requestId', i) as string;
					if (!requestId) throw new Error('Request ID is required.');
					const requestOptions: IHttpRequestOptions = {
						method: 'GET',
						url: `https://api.upstage.ai/v1/document-digitization/requests/${encodeURIComponent(requestId)}`,
					};
					const response = await this.helpers.httpRequestWithAuthentication.call(
						this,
						'upstageApi',
						requestOptions,
					);
					returnData.push({ json: response, pairedItem: { item: i } });
				} else if (operation === 'asyncList') {
					const requestOptions: IHttpRequestOptions = {
						method: 'GET',
						url: 'https://api.upstage.ai/v1/document-digitization/requests',
					};
					const response = await this.helpers.httpRequestWithAuthentication.call(
						this,
						'upstageApi',
						requestOptions,
					);
					returnData.push({ json: response, pairedItem: { item: i } });
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
