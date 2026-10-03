import tseslint from "typescript-eslint";

export default [{
  files: ["src/**/*.ts", "tests/**/*.ts"],
  languageOptions: { parser: tseslint.parser },
  plugins: { "@typescript-eslint": tseslint.plugin },
  rules: { "@typescript-eslint/no-duplicate-enum-values": "error" },
}];
