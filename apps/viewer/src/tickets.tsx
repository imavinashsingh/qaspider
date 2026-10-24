export function TicketsPage({ projectId }: { projectId: string }) {
  return (
    <div style={{ padding: '28px 32px' }} data-project={projectId}>
      <div className="headline">
        <div>
          <div className="eyebrow">V3 · PHASE 5.3</div>
          <h1>QA Tickets</h1>
          <p>Full ticket queue with scenario coverage, findings, and evidence — coming in the next commit.</p>
        </div>
      </div>
    </div>
  );
}
