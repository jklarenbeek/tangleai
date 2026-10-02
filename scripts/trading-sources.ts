/** Development-only inventory shared by prompt compilation and source receipts. */
export const TRADING_PROMPT_OUTPUTS = {
  fundamentals: 'analystReportOutput', sentiment: 'analystReportOutput', news: 'analystReportOutput', technical: 'analystReportOutput',
  'research-position': 'debate-position', 'research-rebuttal': 'debate-rebuttal', 'research-judge': 'debate-judge', 'research-verdict': 'analysis-merge',
  trader: 'tradeProposalOutput', 'risk-position': 'riskTurnOutput', 'risk-facilitator': 'riskVerdictOutput', 'fund-manager': 'fundManagerOutput',
} as const;
export function tradingPromptFiles(): string[] { return Object.keys(TRADING_PROMPT_OUTPUTS).sort().map(id => `prompts/trading/${id}.toml`); }
