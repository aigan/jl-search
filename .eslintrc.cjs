module.exports = {
  "env": {
      "browser": true,
      "es2021": true
  },
  "extends": "eslint:recommended",
  "plugins": ["html"],
  "overrides": [
      {
          "env": {
              "node": true
          },
          "files": [
              ".eslintrc.cjs"
          ],
          "parserOptions": {
              "sourceType": "script"
          }
      }
  ],
  "parserOptions": {
      "ecmaVersion": "latest",
      "sourceType": "module"
  },
  "rules": {
      "no-unused-vars": ["error", { "args": "none" }]
  }
}
