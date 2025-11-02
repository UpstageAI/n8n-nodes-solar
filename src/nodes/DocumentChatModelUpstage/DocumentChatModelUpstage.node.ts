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
import { getHttpProxyAgent } from '../../utils/httpProxyAgent';
import { getConnectionHintNoticeField } from '../../utils/sharedFields';

/**
 * Custom ChatOpenAI wrapper for Upstage Document Chat API
 * This extends ChatOpenAI to transform messages into Document Chat format
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
		// Call ChatOpenAI constructor with Document Chat API endpoint
		const httpAgent = getHttpProxyAgent();
		const configOptions: any = {
			baseURL: 'https://api.upstage.ai/v1/document-chat',
			defaultHeaders: {
				'Content-Type': 'application/json',
			},
		};
		if (httpAgent) {
			configOptions.httpAgent = httpAgent;
		}

		super({
			apiKey: config.apiKey,
			model: config.model,
			temperature: config.temperature,
			streaming: config.streaming || false,
			configuration: configOptions,
			callbacks: config.callbacks,
			onFailedAttempt: config.onFailedAttempt,
		});

		this.fileIds = config.fileIds;
		this.conversationId = config.conversationId;
		this.reasoningEffort = config.reasoningEffort;
		this.reasoningSummary = config.reasoningSummary;
	}

	/**
	 * Override to transform messages to Document Chat format
	 * This method is called by ChatOpenAI before making the API call
	 */
	override invocationParams(options?: any): any {
		const params = super.invocationParams(options);

		// Add Document Chat specific parameters
		return {
			...params,
			reasoning: {
				effort: this.reasoningEffort as 'low' | 'medium' | 'high',
				summary: this.reasoningSummary as 'auto' | 'enabled' | 'disabled',
			},
			...(this.conversationId && {
				conversation: {
					id: this.conversationId,
				},
			}),
		};
	}

	/**
	 * Override to transform messages into Document Chat input format
	 * This is called before sending to API
	 */
	override async _generate(
		messages: BaseMessage[],
		options: any,
		runManager?: any,
	): Promise<any> {
		// Extract query from last message
		const lastMessage = messages[messages.length - 1];
		let query = '';
		if (typeof lastMessage.content === 'string') {
			query = lastMessage.content;
		} else if (Array.isArray(lastMessage.content)) {
			const textContent = lastMessage.content.find(
				(c: any) => c.type === 'text' || typeof c === 'string'
			);
			query = typeof textContent === 'string'
				? textContent
				: (textContent as any)?.text || '';
		}

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

		// Create Document Chat formatted message
		const documentChatMessages = [
			{
				role: 'user' as const,
				content,
			},
		];

		// Replace messages with Document Chat format and call parent
		return super._generate(documentChatMessages as any, options, runManager);
	}

	/**
	 * Override streaming to use Document Chat format
	 */
	override async *_streamResponseChunks(
		messages: BaseMessage[],
		options: any,
		runManager?: any,
	): AsyncGenerator<any> {
		// Extract query from last message
		const lastMessage = messages[messages.length - 1];
		let query = '';
		if (typeof lastMessage.content === 'string') {
			query = lastMessage.content;
		} else if (Array.isArray(lastMessage.content)) {
			const contentArray = lastMessage.content as any[];
			const textContent = contentArray.find(
				(c: any) => c.type === 'text' || typeof c === 'string'
			);
			query = typeof textContent === 'string'
				? textContent
				: (textContent as any)?.text || '';
		}

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

		// Create Document Chat formatted message
		const documentChatMessages = [
			{
				role: 'user' as const,
				content,
			},
		];

		// Use parent's streaming with transformed messages
		yield* super._streamResponseChunks(documentChatMessages as any, options, runManager);
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
