import { ChatOpenAI } from '@langchain/openai';
import type { BaseMessage } from '@langchain/core/messages';
import {
	type INodeType,
	type INodeTypeDescription,
	type ISupplyDataFunctions,
	type SupplyData,
} from 'n8n-workflow';

import { N8nLlmTracing } from '../../utils/N8nLlmTracing';
import { makeN8nLlmFailedAttemptHandler } from '../../utils/n8nLlmFailedAttemptHandler';
import { getConnectionHintNoticeField } from '../../utils/sharedFields';

/**
 * Custom ChatOpenAI wrapper for Upstage Document Chat API
 * Extends ChatOpenAI but overrides the endpoint to use /responses instead of /chat/completions
 */
class UpstageDocumentChatModel extends ChatOpenAI {
	private fileIds: string[];
	private conversationId?: string;
	private reasoningEffort: string;
	private reasoningSummary: string;

	constructor(config: {
		apiKey: string;
		model: string;
		fileIds: string[];
		conversationId?: string;
		reasoningEffort: string;
		reasoningSummary: string;
		temperature?: number;
		streaming?: boolean;
		callbacks?: any[];
		onFailedAttempt?: any;
	}) {
		console.log('🔧 UpstageDocumentChatModel constructor called with:', {
			model: config.model,
			fileIds: config.fileIds,
			streaming: config.streaming,
			conversationId: config.conversationId,
		});

		// Call ChatOpenAI constructor
		// We'll override the endpoint in completionWithRetry
		super({
			apiKey: config.apiKey,
			model: config.model,
			temperature: config.temperature,
			streaming: config.streaming || false,
			configuration: {
				// Use base Document Chat URL (we'll add /responses in completionWithRetry)
				baseURL: 'https://api.upstage.ai/v1/document-chat',
			},
			callbacks: config.callbacks,
			onFailedAttempt: config.onFailedAttempt,
		});

		this.fileIds = config.fileIds;
		this.conversationId = config.conversationId;
		this.reasoningEffort = config.reasoningEffort;
		this.reasoningSummary = config.reasoningSummary;

		console.log('✅ UpstageDocumentChatModel initialized');
	}

	/**
	 * Override the completion method to use /responses endpoint
	 * This is the critical method that ChatOpenAI uses to make API calls
	 */
	async completionWithRetry(
		request: any,
		options?: any,
	): Promise<any> {
		console.log('🚀 completionWithRetry called');
		console.log('📤 Original request:', JSON.stringify(request, null, 2));
		console.log('⚙️ Options:', JSON.stringify(options, null, 2));

		// Transform the request to Document Chat format
		const documentChatRequest = this.transformToDocumentChatFormat(request);

		console.log('📤 Transformed Document Chat request:', JSON.stringify(documentChatRequest, null, 2));

		// ChatOpenAI uses the 'client' property which has a 'chat.completions.create()' method
		// We need to directly call fetch to use the correct endpoint
		const url = 'https://api.upstage.ai/v1/document-chat/responses';
		console.log('🌐 Calling endpoint:', url);

		try {
			const response = await fetch(url, {
				method: 'POST',
				headers: {
					'Authorization': `Bearer ${(this as any).apiKey}`,
					'Content-Type': 'application/json',
				},
				body: JSON.stringify(documentChatRequest),
				signal: options?.signal,
			});

			console.log('📥 Response status:', response.status, response.statusText);

			if (!response.ok) {
				const errorText = await response.text();
				console.error('❌ API Error:', errorText);
				throw new Error(`Document Chat API error: ${response.status} - ${errorText}`);
			}

			// If streaming, return the response body for SSE parsing
			if (documentChatRequest.stream) {
				console.log('🔄 Returning streaming response');
				return response;
			}

			// Non-streaming: parse JSON
			const data = await response.json();
			console.log('📥 Response data:', JSON.stringify(data, null, 2));
			return this.transformFromDocumentChatFormat(data);
		} catch (error: any) {
			console.error('❌ completionWithRetry error:', error);
			throw error;
		}
	}

	/**
	 * Transform OpenAI format request to Document Chat format
	 */
	private transformToDocumentChatFormat(request: any): any {
		console.log('🔄 Transforming to Document Chat format');

		// Extract the user query from messages
		const messages = request.messages || [];
		const lastMessage = messages[messages.length - 1];
		let query = '';

		if (typeof lastMessage?.content === 'string') {
			query = lastMessage.content;
		} else if (Array.isArray(lastMessage?.content)) {
			const textContent = lastMessage.content.find(
				(c: any) => c.type === 'text' || typeof c === 'string'
			);
			query = typeof textContent === 'string'
				? textContent
				: (textContent as any)?.text || '';
		}

		console.log('📝 Extracted query:', query);

		// Build Document Chat input format
		const content = [
			...this.fileIds.map(fileId => ({
				type: 'input_file' as const,
				file_id: fileId,
			})),
			{
				type: 'input_text' as const,
				text: query,
			},
		];

		const documentChatRequest: any = {
			model: request.model,
			stream: request.stream || false,
			input: [
				{
					role: 'user',
					content,
				},
			],
			reasoning: {
				effort: this.reasoningEffort as 'low' | 'medium' | 'high',
				summary: this.reasoningSummary as 'auto' | 'enabled' | 'disabled',
			},
		};

		if (this.conversationId) {
			documentChatRequest.conversation = {
				id: this.conversationId,
			};
		}

		if (request.temperature !== undefined) {
			documentChatRequest.temperature = request.temperature;
		}

		console.log('✅ Transformed request ready');
		return documentChatRequest;
	}

	/**
	 * Transform Document Chat response to OpenAI format
	 */
	private transformFromDocumentChatFormat(data: any): any {
		console.log('🔄 Transforming from Document Chat format');

		// Extract the response text
		const output = data.output || [];
		const messageOutput = output.find((item: any) => item.type === 'message');
		const contentText = messageOutput?.content?.[0]?.text || '';

		console.log('📝 Extracted content:', contentText.substring(0, 100) + '...');

		// Transform to OpenAI format
		const openAIFormat = {
			id: data.id || 'unknown',
			object: 'chat.completion',
			created: data.created_at || Math.floor(Date.now() / 1000),
			model: data.model || this.model,
			choices: [
				{
					index: 0,
					message: {
						role: 'assistant',
						content: contentText,
					},
					finish_reason: 'stop',
				},
			],
			usage: {
				prompt_tokens: data.usage?.input_tokens || 0,
				completion_tokens: data.usage?.output_tokens || 0,
				total_tokens: data.usage?.total_tokens || 0,
			},
		};

		console.log('✅ Transformed to OpenAI format');
		return openAIFormat;
	}

	/**
	 * Override invocationParams to add Document Chat specific parameters
	 */
	override invocationParams(options?: any): any {
		const params = super.invocationParams(options);
		console.log('📋 invocationParams called, returning params:', JSON.stringify(params, null, 2));
		return params;
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

		// Create tracing and failure handler
		const tracing = new N8nLlmTracing(this, {
			tokensUsageParser: documentChatTokensParser,
		});
		const failureHandler = makeN8nLlmFailedAttemptHandler(this);

		// Create Document Chat model (wraps ChatOpenAI)
		const chatModel = new UpstageDocumentChatModel({
			apiKey: credentials.apiKey as string,
			model: model,
			fileIds: fileIdArray,
			conversationId: conversationId || undefined,
			reasoningEffort: options.reasoningEffort || 'medium',
			reasoningSummary: options.reasoningSummary || 'auto',
			temperature: options.temperature,
			streaming: options.streaming || false,
			callbacks: tracing ? [tracing] : undefined,
			onFailedAttempt: failureHandler,
		});

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
