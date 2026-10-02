/** Scripted causal mechanism replies. These fixtures make no model-quality claim. */
import type { TradingAnalystView, TradingVisiblePortfolio, TradeProposalOutput, TradeProposal, RiskVerdictOutput } from '@tangleai/trading';
import { tradingResearchScript, promptJson } from './trading-research-runner.ts';
import { tradingRiskDecisionScript } from './trading-risk-runner.ts';
import type { ScriptedDriveOptions } from './gmpl-runner.ts';

export function tradingDecisionScript(options: { fullRounds?: boolean } = {}): ScriptedDriveOptions['response'] {
  const research = tradingResearchScript({ action: options.fullRounds ? 'continue' : 'accept' }), risk = tradingRiskDecisionScript(options.fullRounds ? 'continue' : 'adjust');
  return async (node, iteration, phase, messages) => {
    if (node.startsWith('analyst-')) {
      const snapshot = promptJson(messages, 'snapshot', 'portfolio') as TradingAnalystView, first = snapshot.evidence[0];
      return { findings: first ? [{ text: `Synthetic ${snapshot.role} finding`, citations: [{ id: first.id, digest: first.digest }] }] : [],
        signal: 'neutral', confidence: first ? 0.5 : 0, horizon: 'Next session', limitations: ['Scripted mechanism proof only'] };
    }
    if (node.startsWith('risk-') || node === 'fund-manager') {
      const result = await risk(node, iteration, phase, messages);
      if (node === 'risk-facilitator' && !options.fullRounds) {
        const proposal = promptJson(messages, 'proposal', 'portfolio') as TradeProposal;
        (result as RiskVerdictOutput).adjustedIntent = proposal.action === 'hold' ? { action: 'hold' }
          : proposal.quantity !== undefined ? { action: proposal.action, quantity: proposal.quantity } : { action: proposal.action, targetWeight: proposal.targetWeight! };
      }
      return result;
    }
    const result = await research(node, iteration, phase, messages);
    if (node !== 'trader') return result;
    const portfolio = promptJson(messages, 'portfolio') as TradingVisiblePortfolio;
    const assetText = messages.find(m => m.role === 'user')!.content.match(/asset:\n([^\n]+)/)![1];
    const asset = assetText.startsWith('"') ? JSON.parse(assetText) as string : assetText;
    const held = portfolio.positions.find(p => p.asset === asset)!.quantity;
    const { quantity: _quantity, targetWeight: _weight, ...proposal } = result as TradeProposalOutput;
    return { ...proposal, ...(held ? { action: 'hold' } : { action: 'buy', quantity: 2 }) };
  };
}
