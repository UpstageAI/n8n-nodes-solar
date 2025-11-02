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

// Custom chat model for Upstage Document Chat API
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

class UpstageDocumentChatModel extends BaseChatModel {
	private config: DocumentChatConfig;

	constructor(config: DocumentChatConfig, params?: BaseChatModelParams) {
		super(params || {});
		this.config = config;
	}

	_llmType(): string {
		return 'upstage-document-chat';
	}

	// Indicate that this model supports tool calling
	bindTools(_tools: any[], _kwargs?: any): this {
		// Document Chat doesn't directly support function calling,
		// but we need to return 'this' to satisfy the interface
		// The tools will be handled by the Agent framework
		return this;
	}

	// Implement streaming support
	async *_streamResponseChunks(
		messages: BaseMessage[],
		_options: this['ParsedCallOptions'],
		_runManager?: CallbackManagerForLLMRun,
	): AsyncGenerator<ChatGenerationChunk> {
		// Extract the user's query from the last message
		const lastMessage = messages[messages.length - 1];
		let query = '';
		if (typeof lastMessage.content === 'string') {
			query = lastMessage.content;
		} else if (Array.isArray(lastMessage.content)) {
			const textContent = lastMessage.content.find((c: any) => c.type === 'text' || typeof c === 'string');
			query = typeof textContent === 'string' ? textContent : (textContent as any)?.text || '';
		}

		// Build input with file references
		const inputFiles = this.config.fileIds.map((fileId: string) => ({
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

		// Build request body for Document Chat API with streaming enabled
		const requestBody: any = {
			model: this.config.model,
			stream: true, // Always use streaming in this method
			input: [
				{
					role: 'user',
					content,
				},
			],
			reasoning: {
				effort: this.config.reasoningEffort,
				summary: this.config.reasoningSummary,
			},
		};

		if (this.config.conversationId) {
			requestBody.conversation = {
				id: this.config.conversationId,
			};
		}

		if (this.config.temperature !== undefined) {
			requestBody.temperature = this.config.temperature;
		}

		// Make streaming API call
		const response = await fetch('https://api.upstage.ai/v1/document-chat/responses', {
			method: 'POST',
			headers: {
				'Authorization': `Bearer ${this.config.apiKey}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify(requestBody),
		});

		if (!response.ok) {
			const errorText = await response.text();
			throw new Error(`Document Chat API error: ${response.status} ${response.statusText} - ${errorText}`);
		}

		if (!response.body) {
			throw new Error('Response body is null');
		}

		// Stream the response chunks
		const reader = response.body.getReader();
		const decoder = new TextDecoder();

		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;

				const chunk = decoder.decode(value, { stream: true });
				const lines = chunk.split('\n');

				for (const line of lines) {
					if (!line.trim() || !line.startsWith('data: ')) continue;

					const jsonStr = line.slice(6);
					if (jsonStr === '[DONE]') continue;

					try {
						const data = JSON.parse(jsonStr);

						// Extract text from streaming chunk
						if (data.output && Array.isArray(data.output)) {
							const messageOutput = data.output.find((item: any) => item.type === 'message');
							if (messageOutput?.content?.[0]?.text) {
								const text = messageOutput.content[0].text;
								const chunk = new AIMessageChunk(text);

								// Yield proper ChatGenerationChunk
								yield new ChatGenerationChunk({
									text,
									message: chunk,
									generationInfo: {
										usage: data.usage,
										conversation_id: data.conversation?.id,
									},
								});
							}
						}
					} catch (e) {
						// Skip invalid JSON lines
						continue;
					}
				}
			}
		} finally {
			reader.releaseLock();
		}
	}

	async _generate(
		messages: BaseMessage[],
		_options: this['ParsedCallOptions'],
		_runManager?: CallbackManagerForLLMRun,
	): Promise<ChatResult> {
		// Extract the user's query from the last message
		const lastMessage = messages[messages.length - 1];
		let query = '';
		if (typeof lastMessage.content === 'string') {
			query = lastMessage.content;
		} else if (Array.isArray(lastMessage.content)) {
			const textContent = lastMessage.content.find((c: any) => c.type === 'text' || typeof c === 'string');
			query = typeof textContent === 'string' ? textContent : (textContent as any)?.text || '';
		}

		// Build input with file references
		const inputFiles = this.config.fileIds.map((fileId: string) => ({
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

		// Build request body for Document Chat API
		const requestBody: any = {
			model: this.config.model,
			stream: this.config.streaming || false,
			input: [
				{
					role: 'user',
					content,
				},
			],
			reasoning: {
				effort: this.config.reasoningEffort,
				summary: this.config.reasoningSummary,
			},
		};

		// Add conversation ID if specified
		if (this.config.conversationId) {
			requestBody.conversation = {
				id: this.config.conversationId,
			};
		}

		// Add temperature if specified
		if (this.config.temperature !== undefined) {
			requestBody.temperature = this.config.temperature;
		}

		// Make API call to Document Chat endpoint
		try {
			const response = await fetch('https://api.upstage.ai/v1/document-chat/responses', {
				method: 'POST',
				headers: {
					'Authorization': `Bearer ${this.config.apiKey}`,
					'Content-Type': 'application/json',
				},
				body: JSON.stringify(requestBody),
			});

			if (!response.ok) {
				const errorText = await response.text();
				throw new Error(`Document Chat API error: ${response.status} ${response.statusText} - ${errorText}`);
			}

			// Handle streaming response
			if (this.config.streaming && response.body) {
				let fullText = '';
				let conversationId = '';
				let usage: any = null;

				const reader = response.body.getReader();
				const decoder = new TextDecoder();

				while (true) {
					const { done, value } = await reader.read();
					if (done) break;

					const chunk = decoder.decode(value, { stream: true });
					const lines = chunk.split('\n');

					for (const line of lines) {
						if (!line.trim() || !line.startsWith('data: ')) continue;

						const jsonStr = line.slice(6); // Remove 'data: ' prefix
						if (jsonStr === '[DONE]') continue;

						try {
							const data = JSON.parse(jsonStr);

							// Extract text from streaming chunks
							if (data.output && Array.isArray(data.output)) {
								const messageOutput = data.output.find((item: any) => item.type === 'message');
								if (messageOutput?.content?.[0]?.text) {
									fullText += messageOutput.content[0].text;
								}
							}

							// Collect metadata
							if (data.conversation?.id) {
								conversationId = data.conversation.id;
							}
							if (data.usage) {
								usage = data.usage;
							}
						} catch (e) {
							// Skip invalid JSON lines
							continue;
						}
					}
				}

				const aiMessage = new AIMessage(fullText);
				return {
					generations: [
						{
							text: fullText,
							message: aiMessage,
						},
					],
					llmOutput: {
						usage,
						conversation_id: conversationId,
					},
				};
			}

			// Handle non-streaming response
			const data = await response.json();

			// Extract the response text - matching DocumentChatUpstage.node.ts format
			const output = data.output || [];
			const messageOutput = output.find((item: any) => item.type === 'message');
			const contentText = messageOutput?.content?.[0]?.text || '';

			// Create AI message
			const aiMessage = new AIMessage(contentText);

			// Return in LangChain format
			return {
				generations: [
					{
						text: contentText,
						message: aiMessage,
					},
				],
				llmOutput: {
					usage: data.usage,
					conversation_id: data.conversation?.id,
				},
			};
		} catch (error: any) {
			throw new Error(`Failed to call Document Chat API: ${error.message}`);
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
			const usage = llmOutput?.usage;
			if (usage) {
				const completionTokens = usage.output_tokens || 0;
				const promptTokens = usage.input_tokens || 0;
				const totalTokens = usage.total_tokens || completionTokens + promptTokens;

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
			model: model, // 'genius' or 'turbo'
			fileIds: fileIdArray,
			conversationId: conversationId || undefined,
			reasoningEffort: options.reasoningEffort || 'medium',
			reasoningSummary: options.reasoningSummary || 'auto',
			temperature: options.temperature,
			streaming: options.streaming || false,
		};

		// Build LangChain model params
		const modelParams: BaseChatModelParams = {};

		// Add tracing callbacks if available
		if (tracing) {
			modelParams.callbacks = [tracing];
		}

		// Create custom Document Chat model instance
		const chatModel = new UpstageDocumentChatModel(documentChatConfig, modelParams);

		console.log(`✅ Document Chat Model initialized with ${fileIdArray.length} file(s)`);
		console.log(`📄 File IDs: ${fileIdArray.join(', ')}`);
		if (conversationId) {
			console.log(`💬 Continuing conversation: ${conversationId}`);
		}

		return {
			response: chatModel,
		};
	}
}
