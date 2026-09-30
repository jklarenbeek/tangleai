/** Registered topology diagnostics use explicit invocation order and dependency edges. */
import {mean} from '@jarenjs/core/stats';
import type {HeraTopology,HeraTrajectory} from './contracts.gen.ts';
export interface HeraMetricNode {id:string;roleId:string;dependsOn:readonly string[];}
export interface HeraRoleProjection {nodes:readonly HeraMetricNode[];order?:readonly string[];}
export interface HeraMetrics {entropy:number|null;distinctRoles:number;nodeEfficiency:number|null;selfLoops:number;cycles:number;diameter:number|null;}
function projection(input:HeraRoleProjection){
  const byId=new Map(input.nodes.map(n=>[n.id,n]));
  if(byId.size!==input.nodes.length||input.nodes.some(n=>n.dependsOn.some(id=>!byId.has(id))))throw new TypeError('Metric invocations and dependencies must have unique retained identities.');
  const order=input.order??input.nodes.map(n=>n.id);
  if(new Set(order).size!==order.length||order.some(id=>!byId.has(id)))throw new TypeError('The projection order must name unique retained invocations.');
  const nodes=order.map(id=>byId.get(id)!),included=new Set(order);
  return {nodes,roles:nodes.map(n=>n.roleId),edges:nodes.flatMap(n=>n.dependsOn.filter(id=>included.has(id)).map(id=>[byId.get(id)!,n] as const))};
}
const entropy=(pairs:readonly (readonly [string,string])[]):number|null=>{
  if(!pairs.length)return null;const counts=new Map<string,number>();
  for(const pair of pairs){const key=JSON.stringify(pair);counts.set(key,(counts.get(key)??0)+1);}
  return -[...counts.values()].reduce((sum,count)=>{const p=count/pairs.length;return sum+p*Math.log2(p);},0)||0;
};
/** Sequential lists use adjacent invocations; DAG projections use retained dependency edges. */
export function transitionEntropy(input:readonly string[]|HeraRoleProjection,window=8):number|null{
  if(!Number.isSafeInteger(window)||window<1)throw new TypeError('Entropy windows require a positive invocation count.');
  const graph=Array.isArray(input)?null:projection(input as HeraRoleProjection),roles=graph?.roles??input as readonly string[];
  if(roles.length<2)return null;
  const values:number[]=[];
  for(let start=0;start<=Math.max(0,roles.length-window);start++){
    const end=Math.min(roles.length,start+window),within=graph?new Set(graph.nodes.slice(start,end).map(n=>n.id)):null;
    const pairs:ReadonlyArray<readonly [string,string]>=graph?graph.edges.filter(([a,b])=>within!.has(a.id)&&within!.has(b.id)).map(([a,b])=>[a.roleId,b.roleId]):roles.slice(start,end-1).map((role,index)=>[role,roles[start+index+1]]);
    const value=entropy(pairs);if(value!==null)values.push(value);
  }
  return values.length?mean(values)!:null;
}
export function distinctRoles(roles:readonly string[]):number{return new Set(roles).size;}
export function nodeEfficiency(primaryScore:number|null,count:number):number|null{
  if(primaryScore!==null&&(!Number.isFinite(primaryScore)||primaryScore<0||primaryScore>1))throw new TypeError('Efficiency requires a unit task score.');
  if(!Number.isSafeInteger(count)||count<0)throw new TypeError('Distinct-role counts must be nonnegative safe integers.');
  return primaryScore===null||count===0?null:primaryScore/count;
}
export function selfLoops(roles:readonly string[]):number{return roles.slice(1).reduce((count,role,index)=>count+Number(role===roles[index]),0);}
/** Count unique role-projected DFS back edges, including a role self-edge. */
export function cycles(input:HeraRoleProjection):number{
  const graph=projection(input),roles=[...new Set(graph.roles)],out=new Map(roles.map(role=>[role,new Set<string>()]));
  for(const [from,to] of graph.edges)out.get(from.roleId)!.add(to.roleId);
  const state=new Map<string,number>();let count=0;
  const walk=(role:string):void=>{state.set(role,1);for(const target of out.get(role)!){if(state.get(target)===1)count++;else if(!state.has(target))walk(target);}state.set(role,2);};
  for(const role of roles)if(!state.has(role))walk(role);return count;
}
/** Longest directed invocation path, in edges; cyclic input has no DAG diameter. */
export function diameter(input:HeraRoleProjection):number|null{
  const graph=projection(input),out=new Map(graph.nodes.map(n=>[n.id,[] as string[]])),degree=new Map(graph.nodes.map(n=>[n.id,0]));
  for(const [a,b] of graph.edges){out.get(a.id)!.push(b.id);degree.set(b.id,degree.get(b.id)!+1);}
  const ready=graph.nodes.filter(n=>degree.get(n.id)===0).map(n=>n.id),depth=new Map<string,number>();let visited=0,longest=0;
  while(ready.length){const id=ready.shift()!,current=depth.get(id)??0;visited++;longest=Math.max(longest,current);
    for(const child of out.get(id)!){depth.set(child,Math.max(depth.get(child)??0,current+1));degree.set(child,degree.get(child)!-1);if(degree.get(child)===0)ready.push(child);}
  }
  return visited===graph.nodes.length?longest:null;
}
export function topologyMetrics(input:HeraRoleProjection,primaryScore:number|null,window=8):HeraMetrics{
  const roles=projection(input).roles,count=distinctRoles(roles);return {entropy:transitionEntropy(input,window),distinctRoles:count,nodeEfficiency:nodeEfficiency(primaryScore,count),selfLoops:selfLoops(roles),cycles:cycles(input),diameter:diameter(input)};
}
export function summarizeTopology(trajectories:readonly HeraTrajectory[],topologies:readonly HeraTopology[],options:{includeFailed:boolean;window?:number}){
  const rows=trajectories.filter(t=>options.includeFailed||t.status==='completed').map(t=>{
    const topology=topologies.find(p=>p.id===t.topologyId);if(!topology)throw new TypeError('A trajectory requires its retained topology.');
    return topologyMetrics({nodes:topology.nodes.map(n=>({id:n.id,roleId:n.agentId,dependsOn:n.dependsOn})),order:t.invocationOrder},t.primaryScore,options.window);
  });
  const average=(key:keyof HeraMetrics):number|null=>{const values=rows.map(r=>r[key]).filter((n):n is number=>n!==null);return values.length?mean(values)!:null;};
  return {entropy:average('entropy'),distinctRoles:average('distinctRoles'),nodeEfficiency:average('nodeEfficiency'),selfLoops:average('selfLoops'),cycles:average('cycles'),diameter:average('diameter'),includesFailed:options.includeFailed,trajectories:rows.length};
}
