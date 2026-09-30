import {SCORABLE_CATEGORIES} from './locomo.ts';
import type {Quality} from './hera-qa.types.ts';
export interface HeraScoredCase {category:number;f1:number;success:number;citationRecall:number;answered:boolean;split:string;}
export function heraQuality(cases:readonly HeraScoredCase[]):NonNullable<Quality>{
  const mean=(get:(c:HeraScoredCase)=>number)=>cases.length?cases.reduce((n,c)=>n+get(c),0)/cases.length:0;
  return {f1:mean(c=>c.f1),successRate:mean(c=>c.success),citationRecall:mean(c=>c.citationRecall),answered:cases.filter(c=>c.answered).length,planned:cases.length,
    byCategory:SCORABLE_CATEGORIES.map(category=>{const selected=cases.filter(c=>c.category===category);return {category,f1:selected.length?selected.reduce((n,c)=>n+c.f1,0)/selected.length:0,answered:selected.filter(c=>c.answered).length,planned:selected.length};})};
}
