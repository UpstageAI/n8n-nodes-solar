import type {
	IExecuteFunctions,
	INodeType,
	INodeTypeDescription,
	INodeExecutionData,
	IHttpRequestOptions,
	IDataObject,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

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
				`Content-Disposition: form-data; name="file"; filename="${file.filename}"\r\n` +
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

export class DocumentChatUpstage implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Upstage Document Chat',
		name: 'documentChatUpstage',
		icon: 'file:upstage_v2.svg',
		group: ['transform'],
		version: 1,
		description: 'Chat with documents using Upstage Solar models',
		defaults: {
			name: 'Upstage Document Chat',
		},
		inputs: ['main'],
		outputs: ['main'],
		credentials: [
			{
				name: 'upstageApi',
				required: true,
			},
		],
		properties: [
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Upload File',
						value: 'uploadFile',
						description: 'Upload a document for chat',
						action: 'Upload a file',
					},
					{
						name: 'Retrieve File',
						value: 'retrieveFile',
						description: 'Check file processing status and retrieve details',
						action: 'Retrieve a file',
					},
					{
						name: 'Get Response',
						value: 'getResponse',
						description: 'Ask questions about uploaded documents',
						action: 'Get a response',
					},
				],
				default: 'uploadFile',
			},

			// Upload File operation fields
			{
				displayName: 'Input Binary Field',
				name: 'binaryPropertyName',
				type: 'string',
				default: 'data',
				required: true,
				displayOptions: {
					show: {
						operation: ['uploadFile'],
					},
				},
				description: 'Name of the binary property containing the file to upload',
			},

			// Retrieve File operation fields
			{
				displayName: 'File ID',
				name: 'fileId',
				type: 'string',
				default: '',
				required: true,
				displayOptions: {
					show: {
						operation: ['retrieveFile'],
					},
				},
				description: 'The ID of the file to retrieve',
			},
			{
				displayName: 'Options',
				name: 'retrieveOptions',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				displayOptions: {
					show: {
						operation: ['retrieveFile'],
					},
				},
				options: [
					{
						displayName: 'Pages',
						name: 'pages',
						type: 'string',
						default: 'all',
						description: 'Specify which pages to retrieve (e.g., "all", "1-3", "1,3,5")',
					},
					{
						displayName: 'View',
						name: 'view',
						type: 'options',
						options: [
							{
								name: 'All',
								value: 'all',
								description: 'Return all details including elements',
							},
							{
								name: 'Summary',
								value: 'summary',
								description: 'Return summary information only',
							},
						],
						default: 'all',
					},
				],
			},

			// Get Response operation fields
			{
				displayName: 'Model',
				name: 'model',
				type: 'options',
				options: [
					{
						name: 'Genius',
						value: 'genius',
						description: 'Best for most users - balanced performance',
					},
					{
						name: 'Turbo',
						value: 'turbo',
						description: 'Optimized for speed',
					},
				],
				default: 'genius',
				displayOptions: {
					show: {
						operation: ['getResponse'],
					},
				},
				description: 'The model to use for document chat',
			},
			{
				displayName: 'File ID(s)',
				name: 'fileIds',
				type: 'string',
				default: '',
				required: true,
				displayOptions: {
					show: {
						operation: ['getResponse'],
					},
				},
				description: 'Comma-separated list of file IDs to chat with',
			},
			{
				displayName: 'Query',
				name: 'query',
				type: 'string',
				typeOptions: {
					rows: 4,
				},
				default: '',
				required: true,
				displayOptions: {
					show: {
						operation: ['getResponse'],
					},
				},
				description: 'The question or instruction to ask about the documents',
			},
			{
				displayName: 'Options',
				name: 'responseOptions',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				displayOptions: {
					show: {
						operation: ['getResponse'],
					},
				},
				options: [
					{
						displayName: 'Conversation ID',
						name: 'conversationId',
						type: 'string',
						default: '',
						description: 'Continue an existing conversation by providing the conversation ID',
					},
					{
						displayName: 'Stream',
						name: 'stream',
						type: 'boolean',
						default: false,
						description: 'Whether to stream the response',
					},
					{
						displayName: 'Reasoning',
						name: 'reasoning',
						type: 'fixedCollection',
						default: {},
						options: [
							{
								displayName: 'Settings',
								name: 'settings',
								values: [
									{
										displayName: 'Effort',
										name: 'effort',
										type: 'options',
										options: [
											{
												name: 'Low',
												value: 'low',
											},
											{
												name: 'Medium',
												value: 'medium',
											},
											{
												name: 'High',
												value: 'high',
											},
										],
										default: 'medium',
										description: 'The reasoning effort level',
									},
									{
										displayName: 'Summary',
										name: 'summary',
										type: 'options',
										options: [
											{
												name: 'Auto',
												value: 'auto',
											},
											{
												name: 'Enabled',
												value: 'enabled',
											},
											{
												name: 'Disabled',
												value: 'disabled',
											},
										],
										default: 'auto',
										description: 'Whether to include reasoning summary',
									},
								],
							},
						],
					},
				],
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];
		const operation = this.getNodeParameter('operation', 0) as string;

		for (let i = 0; i < items.length; i++) {
			try {
				if (operation === 'uploadFile') {
					// Upload File operation
					const binaryPropertyName = this.getNodeParameter('binaryPropertyName', i) as string;
					const binaryData = items[i].binary?.[binaryPropertyName];

					if (!binaryData) {
						throw new NodeOperationError(
							this.getNode(),
							`No binary data found in property "${binaryPropertyName}"`,
							{ itemIndex: i }
						);
					}

					// Get the file buffer
					const fileBuffer = await this.helpers.getBinaryDataBuffer(i, binaryPropertyName);

					// Prepare form data using helper function
					const { body, contentType } = createMultipartFormData(
						{ purpose: 'user_data' },
						{
							buffer: fileBuffer,
							filename: binaryData.fileName || 'document',
							contentType: binaryData.mimeType || 'application/octet-stream',
						}
					);

					// Make upload request
					const requestOptions: IHttpRequestOptions = {
						method: 'POST',
						url: 'https://api.upstage.ai/v1/document-chat/files',
						body,
						headers: {
							'Content-Type': contentType,
						},
					};

					const response = await this.helpers.httpRequestWithAuthentication.call(
						this,
						'upstageApi',
						requestOptions
					);

					returnData.push({
						json: response as IDataObject,
						pairedItem: { item: i },
					});

				} else if (operation === 'retrieveFile') {
					// Retrieve File operation
					const fileId = this.getNodeParameter('fileId', i) as string;
					const retrieveOptions = this.getNodeParameter('retrieveOptions', i, {}) as {
						pages?: string;
						view?: string;
					};

					// Build query parameters
					const queryParams = new URLSearchParams();
					if (retrieveOptions.pages) {
						queryParams.append('pages', retrieveOptions.pages);
					}
					if (retrieveOptions.view) {
						queryParams.append('view', retrieveOptions.view);
					}

					const queryString = queryParams.toString();
					const url = `https://api.upstage.ai/v1/document-chat/files/${fileId}${queryString ? '?' + queryString : ''}`;

					const requestOptions: IHttpRequestOptions = {
						method: 'GET',
						url,
					};

					const response = await this.helpers.httpRequestWithAuthentication.call(
						this,
						'upstageApi',
						requestOptions
					);

					returnData.push({
						json: response as IDataObject,
						pairedItem: { item: i },
					});

				} else if (operation === 'getResponse') {
					// Get Response operation
					const model = this.getNodeParameter('model', i) as string;
					const fileIds = this.getNodeParameter('fileIds', i) as string;
					const query = this.getNodeParameter('query', i) as string;
					const responseOptions = this.getNodeParameter('responseOptions', i, {}) as {
						conversationId?: string;
						stream?: boolean;
						reasoning?: {
							settings?: Array<{
								effort?: string;
								summary?: string;
							}>;
						};
					};

					// Parse file IDs
					const fileIdArray = fileIds.split(',').map(id => id.trim()).filter(id => id);

					if (fileIdArray.length === 0) {
						throw new NodeOperationError(
							this.getNode(),
							'At least one file ID is required',
							{ itemIndex: i }
						);
					}

					// Build input content array
					const inputFiles = fileIdArray.map(fileId => ({
						type: 'input_file',
						file_id: fileId,
					}));

					const content = [
						...inputFiles,
						{
							type: 'input_text',
							text: query,
						},
					];

					// Build request body
					const requestBody: any = {
						model,
						stream: responseOptions.stream || false,
						input: [
							{
								role: 'user',
								content,
							},
						],
					};

					// Add reasoning if specified
					const reasoningSettings = responseOptions.reasoning?.settings?.[0];
					if (reasoningSettings && (reasoningSettings.effort || reasoningSettings.summary)) {
						requestBody.reasoning = {
							effort: reasoningSettings.effort || 'medium',
							summary: reasoningSettings.summary || 'auto',
						};
					}

					// Add conversation ID if specified
					if (responseOptions.conversationId) {
						requestBody.conversation = {
							id: responseOptions.conversationId,
						};
					}

					const requestOptions: IHttpRequestOptions = {
						method: 'POST',
						url: 'https://api.upstage.ai/v1/document-chat/responses',
						body: requestBody,
						json: true,
					};

					const response = await this.helpers.httpRequestWithAuthentication.call(
						this,
						'upstageApi',
						requestOptions
					);

					// Extract the main content from the response
					const output = response.output || [];
					const messageOutput = output.find((item: any) => item.type === 'message');
					const content_text = messageOutput?.content?.[0]?.text || '';

					returnData.push({
						json: {
							content: content_text,
							conversation_id: response.conversation?.id,
							query,
							full_response: response,
						} as IDataObject,
						pairedItem: { item: i },
					});
				}

			} catch (error) {
				const errorMessage = error instanceof Error ? error.message : 'Unknown error';

				console.error('🚫 Upstage Document Chat Error:', {
					operation,
					error: errorMessage,
					itemIndex: i,
					timestamp: new Date().toISOString(),
				});

				if (this.continueOnFail()) {
					returnData.push({
						json: {
							error: errorMessage,
							error_code: (error as any)?.code || 'unknown_error',
							operation,
							timestamp: new Date().toISOString(),
						} as IDataObject,
						pairedItem: { item: i },
					});
				} else {
					throw new NodeOperationError(
						this.getNode(),
						`Upstage Document Chat failed for item ${i}: ${errorMessage}`,
						{ itemIndex: i }
					);
				}
			}
		}

		return [returnData];
	}
}
