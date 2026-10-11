const { getDefaultConfig } = require('expo/metro-config');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// Ignore Gradle build artifacts to prevent ENOENT errors on Windows
config.resolver.blockList = [
  /.*\/node_modules\/.*\/build\/.*/,
  /.*\/android\/build\/.*/,
];

module.exports = config;
