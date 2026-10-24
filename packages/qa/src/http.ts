import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import { storyContextSchema, policySchema, proposalSchema,permissionDecisionInputSchema } from '../../core/src/index.js';
import { QaService } from './service.js';
export function createQaApi(service: QaService) {
    const { store, artifacts } = service;
    function json(response: ServerResponse, value: unknown, status = 200) { response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); response.end(JSON.stringify(value)); }
    async function body(request: IncomingMessage, origin: string) {
        if (request.headers.origin !== origin || !request.headers['content-type']?.startsWith('application/json'))
            throw new Error('Same-origin JSON required');
        let size = 0;
        const chunks: Buffer[] = [];
        for await (const part of request) {
            size += part.length;
            if (size > 262144)
                throw new Error('Request too large');
            chunks.push(Buffer.from(part));
        }
        return JSON.parse(Buffer.concat(chunks).toString()) as unknown;
    }
    return { shutdown: () => service.shutdown(), async handle(request: IncomingMessage, response: ServerResponse, url: URL, origin: string) {
            if (!url.pathname.startsWith('/api/qa/'))
                return false;
            try {
                const path = url.pathname.slice(8);
                const id = url.searchParams.get('id') ?? '';
                if (request.method === 'GET') {
                    if(path==='jobs')json(response,store.testing.listJobs());
                    else if(path==='permissions')json(response,store.testing.permissions(id));
                    else if (path === 'stories')
                        json(response, store.testing.listStories());
                    else if (path === 'plans')
                        json(response, store.testing.listPlans());
                    else if (path === 'runs')
                        json(response, store.testing.listRuns());
                    else if (path === 'report') {
                        const report = store.testing.report(id);
                        if (!report)
                            throw new Error('Unknown run');
                        json(response, report);
                    }
                    else if (path === 'job') {
                        const job = store.testing.getJob(id);
                        if (!job)
                            throw new Error('Unknown job');
                        json(response, job);
                    }
                    else if (path === 'artifacts' || path === 'evidence') {
                        const report = store.testing.report(url.searchParams.get('run') ?? '');
                        if (!report)
                            throw new Error('Unknown run');
                        const ids = new Set(report.results.flatMap(r => r.attempts.flatMap(a => a.evidenceIds)));
                        if (path === 'artifacts')
                            json(response, [...ids].map(id => store.getArtifact(id)).filter(Boolean).map(a => ({ id: a!.id, kind: a!.kind, status: a!.status, sizeBytes: a!.sizeBytes })));
                        else {
                            const artifact = store.getArtifact(id);
                            if (!ids.has(id) || !artifact || artifact.status !== 'available' || artifact.kind === 'trace')
                                throw new Error('Evidence unavailable or restricted; traces remain local');
                            response.writeHead(200, { 'content-type': artifact.kind === 'screenshot' ? 'image/png' : 'application/json', 'cache-control': 'no-store' });
                            response.end(artifacts.read(id));
                        }
                    }
                    else
                        json(response, { error: 'Unknown QA operation' }, 404);
                }
                else if (request.method === 'POST') {
                    const data = await body(request, origin);
                    if (path === 'stories') {
                        const v = z.object({ markdown: z.string(), sourceRef: z.string(), context: storyContextSchema, storyId: z.string().optional() }).strict().parse(data);
                        json(response, store.testing.importStory(v.markdown, v.sourceRef, v.context, v.storyId), 201);
                    }
                    else if (path === 'plan') {
                        const v = z.object({ storyRevisionId: z.string(), policy: policySchema.optional() }).strict().parse(data);
                        // HTTP planning is always proposal-only; caller-supplied grants cannot create authority.
                        json(response, service.startPlanning(v.storyRevisionId), 202);
                    }
                    else if(path==='permissions'){
                        const v=z.object({planRevisionId:z.string(),planHash:z.string(),decisions:z.array(permissionDecisionInputSchema),reviewer:z.string()}).strict().parse(data);
                        json(response,store.testing.decidePermissions(v.planRevisionId,v.planHash,v.decisions,v.reviewer));
                    }
                    else if(path==='access-config'){
                        const v=z.object({planRevisionId:z.string(),policy:policySchema}).strict().parse(data);json(response,store.testing.configureAccess(v.planRevisionId,v.policy));
                    }
                    else if(path==='reconcile'){const v=z.object({runId:z.string(),reviewer:z.string().trim().min(1).max(200),notes:z.string().trim().min(10).max(1000),confirm:z.literal(true)}).strict().parse(data);json(response,await service.reconcileRun(v.runId,v.reviewer,v.notes));}
                    else if(path==='revise'){
                        const v=z.object({planRevisionId:z.string(),feedback:z.string().trim().min(1).max(2000)}).strict().parse(data);json(response,service.startRevision(v.planRevisionId,v.feedback),202);
                    }
                    else if (path === 'edit') {
                        const v = z.object({ planRevisionId: z.string(), proposal: proposalSchema }).strict().parse(data);
                        json(response, store.testing.revisePlan(v.planRevisionId, v.proposal));
                    }
                    else if (path === 'approve') {
                        const v = z.object({ planRevisionId: z.string(), reviewer: z.string(), requirementIds: z.array(z.string()) }).strict().parse(data);
                        json(response, store.testing.approvePlan(v.planRevisionId, v.reviewer, v.requirementIds));
                    }
                    else if (path === 'execute') {
                        const v = z.object({ planRevisionId: z.string(), selected: z.array(z.string()).optional() }).strict().parse(data);
                        if (store.testing.getPlan(v.planRevisionId)?.status !== 'approved')
                            throw new Error('Execution requires an approved plan');
                        json(response, service.startExecution(v.planRevisionId, v.selected), 202);
                    }
                    else if (path === 'cancel') {
                        const v = z.object({ jobId: z.string() }).strict().parse(data);
                        service.cancel(v.jobId);
                        json(response, { status: 'cancelling' });
                    }
                    else
                        json(response, { error: 'Unknown QA operation' }, 404);
                }
                else
                    json(response, { error: 'Method not allowed' }, 405);
            }
            catch (error) {
                json(response, { error: error instanceof z.ZodError ? 'Invalid structured QA request' : error instanceof Error ? error.message : 'QA operation failed' }, 400);
            }
            return true;
        } };
}
