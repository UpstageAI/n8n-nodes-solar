import type {
	IExecuteFunctions,
	INodeType,
	INodeTypeDescription,
	INodeExecutionData,
	IHttpRequestOptions,
} from 'n8n-workflow';
import { NodeConnectionType } from 'n8n-workflow';

export class InformationExtractionUpstage implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Upstage Information Extraction',
		name: 'informationExtractionUpstage',
		icon: 'file:upstage_v2.svg',
		group: ['transform', '@n8n/n8n-nodes-langchain'],
		version: 1,
		description: 'Extract structured data from documents/images using Upstage Information Extraction',
		defaults: { name: 'Upstage Information Extraction' },
		inputs: [NodeConnectionType.Main],
		outputs: [NodeConnectionType.Main],
		credentials: [{ name: 'upstageApi', required: true }],
		properties: [
			// 입력 방식
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

			// 바이너리일 때
			{
				displayName: 'Binary Property',
				name: 'binaryPropertyName',
				type: 'string',
				default: 'document',
				placeholder: 'e.g. document, data, file',
				description: 'Name of the binary property that contains the file',
				displayOptions: { show: { inputType: ['binary'] } },
			},

			// URL일 때
			{
				displayName: 'Image URL',
				name: 'imageUrl',
				type: 'string',
				default: '',
				placeholder: 'https://example.com/sample.png',
				displayOptions: { show: { inputType: ['url'] } },
			},

			// 모델
			{
				displayName: 'Model',
				name: 'model',
				type: 'options',
				options: [
					{ name: 'information-extract (recommended)', value: 'information-extract' },
				],
				default: 'information-extract',
			},

			// JSON 스키마
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
			},
			{
				displayName: 'Schema Name',
				name: 'schemaName',
				type: 'string',
				default: 'document_schema',
				description: 'Name for the JSON schema in response_format',
				displayOptions: { show: { schemaInputType: ['schema'] } },
			},
			{
				displayName: 'JSON Schema (object)',
				name: 'json_schema',
				type: 'json',
				default: '{ "type": "object", "properties": {} }',
				description: 'Target JSON schema for extraction (object schema)',
				displayOptions: { show: { schemaInputType: ['schema'] } },
			},
			{
				displayName: 'Full Response Format JSON',
				name: 'fullResponseFormat',
				type: 'json',
				default: '{"type":"json_schema","json_schema":{"name":"document_schema","schema":{"type":"object","properties":{}}}}',
				description: 'Complete response_format JSON (including type, json_schema, name, and schema)',
				displayOptions: { show: { schemaInputType: ['full'] } },
			},

			// Chunking 옵션
			{
				displayName: 'Pages per Chunk',
				name: 'pagesPerChunk',
				type: 'number',
				default: 0,
				typeOptions: { minValue: 0 },
				description: 'Chunk pages to improve performance (recommended for 30+ pages). 0 to disable.',
			},

			// 반환 방식
			{
				displayName: 'Return',
				name: 'returnMode',
				type: 'options',
				options: [
					{ name: 'Extracted JSON Only', value: 'extracted' },
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
				const inputType = this.getNodeParameter('inputType', i) as string;
				const model = this.getNodeParameter('model', i) as string;
				const schemaInputType = this.getNodeParameter('schemaInputType', i) as string;
				const pagesPerChunk = this.getNodeParameter('pagesPerChunk', i, 0) as number;
				const returnMode = this.getNodeParameter('returnMode', i) as string;

				// 스키마 파싱
				let responseFormat: any;
				let schemaName: string;
				let schemaObj: any;

				if (schemaInputType === 'schema') {
					// Schema Only 모드
					schemaName = this.getNodeParameter('schemaName', i) as string;
					const schemaRaw = this.getNodeParameter('json_schema', i);
					
					try {
						if (typeof schemaRaw === 'string') {
							// JSON 클렌징: 앞뒤 공백 제거 및 보이지 않는 문자 제거
							const cleanedJson = schemaRaw.trim().replace(/[\u200B-\u200D\uFEFF]/g, '');
							schemaObj = JSON.parse(cleanedJson);
						} else if (typeof schemaRaw === 'object' && schemaRaw !== null) {
							schemaObj = schemaRaw;
						} else {
							throw new Error('Invalid schema data type');
						}
					} catch (error) {
						throw new Error(`Invalid JSON schema provided: ${(error as Error).message}`);
					}

					responseFormat = {
						type: 'json_schema',
						json_schema: {
							name: schemaName,
							schema: schemaObj,
						},
					};
				} else {
					// Full Response Format 모드
					const fullResponseRaw = this.getNodeParameter('fullResponseFormat', i);
					
					try {
						if (typeof fullResponseRaw === 'string') {
							// 강력한 JSON 클렌징
							let cleanedJson = fullResponseRaw
								.trim() // 앞뒤 공백 제거
								.replace(/[\u200B-\u200D\uFEFF]/g, '') // BOM 및 zero-width 문자 제거
								.replace(/\r\n/g, '\n') // Windows 줄바꿈 정규화
								.replace(/\r/g, '\n') // Mac 줄바꿈 정규화
								.replace(/\n/g, '') // 모든 줄바꿈 제거
								.replace(/\s+/g, ' ') // 연속 공백을 하나로
								.replace(/\s*([{}[\]":,])/g, '$1') // JSON 구분자 앞 공백 제거
								.replace(/([{}[\]":,])\s*/g, '$1') // JSON 구분자 뒤 공백 제거
								.trim(); // 최종 공백 제거
							
							// 디버깅을 위한 로그 (개발 시에만)
							console.log('Original length:', fullResponseRaw.length);
							console.log('Cleaned length:', cleanedJson.length);
							console.log('Position 1200-1210:', cleanedJson.substring(1200, 1210));
							
							responseFormat = JSON.parse(cleanedJson);
						} else if (typeof fullResponseRaw === 'object' && fullResponseRaw !== null) {
							responseFormat = fullResponseRaw;
						} else {
							throw new Error('Invalid response format data type');
						}
					} catch (error) {
						throw new Error(`Invalid full response format JSON provided: ${(error as Error).message}`);
					}
				}

				// messages 구성
				let dataUrlOrHttp: string;
				if (inputType === 'binary') {
					const binaryPropertyName = this.getNodeParameter('binaryPropertyName', i) as string;
					const item = items[i];
					if (!item.binary || !item.binary[binaryPropertyName]) {
						throw new Error(`No binary data found in property "${binaryPropertyName}".`);
					}
					const binaryData = item.binary[binaryPropertyName];
					const buffer = await this.helpers.getBinaryDataBuffer(i, binaryPropertyName);
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

				// chunking 옵션 (선택)
				if (pagesPerChunk && pagesPerChunk > 0) {
					requestBody.chunking = { pages_per_chunk: pagesPerChunk };
				}

				const requestOptions: IHttpRequestOptions = {
					method: 'POST',
					url: 'https://api.upstage.ai/v1/information-extraction',
					body: requestBody,
					json: true,
				};

				const response = await this.helpers.httpRequestWithAuthentication.call(
					this,
					'upstageApi',
					requestOptions,
				);

				if (returnMode === 'full') {
					returnData.push({ json: response, pairedItem: { item: i } });
				} else {
					// Extracted JSON 파싱
					const content = response?.choices?.[0]?.message?.content ?? '';
					let extracted: any;
					try {
						extracted = content ? JSON.parse(content) : {};
					} catch {
						// 콘텐츠가 JSON 문자열이 아닐 수 있으므로, 실패 시 원문 반환
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
