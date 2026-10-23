import type { Browser } from 'playwright';
import { z } from 'zod';
import { SqliteStore, ArtifactStore } from '../../storage/src/index.js';
import { NavigationEngine } from '../../navigation/src/engine.js';
import { budgetsSchema, navigationConfigSchema, scopeSchema, sameBuildFamily, type Scope, type NavigationConfig, type NavigationBudgets } from '../../core/src/index.js';
export const explorationRequestSchema=z.object({base:scopeSchema,head:scopeSchema,terms:z.array(z.string().trim().min(2).max(80)).min(1).max(12),config:navigationConfigSchema,limits:budgetsSchema,reviewer:z.string().trim().min(1).max(200)}).strict();
export class LearningService {
 constructor(readonly store:SqliteStore,readonly artifacts:ArtifactStore,private readonly browser?:Browser,private readonly env:NodeJS.ProcessEnv=process.env){}
 async explore(base:Scope,head:Scope,terms:string[],config:NavigationConfig,limits:Partial<NavigationBudgets>,reviewer:string,signal?:AbortSignal){
  const input=explorationRequestSchema.parse({base,head,terms,config,limits,reviewer});
  if(!sameBuildFamily(input.base,input.head))throw new Error('Targeted exploration requires matching scope and distinct build');
  const source=this.store.navigation.snapshot(input.base);if(!source.scope)throw new Error('Unknown base scope');
  const run=await new NavigationEngine(this.store,this.artifacts,this.browser).map(input.head,source.scope.seedUrl,input.config,input.limits,signal,this.env,input.terms);
  if(run.status!=='complete')return {run,change:null,candidate:null};
  const change=this.store.learning.compare(input.base,input.head,input.reviewer);
  const graph=this.store.navigation.snapshot(input.head);const verified=graph.transitions.filter(t=>change.newTransitionIds.includes(t.id)&&t.status==='verified');
  const candidate=verified.length?this.store.learning.proposeNavigation(input.head,verified.map(t=>t.id),change.id,'Bounded targeted exploration with checked preconditions and postconditions'):null;
  return {run,change,candidate};
 }
}
