import type {
	IExecuteFunctions,
	INodeType,
	INodeTypeDescription,
	INodeExecutionData,
	IHttpRequestOptions,
} from 'n8n-workflow';

export class InformationExtractionUpstage implements INodeType {
	// JSON structure validation and fix method
	private static validateAndFixJsonStructure(jsonString: string): string {
		try {
			console.log('=== JSON Structure Analysis ===');
			console.log('Original length:', jsonString.length);
			console.log(
				'Last 20 chars:',
				jsonString.substring(jsonString.length - 20)
			);

			// Step 1: Basic bracket balance check
			const openBraces = (jsonString.match(/\{/g) || []).length;
			const closeBraces = (jsonString.match(/\}/g) || []).length;
			const openBrackets = (jsonString.match(/\[/g) || []).length;
			const closeBrackets = (jsonString.match(/\]/g) || []).length;

			console.log(
				`Brace balance: {${openBraces}} {${closeBraces}}, [${openBrackets}] [${closeBrackets}]`
			);

			// Step 2: Structural analysis and modification
			let fixedJson = jsonString;

			// Fix brace imbalance
			if (openBraces > closeBraces) {
				const missingBraces = openBraces - closeBraces;
				console.log(`Adding ${missingBraces} missing closing braces`);
				fixedJson += '}'.repeat(missingBraces);
			} else if (closeBraces > openBraces) {
				const extraBraces = closeBraces - openBraces;
				console.log(`Removing ${extraBraces} extra closing braces`);
				fixedJson = fixedJson.replace(
					/\}+$/,
					'}'.repeat(closeBraces - extraBraces)
				);
			}

			// Fix bracket imbalance
			if (openBrackets > closeBrackets) {
				const missingBrackets = openBrackets - closeBrackets;
				console.log(`Adding ${missingBrackets} missing closing brackets`);
				fixedJson += ']'.repeat(missingBrackets);
			} else if (closeBrackets > openBrackets) {
				const extraBrackets = closeBrackets - openBrackets;
				console.log(`Removing ${extraBrackets} extra closing brackets`);
				fixedJson = fixedJson.replace(
					/\]+$/,
					']'.repeat(closeBrackets - extraBrackets)
				);
			}

			// Step 3: JSON validation
			try {
				const parsed = JSON.parse(fixedJson);
				console.log('JSON structure fixed successfully');
				console.log('Fixed length:', fixedJson.length);
				console.log(
					'Last 20 chars after fix:',
					fixedJson.substring(fixedJson.length - 20)
				);
				return fixedJson;
			} catch (parseError) {
				console.log(
					'Still invalid after basic fix:',
					(parseError as Error).message
				);

				// Step 4: Advanced modification attempt
				fixedJson = InformationExtractionUpstage.advancedJsonFix(fixedJson);

				// Step 5: Final validation
				try {
					JSON.parse(fixedJson);
					console.log('Advanced fix successful');
					return fixedJson;
				} catch (finalError) {
					console.log('Advanced fix failed:', (finalError as Error).message);
					return jsonString; // Return original
				}
			}
		} catch (error) {
			console.log('Could not fix JSON structure:', (error as Error).message);
			return jsonString; // Return original
		}
	}

	// Advanced JSON modification method
	private static advancedJsonFix(jsonString: string): string {
		console.log('=== Advanced JSON Fix ===');

		// Fix specific pattern: when properties object is not properly closed
		// "properties":{...}}}} -> "properties":{...}}}}
		const propertiesPattern = /("properties":\{[^}]*)\}\}\}\}/g;
		if (propertiesPattern.test(jsonString)) {
			console.log('Fixing properties object closure');
			jsonString = jsonString.replace(propertiesPattern, '$1}}}');
		}

		// Other common patterns
		// Clean up consecutive closing brackets
		jsonString = jsonString.replace(/\}\}\}+/g, match => {
			const count = match.length;
			if (count > 2) {
				console.log(`Reducing ${count} consecutive closing braces to 2`);
				return '}}';
			}
			return match;
		});

		return jsonString;
	}
	description: INodeTypeDescription = {
		displayName: 'Upstage Information Extraction',
		name: 'informationExtractionUpstage',
		icon: 'file:upstage_v2.svg',
		group: ['transform'],
		version: 1,
		description:
			'Extract structured data from documents/images using Upstage Information Extraction',
		defaults: { name: 'Upstage Information Extraction' },
		inputs: ['main'],
		outputs: ['main'],
		credentials: [{ name: 'upstageApi', required: true }],
		properties: [
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				options: [
					{ name: 'Extract Information', value: 'extract' },
					{ name: 'Generate Schema', value: 'schema' },
				],
				default: 'extract',
				description:
					'Choose between extracting information with a schema or generating a schema from a document',
			},
			// Input method
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

			// When binary
			{
				displayName: 'Binary Property',
				name: 'binaryPropertyName',
				type: 'string',
				default: 'document',
				placeholder: 'e.g. document, data, file',
				description: 'Name of the binary property that contains the file',
				displayOptions: { show: { inputType: ['binary'] } },
			},

			// When URL
			{
				displayName: 'Image URL',
				name: 'imageUrl',
				type: 'string',
				default: '',
				placeholder: 'e.g. https://example.com/sample.png',
				displayOptions: { show: { inputType: ['url'] } },
			},

			// Model
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

			// JSON schema (for extract operation)
			{
				displayName: 'Schema Input Type',
				name: 'schemaInputType',
				type: 'options',
				options: [
					{ name: 'Schema Only', value: 'schema' },
					{ name: 'Full Response Format', value: 'full' },
				],
				default: 'schema',
				description: 'How to provide the JSON schema',
				displayOptions: { show: { operation: ['extract'] } },
			},
			{
				displayName: 'Schema Name',
				name: 'schemaName',
				type: 'string',
				default: 'document_schema',
				description: 'Name for the JSON schema in response_format',
				displayOptions: {
					show: { operation: ['extract'], schemaInputType: ['schema'] },
				},
			},
			{
				displayName: 'JSON Schema (object)',
				name: 'json_schema',
				type: 'json',
				default: '{ "type": "object", "properties": {} }',
				description: 'Target JSON schema for extraction (object schema)',
				displayOptions: {
					show: { operation: ['extract'], schemaInputType: ['schema'] },
				},
			},
			{
				displayName: 'Full Response Format JSON',
				name: 'fullResponseFormat',
				type: 'json',
				default:
					'{"type":"json_schema","json_schema":{"name":"document_schema","schema":{"type":"object","properties":{}}}}',
				description:
					'Complete response_format JSON (including type, json_schema, name, and schema)',
				displayOptions: {
					show: { operation: ['extract'], schemaInputType: ['full'] },
				},
			},
			// Guidance for schema generation
			{
				displayName: 'Guidance (optional)',
				name: 'prompt',
				type: 'string',
				typeOptions: { rows: 3 },
				default: '',
				placeholder: 'e.g., Generate a schema suitable for bank statements.',
				description: 'Optional text instruction to influence schema generation',
				displayOptions: { show: { operation: ['schema'] } },
			},

			// Chunking options (for extract operation)
			{
				displayName: 'Pages per Chunk',
				name: 'pagesPerChunk',
				type: 'number',
				default: 0,
				typeOptions: { minValue: 0 },
				description:
					'Chunk pages to improve performance (recommended for 30+ pages). 0 to disable.',
				displayOptions: { show: { operation: ['extract'] } },
			},

			// Return mode
			{
				displayName: 'Return',
				name: 'returnMode',
				type: 'options',
				options: [
					{ name: 'Extracted JSON Only', value: 'extracted' },
					{ name: 'Schema JSON Only', value: 'schema' },
					{ name: 'Full Response', value: 'full' },
				],
				default: 'extracted',
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
			try {
				const operation = this.getNodeParameter('operation', i) as string;
				const inputType = this.getNodeParameter('inputType', i) as string;
				const model = this.getNodeParameter('model', i) as string;
				const returnMode = this.getNodeParameter('returnMode', i) as string;

				// Handle different operations
				if (operation === 'extract') {
					// Extract Information operation
					const schemaInputType = this.getNodeParameter(
						'schemaInputType',
						i
					) as string;
					const pagesPerChunk = this.getNodeParameter(
						'pagesPerChunk',
						i,
						0
					) as number;

					// Schema parsing
					let responseFormat: any;
					let schemaName: string;
					let schemaObj: any;

					if (schemaInputType === 'schema') {
						// Schema Only mode
						schemaName = this.getNodeParameter('schemaName', i) as string;
						const schemaRaw = this.getNodeParameter('json_schema', i);

						try {
							if (typeof schemaRaw === 'string') {
								// JSON cleaning: remove leading/trailing spaces and invisible characters
								const cleanedJson = schemaRaw
									.trim()
									.replace(/[\u200B-\u200D\uFEFF]/g, '');
								schemaObj = JSON.parse(cleanedJson);
							} else if (typeof schemaRaw === 'object' && schemaRaw !== null) {
								schemaObj = schemaRaw;
							} else {
								throw new Error('Invalid schema data type');
							}
						} catch (error) {
							throw new Error(
								`Invalid JSON schema provided: ${(error as Error).message}`
							);
						}

						responseFormat = {
							type: 'json_schema',
							json_schema: {
								name: schemaName,
								schema: schemaObj,
							},
						};
					} else {
						// Full Response Format mode
						const fullResponseRaw = this.getNodeParameter(
							'fullResponseFormat',
							i
						);

						try {
							if (typeof fullResponseRaw === 'string') {
								// Step 1: Basic cleaning (remove only invisible characters)
								let cleanedJson = fullResponseRaw
									.trim() // Remove leading/trailing spaces
									.replace(/[\u200B-\u200D\uFEFF]/g, '') // Remove BOM and zero-width characters
									.replace(/\r\n/g, '\n') // Normalize Windows line breaks
									.replace(/\r/g, '\n'); // Normalize Mac line breaks

								// Step 2: JSON validation and format detection
								let parsedJson;
								try {
									// First try parsing as original
									parsedJson = JSON.parse(cleanedJson);
								} catch (firstError) {
									// If failed, consider as compressed JSON and do additional cleaning
									console.log(
										'First parse failed, trying compressed JSON cleaning...'
									);
									console.log('Original error:', (firstError as Error).message);

									cleanedJson = cleanedJson
										.replace(/\n/g, '') // Remove all line breaks
										.replace(/\s+/g, ' ') // Replace consecutive spaces with single space
										.replace(/\s*([{}[\]":,])/g, '$1') // Remove spaces before JSON separators
										.replace(/([{}[\]":,])\s*/g, '$1') // Remove spaces after JSON separators
										.trim(); // Final space removal

									// Attempt JSON structure validation and modification
									cleanedJson =
										InformationExtractionUpstage.validateAndFixJsonStructure(
											cleanedJson
										);

									parsedJson = JSON.parse(cleanedJson);
								}

								// Step 3: JSON object validation
								if (typeof parsedJson !== 'object' || parsedJson === null) {
									throw new Error('Parsed result is not a valid JSON object');
								}

								// Step 4: Required structure validation
								if (!parsedJson.type || !parsedJson.json_schema) {
									throw new Error(
										'Missing required fields: type or json_schema'
									);
								}

								responseFormat = parsedJson;

								// Debug logging
								console.log('JSON parsing successful');
								console.log('Type:', parsedJson.type);
								console.log('Schema name:', parsedJson.json_schema?.name);
							} else if (
								typeof fullResponseRaw === 'object' &&
								fullResponseRaw !== null
							) {
								responseFormat = fullResponseRaw;
							} else {
								throw new Error('Invalid response format data type');
							}
						} catch (error) {
							throw new Error(
								`Invalid full response format JSON provided: ${(error as Error).message}`
							);
						}
					}

					// Compose messages
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

					const requestBody: any = {
						model,
						messages: [
							{
								role: 'user',
								content: [
									{
										type: 'image_url',
										image_url: { url: dataUrlOrHttp },
									},
								],
							},
						],
						response_format: responseFormat,
					};

					// chunking options (optional)
					if (pagesPerChunk && pagesPerChunk > 0) {
						requestBody.chunking = { pages_per_chunk: pagesPerChunk };
					}

					const requestOptions: IHttpRequestOptions = {
						method: 'POST',
						url: 'https://api.upstage.ai/v1/information-extraction',
						body: requestBody,
						json: true,
					};

					const response =
						await this.helpers.httpRequestWithAuthentication.call(
							this,
							'upstageApi',
							requestOptions
						);

					if (returnMode === 'full') {
						returnData.push({ json: response, pairedItem: { item: i } });
					} else {
						// Parse extracted JSON
						const content = response?.choices?.[0]?.message?.content ?? '';
						let extracted: any;
						try {
							extracted = content ? JSON.parse(content) : {};
						} catch {
							// Content may not be JSON string, so return original text on failure
							extracted = { _raw: content };
						}

						returnData.push({
							json: {
								extracted,
								model: response?.model,
								usage: response?.usage,
								full_response: response,
							},
							pairedItem: { item: i },
						});
					}
				} else {
					// Generate Schema operation
					const prompt = (
						this.getNodeParameter('prompt', i, '') as string
					)?.trim();

					// Compose messages
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

					// Compose messages
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

					// Request body
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

					// Call
					const response =
						await this.helpers.httpRequestWithAuthentication.call(
							this,
							'upstageApi',
							requestOptions
						);

					// Response parsing + binary passthrough
					if (returnMode === 'full') {
						const out: INodeExecutionData = {
							json: response,
							pairedItem: { item: i },
						};
						if (items[i].binary) out.binary = items[i].binary; // passthrough
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
						if (items[i].binary) out.binary = items[i].binary; // passthrough
						returnData.push(out);
					}
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
