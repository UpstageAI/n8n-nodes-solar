import { ChatOpenAI } from '@langchain/openai';
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
		// Note: We're extending ChatOpenAI but customizing for Document Chat API
		const modelConfig: any = {
			apiKey: credentials.apiKey as string,
			model, // 'genius' or 'turbo'
			configuration,
			temperature: options.temperature,
			streaming: options.streaming || false,
			// Store file IDs and conversation settings for use in API calls
			modelKwargs: {
				fileIds: fileIdArray,
				conversationId: conversationId || undefined,
				reasoning: {
					effort: options.reasoningEffort || 'medium',
					summary: options.reasoningSummary || 'auto',
				},
			},
		};

		// Add tracing callbacks if available
		if (tracing) {
			modelConfig.callbacks = [tracing];
		}

		// Add failure handler if available
		if (failureHandler) {
			modelConfig.onFailedAttempt = failureHandler;
		}

		// Create a custom ChatOpenAI instance that uses Document Chat API
		// We configure it to use solar models through Upstage's OpenAI-compatible endpoint
		const chatModel = new ChatOpenAI(modelConfig);

		// Store file context in a way the model can access it
		// We'll inject this into the system message for each request
		const documentContext = `[Document Chat Context: This conversation references ${fileIdArray.length} uploaded document(s) with IDs: ${fileIdArray.join(', ')}]`;

		// Override _llmType to identify this as Document Chat
		Object.defineProperty(chatModel, '_llmType', {
			value: () => 'upstage-document-chat',
			writable: false,
		});

		// Store metadata about document chat configuration
		(chatModel as any).documentChatConfig = {
			fileIds: fileIdArray,
			conversationId: conversationId || undefined,
			reasoning: {
				effort: options.reasoningEffort || 'medium',
				summary: options.reasoningSummary || 'auto',
			},
			documentContext,
		};

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
