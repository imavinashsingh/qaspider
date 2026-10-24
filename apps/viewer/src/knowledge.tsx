export function KnowledgePage({ projectId }: { projectId: string }) {
  return (
    <div style={{ padding: '28px 32px' }} data-project={projectId}>
      <div className="headline">
        <div>
          <div className="eyebrow">V3 · PHASE 5.4</div>
          <h1>Knowledge</h1>
          <p>Verified navigation routes, approved workflows, expectations and revision history — coming soon.</p>
        </div>
      </div>
    </div>
  );
}
