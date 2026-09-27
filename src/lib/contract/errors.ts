export type ContractErrorCode =
  | 'InvalidDiscountRate'
  | 'Unauthorized'
  | 'InvoiceNotFound'
  | 'AlreadyFunded'
  | 'AlreadyPaid'
  | 'InvoiceAlreadyPaid'
  | 'NotFunded'
  | 'InvalidAmount'
  | 'InvalidDueDate'
  | 'InvoiceDefaulted'
  | 'NothingToClaim'
  | 'NotYetDefaulted'
  | 'OverfundingRejected'
  | 'InvoiceExpired'
  | 'BatchTooLarge'
  | 'InvoiceCancelled'
  | 'AlreadyCancelled'
  | 'AlreadyInitialized'
  | 'AlreadyAppealed'
  | 'AppealWindowClosed'
  | 'NotDefaulted'
  | 'AlreadyInQueue'
  | 'NotApprovedFunder'
  | 'InvoiceAppealed'
  | 'AlreadyDisputed'
  | 'NotDisputed'
  | 'InvoiceDisputed'
  | 'DueDateTooSoon'
  | 'DueDateTooFar'
  | 'SelfInvoice'
  | 'OverpaymentRejected'
  | 'PayerReputationTooLow'
  | 'PayerUnverified'
  | 'OracleDataStale'
  | 'OracleCircuitOpen'
  | 'MaxInvoiceAmountExceeded'
  | 'GlobalVolumeCapExceeded'
  | 'QueueNotMature'
  | 'InsufficientLiquidity'
  | 'InsufficientBalance'
  | 'ArithmeticOverflow'
  | 'TokenNotSupported'
  | 'ContractPaused'
  | 'InvalidInvoiceState'
  | 'FeeOnTransferToken'
  | 'InvalidMultisigConfig';

export interface ContractErrorInfo {
  title: string;
  message: string;
  remediation?: string;
}

export const CONTRACT_ERROR_MAP: Record<ContractErrorCode, ContractErrorInfo> = {
  InvalidDiscountRate: {
    title: 'Invalid Discount Rate',
    message: 'The discount rate must be between 0.01% and 50%.',
    remediation: 'Adjust the discount rate and try again.',
  },
  Unauthorized: {
    title: 'Unauthorized Action',
    message: 'Your wallet is not authorized to perform this action.',
    remediation: 'Check if you are using the correct connected wallet account.',
  },
  InvoiceNotFound: {
    title: 'Invoice Not Found',
    message: 'The requested invoice could not be found on the network.',
    remediation: 'Verify the invoice ID and ensure it was created successfully.',
  },
  AlreadyFunded: {
    title: 'Invoice Already Funded',
    message: 'This invoice has already been funded and cannot be funded again.',
    remediation: 'Read the invoice status first and stop funding once the invoice is funded.',
  },
  AlreadyPaid: {
    title: 'Invoice Already Paid',
    message: 'This invoice has already been fully paid.',
    remediation: 'No further action is required for this invoice.',
  },
  InvoiceAlreadyPaid: {
    title: 'Invoice Already Paid',
    message: 'This invoice has already been fully paid.',
    remediation: 'No further action is required for this invoice.',
  },
  NotFunded: {
    title: 'Invoice Not Funded',
    message: 'This invoice has not been funded yet.',
    remediation: 'Fund the invoice first, or wait until the correct state transition has occurred.',
  },
  InvalidAmount: {
    title: 'Invalid Amount',
    message: 'The provided amount is not acceptable to the contract.',
    remediation: 'Send a positive amount that matches the invoice rules and token decimals.',
  },
  InvalidDueDate: {
    title: 'Invalid Due Date',
    message: 'The due date is not valid for invoice creation or update.',
    remediation: 'Provide a future due date that satisfies the contract validation rules.',
  },
  InvoiceDefaulted: {
    title: 'Invoice Defaulted',
    message: 'This invoice has already defaulted and can no longer be settled normally.',
    remediation: 'Use the default or appeal flow instead of settlement or funding flows.',
  },
  NothingToClaim: {
    title: 'Nothing To Claim',
    message: 'There is no yield or claimable amount available yet.',
    remediation: 'Wait until the invoice has generated claimable yield, then retry the claim.',
  },
  NotYetDefaulted: {
    title: 'Invoice Not Yet Defaulted',
    message: 'This invoice has not reached the default threshold yet.',
    remediation:
      'Wait until the invoice is actually defaulted before using the default recovery flow.',
  },
  OverfundingRejected: {
    title: 'Overfunding Rejected',
    message: 'The funding attempt would exceed the invoice remaining amount.',
    remediation: 'Fund only the remaining unpaid amount, or read the remaining balance first.',
  },
  InvoiceExpired: {
    title: 'Invoice Expired',
    message: 'This invoice has expired and can no longer be processed.',
    remediation: 'You may need to request a new invoice from the issuer.',
  },
  BatchTooLarge: {
    title: 'Batch Too Large',
    message: 'The submitted batch exceeds the contract maximum batch size.',
    remediation: 'Split the request into smaller batches and retry.',
  },
  InvoiceCancelled: {
    title: 'Invoice Cancelled',
    message: 'This invoice was cancelled by the issuer.',
    remediation: 'Please contact the issuer for more details.',
  },
  AlreadyCancelled: {
    title: 'Invoice Already Cancelled',
    message: 'This invoice was already cancelled.',
    remediation: 'Treat the invoice as terminal and stop sending state-changing actions for it.',
  },
  AlreadyInitialized: {
    title: 'Contract Already Initialized',
    message: 'The contract was initialized more than once.',
    remediation: 'Run initialization only once per deployment.',
  },
  AlreadyAppealed: {
    title: 'Appeal Already Exists',
    message: 'An appeal already exists for this invoice.',
    remediation: 'Check whether an appeal is already open before creating another one.',
  },
  AppealWindowClosed: {
    title: 'Appeal Window Closed',
    message: 'The appeal deadline has passed.',
    remediation: 'Submit the appeal before the deadline, or update the contract configuration.',
  },
  NotDefaulted: {
    title: 'Invoice Not Defaulted',
    message: 'The invoice is not in the defaulted state required by this action.',
    remediation: 'Wait until the invoice is defaulted, then retry the default-specific action.',
  },
  AlreadyInQueue: {
    title: 'Already In Funding Queue',
    message: 'This LP has already joined the funding queue for this invoice.',
    remediation: 'Skip re-joining if the LP is already queued, or remove the existing entry first.',
  },
  NotApprovedFunder: {
    title: 'Not Approved Funder',
    message: 'This LP is not the funder approved by the priority queue.',
    remediation:
      'Wait for queue resolution and fund only when the contract assigns that LP as the approved funder.',
  },
  InvoiceAppealed: {
    title: 'Invoice Under Appeal',
    message: 'The invoice is currently in the appealed state.',
    remediation: 'Wait for the appeal to resolve before retrying settlement or closure flows.',
  },
  AlreadyDisputed: {
    title: 'Invoice Already Disputed',
    message: 'This invoice is already disputed.',
    remediation: 'Check dispute status before filing and avoid re-opening an active dispute.',
  },
  NotDisputed: {
    title: 'Invoice Not Disputed',
    message: 'The invoice is not in a disputed state.',
    remediation: 'Open a dispute first, or call the correct function for the current state.',
  },
  InvoiceDisputed: {
    title: 'Invoice Under Dispute',
    message: 'The invoice is under dispute and cannot proceed through normal settlement.',
    remediation: 'Resolve or dismiss the dispute before retrying normal invoice actions.',
  },
  DueDateTooSoon: {
    title: 'Due Date Too Soon',
    message: 'The due date is earlier than the minimum allowed horizon.',
    remediation: 'Choose a later due date that satisfies the contract minimum lead time.',
  },
  DueDateTooFar: {
    title: 'Due Date Too Far',
    message: 'The due date is later than the maximum allowed horizon.',
    remediation: 'Reduce the due date to fall within the contract configured maximum range.',
  },
  SelfInvoice: {
    title: 'Self-Invoice Not Allowed',
    message: 'The payer and invoice creator are the same address.',
    remediation: 'Use distinct payer and submitter addresses before resubmitting.',
  },
  OverpaymentRejected: {
    title: 'Overpayment Rejected',
    message: 'The payment amount exceeds the remaining amount due.',
    remediation: 'Pay exactly the remaining amount or query the outstanding balance first.',
  },
  PayerReputationTooLow: {
    title: 'Payer Reputation Too Low',
    message: 'The payer reputation is below the configured minimum threshold.',
    remediation:
      'Improve the payer reputation score, or adjust the minimum threshold through governance.',
  },
  PayerUnverified: {
    title: 'Payer Not Verified',
    message: 'The oracle did not verify the payer when verification was required.',
    remediation: 'Use a verified payer account, or disable payer verification if not required.',
  },
  OracleDataStale: {
    title: 'Oracle Data Stale',
    message: 'The oracle response is older than the configured freshness window.',
    remediation: 'Refresh the oracle data and retry the transaction.',
  },
  OracleCircuitOpen: {
    title: 'Oracle Circuit Open',
    message:
      'The oracle verification circuit breaker is open after repeated stale data, so funding was rejected.',
    remediation:
      'Wait for the oracle feed to recover and the circuit to reset before retrying funding.',
  },
  MaxInvoiceAmountExceeded: {
    title: 'Max Invoice Amount Exceeded',
    message:
      'The invoice amount exceeds the maximum allowed by the current contract configuration.',
    remediation: 'Split the invoice into smaller amounts or request a governance cap increase.',
  },
  GlobalVolumeCapExceeded: {
    title: 'Global Volume Cap Exceeded',
    message: 'This transaction would exceed the contract global volume cap.',
    remediation:
      'Wait for the volume window to reset or request a cap increase through governance.',
  },
  QueueNotMature: {
    title: 'Funding Queue Not Mature',
    message: 'The funding queue has not matured enough to resolve.',
    remediation: 'Wait for the queue window to elapse before resolving the invoice.',
  },
  InsufficientLiquidity: {
    title: 'Insufficient Liquidity',
    message: 'There is not enough liquidity available in the pool to complete this transaction.',
    remediation: 'Please try a smaller amount or wait for more liquidity to be added.',
  },
  InsufficientBalance: {
    title: 'Insufficient Balance',
    message: 'Your wallet does not have enough balance to cover the transaction.',
    remediation: 'Ensure you have enough funds, including necessary network fees.',
  },
  ArithmeticOverflow: {
    title: 'Calculation Error',
    message: 'A mathematical error occurred during the transaction.',
    remediation: 'Please review the transaction amounts and try again.',
  },
  TokenNotSupported: {
    title: 'Unsupported Token',
    message: 'The selected token asset is not supported by this contract.',
    remediation: 'Try using a different asset for this transaction.',
  },
  ContractPaused: {
    title: 'Contract Paused',
    message: 'The smart contract is currently paused for maintenance or security reasons.',
    remediation: 'Please try again later when the network resumes operations.',
  },
  InvalidInvoiceState: {
    title: 'Invalid Invoice State',
    message: 'The invoice is not in the correct state to perform this action.',
    remediation: 'Verify the current status of the invoice before proceeding.',
  },
  FeeOnTransferToken: {
    title: 'Unsupported Token Type',
    message:
      'This token implements fee-on-transfer and cannot be added to the ILN allowlist. Tokens must transfer the exact amount specified.',
    remediation: 'Choose a standard token that transfers the full amount without deducting a fee.',
  },
  InvalidMultisigConfig: {
    title: 'Invalid Multisig Configuration',
    message: 'The multisig configuration for this action is invalid or incomplete.',
    remediation: 'Verify the multisig signer setup and required thresholds before retrying.',
  },
};

export const UNKNOWN_CONTRACT_ERROR: ContractErrorInfo = {
  title: 'Transaction Failed',
  message: 'The transaction could not be completed due to an unexpected error.',
  remediation: 'Please try again or contact support if the issue persists.',
};

const ERROR_CODE_KEYS = (Object.keys(CONTRACT_ERROR_MAP) as ContractErrorCode[]).sort(
  (a, b) => b.length - a.length
);

/**
 * Attempts to extract a known ContractErrorCode from a variety of error shapes.
 */
export function parseContractError(error: unknown): ContractErrorCode | null {
  if (!error) return null;

  // Gather strings to search in
  const representations: string[] = [];

  if (typeof error === 'string') {
    representations.push(error);
  } else if (error instanceof Error) {
    representations.push(error.message);
    representations.push(error.name);
  } else if (typeof error === 'object') {
    try {
      // In Soroban, errors sometimes come back as JSON payloads
      representations.push(JSON.stringify(error));

      const record = error as Record<string, unknown>;
      if (typeof record.message === 'string') representations.push(record.message);
      if (typeof record.error === 'string') representations.push(record.error);
    } catch {
      // Ignore stringify errors (e.g. circular refs)
    }
  }

  // Iterate over all possible error codes and see if they exist in any representation
  for (const code of ERROR_CODE_KEYS) {
    for (const rep of representations) {
      if (rep && rep.includes(code)) {
        return code;
      }
    }
  }

  return null;
}
