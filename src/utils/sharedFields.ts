import type { INodeProperties } from 'n8n-workflow';
import { NodeConnectionType } from 'n8n-workflow';

/**
 * Get the connection hint field for a node
 */
export function getConnectionHintNoticeField(
	allowedConnectionTypes: NodeConnectionType[]
): INodeProperties {
	const connectionTypes = allowedConnectionTypes
		.map(type => {
			switch (type) {
				case 'ai_agent':
					return 'AI Agent';
				case 'ai_chain':
					return 'AI Chain';
				case 'ai_document':
					return 'AI Document';
				case 'ai_embedding':
					return 'AI Embedding';
				case 'ai_languageModel':
					return 'AI Language Model';
				case 'ai_memory':
					return 'AI Memory';
				case 'ai_outputParser':
					return 'AI Output Parser';
				case 'ai_retriever':
					return 'AI Retriever';
				case 'ai_textSplitter':
					return 'AI Text Splitter';
				case 'ai_tool':
					return 'AI Tool';
				case 'ai_vectorStore':
					return 'AI Vector Store';
				default:
					return type;
			}
		})
		.join(', ');

	return {
		displayName: '',
		name: 'notice',
		type: 'notice',
		default: '',
		description: `Connect this node to: ${connectionTypes}`,
	};
}
