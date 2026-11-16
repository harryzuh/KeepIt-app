import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'node_modules'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { plugins: { 'react-hooks': reactHooks }, rules: reactHooks.configs.recommended.rules },
  {
    // Sem HTML injetado nem eval: toda saída de texto do usuário passa pelo escape do React.
    rules: {
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-restricted-syntax': [
        'error',
        { selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']", message: 'Proibido: use texto escapado pelo React.' },
        { selector: "AssignmentExpression[left.property.name=/^(innerHTML|outerHTML)$/]", message: 'Proibido atribuir innerHTML/outerHTML.' },
      ],
    },
  },
);
