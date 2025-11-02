import { ChatOpenAI } from '@langchain/openai';
import type { BaseChatModelParams } from '@langchain/core/language_models/chat_models';
import type { BaseMessage } from '@langchain/core/messages';
import { AIMessage } from '@langchain/core/messages';
import type { ChatResult } from '@langchain/core/outputs';
import type { CallbackManagerForLLMRun } from '@langchain/core/callbacks/manager';
import {
	type INodeType,
	type INodeTypeDescription,
	type ISupplyDataFunctions,
	type SupplyData,
} from 'n8n-workflow';

import { N8nLlmTracing } from '../../utils/N8nLlmTracing';
import { makeN8nLlmFailedAttemptHandler } from '../../utils/n8nLlmFailedAttemptHandler';
import { getHttpProxyAgent } from '../../utils/httpProxyAgent';
import { getConnectionHintNoticeField } from '../../utils/sharedFields';

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

		// Document Chat API doesn't use OpenAI-compatible endpoints
		// We override _generate to call the Document Chat API directly
		const configuration = {
			baseURL: 'https://api.upstage.ai/v1/document-chat',
			httpAgent: getHttpProxyAgent(),
			defaultHeaders: {
				'Content-Type': 'application/json',
			},
		};

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

		// Create tracing and failure handler
		const tracing = new N8nLlmTracing(this, {
			tokensUsageParser: documentChatTokensParser,
		});
		const failureHandler = makeN8nLlmFailedAttemptHandler(this);

		// Build model configuration
		// Use the actual Document Chat model name selected by user
		const modelConfig: any = {
			apiKey: credentials.apiKey as string,
			model: model, // Use 'genius' or 'turbo' directly
			configuration,
			temperature: options.temperature,
			streaming: options.streaming || false,
			// Don't use modelKwargs - it gets sent in API requests!
		};

		// Add tracing callbacks if available
		if (tracing) {
			modelConfig.callbacks = [tracing];
		}

		// Add failure handler if available
		if (failureHandler) {
			modelConfig.onFailedAttempt = failureHandler;
		}

		// Create a custom ChatOpenAI instance
		const chatModel = new ChatOpenAI(modelConfig);

		// Store Document Chat configuration directly on the instance
		// (not in modelKwargs, which gets sent to API)
		(chatModel as any).documentChatConfig = {
			actualModel: model, // 'genius' or 'turbo'
			fileIds: fileIdArray,
			conversationId: conversationId || undefined,
			reasoningEffort: options.reasoningEffort || 'medium',
			reasoningSummary: options.reasoningSummary || 'auto',
			apiKey: credentials.apiKey as string,
		};

		// Override _generate to use Document Chat API instead of OpenAI API
		const originalGenerate = chatModel._generate.bind(chatModel);
		chatModel._generate = async function(
			messages: BaseMessage[],
			_options: any,
			_runManager?: CallbackManagerForLLMRun
		): Promise<ChatResult> {
			// Get Document Chat configuration
			const config = (this as any).documentChatConfig;
			if (!config) {
				throw new Error('Document Chat configuration not found');
			}

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
			const inputFiles = config.fileIds.map((fileId: string) => ({
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
				model: config.actualModel, // Use 'genius' or 'turbo'
				stream: false, // Disable streaming for now
				input: [
					{
						role: 'user',
						content,
					},
				],
			};

			// Add reasoning configuration
			requestBody.reasoning = {
				effort: config.reasoningEffort,
				summary: config.reasoningSummary,
			};

			// Add conversation ID if specified
			if (config.conversationId) {
				requestBody.conversation = {
					id: config.conversationId,
				};
			}

			// Make API call to Document Chat endpoint
			try {
				const response = await fetch('https://api.upstage.ai/v1/document-chat/responses', {
					method: 'POST',
					headers: {
						'Authorization': `Bearer ${config.apiKey}`,
						'Content-Type': 'application/json',
					},
					body: JSON.stringify(requestBody),
				});

				if (!response.ok) {
					const errorText = await response.text();
					throw new Error(`Document Chat API error (${response.status}): ${errorText}`);
				}

				const data = await response.json();

				// Extract content from Document Chat response
				const output = data.output || [];
				const messageOutput = output.find((item: any) => item.type === 'message');
				const contentText = messageOutput?.content?.[0]?.text || '';
				const citations = messageOutput?.content?.[0]?.annotations || [];

				// Create AIMessage with proper structure
				const aiMessage = new AIMessage({
					content: contentText,
					additional_kwargs: {
						conversation_id: data.conversation?.id,
						citations,
					},
				});

				// Return in LangChain ChatResult format
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
			} catch (error) {
				console.error('🚫 Document Chat Model Error:', error);
				throw error;
			}
		};

		// Override _llmType to identify this as Document Chat
		Object.defineProperty(chatModel, '_llmType', {
			value: () => 'upstage-document-chat',
			writable: false,
		});

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
