import type {
  IssueRecord,
  RecurringDismissalRecord,
  RecurringSuggestion,
} from '../../shared/types.ts';

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'have', 'has', 'had',
  'are', 'was', 'were', 'been', 'will', 'would', 'could', 'should', 'into',
  'about', 'after', 'before', 'during', 'between', 'under', 'over', 'there',
  'their', 'they', 'them', 'then', 'than', 'when', 'where', 'which', 'while',
  'need', 'needs', 'issue', 'issues', 'concern', 'concerns', 'party', 'meeting',
  'polling', 'station', 'constituency', 'region', 'members', 'member', 'report',
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length >= 3 && !STOP_WORDS.has(token));
}

function buildBigrams(tokens: string[]): string[] {
  const bigrams: string[] = [];
  for (let i = 0; i < tokens.length - 1; i++) {
    bigrams.push(`${tokens[i]}_${tokens[i + 1]}`);
  }
  return bigrams;
}

export function findRecurringSuggestions(
  targetIssue: IssueRecord,
  scopedIssues: IssueRecord[],
  dismissals: RecurringDismissalRecord[],
): RecurringSuggestion[] {
  const dismissedPairs = new Set(
    dismissals.map((d) => [d.issueIdA, d.issueIdB].sort().join('::')),
  );

  const targetTokens = tokenize(
    `${targetIssue.title} ${targetIssue.description} ${targetIssue.requestedAction}`,
  );
  const targetSet = new Set([...targetTokens, ...buildBigrams(targetTokens)]);
  if (targetSet.size === 0) return [];

  const suggestions: RecurringSuggestion[] = [];

  for (const candidate of scopedIssues) {
    if (candidate.id === targetIssue.id) continue;
    if (targetIssue.recurringGroupId && candidate.recurringGroupId === targetIssue.recurringGroupId) {
      continue;
    }

    const pairKey = [targetIssue.id, candidate.id].sort().join('::');
    if (dismissedPairs.has(pairKey)) continue;

    const candTokens = tokenize(
      `${candidate.title} ${candidate.description} ${candidate.requestedAction}`,
    );
    const candSet = new Set([...candTokens, ...buildBigrams(candTokens)]);
    if (candSet.size === 0) continue;

    const matched: string[] = [];
    for (const tok of targetSet) {
      if (candSet.has(tok)) matched.push(tok);
    }

    const unionSize = new Set([...targetSet, ...candSet]).size;
    const jaccard = unionSize > 0 ? matched.length / unionSize : 0;

    let score = jaccard;
    if (candidate.categoryId === targetIssue.categoryId) score += 0.14;
    if (candidate.constituencyId === targetIssue.constituencyId) score += 0.08;
    else if (candidate.regionId === targetIssue.regionId) score += 0.04;

    const cleanTerms = matched
      .filter((t) => !t.includes('_'))
      .slice(0, 5);

    if (score >= 0.24 && cleanTerms.length >= 2) {
      suggestions.push({
        primaryIssueId: targetIssue.id,
        relatedIssueId: candidate.id,
        relatedReferenceCode: candidate.referenceCode,
        relatedTitle: candidate.title,
        relatedCategoryName: candidate.categoryName,
        relatedLocation: `${candidate.pollingStationName}, ${candidate.constituencyName}`,
        relatedStatus: candidate.status,
        relatedCreatedAt: candidate.createdAt,
        similarityScore: Math.min(0.99, Math.round(score * 100) / 100),
        matchedTerms: cleanTerms,
        isSuggestion: true,
        requiresConfirmation: true,
      });
    }
  }

  return suggestions.sort((a, b) => b.similarityScore - a.similarityScore).slice(0, 6);
}
