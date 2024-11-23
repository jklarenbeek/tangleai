import dot from 'compute-dot';
import cosineSimilarity from 'compute-cosine-similarity';
import { getSimilarityMeasure } from '../config';

const computeSimilarity = (x: number[], y: number[]): number => {
  const similarityMeasure = getSimilarityMeasure() || "cosine";

  if (similarityMeasure === 'cosine') {
    return cosineSimilarity(x, y);
  } 
  else if (similarityMeasure === 'dot') {
    return dot(x, y);
  }

  throw new Error('Invalid similarity measure');
};

export default computeSimilarity;

type estimateTokensMethod = "average" // "average" is the average of words and chars
  | "words" // "words" is the word count divided by 0.75
  | "chars" // "chars" is the char count divided by 4
  | "max" // "max" is the max of word and char
  | "min"; // "min" is the min of word and char

export function estimateTokens(text: string, method: estimateTokensMethod = "max") {
  const symbols = /[-’/`~!#*$@_%+=.,^&(){}[\]|;:”<>?\\]/g;
  const wordCount = text.split(symbols).length;
  const charCount = text.length;

  // Include additional tokens for spaces and punctuation marks
  const additionalTokens = text.match(symbols).length;

  const tokenCountWordEst = wordCount / 0.75;
  const tokenCountCharEst = charCount / 4.0;

  let output = 0;
  switch(method) {
    case "average":
      return ((tokenCountWordEst + tokenCountCharEst) / 2) + additionalTokens;
    case "words":
      return tokenCountWordEst + additionalTokens;
    case "chars":
      return tokenCountCharEst + additionalTokens;
    case "max":
      return Math.max(tokenCountWordEst, tokenCountCharEst) + additionalTokens;
    case "min":
      return Math.min(tokenCountWordEst, tokenCountCharEst) + additionalTokens;
    default:
      throw new Error("Invalid Method");
  }
}
