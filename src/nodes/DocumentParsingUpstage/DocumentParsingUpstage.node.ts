import type {
	IExecuteFunctions,
	INodeType,
	INodeTypeDescription,
	INodeExecutionData,
	IHttpRequestOptions,
} from 'n8n-workflow';

// Response type definitions
interface DocumentParsingResponse {
	content?: {
		html?: string;
		markdown?: string;
		text?: string;
	};
	elements?: any[];
}

interface AsyncSubmitResponse {
	request_id?: string;
}

// Helper function to create multipart/form-data without external dependencies
function createMultipartFormData(
	fields: Record<string, string>,
	file: { buffer: Buffer; filename: string; contentType: string }
): { body: Buffer; contentType: string } {
	const boundary =
		'----WebKitFormBoundary' + Math.random().toString(36).substring(2);
	const parts: Buffer[] = [];

	// Add text fields
	for (const [name, value] of Object.entries(fields)) {
		parts.push(
			Buffer.from(
				`--${boundary}\r\n` +
					`Content-Disposition: form-data; name="${name}"\r\n\r\n` +
					`${value}\r\n`
			)
		);
	}

	// Add file
	parts.push(
		Buffer.from(
			`--${boundary}\r\n` +
				`Content-Disposition: form-data; name="document"; filename="${file.filename}"\r\n` +
				`Content-Type: ${file.contentType}\r\n\r\n`
		)
	);
	parts.push(file.buffer);
	parts.push(Buffer.from('\r\n'));

	// End boundary
	parts.push(Buffer.from(`--${boundary}--\r\n`));

	return {
		body: Buffer.concat(parts),
		contentType: `multipart/form-data; boundary=${boundary}`,
	};
}

export class DocumentParsingUpstage implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Upstage Document Parsing',
		name: 'documentParsingUpstage',
		icon: 'file:upstage_v2.svg',
		group: ['transform'],
		version: 1,
		description:
			'Convert documents into structured HTML/Markdown using Upstage Document Parse',
		defaults: { name: 'Upstage Document Parsing' },
		inputs: ['main'],
		outputs: ['main'],
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
				description:
					'Name of the input item binary property that contains the file',
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
				],
				default: 'auto',
				description:
					'Whether to perform OCR inference on the document before layout detection. Auto applies OCR only to image documents; Force always performs OCR.',
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
				displayName: 'Output Formats',
				name: 'outputFormats',
				type: 'multiOptions',
				options: [
					{ name: 'HTML', value: 'html' },
					{ name: 'Markdown', value: 'markdown' },
					{ name: 'Text', value: 'text' },
				],
				default: ['html'],
				description:
					'Specify which formats to include in the response. Each layout element will be formatted according to these formats.',
				displayOptions: { show: { operation: ['sync', 'asyncSubmit'] } },
			},
			{
				displayName: 'Include Coordinates',
				name: 'coordinates',
				type: 'boolean',
				default: true,
				description:
					'Whether to return coordinates of bounding boxes of each layout element',
				displayOptions: { show: { operation: ['sync', 'asyncSubmit'] } },
			},
			{
				displayName: 'Chart Recognition',
				name: 'chartRecognition',
				type: 'boolean',
				default: true,
				description:
					'Whether to use chart recognition. If true, charts are converted to tables.',
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
					const binaryPropertyName = this.getNodeParameter(
						'binaryPropertyName',
						i
					) as string;
					const model = this.getNodeParameter('model', i) as string;
					const ocr = this.getNodeParameter('ocr', i) as string;
					const base64Categories = this.getNodeParameter(
						'base64Categories',
						i,
						[]
					) as string[];
					const mergeMultipage = this.getNodeParameter(
						'merge_multipage_tables',
						i,
						false
					) as boolean;
					const outputFormats = this.getNodeParameter('outputFormats', i, [
						'html',
					]) as string[];
					const coordinates = this.getNodeParameter(
						'coordinates',
						i,
						true
					) as boolean;
					const chartRecognition = this.getNodeParameter(
						'chartRecognition',
						i,
						true
					) as boolean;

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

					// Prepare form fields
					const fields: Record<string, string> = {
						model,
						ocr,
						output_formats: JSON.stringify(outputFormats),
						coordinates: coordinates.toString(),
						chart_recognition: chartRecognition.toString(),
					};

					if (base64Categories.length > 0) {
						fields.base64_encoding = JSON.stringify(base64Categories);
					}
					if (mergeMultipage) {
						fields.merge_multipage_tables = 'true';
					}

					// Create multipart/form-data without external dependencies
					const { body, contentType } = createMultipartFormData(fields, {
						buffer,
						filename: binaryData.fileName || 'upload',
						contentType: binaryData.mimeType || 'application/octet-stream',
					});

					const url =
						operation === 'sync'
							? 'https://api.upstage.ai/v1/document-digitization'
							: 'https://api.upstage.ai/v1/document-digitization/async';

					const requestOptions: IHttpRequestOptions = {
						method: 'POST',
						url,
						body,
						headers: {
							'Content-Type': contentType,
						},
						// Response will be JSON (request body is already Buffer)
					};

					const response =
						await this.helpers.httpRequestWithAuthentication.call(
							this,
							'upstageApi',
							requestOptions
						);

					if (operation === 'sync') {
						const syncResponse = response as DocumentParsingResponse;
						const returnMode = this.getNodeParameter('returnMode', i) as string;
						if (returnMode === 'content_html') {
							returnData.push({
								json: { html: syncResponse?.content?.html ?? '' },
								pairedItem: { item: i },
							});
						} else if (returnMode === 'content_markdown') {
							returnData.push({
								json: { markdown: syncResponse?.content?.markdown ?? '' },
								pairedItem: { item: i },
							});
						} else if (returnMode === 'content_text') {
							returnData.push({
								json: { text: syncResponse?.content?.text ?? '' },
								pairedItem: { item: i },
							});
						} else if (returnMode === 'elements') {
							returnData.push({
								json: { elements: syncResponse?.elements ?? [] },
								pairedItem: { item: i },
							});
						} else {
							returnData.push({
								json: syncResponse as any,
								pairedItem: { item: i },
							});
						}
					} else {
						const asyncResponse = response as AsyncSubmitResponse;
						returnData.push({
							json: { request_id: asyncResponse?.request_id, submitted: true },
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
					const response =
						await this.helpers.httpRequestWithAuthentication.call(
							this,
							'upstageApi',
							requestOptions
						);
					returnData.push({
						json: response as any,
						pairedItem: { item: i },
					});
				} else if (operation === 'asyncList') {
					const requestOptions: IHttpRequestOptions = {
						method: 'GET',
						url: 'https://api.upstage.ai/v1/document-digitization/requests',
					};
					const response =
						await this.helpers.httpRequestWithAuthentication.call(
							this,
							'upstageApi',
							requestOptions
						);
					returnData.push({
						json: response as any,
						pairedItem: { item: i },
					});
				}
			} catch (error) {
				if (this.continueOnFail()) {
					const errorMessage =
						error instanceof Error ? error.message : 'Unknown error';
					const statusCode =
						typeof error === 'object' &&
						error !== null &&
						'statusCode' in error &&
						typeof error.statusCode === 'number'
							? error.statusCode
							: undefined;

					returnData.push({
						json: {
							error: errorMessage,
							statusCode,
							timestamp: new Date().toISOString(),
						},
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
