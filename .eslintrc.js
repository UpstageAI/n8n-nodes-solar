module.exports = {
	parser: '@typescript-eslint/parser',
	parserOptions: {
		ecmaVersion: 2020,
		sourceType: 'module',
	},
	plugins: ['@typescript-eslint', 'prettier'],
	extends: ['eslint:recommended', 'prettier', 'plugin:prettier/recommended'],
	env: {
		node: true,
		es6: true,
	},
	rules: {
		// General rules
		'no-console': 'warn',
		'no-debugger': 'error',
		'no-unused-vars': 'off', // Use TypeScript version
		'prefer-const': 'off', // Use TypeScript version
		'no-var': 'error',

		// TypeScript rules
		'@typescript-eslint/no-unused-vars': 'warn',
		'@typescript-eslint/no-explicit-any': 'warn',

		// Prettier integration
		'prettier/prettier': 'error',

		// n8n community package specific rules
		'no-restricted-imports': 'off',
		'no-restricted-globals': 'off',
		'n8n-nodes-base/node-dirname-against-convention': 'off',
		'n8n-nodes-base/node-class-description-name-miscased': 'off',
		'n8n-nodes-base/node-class-description-inputs-wrong-regular-node': 'off',
		'n8n-nodes-base/node-class-description-outputs-wrong': 'off',
	},
	ignorePatterns: ['node_modules/', 'dist/', '*.js', '!.eslintrc.js'],
};
