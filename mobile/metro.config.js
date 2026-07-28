const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

// Monorepo (npm workspaces): sem isso o Metro fica ambíguo sobre qual é a raiz
// do projeto (mobile/ vs a raiz do monorepo), e coisas como a substituição de
// EXPO_ROUTER_APP_ROOT no build do expo-router quebram.
// https://docs.expo.dev/guides/monorepos/
const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

module.exports = config;
