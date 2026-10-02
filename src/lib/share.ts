/**
 * TC-P1-PAY-13: share a receipt from the browser. Uses the Web Share API where
 * available (mobile browsers) and falls back to copying the text.
 */
export async function shareText(text: string): Promise<'shared' | 'copied' | 'cancelled'> {
  const nav = typeof navigator !== 'undefined' ? navigator : undefined;
  if (nav?.share) {
    try {
      await nav.share({ title: 'Shongrokhon receipt', text });
      return 'shared';
    } catch {
      return 'cancelled';
    }
  }
  await nav?.clipboard?.writeText(text);
  return 'copied';
}
