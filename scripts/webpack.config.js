/**
 * Webpack config for building the library for npm consumption.
 * Builds JSX and dependencies into build/index.js so consumers don't need to transpile.
 * Peer deps (React, @wordpress/*) are external; other deps (MCP SDK, zod, etc.) are bundled.
 * @see https://github.com/WordPress/gutenberg/tree/master/packages/scripts#extending-the-webpack-config
 */
const path = require('path');
const wpScriptsConfig = require('@wordpress/scripts/config/webpack.config');

// Build as a consumable library (CommonJS).
wpScriptsConfig.output = {
	...wpScriptsConfig.output,
	path: path.resolve(process.cwd(), 'build'),
	filename: 'index.js',
	library: {
		type: 'commonjs2',
	},
};

// Externalize peer deps so the consumer supplies React and @wordpress/*.
wpScriptsConfig.externals = {
	react: 'react',
	'react-dom': 'react-dom',
	'@wordpress/element': '@wordpress/element',
	'@wordpress/data': '@wordpress/data',
	'@wordpress/i18n': '@wordpress/i18n',
	'@wordpress/components': '@wordpress/components',
	'@wordpress/api-fetch': '@wordpress/api-fetch',
};

module.exports = wpScriptsConfig;
