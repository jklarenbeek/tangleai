import {corpusFixture} from './corpus-promotion.ts';
import {EMPTY_HEAD} from '@tangleai/outcomes';
import {createBudgetAccount} from '@tangleai/agents';
import {createHashEmbedder} from '@tangleai/models/embed';
import {createMemoryLightRagStore,createScriptedPlanner,retrieveLightRag,projectionForContribution,planProjectionWrites,lightragMust,type LightRagMode,type LightRagLimits,type LightRagStore} from '@tangleai/lightrag';
import control from '../../benchmark/fixtures/lightrag/one-hop-control.json' with{type:'json'};
export async function retrievalFixture(){
    const f=await corpusFixture({dims:64}),memory=createMemoryLightRagStore(),chunkByKey=new Map<string,string>(),sourceByKey=new Map<string,string>();
    try{
        for(const source of control.sources){
            const url='https://graph.example/'+source.key;f.setBody(url,'# '+source.key+'\n\n'+source.text);
            const document=await f.ingester.prepare({url,maxTokens:100,overlapTokens:16});
            const result=lightragMust(await f.prepareDocument(document,()=>({entities:source.entities.map(name=>({name,type:'CONCEPT',description:source.entities.length===1?source.text:name+' participates in the depot connection.'})),
                relations:source.relations.map(([from,to])=>({source:from,target:to,description:source.text,themes:['connections'],strength:1})),contentKeywords:['connections']})));
            if(result.status!=='prepared')throw Error('Expected a registered source.');lightragMust(await f.promotion.promote(result));
            chunkByKey.set(source.key,result.document.chunks[0].id);sourceByKey.set(source.key,result.document.source.id);
            const projection=lightragMust(await projectionForContribution(result.contribution));lightragMust(await memory.apply(lightragMust(await planProjectionWrites({projection,contribution:result.contribution.plan,projections:[],actualHead:EMPTY_HEAD,expectedHead:EMPTY_HEAD,at:null}))));
        }
        const embedder=createHashEmbedder({dims:64}),planner=createScriptedPlanner(()=>({lowLevelKeywords:control.lowLevelKeywords,highLevelKeywords:['connections']}));
        async function retrieve(mode:LightRagMode='low',limits:Partial<LightRagLimits>={},store:LightRagStore=f.graph){
            const budget=createBudgetAccount({turns:8,tokens:10000},()=>0),plan=lightragMust(await planner(control.query,{mode,limits:{...control.limits,...limits}}));
            return lightragMust(await retrieveLightRag({store,documents:f.documents,embedder,plan,budget,clock:()=>0}));
        }
        return {...f,memory,embedder,planner,control,chunkByKey,sourceByKey,retrieve};
    }catch(cause){await f.db.close();throw cause;}
}
