export function GettingStarted() {
  return <section className="panel"><div className="panel-heading"><div><h2>Your first controlled task</h2><p>Private local evaluation · use the disposable customer and repository fixtures.</p></div></div><div className="section-pad getting-started">
    <ol>
      <li><strong>Create a scoped task.</strong> From Tasks, create an identity with only the required catalog tools and resources. Copy its bearer credential once and issue a short, bounded task grant.</li>
      <li><strong>Connect from the isolated agent network.</strong> Open Connections and copy the generated MCP HTTP template for this installation. Put the task bearer in the named environment variable in the isolated agent runtime. The private service uses the HTTP gateway; the separate stdio template belongs to the local compatibility fixture.</li>
      <li><strong>Try a permitted read.</strong> Allow reads in Policies, then call database_read for customers with a small limit using your connected agent. Demo Lab also submits real read and denial requests through the local gateway.</li>
      <li><strong>Request independent review.</strong> A database update or repository change can become pending. A different administrator or approver opens Approvals, inspects the immutable before/after preview, and approves the exact one-use proof. The task owner cannot approve its own mutation.</li>
      <li><strong>Inspect evidence.</strong> Open Activity or Evidence to see the policy decision, review receipt, dispatch observation, correlation ID and audit entries. An UNKNOWN outcome needs target-state reconciliation; do not resubmit it.</li>
    </ol>
    <h3>Keep the boundary intact</h3><p>Agent traffic goes to the gateway on the isolated network. The dashboard is a human control plane and never proxies MCP traffic or exposes target credentials. Keep target services inaccessible to agents by other routes. Recorded adapter outcomes are local observations, not independent production verification.</p>
    <h3>Installation and recovery help</h3><p>Run these commands in the AgentBrake installation directory on the host. Replace NAME and the other placeholders. These are instructions; the dashboard has not executed them.</p>
    <pre>{`node scripts/product.mjs doctor NAME
node scripts/product.mjs backup NAME
node scripts/product.mjs restore NEW_NAME BACKUP_FILE KEY_FILE PORT
node scripts/product.mjs diagnostics NAME`}</pre>
    <p>Doctor checks the installation. Backup creates an encrypted recovery archive and separate key file. Store them securely and separately. Restore targets a new installation name and available port. Diagnostics produces a bounded, redacted support bundle. Review command output for the actual result.</p>
    <p>Account access: an administrator creates invitations and 15-minute recovery links from Team and shares them manually. There is no public signup or email delivery.</p>
  </div></section>;
}
