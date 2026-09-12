import {gmplArtifacts,createGmplCatalog,materializeGmplTemplate,instantiateGmplPattern,createGmplHostBindings,
  type GmplPatternParameters,type GmplDomainBinding,type GmplHostSnapshot,type GmplPatternRecipe,
  type GmplAnswerProjector} from '@tangleai/gmpl';
import type {GmplInput} from '@tangleai/gmpl/contracts';
import artifacts from '@tangleai/gmpl/artifacts' with {type:'json'};
import schema from '@tangleai/gmpl/schemas/gmpl' with {type:'json'};
declare const host:GmplHostSnapshot,domain:GmplDomainBinding,recipe:GmplPatternRecipe,input:GmplInput;
const catalog=await createGmplCatalog(gmplArtifacts);
if(catalog.valid){const m=await materializeGmplTemplate(recipe,domain,host,catalog.value);if(m.valid){await instantiateGmplPattern(m.value,{},host,catalog.value);const projector:GmplAnswerProjector={id:'estimate-answer',version:'1',project:poll=>({valid:true,value:{key:poll.answerKey,estimate:poll.estimate}})};createGmplHostBindings(m.value,catalog.value,{answerProjector:projector});}}
// @ts-expect-error only the six canonical families are accepted
const invalid:GmplPatternParameters={pattern:'invented'};
// @ts-expect-error a serialized domain cannot carry an executable projector
const bad:GmplDomainBinding['projection']={id:'custom',version:'1',kind:'text',scale:null,project:()=>0};
void [artifacts,schema,input,invalid,bad];
