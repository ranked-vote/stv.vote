import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig, createLogger } from 'vite';

// Create custom logger that filters out noisy warnings
const logger = createLogger();
const originalWarn = logger.warn.bind(logger);
logger.warn = (msg, options) => {
	// Suppress @__PURE__ annotation and sourcemap warnings
	if (msg.includes('@__PURE__') || msg.includes("Can't resolve original location")) {
		return;
	}
	originalWarn(msg, options);
};

// Rollup warning suppression for @__PURE__ annotations and sourcemap issues
const onwarn = (warning, warn) => {
	// Suppress @__PURE__ annotation warnings from Svelte compiled output
	if (warning.message?.includes('@__PURE__')) {
		return;
	}
	// Suppress sourcemap resolution errors
	if (warning.message?.includes("Can't resolve original location")) {
		return;
	}
	warn(warning);
};

export default defineConfig({
	plugins: [sveltekit()],
	customLogger: logger,
	server: {
		port: 3000
	},
	build: {
		rollupOptions: {
			onwarn
		}
	}
});

