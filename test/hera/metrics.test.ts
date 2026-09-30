import {test} from 'node:test';
import assert from 'node:assert/strict';
import fixtures from '../../benchmark/fixtures/hera/topologies.json' with {type:'json'};
import {topologyMetrics,transitionEntropy,distinctRoles,nodeEfficiency,selfLoops,cycles,diameter,summarizeTopology,type HeraTopology,type HeraTrajectory} from '@tangleai/hera';
test('registered invocation projections reproduce every analytic metric',()=>{
  for(const fixture of fixtures){const {validity,...expected}=fixture.expected;
    assert.deepEqual(topologyMetrics(fixture,fixture.primaryScore,fixture.window),{...expected,nodeEfficiency:1/expected.distinctRoles},fixture.id);
  }
  assert.equal(selfLoops(['query-decomposer','retriever','retriever','evidence-selector','context-validator','conclude-agent']),1);
  assert.equal(transitionEntropy(['a','b','c','d'],4),Math.log2(3));assert.equal(transitionEntropy(['a','b','a','b'],2),0);
  assert.equal(transitionEntropy([],8),null);assert.equal(transitionEntropy(['a','b'],1),null);assert.equal(distinctRoles([]),0);
  assert.equal(nodeEfficiency(null,3),null);assert.equal(nodeEfficiency(0,3),0);assert.equal(diameter({nodes:[]}),0);assert.equal(cycles({nodes:[]}),0);
  assert.throws(()=>transitionEntropy(['a'],0));assert.throws(()=>diameter({nodes:[{id:'a',roleId:'a',dependsOn:['missing']}]}));
});
test('aggregate diagnostics explicitly retain failed partial invocations',()=>{
  const topology={id:'serial',nodes:fixtures[0].nodes.map(n=>({...n,agentId:n.roleId}))} as unknown as HeraTopology;
  const trajectories=[{topologyId:'serial',invocationOrder:['a','b','c'],primaryScore:1,status:'completed'},{topologyId:'serial',invocationOrder:['a'],primaryScore:null,status:'failed'}] as HeraTrajectory[];
  assert.deepEqual(summarizeTopology(trajectories,[topology],{includeFailed:true}),{entropy:1,distinctRoles:2,nodeEfficiency:1/3,selfLoops:0,cycles:0,diameter:1,includesFailed:true,trajectories:2});
  assert.equal(summarizeTopology(trajectories,[topology],{includeFailed:false}).trajectories,1);
});
