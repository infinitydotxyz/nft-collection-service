module.exports = {
  env: {
    commonjs: true,
    es6: true,
    node: true
  },
  parser: '@typescript-eslint/parser',
  plugins: ['promise', '@typescript-eslint'],
  overrides: [
    {
      files: ['*.ts', '*.tsx'], // Your TypeScript files extension

      // As mentioned in the comments, you should extend TypeScript plugins here,
      // instead of extending them outside the `overrides`.
      // If you don't want to extend any rules, you don't need an `extends` attribute.
      extends: [
        'plugin:@typescript-eslint/recommended',
        'plugin:@typescript-eslint/recommended-requiring-type-checking'
      ],

      parserOptions: {
        project: ['./tsconfig.json'] // Specify it only for TypeScript files
      }
    }
  ],
  extends: ['standard', 'standard-with-typescript', 'prettier'],
  globals: {
    Atomics: 'readonly',
    SharedArrayBuffer: 'readonly'
  },
  parserOptions: {
    ecmaVersion: 2020
  },
  rules: {
    'no-case-declarations': 0,
    '@typescript-eslint/strict-boolean-expressions': 0,
    '@typescript-eslint/no-unsafe-assignment': 0,
    'restrict-template-expressions': 0,
    '@typescript-eslint/restrict-template-expressions': 0,
    '@typescript-eslint/no-case-declarations': 0
  },
  ignorePatterns: ['/dist/**', '**/node_modules/**']
};
