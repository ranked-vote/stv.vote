import js from "@eslint/js";
import svelte from "eslint-plugin-svelte";
import globals from "globals";
import ts from "typescript-eslint";

export default ts.config(
	js.configs.recommended,
	...ts.configs.recommended,
	...svelte.configs["flat/recommended"],
	{
		languageOptions: {
			globals: {
				...globals.browser,
				...globals.node,
			},
		},
	},
	{
		files: ["**/*.svelte", "**/*.svelte.ts", "**/*.svelte.js"],
		languageOptions: {
			parserOptions: {
				parser: ts.parser,
				extraFileExtensions: [".svelte"],
			},
		},
	},
	{
		rules: {
			// Allow unused vars prefixed with underscore
			"@typescript-eslint/no-unused-vars": [
				"error",
				{
					argsIgnorePattern: "^_",
					varsIgnorePattern: "^_",
				},
			],
			// Svelte 5 uses $state, $derived, etc. which look like unused expressions
			"no-unused-expressions": "off",
			"@typescript-eslint/no-unused-expressions": "off",
		},
	},
	{
		files: ["**/*.test.mjs", "**/*.test.js", "**/*.spec.mjs", "**/*.spec.js"],
		languageOptions: {
			globals: {
				...globals.jest,
				...globals.node,
			},
		},
	},
	{
		ignores: [
			"build/",
			".svelte-kit/",
			".svelte-kit-build/",
			"node_modules/",
			".trunk/",
			"static/",
		],
	},
);
