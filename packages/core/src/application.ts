import { z } from 'zod';
import { applicationSchema, environmentSchema, roleSchema, scopeSchema } from './contracts.js';
import { navigationConfigSchema, budgetsSchema, httpUrlSchema } from './navigation.js';
export const onboardingSchema=z.object({application:applicationSchema,environment:environmentSchema,roles:z.array(roleSchema).min(1).max(20)}).strict().refine(v=>v.environment.applicationId===v.application.id&&v.roles.every(r=>r.environmentId===v.environment.id)&&new Set(v.roles.map(r=>r.id)).size===v.roles.length,'Mismatched application/environment/roles');
export const mapRequestSchema=z.object({scope:scopeSchema,seedUrl:httpUrlSchema,config:navigationConfigSchema,limits:budgetsSchema}).strict();
export type Onboarding=z.infer<typeof onboardingSchema>;
export interface OperationJob {id:string;scope:z.infer<typeof scopeSchema>;kind:'map'|'explore';status:'running'|'complete'|'failed'|'cancelled'|'interrupted';createdAt:number;updatedAt:number;result:unknown;}
