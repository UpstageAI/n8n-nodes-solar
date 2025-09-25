import { ChatOpenAI } from '@langchain/openai';
import {
	type INodeType,
	type INodeTypeDescription,
	type ISupplyDataFunctions,
	type SupplyData,
	type ILoadOptionsFunctions,
	type INodePropertyOptions,
} from 'n8n-workflow';

import { N8nLlmTracing } from '../../utils/N8nLlmTracing';
import { makeN8nLlmFailedAttemptHandler } from '../../utils/n8nLlmFailedAttemptHandler';
import { getHttpProxyAgent } from '../../utils/httpProxyAgent';
import { getConnectionHintNoticeField } from '../../utils/sharedFields';

export class LmChatModelUpstage implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Solar Chat Model',
		name: 'lmChatModelUpstage',
		icon: 'file:upstage_v2.svg',
		group: ['transform'],
		version: 1,
		description: 'For advanced usage with an AI chain',
		defaults: {
			name: 'Solar Chat Model',
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
				description:
					'The model which will generate the completion. <a href="https://developers.upstage.ai/docs/apis/chat">Learn more</a>.',
				typeOptions: {
					loadOptions: {
						routing: {
							request: {
								method: 'GET',
								url: '/models',
							},
							output: {
								postReceive: [
									{
										type: 'rootProperty',
										properties: {
											property: 'data',
										},
									},
									{
										type: 'filter',
										properties: {
											pass: "={{ $responseItem && $responseItem.id && $responseItem.id.toLowerCase().includes('solar') }}",
										},
									},
									{
										type: 'setKeyValue',
										properties: {
											name: '={{ $responseItem.id }}',
											value: '={{ $responseItem.id }}',
										},
									},
									{
										type: 'sort',
										properties: {
											key: 'name',
										},
									},
								],
							},
						},
					},
				},
				routing: {
					send: {
						type: 'body',
						property: 'model',
					},
				},
				default: '',
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
						displayName: 'Maximum Number of Tokens',
						name: 'maxTokens',
						default: -1,
						description:
							'The maximum number of tokens to generate in the completion. Most models have a context length of 2048 tokens (except for the newest models, which support 32,768).',
						type: 'number',
						typeOptions: {
							maxValue: 32768,
						},
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

	methods = {
		loadOptions: {
			async getModels(
				this: ILoadOptionsFunctions
			): Promise<INodePropertyOptions[]> {
				const credentials = await this.getCredentials('upstageApi');
				const requestOptions = {
					method: 'GET' as const,
					headers: {
						Authorization: `Bearer ${credentials.apiKey}`,
						'Content-Type': 'application/json',
					},
				};

				try {
					const response = await this.helpers.request(
						'https://api.upstage.ai/v1/models',
						requestOptions
					);

					if (!response?.data || !Array.isArray(response.data)) {
						console.warn('Invalid response format from models API:', response);
						return [{ name: 'solar-mini', value: 'solar-mini' }];
					}

					// Filter for Solar models only, remove duplicates, and sort by version/date (latest first)
					const solarModels = response.data
						.filter((model: any) => model?.id?.toLowerCase().includes('solar'))
						.map((model: any) => ({
							name: model.id,
							value: model.id,
							...model,
						}))
						.filter(
							(model: any, index: number, self: any[]) =>
								self.findIndex(m => m.value === model.value) === index
						)
						.sort((a: any, b: any) => {
							const extractVersionInfo = (name: string) => {
								const dateMatch = name.match(/(\d{6})$/);
								if (dateMatch) {
									const dateStr = dateMatch[1];
									const year = 2000 + parseInt(dateStr.substring(0, 2));
									const month = parseInt(dateStr.substring(2, 4));
									const day = parseInt(dateStr.substring(4, 6));
									return {
										hasDate: true,
										date: new Date(year, month - 1, day).getTime(),
										name: name.replace(`-${dateStr}`, ''),
									};
								}

								const versionMatch = name.match(/v?(\d+)\.?(\d+)?/);
								if (versionMatch) {
									const major = parseInt(versionMatch[1]);
									const minor = parseInt(versionMatch[2] || '0');
									return {
										hasVersion: true,
										version: major * 1000 + minor,
										name: name.replace(versionMatch[0], ''),
									};
								}

								return { name };
							};

							const infoA = extractVersionInfo(a.name);
							const infoB = extractVersionInfo(b.name);

							if (infoA.hasDate && infoB.hasDate) {
								return infoB.date! - infoA.date!;
							}

							if (infoA.hasVersion && infoB.hasVersion) {
								return infoB.version! - infoA.version!;
							}

							if (
								(infoA.hasDate || infoA.hasVersion) &&
								!(infoB.hasDate || infoB.hasVersion)
							) {
								return -1;
							}
							if (
								(infoB.hasDate || infoB.hasVersion) &&
								!(infoA.hasDate || infoA.hasVersion)
							) {
								return 1;
							}

							if (infoA.name === infoB.name) {
								const getTierPriority = (name: string) => {
									if (name.includes('pro2')) return 4;
									if (name.includes('pro') && !name.includes('pro2')) return 3;
									if (name.includes('solar-1')) return 2;
									if (name.includes('mini')) return 1;
									return 0;
								};

								const priorityA = getTierPriority(a.name);
								const priorityB = getTierPriority(b.name);

								if (priorityA !== priorityB) {
									return priorityB - priorityA;
								}
							}

							return b.name.localeCompare(a.name);
						});

					if (solarModels.length === 0) {
						console.warn('No Solar models found in API response');
						return [{ name: 'solar-mini', value: 'solar-mini' }];
					}

					return solarModels;
				} catch (error) {
					console.error('Error fetching models:', error);
					return [{ name: 'solar-mini', value: 'solar-mini' }];
				}
			},
		},
	};

	async supplyData(
		this: ISupplyDataFunctions,
		itemIndex: number
	): Promise<SupplyData> {
		const credentials = await this.getCredentials('upstageApi');

		let modelName = this.getNodeParameter('model', itemIndex) as string;

		if (!modelName) {
			try {
				const requestOptions = {
					method: 'GET' as const,
					headers: {
						Authorization: `Bearer ${credentials.apiKey}`,
						'Content-Type': 'application/json',
					},
				};

				const response = await this.helpers.request(
					'https://api.upstage.ai/v1/models',
					requestOptions
				);

				if (response?.data && Array.isArray(response.data)) {
					const solarModels = response.data
						.filter((model: any) => model?.id?.toLowerCase().includes('solar'))
						.map((model: any) => model.id)
						.sort((a: string, b: string) => {
							const extractVersionInfo = (name: string) => {
								const dateMatch = name.match(/(\d{6})$/);
								if (dateMatch) {
									const dateStr = dateMatch[1];
									const year = 2000 + parseInt(dateStr.substring(0, 2));
									const month = parseInt(dateStr.substring(2, 4));
									const day = parseInt(dateStr.substring(4, 6));
									return {
										hasDate: true,
										date: new Date(year, month - 1, day).getTime(),
										name: name.replace(`-${dateStr}`, ''),
									};
								}

								const versionMatch = name.match(/v?(\d+)\.?(\d+)?/);
								if (versionMatch) {
									const major = parseInt(versionMatch[1]);
									const minor = parseInt(versionMatch[2] || '0');
									return {
										hasVersion: true,
										version: major * 1000 + minor,
										name: name.replace(versionMatch[0], ''),
									};
								}

								return { name };
							};

							const infoA = extractVersionInfo(a);
							const infoB = extractVersionInfo(b);

							if (infoA.hasDate && infoB.hasDate) {
								return infoB.date! - infoA.date!;
							}

							if (infoA.hasVersion && infoB.hasVersion) {
								return infoB.version! - infoA.version!;
							}

							if (
								(infoA.hasDate || infoA.hasVersion) &&
								!(infoB.hasDate || infoB.hasVersion)
							) {
								return -1;
							}
							if (
								(infoB.hasDate || infoB.hasVersion) &&
								!(infoA.hasDate || infoA.hasVersion)
							) {
								return 1;
							}

							if (infoA.name === infoB.name) {
								const getTierPriority = (name: string) => {
									if (name.includes('pro2')) return 4;
									if (name.includes('pro') && !name.includes('pro2')) return 3;
									if (name.includes('solar-1')) return 2;
									if (name.includes('mini')) return 1;
									return 0;
								};

								const priorityA = getTierPriority(a);
								const priorityB = getTierPriority(b);

								if (priorityA !== priorityB) {
									return priorityB - priorityA;
								}
							}

							return b.localeCompare(a);
						});

					if (solarModels.length > 0) {
						modelName = solarModels[0];
						console.log(`🔄 Auto-selected latest Solar model: ${modelName}`);
					}
				}
			} catch (error) {
				console.warn(
					'Failed to fetch models dynamically, using fallback:',
					error
				);
			}

			if (!modelName) {
				const fallbackModels = [
					'solar-pro2-preview',
					'solar-pro',
					'solar-mini',
				];
				modelName = fallbackModels[0];
				console.log(`🔄 Using fallback model: ${modelName}`);
			}
		}

		const options = this.getNodeParameter('options', itemIndex, {}) as {
			maxTokens?: number;
			temperature?: number;
			streaming?: boolean;
		};

		const modelKwargs = {};

		const configuration = {
			baseURL: 'https://api.upstage.ai/v1',
			httpAgent: getHttpProxyAgent(), // Use n8n's proxy agent when available
			defaultHeaders: {
				'Content-Type': 'application/json',
			},
		};

		const upstageTokensParser = (llmOutput: any) => {
			const usage = llmOutput?.tokenUsage || llmOutput?.usage;
			if (usage) {
				const completionTokens =
					usage.completion_tokens || usage.completionTokens || 0;
				const promptTokens = usage.prompt_tokens || usage.promptTokens || 0;
				const totalTokens =
					usage.total_tokens ||
					usage.totalTokens ||
					completionTokens + promptTokens;

				console.log('🔍 Solar LLM Token Usage:', {
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

			console.log(
				'⚠️ No token usage data found in Solar LLM response:',
				llmOutput
			);
			return {
				completionTokens: 0,
				promptTokens: 0,
				totalTokens: 0,
			};
		};

		// Create tracing and failure handler using our implementations
		const tracing = new N8nLlmTracing(this, {
			tokensUsageParser: upstageTokensParser,
		});
		const failureHandler = makeN8nLlmFailedAttemptHandler(this);

		const modelConfig: any = {
			apiKey: credentials.apiKey as string,
			model: modelName, // Use 'model' instead of 'modelName' for better API compatibility
			configuration,
			maxTokens: options.maxTokens,
			temperature: options.temperature,
			streaming: options.streaming || false,
		};

		// Add tracing callbacks if available (when installed in n8n core)
		if (tracing) {
			modelConfig.callbacks = [tracing];
		}

		// Add failure handler if available
		if (failureHandler) {
			modelConfig.onFailedAttempt = failureHandler;
		}

		const model = new ChatOpenAI(modelConfig);

		return {
			response: model,
		};
	}
}
