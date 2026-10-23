import { expect, it } from 'vitest';
import { parseStory, scenarioSchema, classifyAttempts } from '../../packages/core/src/testing.js';
it('imports Markdown criteria with exact source lines and never infers approved expectations', () => {
    const story = parseStory('# Registration\n\n## Acceptance Criteria\n- AC-1: Invalid email is rejected.\n- AC-2: Duplicate email is rejected.\n', 'stories/registration.md');
    expect(story.title).toBe('Registration');
    expect(story.requirements).toHaveLength(2);
    expect(story.requirements[0]).toMatchObject({ key: 'AC-1', sourceRef: 'stories/registration.md#L4', origin: 'specified' });
    expect(() => parseStory('# No criteria', 'story.md')).toThrow();
});
it('rejects arbitrary execution instructions and preserves result taxonomy', () => {
    expect(scenarioSchema.safeParse({ code: 'process.exec()' }).success).toBe(false);
    expect(classifyAttempts(['FAIL', 'PASS'])).toBe('FLAKY');
    expect(classifyAttempts(['INCONCLUSIVE', 'PASS'])).toBe('INCONCLUSIVE');
    expect(classifyAttempts([])).toBe('NOT RUN');
    expect(classifyAttempts(['BLOCKED'])).toBe('BLOCKED');
});
