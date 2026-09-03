import { sxzz } from '@sxzz/eslint-config'

export default sxzz().append({
  rules: {
    '@typescript-eslint/no-redeclare': 'off',
    // The TypeScript content-mapper protocol spells these values `utf-8`.
    'unicorn/text-encoding-identifier-case': 'off',
  },
})
