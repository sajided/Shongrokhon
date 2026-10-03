// User-facing text for every error code the app can receive. English for
// Phase 1; Bangla translations arrive with Phase 4 localization.

const messages: Record<string, string> = {
  // Phone / OTP
  INVALID_PHONE: 'Enter a valid Bangladeshi mobile number, e.g. 01712345678.',
  INVALID_OTP_FORMAT: 'The code has 6 digits.',
  WRONG_OTP: 'That code is not correct.',
  OTP_EXPIRED: 'This code has expired. Request a new one.',
  OTP_LOCKED: 'Too many wrong codes. Try again later.',
  OTP_NOT_REQUESTED: 'Request a code first.',
  RATE_LIMITED: 'Too many requests. Please wait a moment.',
  OTP_SEND_FAILED: 'We could not send the code. Try again.',
  // PIN
  INVALID_PIN_FORMAT: 'PIN must be 4 or 5 digits.',
  PIN_MISMATCH: 'The PINs do not match.',
  PIN_ALREADY_SET: 'Your PIN is already set.',
  PIN_NOT_SET: 'Set your PIN before making payments.',
  WRONG_PIN: 'Wrong PIN.',
  PIN_LOCKED: 'Too many wrong PINs. Payments are locked for a while.',
  // QR
  INVALID_QR: 'Invalid QR code.',
  NOT_BANGLA_QR: 'This is not a Bangla QR payment code.',
  EXPIRED_QR: 'This payment QR has expired. Ask the merchant for a new one.',
  // Payment
  REQUIRED: 'Enter an amount.',
  INVALID_AMOUNT: 'Enter an amount greater than zero.',
  AMOUNT_TOO_PRECISE: 'Amounts can have at most 2 decimal places.',
  AMOUNT_ABOVE_LIMIT: 'This amount is above the per-transaction limit.',
  INSUFFICIENT_FUNDS: 'Insufficient balance for this payment.',
  MERCHANT_NOT_FOUND: 'This merchant is not registered.',
  MERCHANT_INACTIVE: 'This merchant cannot accept payments right now.',
  SELF_PAYMENT: 'You cannot pay your own merchant account.',
  WALLET_INACTIVE: 'This wallet cannot make payments right now.',
  WALLET_NOT_FOUND: 'Wallet not found.',
  IDEMPOTENCY_KEY_REUSED: 'This payment request was already used. Start again.',
  INVALID_REQUEST: 'Something went wrong. Start again.',
  // Risk checks (Phase 2). Neutral on purpose: never say why a payment was checked.
  CONFIRM_PAYMENT: 'Please confirm this payment with your PIN.',
  SCORE_REQUIRED: 'We could not check this payment. Try again.',
  SCORE_INVALID: 'We could not check this payment. Try again.',
  SCORE_EXPIRED: 'This payment took too long to confirm. Try again.',
  INVALID_SCORE: 'We could not check this payment. Try again.',
  // AI coach and savings planner (Phase 3)
  INVALID_PERIOD: 'Choose a period to view.',
  INVALID_QUESTION: 'Ask a question of up to 300 characters.',
  FORBIDDEN: 'You can only view your own data.',
  GOAL_NAME_INVALID: 'Give your goal a name (up to 60 characters).',
  GOAL_AMOUNT_INVALID: 'Enter a target amount greater than zero, with at most 2 decimal places.',
  GOAL_AMOUNT_TOO_LARGE: 'The target can be at most ৳10,00,000.',
  GOAL_MONTHS_INVALID: 'Choose between 1 and 60 months.',
  GOAL_NOT_FOUND: 'This goal no longer exists.',
  GOAL_LIMIT_REACHED: 'You can have up to 10 goals.',
  CONTRIBUTION_INVALID: 'Enter an amount greater than zero.',
  // Generic
  NETWORK: 'No connection. Check your internet and try again.',
  SESSION_EXPIRED: 'Your session has ended. Please sign in again.',
  INTERNAL_ERROR: 'Something went wrong. Try again.',
};

export function messageFor(code: string | null | undefined, extra?: { attempts_left?: number }): string {
  const base = (code && messages[code]) || messages.INTERNAL_ERROR;
  if (extra?.attempts_left !== undefined && (code === 'WRONG_PIN' || code === 'WRONG_OTP')) {
    return `${base} ${extra.attempts_left} attempt${extra.attempts_left === 1 ? '' : 's'} left.`;
  }
  return base;
}
