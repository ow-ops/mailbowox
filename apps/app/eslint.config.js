// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*'],
  },
  {
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'react-native',
              importNames: ['LayoutAnimation'],
              message: "Crashes iOS alongside Reanimated's layout animations; use Reanimated's entering, exiting and layout props.",
            },
          ],
        },
      ],
    },
  },
]);
