#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');

function removeDirIfExists(dir) {
  if (!fs.existsSync(dir)) return;
  fs.rmSync(dir, { recursive: true, force: true });
}

function clearGeneratedWebArtifacts() {
  removeDirIfExists(path.join(root, 'web-dist'));
  removeDirIfExists(path.join(root, 'public', '_expo'));
  removeDirIfExists(path.join(root, 'public', 'assets'));
  removeDirIfExists(path.join(root, 'public', 'home'));
  removeDirIfExists(path.join(root, 'public', 'dashboard'));
}

function usage() {
  console.log(`Usage: node ./scripts/eas-update.js [--channel <name>] [--platform <ios|android|all>] [--message <text>] [--input-dir <dir>] [--skip-fingerprint]

Publishes an EAS Update without requiring bash.

Examples:
  node ./scripts/eas-update.js --channel preview --message "Testing ready"
  node ./scripts/eas-update.js --channel production --platform ios`);
}

function parseArgs(argv) {
  const options = {
    channel: 'preview',
    platform: 'all',
    message: '',
    inputDir: 'dist',
    skipFingerprint: false,
  };

  for (let index = 0; index < argv.length; ) {
    const arg = argv[index];

    switch (arg) {
      case '--channel':
      case '-c':
        if (index + 1 >= argv.length) {
          throw new Error('--channel requires a value');
        }
        options.channel = argv[index + 1];
        index += 2;
        break;
      case '--platform':
      case '-p':
        if (index + 1 >= argv.length) {
          throw new Error('--platform requires a value');
        }
        options.platform = argv[index + 1];
        index += 2;
        break;
      case '--message':
      case '-m': {
        if (index + 1 >= argv.length) {
          throw new Error('--message requires a value');
        }
        const parts = [argv[index + 1]];
        index += 2;
        while (index < argv.length && !argv[index].startsWith('-')) {
          parts.push(argv[index]);
          index += 1;
        }
        options.message = parts.join(' ');
        break;
      }
      case '--input-dir':
        if (index + 1 >= argv.length) {
          throw new Error('--input-dir requires a value');
        }
        options.inputDir = argv[index + 1];
        index += 2;
        break;
      case '--skip-fingerprint':
        options.skipFingerprint = true;
        index += 1;
        break;
      case '--help':
      case '-h':
        usage();
        process.exit(0);
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!['ios', 'android', 'all'].includes(options.platform)) {
    throw new Error('--platform must be one of: ios, android, all');
  }

  return options;
}

function getNpmCliArgs(commandArgs) {
  if (process.env.npm_execpath) {
    return [process.execPath, [process.env.npm_execpath, 'exec', '--', ...commandArgs]];
  }

  if (process.platform === 'win32') {
    return ['npm.cmd', ['exec', '--', ...commandArgs]];
  }

  return ['npm', ['exec', '--', ...commandArgs]];
}

function run(commandArgs, extraEnv) {
  const [command, args] = getNpmCliArgs(commandArgs);
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    shell: false,
    windowsHide: true,
    env: {
      ...process.env,
      ...extraEnv,
    },
  });

  if (typeof result.status === 'number' && result.status !== 0) {
    process.exit(result.status);
  }

  if (result.error) {
    throw result.error;
  }
}

function getLatestGitSubject() {
  const insideRepo = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], {
    cwd: root,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
  });

  if (insideRepo.status !== 0) {
    return '';
  }

  const subject = spawnSync('git', ['log', '-1', '--pretty=%s'], {
    cwd: root,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
  });

  return subject.status === 0 ? subject.stdout.trim() : '';
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const inputDir = path.resolve(root, options.inputDir);
  const inputDirArg = options.inputDir;
  const message = options.message || getLatestGitSubject() || `EAS-update-${options.platform}`;
  const env = { CI: '1' };

  if (options.skipFingerprint) {
    env.EAS_SKIP_AUTO_FINGERPRINT = '1';
  }

  clearGeneratedWebArtifacts();
  fs.rmSync(inputDir, { recursive: true, force: true });
  fs.mkdirSync(inputDir, { recursive: true });

  run(
    [
      'expo',
      'export',
      '--output-dir',
      inputDirArg,
      '--platform',
      options.platform,
      '--no-bytecode',
      '--dump-assetmap',
      '--source-maps',
    ],
    env
  );

  run(
    [
      'eas',
      'update',
      '--channel',
      options.channel,
      '-p',
      options.platform,
      '--skip-bundler',
      '--input-dir',
      inputDirArg,
      '-m',
      message,
    ],
    env
  );
}

try {
  main();
} catch (error) {
  console.error(error.message || error);
  process.exit(1);
}