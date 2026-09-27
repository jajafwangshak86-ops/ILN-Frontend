import { describe, expect, it, vi } from 'vitest';
import { noUncontrolledDefaultValue } from '../eslint-rules/no-uncontrolled-defaultvalue.mjs';

describe('no-uncontrolled-defaultvalue ESLint rule', () => {
  function runRule(attributes: any[]) {
    const reports: any[] = [];
    const context = {
      report: (reportObj: any) => reports.push(reportObj),
    };

    const visitor = noUncontrolledDefaultValue.create(context as any);
    const node = { attributes };
    visitor.JSXOpeningElement(node as any);

    return reports;
  }

  it('reports when defaultValue is present with missing onChange', () => {
    const attributes = [
      {
        type: 'JSXAttribute',
        name: { name: 'defaultValue' },
        value: { type: 'Literal', value: 'test' },
      },
    ];

    const reports = runRule(attributes);
    expect(reports).toHaveLength(1);
    expect(reports[0].messageId).toBe('noOpOnChange');
  });

  it('reports when defaultValue is present with no-op arrow function onChange', () => {
    const attributes = [
      {
        type: 'JSXAttribute',
        name: { name: 'defaultValue' },
        value: { type: 'Literal', value: 'test' },
      },
      {
        type: 'JSXAttribute',
        name: { name: 'onChange' },
        value: {
          type: 'JSXExpressionContainer',
          expression: {
            type: 'ArrowFunctionExpression',
            body: { type: 'BlockStatement', body: [] },
          },
        },
      },
    ];

    const reports = runRule(attributes);
    expect(reports).toHaveLength(1);
    expect(reports[0].messageId).toBe('noOpOnChange');
  });

  it('does not report when controlled value is used with active onChange', () => {
    const attributes = [
      {
        type: 'JSXAttribute',
        name: { name: 'value' },
        value: { type: 'Literal', value: 'test' },
      },
      {
        type: 'JSXAttribute',
        name: { name: 'onChange' },
        value: {
          type: 'JSXExpressionContainer',
          expression: {
            type: 'ArrowFunctionExpression',
            body: {
              type: 'CallExpression',
              callee: { name: 'setValue' },
            },
          },
        },
      },
    ];

    const reports = runRule(attributes);
    expect(reports).toHaveLength(0);
  });
});
