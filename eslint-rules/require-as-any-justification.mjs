/**
 * Local ESLint rule: require-as-any-justification
 *
 * Durable fix for #911: every bare `as any` cast must carry a justification
 * comment on the immediately preceding line (or the same line before the
 * `as` keyword). The comment must explain the specific type-system limitation
 * the cast works around and, where applicable, link the upstream
 * issue/type-definition gap.
 *
 * Rationale: bare `as any` escapes silently accumulate (see #908/#909/#910).
 * Forcing a written justification makes each new escape a deliberate,
 * reviewable decision and keeps the inventory from growing back.
 *
 * Accepted shapes:
 *
 * ```ts
 * // as-any justification: @stellar/freighter-api lacks types for the
 * // experimental addTrustline method. Remove once upstream types land.
 * // See https://github.com/stellar/freighter/issues/...
 * await (freighter as any).addTrustline?.({...});
 * ```
 *
 * An `eslint-disable-next-line` comment for this rule also satisfies the
 * check, but a plain justification comment is preferred so the reason stays
 * visible in the code rather than hidden in a disable directive.
 */

function isAnyKeyword(typeAnnotation) {
  return !!typeAnnotation && typeAnnotation.type === 'TSAnyKeyword';
}

export const requireAsAnyJustification = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Require a justification comment immediately preceding any `as any` cast. See CONTRIBUTING.md.',
    },
    messages: {
      missingJustification:
        '`as any` cast requires a justification comment on the immediately preceding line explaining the type-system limitation it works around (and a link to the upstream issue/type gap where one exists). See CONTRIBUTING.md. Prefer a precise type or type guard instead when possible.',
    },
    schema: [],
  },
  create(context) {
    const sourceCode = context.sourceCode ?? context.getSourceCode();

    function checkAsExpression(node, typeAnnotation) {
      if (!isAnyKeyword(typeAnnotation)) return;

      // Locate the cast's `as` keyword (the last `as` token in the node, so
      // nested casts inside the operand don't misdirect the check). Either a
      // comment above the operand or directly above the cast itself counts.
      let asLine = null;
      let asColumn = null;
      try {
        const tokens = sourceCode.getTokens(node);
        let asToken = null;
        for (const token of tokens) {
          if (token.value === 'as') asToken = token;
        }
        if (asToken) {
          asLine = asToken.loc.start.line;
          asColumn = asToken.loc.start.column;
        }
      } catch {
        // Fall back to the node location when tokens are unavailable.
      }

      const comments = sourceCode.getAllComments();
      const hasJustification = comments.some((comment) => {
        if (!comment.loc) return false;
        const endLine = comment.loc.end.line;
        // Comment on the line directly above the operand or the `as` keyword.
        if (endLine === node.loc.start.line - 1) return true;
        if (asLine !== null && endLine === asLine - 1) return true;
        // Trailing comment on the same line, before the operand or the `as`.
        if (
          endLine === node.loc.start.line &&
          comment.loc.end.column <= node.loc.start.column
        )
          return true;
        if (asLine !== null && endLine === asLine && comment.loc.end.column <= asColumn)
          return true;
        return false;
      });

      if (!hasJustification) {
        context.report({ node, messageId: 'missingJustification' });
      }
    }

    return {
      TSAsExpression(node) {
        checkAsExpression(node, node.typeAnnotation);
      },
      TSTypeAssertion(node) {
        checkAsExpression(node, node.typeAnnotation);
      },
    };
  },
};

export default requireAsAnyJustification;
