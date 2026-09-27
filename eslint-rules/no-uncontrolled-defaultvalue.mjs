/**
 * Local ESLint rule: no-uncontrolled-defaultvalue
 *
 * Durable fix for #861: flags JSX input, select, or textarea elements that use
 * `defaultValue` (or `defaultChecked`) combined with a missing or no-op `onChange`
 * handler.
 *
 * Rationale: using `defaultValue` with no-op or missing state setters causes inputs
 * to behave as uncontrolled components, leading to silent state drift in settings forms.
 */

function isNoOpFunction(node) {
  if (!node) return true;

  // Arrow function expression or FunctionExpression
  if (node.type === 'ArrowFunctionExpression' || node.type === 'FunctionExpression') {
    const body = node.body;
    // () => {}
    if (body.type === 'BlockStatement' && body.body.length === 0) {
      return true;
    }
    // () => undefined or () => null or () => void 0
    if (
      body.type === 'Identifier' &&
      (body.name === 'undefined' || body.name === 'noop')
    ) {
      return true;
    }
    if (body.type === 'Literal' && body.value === null) {
      return true;
    }
    if (body.type === 'UnaryExpression' && body.operator === 'void') {
      return true;
    }
  }

  // Identifier like `noop`
  if (node.type === 'Identifier' && node.name === 'noop') {
    return true;
  }

  return false;
}

export const noUncontrolledDefaultValue = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow `defaultValue` or `defaultChecked` combined with a missing or no-op `onChange` handler in JSX form elements. See #861.',
    },
    messages: {
      noOpOnChange:
        'JSX element with `defaultValue`/`defaultChecked` has a no-op or missing state-updating `onChange` handler. Use a controlled `value` prop with an active state setter in `onChange`.',
    },
    schema: [],
  },
  create(context) {
    return {
      JSXOpeningElement(node) {
        const attributes = node.attributes;
        if (!attributes) return;

        let defaultValueAttr = null;
        let onChangeAttr = null;

        for (const attr of attributes) {
          if (attr.type !== 'JSXAttribute' || !attr.name) continue;
          const attrName = attr.name.name;
          if (attrName === 'defaultValue' || attrName === 'defaultChecked') {
            defaultValueAttr = attr;
          } else if (attrName === 'onChange') {
            onChangeAttr = attr;
          }
        }

        if (!defaultValueAttr) return;

        // If onChange is missing or is a no-op handler
        if (!onChangeAttr) {
          context.report({
            node: defaultValueAttr,
            messageId: 'noOpOnChange',
          });
          return;
        }

        // Check if onChange handler value is a no-op
        const value = onChangeAttr.value;
        if (value && value.type === 'JSXExpressionContainer') {
          const expression = value.expression;
          if (isNoOpFunction(expression)) {
            context.report({
              node: onChangeAttr,
              messageId: 'noOpOnChange',
            });
          }
        }
      },
    };
  },
};

export default noUncontrolledDefaultValue;
