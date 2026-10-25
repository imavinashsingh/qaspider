import { PlanStore } from '../../electron/plan-store.mjs';
import { ApprovedExecution } from '../../electron/approved-execution.mjs';
import { genericProposal } from './generic-plan.mjs';
import { approve, executionIdentity, executionRequest } from './approved-plan.mjs';

/** Test/demo setup only: synthetic reviewed expectations, actual authorized owned-browser execution. */
export async function seedMainAgentData(path) {
  const store = new PlanStore(path);
  let execution;
  try {
    const a = store.conversations.createProject({ title: 'Clinic Alpha', description: 'Clinic Alpha schedules outpatient visits. Its project code is AMBER-482.' });
    const b = store.conversations.createProject({ title: 'Inventory Beta', description: 'Inventory Beta tracks warehouse stock. Its project code is COBALT-713.' });
    const create = projectId => ({ projectId, conversationId: store.conversations.create({ projectId, title: 'Main Agent conversation', context: { mode: 'controlled', url: '/registration' } }).id });
    const projectA = create(a), projectB = create(b);
    store.conversations.profiles.mutate({ projectId: a, version: 1, action: { type: 'note', topic: 'roles', text: 'Receptionists schedule visits; clinicians review appointments.' } });
    let saved = store.create(genericProposal()); store.conversations.linkPlan(projectA.conversationId, saved.planId, 'Synthetic fixture-reviewed QA plan for the Main Agent demonstration.');
    saved = approve(store, saved);
    execution = new ApprovedExecution(store, { options: { headless: true } });
    const preparation = await execution.prepare(executionIdentity(saved));
    const report = await execution.execute(executionRequest(saved, preparation));
    if (report.outcome !== 'PASS' || !report.scenarios.every(item => item.result?.assertionsExecuted > 0 && item.result?.evidence?.length > 0 && item.result?.browserClosed)) throw new Error('The owned browser demonstration did not produce a fully evidenced passing report.');
    store.conversations.linkReport(report);
    const workflow = store.knowledge.list('registration').find(item => item.project === a);
    if (!workflow) throw new Error('Actual execution did not produce project-scoped operational knowledge.');
    return { projectA, projectB, planId: saved.planId, reportId: report.id, approvalHash: saved.hash, workflowRevisionId: workflow.revisions[0].id,
      browserReport: { outcome: report.outcome, scenarios: report.scenarios.map(item => ({ id: item.scenarioId, outcome: item.outcome, assertions: item.result.assertionsExecuted, evidenceIds: item.result.evidence.map(evidence => evidence.id) })) } };
  } finally { await execution?.close(); store.close(); }
}
