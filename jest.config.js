module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/*.{test,spec}.{ts,tsx}'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
  moduleNameMapper: {
    '^expo-sqlite$': '<rootDir>/src/test/__mocks__/expo-sqlite.ts',
    '^expo-file-system/legacy$': '<rootDir>/src/test/__mocks__/expo-file-system.ts',
    '^expo-file-system$': '<rootDir>/src/test/__mocks__/expo-file-system.ts',
    '^llama\\.rn$': '<rootDir>/src/test/__mocks__/llama.rn.ts',
  },
};
