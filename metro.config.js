const { getSentryExpoConfig } = require("@sentry/react-native/metro");
const path = require('path');
const fs = require('fs');
const { resolve: metroResolve } = require('metro-resolver');

const config = getSentryExpoConfig(__dirname);

function escapeForRegExp(value) {
	return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildIgnoredDirPattern(dirPath) {
	return new RegExp(`^${escapeForRegExp(path.resolve(dirPath))}(?:[\\\\/].*)?$`);
}

config.resolver = config.resolver || {};
config.resolver.blockList = [
	buildIgnoredDirPattern(path.join(__dirname, 'public', '_expo')),
	buildIgnoredDirPattern(path.join(__dirname, 'public', 'assets')),
	buildIgnoredDirPattern(path.join(__dirname, 'public', 'dashboard', 'assets')),
	buildIgnoredDirPattern(path.join(__dirname, 'web-dist')),
	buildIgnoredDirPattern(path.join(__dirname, 'dist', 'assets')),
];

// Firebase Auth fix (Expo SDK 54 / Metro):
// Ensure package `exports` resolution includes the `react-native` condition so
// `@firebase/auth` resolves to its RN build (which calls registerAuth(...)).
// Without this, some production bundles can throw:
//   "Component auth has not been registered yet"
config.resolver.unstable_enablePackageExports = true;

const existingConditions = Array.isArray(config.resolver.unstable_conditionNames)
	? config.resolver.unstable_conditionNames
	: [];
const neededConditions = ['react-native', 'browser', 'default'];
config.resolver.unstable_conditionNames = Array.from(
	new Set([...neededConditions, ...existingConditions])
);

// Deterministic alias: Firebase's `firebase/auth` re-exports from `@firebase/auth`.
// In some Metro/export-resolution combinations, the non-RN build is selected and
// Auth never registers its component, causing:
//   "Component auth has not been registered yet"
// Force `@firebase/auth` and `@firebase/auth/internal` to the RN build shipped
// within the `firebase` package.
function firstExistingPath(candidates) {
	for (const candidate of candidates) {
		if (fs.existsSync(candidate)) return candidate;
	}
	return null;
}

function firebaseAuthDistPath(...segments) {
	return firstExistingPath([
		path.join(__dirname, 'node_modules', 'firebase', 'node_modules', '@firebase', 'auth', 'dist', ...segments),
		path.join(__dirname, 'node_modules', '@firebase', 'auth', 'dist', ...segments),
	]);
}

const RN_AUTH_ENTRY = firebaseAuthDistPath('rn', 'index.js');
const RN_AUTH_INTERNAL_ENTRY = firebaseAuthDistPath('rn', 'internal.js');
const WEB_AUTH_ENTRY = firebaseAuthDistPath('esm2017', 'index.js');
const WEB_AUTH_INTERNAL_ENTRY = firebaseAuthDistPath('esm2017', 'internal.js');

config.resolver.resolveRequest = (context, moduleName, platform) => {
	try {
		const isNative = platform === 'ios' || platform === 'android';
		const isWeb = platform === 'web';

		// Force Firebase Auth public entrypoints to the React Native build.
		// Firebase 10.x does not export `firebase/auth/react-native`, and the default
		// `firebase/auth` export chain can select the web build in some Metro setups.
		// This mapping ensures Auth registers its component on native.
		if (isNative && moduleName === 'firebase/auth' && RN_AUTH_ENTRY) {
			return { type: 'sourceFile', filePath: RN_AUTH_ENTRY };
		}
		if (isNative && moduleName === 'firebase/auth/internal' && RN_AUTH_INTERNAL_ENTRY) {
			return { type: 'sourceFile', filePath: RN_AUTH_INTERNAL_ENTRY };
		}

		// Web bundles must NOT use the RN auth build. Because we enable the
		// `react-native` condition for native correctness, some Metro/export
		// combinations can accidentally pick RN exports even for platform=web.
		if (isWeb && moduleName === 'firebase/auth' && WEB_AUTH_ENTRY) {
			return { type: 'sourceFile', filePath: WEB_AUTH_ENTRY };
		}
		if (isWeb && moduleName === 'firebase/auth/internal' && WEB_AUTH_INTERNAL_ENTRY) {
			return { type: 'sourceFile', filePath: WEB_AUTH_INTERNAL_ENTRY };
		}

		// Force @firebase/auth to the appropriate build:
		// - native (iOS/Android): RN build (registers Auth component)
		// - everything else (web/export/etc): web ESM build
		if (moduleName === '@firebase/auth') {
			if (isNative && RN_AUTH_ENTRY) {
				return { type: 'sourceFile', filePath: RN_AUTH_ENTRY };
			}
			if (WEB_AUTH_ENTRY) {
				return { type: 'sourceFile', filePath: WEB_AUTH_ENTRY };
			}
		}
		if (moduleName === '@firebase/auth/internal') {
			if (isNative && RN_AUTH_INTERNAL_ENTRY) {
				return { type: 'sourceFile', filePath: RN_AUTH_INTERNAL_ENTRY };
			}
			if (WEB_AUTH_INTERNAL_ENTRY) {
				return { type: 'sourceFile', filePath: WEB_AUTH_INTERNAL_ENTRY };
			}
		}
	} catch (_) {
		// fall through to default resolver
	}
	// Important: pass `resolveRequest: null` to ensure the default resolver does
	// not bounce back into this custom resolver (which can cause recursion in
	// some Expo/Metro resolver compositions).
	return metroResolve(Object.freeze({ ...context, resolveRequest: null }), moduleName, platform);
};

module.exports = config;
