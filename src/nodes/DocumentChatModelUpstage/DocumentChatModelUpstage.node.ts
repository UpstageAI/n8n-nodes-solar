import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { BaseChatModelParams } from '@langchain/core/language_models/chat_models';
import type { BaseMessage } from '@langchain/core/messages';
import { AIMessage, AIMessageChunk } from '@langchain/core/messages';
import type { ChatResult } from '@langchain/core/outputs';
import { ChatGenerationChunk } from '@langchain/core/outputs';
import type { CallbackManagerForLLMRun } from '@langchain/core/callbacks/manager';
import {
	type INodeType,
	type INodeTypeDescription,
	type ISupplyDataFunctions,
	type SupplyData,
} from 'n8n-workflow';

import { N8nLlmTracing } from '../../utils/N8nLlmTracing';
import { getConnectionHintNoticeField } from '../../utils/sharedFields';

/**
 * Document Chat configuration
 */
interface DocumentChatConfig {
	apiKey: string;
	model: string;
	fileIds: string[];
	conversationId?: string;
	reasoningEffort: string;
	reasoningSummary: string;
	temperature?: number;
	streaming?: boolean;
}

/**
 * Custom chat model for Upstage Document Chat API
 * Extends BaseChatModel directly for full control
 */
class UpstageDocumentChatModel extends BaseChatModel {
	private config: DocumentChatConfig;

	constructor(config: DocumentChatConfig, params?: BaseChatModelParams) {
		console.log('🔧 UpstageDocumentChatModel constructor called with:', {
			model: config.model,
			fileIds: config.fileIds,
			streaming: config.streaming,
			conversationId: config.conversationId,
		});

		super(params || {});
		this.config = config;

		console.log('✅ UpstageDocumentChatModel initialized');
	}

	_llmType(): string {
		return 'upstage-document-chat';
	}

	/**
	 * Bind tools to this model
	 * Required for Tools Agent compatibility
	 */
	bindTools(
		tools: any[],
		kwargs?: Partial<this['ParsedCallOptions']>,
	): this {
		console.log('🔧 bindTools called with', tools.length, 'tools');
		// Document Chat doesn't natively support function calling
		// But we return 'this' to satisfy the Tools Agent requirement
		// The tools will be handled by the Agent framework
		return this;
	}

	/**
	 * Non-streaming generation
	 */
	async _generate(
		messages: BaseMessage[],
		options: this['ParsedCallOptions'],
		runManager?: CallbackManagerForLLMRun,
	): Promise<ChatResult> {
		console.log('🚀 _generate called (non-streaming)');
		console.log('📨 Messages count:', messages.length);
		console.log('🔍 First message:', messages[0]);

		const response = await this.callDocumentChatAPI(messages, false, options?.signal);

		console.log('📥 API Response received');

		// Extract content from Document Chat response
		const output = response.output || [];
		const messageOutput = output.find((item: any) => item.type === 'message');
		const contentText = messageOutput?.content?.[0]?.text || '';

		console.log('✅ Extracted content length:', contentText.length);

		return {
			generations: [
				{
					text: contentText,
					message: new AIMessage(contentText),
				},
			],
			llmOutput: {
				usage: response.usage,
				conversation_id: response.conversation?.id,
			},
		};
	}

	/**
	 * Streaming generation
	 */
	async *_streamResponseChunks(
		messages: BaseMessage[],
		options: this['ParsedCallOptions'],
		runManager?: CallbackManagerForLLMRun,
	): AsyncGenerator<ChatGenerationChunk> {
		console.log('🚀 _streamResponseChunks called (streaming)');
		console.log('📨 Messages count:', messages.length);
		console.log('🔍 First message:', messages[0]);
		console.log('🔄 Starting SSE stream parsing...');

		const response = await this.callDocumentChatAPI(messages, true, options?.signal);

		if (!response.body) {
			console.error('❌ No response body for streaming');
			throw new Error('No response body for streaming');
		}

		console.log('✅ Response body available, starting to read stream...');

		// Parse SSE stream
		const reader = response.body.getReader();
		const decoder = new TextDecoder();
		let buffer = '';
		let chunkCount = 0;

		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) {
					console.log(`✅ Stream completed - Total chunks: ${chunkCount}`);
					break;
				}

				buffer += decoder.decode(value, { stream: true });
				const lines = buffer.split('\n');
				buffer = lines.pop() || '';

				for (const line of lines) {
					if (!line.trim()) continue;
					if (line.startsWith('event:')) {
						console.log('📋 Event type:', line);
						continue;
					}
					if (!line.startsWith('data: ')) continue;

					const jsonStr = line.slice(6).trim();
					if (jsonStr === '[DONE]') {
						console.log('🏁 Received [DONE] marker');
						continue;
					}

					try {
						const data = JSON.parse(jsonStr);
						console.log('📦 Parsed data type:', data.type);

						// Extract delta text from Document Chat events
						let deltaText = '';

					// Prioritize actual output text for user display
					if (data.type === 'response.output_text.delta' && data.delta) {
						deltaText = data.delta;
						console.log('📝 Output delta:', deltaText.substring(0, 50));
					}
					// Log reasoning but don't display it to users
					else if (data.type === 'response.reasoning_summary_text.delta' && data.delta) {
						console.log('🤔 [Internal Reasoning]:', data.delta.substring(0, 100));
						// Don't set deltaText - won't be displayed to user
					}

						if (deltaText) {
							chunkCount++;
							console.log(`💬 Sending chunk ${chunkCount} to n8n...`);

							// Send token to runManager for n8n display
							if (runManager) {
								await runManager.handleLLMNewToken(deltaText);
								console.log('✅ Token sent to runManager');
							} else {
								console.warn('⚠️ No runManager available!');
							}

							// Yield chunk for LangChain
							yield new ChatGenerationChunk({
								text: deltaText,
								message: new AIMessageChunk(deltaText),
								generationInfo: {
									usage: data.usage,
									conversation_id: data.conversation?.id || data.conversation_id,
								},
							});
							console.log('✅ Chunk yielded to LangChain');
						}
					} catch (e) {
						console.error('❌ Failed to parse SSE chunk:', e);
						console.error('❌ Raw line:', line);
						continue;
					}
				}
			}
		} finally {
			reader.releaseLock();
			console.log('🔒 Stream reader released');
		}
	}

	/**
	 * Make API call to Document Chat endpoint
	 */
	private async callDocumentChatAPI(
		messages: BaseMessage[],
		stream: boolean,
		signal?: AbortSignal,
	): Promise<any> {
		console.log('🌐 callDocumentChatAPI called');
		console.log('📊 Stream mode:', stream);

		// Extract query from last message
		const lastMessage = messages[messages.length - 1];
		let query = '';

		if (typeof lastMessage.content === 'string') {
			query = lastMessage.content;
		} else if (Array.isArray(lastMessage.content)) {
			const textContent = (lastMessage.content as any[]).find(
				(c: any) => c.type === 'text' || typeof c === 'string'
			);
			query = typeof textContent === 'string'
				? textContent
				: (textContent as any)?.text || '';
		}

		console.log('📝 Query extracted (first 100 chars):', query.substring(0, 100));

		// Build Document Chat request
		const content = [
			...this.config.fileIds.map(fileId => ({
				type: 'input_file' as const,
				file_id: fileId,
			})),
			{
				type: 'input_text' as const,
				text: query,
			},
		];

		const requestBody: any = {
			model: this.config.model,
			stream,
			input: [
				{
					role: 'user',
					content,
				},
			],
			reasoning: {
				effort: this.config.reasoningEffort as 'low' | 'medium' | 'high',
				summary: this.config.reasoningSummary as 'auto' | 'enabled' | 'disabled',
			},
		};

		if (this.config.conversationId) {
			requestBody.conversation = { id: this.config.conversationId };
		}

		if (this.config.temperature !== undefined) {
			requestBody.temperature = this.config.temperature;
		}

		console.log('📤 Request body:', JSON.stringify(requestBody, null, 2));

		const url = 'https://api.upstage.ai/v1/document-chat/responses';
		console.log('🌐 Calling endpoint:', url);

		try {
			const response = await fetch(url, {
				method: 'POST',
				headers: {
					'Authorization': `Bearer ${this.config.apiKey}`,
					'Content-Type': 'application/json',
				},
				body: JSON.stringify(requestBody),
				signal,
			});

			console.log('📥 Response status:', response.status, response.statusText);
			const headers: any = {};
			response.headers.forEach((value, key) => {
				headers[key] = value;
			});
			console.log('📥 Response headers:', JSON.stringify(headers));

			if (!response.ok) {
				const errorText = await response.text();
				console.error('❌ API Error response:', errorText);
				throw new Error(`Document Chat API error: ${response.status} - ${errorText}`);
			}

			console.log('✅ API call successful');

			// Return response (stream or JSON)
			if (stream) {
				console.log('🔄 Returning streaming response');
				return response;
			} else {
				const data = await response.json();
				console.log('📊 Response data:', JSON.stringify(data, null, 2));
				return data;
			}
		} catch (error: any) {
			console.error('❌ callDocumentChatAPI error:', error);
			console.error('❌ Error stack:', error.stack);
			throw error;
		}
	}
}

export class DocumentChatModelUpstage implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Document Chat Model',
		name: 'documentChatModelUpstage',
		icon: 'file:upstage_v2.svg',
		group: ['transform'],
		version: 1,
		description: 'Chat with documents using Upstage Solar models in AI chains',
		defaults: {
			name: 'Document Chat Model',
		},
		codex: {
			categories: ['AI'],
			subcategories: {
				AI: ['Language Models', 'Root Nodes'],
				'Language Models': ['Chat Models (Recommended)'],
			},
			resources: {
				primaryDocumentation: [
					{
						url: 'https://docs.n8n.io/integrations/builtin/cluster-nodes/sub-nodes/n8n-nodes-langchain.lmchatupstage/',
					},
				],
			},
		},
		inputs: [],
		outputs: ['ai_languageModel'],
		outputNames: ['Model'],
		credentials: [
			{
				name: 'upstageApi',
				required: true,
			},
		],
		requestDefaults: {
			ignoreHttpStatusErrors: true,
			baseURL: 'https://api.upstage.ai/v1',
		},
		properties: [
			getConnectionHintNoticeField(['ai_chain', 'ai_agent']),
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
				description: 'The Document Chat model to use',
			},
			{
				displayName: 'File IDs',
				name: 'fileIds',
				type: 'string',
				default: '',
				required: true,
				description: 'Comma-separated list of uploaded file IDs to chat with. Upload files first using the Document Chat node.',
				placeholder: 'file-abc123, file-def456',
			},
			{
				displayName: 'Conversation ID',
				name: 'conversationId',
				type: 'string',
				default: '',
				description: 'Optional: Continue an existing conversation by providing the conversation ID',
				placeholder: 'conv-abc123',
			},
			{
				displayName: 'Options',
				name: 'options',
				placeholder: 'Add Option',
				description: 'Additional options to add',
				type: 'collection',
				default: {},
				options: [
					{
						displayName: 'Reasoning Effort',
						name: 'reasoningEffort',
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
						description: 'The reasoning effort level for document analysis',
					},
					{
						displayName: 'Reasoning Summary',
						name: 'reasoningSummary',
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
						description: 'Whether to include reasoning summary in responses',
					},
					{
						displayName: 'Sampling Temperature',
						name: 'temperature',
						default: 0.7,
						typeOptions: { maxValue: 2, minValue: 0, numberPrecision: 1 },
						description:
							'Controls randomness: Lowering results in less random completions. As the temperature approaches zero, the model will become deterministic and repetitive.',
						type: 'number',
					},
					{
						displayName: 'Streaming',
						name: 'streaming',
						default: false,
						description: 'Whether to stream the response',
						type: 'boolean',
					},
				],
			},
		],
	};

	async supplyData(
		this: ISupplyDataFunctions,
		itemIndex: number
	): Promise<SupplyData> {
		console.log('🚀 DocumentChatModelUpstage.supplyData called');

		const credentials = await this.getCredentials('upstageApi');

		const model = this.getNodeParameter('model', itemIndex) as string;
		const fileIds = this.getNodeParameter('fileIds', itemIndex) as string;
		const conversationId = this.getNodeParameter('conversationId', itemIndex, '') as string;

		const options = this.getNodeParameter('options', itemIndex, {}) as {
			reasoningEffort?: string;
			reasoningSummary?: string;
			temperature?: number;
			streaming?: boolean;
		};

		console.log('📋 Node parameters:', {
			model,
			fileIds,
			conversationId,
			options,
		});

		// Validate file IDs
		if (!fileIds || fileIds.trim() === '') {
			throw new Error('File IDs are required. Please upload files first using the Document Chat node.');
		}

		// Parse file IDs
		const fileIdArray = fileIds.split(',').map(id => id.trim()).filter(id => id);

		if (fileIdArray.length === 0) {
			throw new Error('At least one valid file ID is required.');
		}

		// Create custom parser for Document Chat responses
		const documentChatTokensParser = (llmOutput: any) => {
			const usage = llmOutput?.usage || llmOutput?.tokenUsage;
			if (usage) {
				const completionTokens = usage.output_tokens || usage.completion_tokens || usage.completionTokens || 0;
				const promptTokens = usage.input_tokens || usage.prompt_tokens || usage.promptTokens || 0;
				const totalTokens = usage.total_tokens || usage.totalTokens || completionTokens + promptTokens;

				console.log('🔍 Document Chat Token Usage:', {
					completionTokens,
					promptTokens,
					totalTokens,
					rawUsage: usage,
				});

				return {
					completionTokens,
					promptTokens,
					totalTokens,
				};
			}

			console.log('⚠️ No token usage data found in Document Chat response:', llmOutput);
			return {
				completionTokens: 0,
				promptTokens: 0,
				totalTokens: 0,
			};
		};

		// Create tracing
		const tracing = new N8nLlmTracing(this, {
			tokensUsageParser: documentChatTokensParser,
		});

		// Build Document Chat configuration
		const documentChatConfig: DocumentChatConfig = {
			apiKey: credentials.apiKey as string,
			model: model,
			fileIds: fileIdArray,
			conversationId: conversationId || undefined,
			reasoningEffort: options.reasoningEffort || 'medium',
			reasoningSummary: options.reasoningSummary || 'auto',
			temperature: options.temperature,
			streaming: options.streaming || false,
		};

		// Build model params with tracing
		const modelParams: BaseChatModelParams = {
			callbacks: tracing ? [tracing] : undefined,
		};

		// Create Document Chat model
		const chatModel = new UpstageDocumentChatModel(documentChatConfig, modelParams);

		console.log(`✅ Document Chat Model initialized with ${fileIdArray.length} file(s)`);
		console.log(`📄 File IDs: ${fileIdArray.join(', ')}`);
		console.log(`🔄 Streaming: ${options.streaming || false}`);
		if (conversationId) {
			console.log(`💬 Continuing conversation: ${conversationId}`);
		}

		return {
			response: chatModel,
		};
	}
}
