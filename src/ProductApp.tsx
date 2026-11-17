import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  Activity,
  ArrowDownToLine,
  ArrowRight,
  Bot,
  CheckCheck,
  ChevronRight,
  Copy,
  Database,
  FileCheck2,
  Fingerprint,
  Github,
  LayoutDashboard,
  Loader2,
  LogOut,
  Menu,
  Pause,
  Play,
  Plug,
  Plus,
  Shield,
  SlidersHorizontal,
  Square,
  Terminal,
  X,
} from "lucide-react";
import { api, setCsrf } from "./api";
import { AuthPanel, type Landing } from "./components/AuthPanel";
import { SettingsPanel, TeamPanel } from "./components/AccountPanels";
import { GettingStarted } from "./components/GettingStarted";
import { Badge, Empty, Logo, Metric, Modal, PolicyEditor } from "./ui";
import type {
  Agent,
  Event,
  Evidence,
  Policies,
  Review,
  Session,
  Setup,
  Workspace,
} from "./types";

const navigation = [
  ["Overview", LayoutDashboard],
  ["Tasks", Bot],
  ["Activity", Activity],
  ["Approvals", FileCheck2],
  ["Policies", SlidersHorizontal],
  ["Connections", Plug],
  ["Evidence", Fingerprint],
  ["Demo Lab", Terminal],
  ["Get started", Shield],
  ["Team", Bot],
  ["Settings", SlidersHorizontal],
] as const;
type Page = (typeof navigation)[number][0];
// Exact supported server/contracts.ts catalog; no arbitrary SQL or URL tool.
const tools = [
  "database_schema",
  "database_read",
  "database_update",
  "github_list_repo",
  "github_list_branches",
  "github_read_file",
  "github_propose_change",
  "github_create_branch",
  "github_open_pull_request",
  "github_create_issue",
];
const resources = ["customers", "agentbrake/sandbox"];
const message = (error: unknown) =>
  error instanceof Error ? error.message : "Request failed";
const json = (value: unknown) => JSON.stringify(value, null, 2);
const date = (value: string | number) => new Date(value).toLocaleString();
type Mutate = (
  path: string,
  body: unknown,
  success: string,
  method?: string,
) => Promise<any>;

function ActionTable({
  items,
  open,
}: {
  items: Event[];
  open: (event: Event) => void;
}) {
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Action / target</th>
            <th>Outcome</th>
            <th>Policy reason</th>
            <th>Requested</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {items.map((event) => (
            <tr key={event.id}>
              <td>
                <button className="event-title" onClick={() => open(event)}>
                  <span className="tool-icon">
                    {event.tool.startsWith("github") ? (
                      <Github size={18} />
                    ) : (
                      <Database size={18} />
                    )}
                  </span>
                  <span>
                    <strong>{event.tool}</strong>
                    <small>
                      {event.resource} · {event.agentId}
                    </small>
                  </span>
                </button>
              </td>
              <td>
                <Badge status={event.status} />
              </td>
              <td>{event.reason}</td>
              <td>{date(event.createdAt)}</td>
              <td>
                <button
                  className="icon-button"
                  aria-label={`Inspect ${event.id}`}
                  onClick={() => open(event)}
                >
                  <ChevronRight size={16} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!items.length && (
        <Empty
          title="No recorded actions"
          description="Actions routed through this local gateway will appear here."
        />
      )}
    </div>
  );
}

export default function App() {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [auth, setAuth] = useState<"loading" | "login" | "ready">("loading");
  const [setup, setSetup] = useState<Setup | null>(null);
  const [landing, setLanding] = useState<Landing | null>(null);
  const [connectionAttempt, setConnectionAttempt] = useState(0);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState<Page>("Overview");
  const [mobileNav, setMobileNav] = useState(false);
  const [connected, setConnected] = useState(false);
  const [selected, setSelected] = useState<Event | null>(null);
  const [modal, setModal] = useState<"agent" | "stop" | null>(null);
  const [created, setCreated] = useState<{
    agent: Agent;
    token: string;
  } | null>(null);
  const refresh = useCallback(async () => {
    try {
      const value: Workspace = await api("/workspace");
      setWorkspace(value);
      setConnected(true);
      setAuth("ready");
    } catch (err) {
      setConnected(false);
      if ((err as { status?: number }).status === 401) {
        setCsrf("");
        setSession(null);
        setWorkspace(null);
        setCreated(null);
        setAuth("login");
      } else {
        setError(message(err));
        throw err;
      }
    }
  }, []);
  const clearSession = useCallback(() => {
    setCsrf(""); setSession(null); setWorkspace(null); setCreated(null);
    setSelected(null); setModal(null); setError(""); setToast(""); setAuth("login");
  }, []);
  const signedIn = async (value: Session) => {
    setLanding(null); setSetup(previous => previous ? {...previous, initialized: previous.managed || previous.initialized} : previous);
    setSession(value); setCsrf(value.csrfToken); setError(""); await refresh();
  };
  useEffect(() => {
    let active = true;
    const match = /^#(invite|reset)=([^&]+)$/.exec(window.location.hash);
    if (match) {
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
      setLanding({kind: match[1] as "invite" | "reset", token: match[2]});
    }
    setAuth("loading"); setError("");
    void api("/setup").then(async (value: Setup) => {
      if (!active) return;
      setSetup(value);
      if (match) { setAuth("login"); return; }
      try {
        const current: Session = await api("/session");
        if (!active) return;
        setSession(current); setCsrf(current.csrfToken); await refresh();
      } catch (err) {
        if (active) { setAuth("login"); if ((err as {status?:number}).status !== 401) setError(message(err)); }
      }
    }).catch(err => { if(active) {setSetup(null); setAuth("login"); setError(message(err));} });
    return () => { active = false; };
  }, [refresh, connectionAttempt]);
  useEffect(() => {
    const unauthorized = () => { if (session) clearSession(); };
    window.addEventListener("agentbrake:unauthorized", unauthorized);
    return () => window.removeEventListener("agentbrake:unauthorized", unauthorized);
  }, [session, clearSession]);
  useEffect(() => {
    const readHash = () => {
      const landingMatch = /^#(invite|reset)=([^&]+)$/.exec(window.location.hash);
      if (landingMatch) {
        window.history.replaceState(null, "", window.location.pathname + window.location.search);
        clearSession();
        setLanding({kind: landingMatch[1] as "invite" | "reset", token: landingMatch[2]});
        return;
      }
      try {
        const next = decodeURIComponent(window.location.hash.slice(1));
        if (navigation.some(([name]) => name === next)) setPage(next as Page);
      } catch {
        /* Invalid hash leaves the current page. */
      }
    };
    readHash();
    window.addEventListener("hashchange", readHash);
    return () => window.removeEventListener("hashchange", readHash);
  }, [clearSession]);
  useEffect(() => {
    if (auth !== "ready") return;
    const timer = setInterval(() => {
      if (!document.hidden) void refresh().catch(() => {});
    }, 10_000);
    return () => clearInterval(timer);
  }, [auth, refresh]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 4500);
    return () => clearTimeout(timer);
  }, [toast]);
  const navigate = (next: Page) => {
    setPage(next);
    window.location.hash = encodeURIComponent(next);
    setMobileNav(false);
  };
  const mutate: Mutate = async (path, body, success, method) => {
    setBusy(true);
    setError("");
    try {
      const result = await api(path, body, method);
      // Return already-issued credentials even if the subsequent read fails.
      await refresh().catch(() => {});
      setToast(success);
      return result;
    } catch (err) {
      setError(message(err));
      return null;
    } finally {
      setBusy(false);
    }
  };
  const logout = async () => {
    try {
      await api("/logout", {});
      clearSession();
    } catch (err) {
      setError(message(err));
    }
  };
  if (auth === "loading")
    return (
      <div className="loading-screen">
        <Logo />
        <Loader2 className="spin" />
        <p>Reading your local session…</p>
      </div>
    );
  if (auth === "login" || !workspace || !session)
    return <AuthPanel setup={setup} landing={landing} onSession={signedIn} onReset={() => {setLanding(null); clearSession();}} initialError={error} retry={() => setConnectionAttempt(value => value + 1)} />;
  const actor = session.actor;
  const manage = ["administrator", "operator"].includes(actor.role);
  const configure = actor.role === "administrator";
  const pending = workspace.actions.filter(
    (action) => action.status === "pending",
  );
  const blocked = workspace.actions.filter(
    (action) => action.status === "blocked",
  );
  const unknown = workspace.actions.filter(
    (action) => action.status === "unknown",
  );
  const open = (event: Event) => setSelected(event);
  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileNav ? "open" : ""}`}>
        <Logo />
        <div className="workspace-switch">
          <span className="workspace-avatar">L</span>
          <span>
            <strong>Local workspace</strong>
            <small>
              {session.teamMode
                ? "Independent team review"
                : "Single-owner compatibility fixture"}
            </small>
          </span>
        </div>
        <div className="nav-label">CONTROL CENTER</div>
        <nav aria-label="Main navigation">
          {navigation.filter(([name]) => name !== "Team" ? name !== "Settings" || session.authMode === "account" : session.authMode === "account" && configure).map(([name, Icon]) => (
            <button
              key={name}
              className={`nav-item ${page === name ? "selected" : ""}`}
              aria-current={page === name ? "page" : undefined}
              onClick={() => navigate(name)}
            >
              <Icon size={18} />
              <span>{name}</span>
              {name === "Approvals" && pending.length > 0 && (
                <b>{pending.length}</b>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-note">
            <Shield size={20} />
            <strong>{workspace.connections.github === 'github-app-sandbox' ? 'Configured sandbox scope' : 'Isolated fixture scope'}</strong>
            <p>
              {workspace.connections.github === 'github-app-sandbox' ? 'GitHub App sandbox and local customer fixture. No production acceptance claim.' : 'Local customer data and repository. No live service verification.'}
            </p>
          </div>
          <button
            className="user-profile"
            onClick={() => void logout()}
            title="Sign out"
          >
            <span className="avatar">
              {actor.name.slice(0, 2).toUpperCase()}
            </span>
            <span>
              <strong>{actor.name}</strong>
              <small>
                {actor.role} · {actor.tenant}
              </small>
            </span>
            <LogOut size={16} />
          </button>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumbs">
            <button
              className="icon-button mobile-menu"
              aria-label="Toggle navigation"
              onClick={() => setMobileNav(!mobileNav)}
            >
              <Menu />
            </button>
            <span>{workspace.connections.github === 'github-app-sandbox' ? 'Private sandbox' : 'Local fixture'}</span>
            <ChevronRight size={13} />
            <strong>{page}</strong>
          </div>
          <div className="topbar-right">
            <span
              className={`connection-state ${connected ? "connected" : ""}`}
            >
              <span className="dot" />
              {connected ? "API observed · 10s polling" : "API unavailable"}
            </span>
          </div>
        </header>
        <main className="main-content">
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                AGENT SECURITY / LOCAL CONTROL CENTER
              </div>
              <h1>{page === "Overview" ? "Security overview" : page}</h1>
              <p>
                {actor.name} · {actor.role} ·{" "}
                {session.teamMode
                  ? "Team controls enabled"
                  : "Single-owner compatibility mode"}
              </p>
            </div>
            <div className="heading-actions">
              {manage && (
                <button
                  className="button dark"
                  onClick={() => {
                    setCreated(null);
                    setModal("agent");
                  }}
                >
                  <Plus size={16} />
                  Create task identity
                </button>
              )}
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => void refresh().catch(() => {})}
              >
                Refresh
              </button>
            </div>
          </div>
          {error && (
            <div className="error error-banner" role="alert">
              {error}
              <button aria-label="Dismiss error" onClick={() => setError("")}>
                <X size={16} />
              </button>
            </div>
          )}
          <div className="info-bar scope-banner">
            <Shield size={18} />
            <p>
              {workspace.connections.github === 'github-app-sandbox' ? `Configured GitHub sandbox: ${workspace.connections.repository}. Local customer fixture. ` : 'Isolated local fixtures: customers and agentbrake/sandbox. '}Counts
              describe the recorded workspace snapshot, not target connectivity
              or production coverage.
            </p>
          </div>
          {workspace.paused && (
            <div className="pause-banner">
              <Pause size={18} />
              <span>
                <strong>Emergency stop is active.</strong> New and queued
                actions are blocked. Dispatched changes are not rolled back.
              </span>
              {configure && (
                <button
                  disabled={busy}
                  onClick={() =>
                    void mutate(
                      "/control",
                      { paused: false },
                      "Gateway resumed.",
                    )
                  }
                >
                  Resume gateway
                </button>
              )}
            </div>
          )}
          {(page === "Overview" || page === "Connections") && <button className="button secondary onboarding-link" onClick={() => navigate("Get started")}>Get started: Connect a scoped task <ArrowRight size={15} /></button>}
          {page === "Get started" && <GettingStarted />}
          {page === "Settings" && session.authMode === "account" && <SettingsPanel onSignedOut={clearSession} onProfile={async () => { const current: Session = await api("/session"); setSession(current); await refresh(); }} />}
          {page === "Team" && session.authMode === "account" && configure && <TeamPanel revision={workspace.updatedAt} />}
          {page === "Team" && !(session.authMode === "account" && configure) && <p>Administrator access is required for team management.</p>}
          {page === "Overview" && (
            <>
              <section className="guard-banner">
                <div className="guard-copy">
                  <div className="guard-status">
                    <span className="dot" />
                    {workspace.paused
                      ? "STOP ACTIVE"
                      : "LOCAL GATEWAY CONTROLS"}
                  </div>
                  <h2>Autonomy, with boundaries.</h2>
                  <p>
                    Inspect decisions and recorded execution outcomes for calls
                    routed through this gateway.
                  </p>
                  <div className="guard-meta">
                    <Shield size={14} />
                    Scoped grants
                    <i />
                    Exact action review
                    <i />
                    Recorded evidence
                  </div>
                </div>
                <div className="flow">
                  <div className="flow-node">
                    <span>
                      <Bot />
                    </span>
                    <small>Agent</small>
                  </div>
                  <div className="flow-line" />
                  <div className="flow-node brake">
                    <span>
                      <Shield />
                    </span>
                    <small>Gateway</small>
                  </div>
                  <div className="flow-line" />
                  <div className="flow-node">
                    <span>
                      <Database />
                    </span>
                    <small>Fixture</small>
                  </div>
                </div>
              </section>
              <section className="metrics product-metrics">
                <Metric
                  icon={<Activity size={17} />}
                  label="Recorded actions"
                  value={workspace.actions.length}
                  detail="Current workspace snapshot"
                  bars={[]}
                  tone="neutral"
                />
                <Metric
                  icon={<Shield size={17} />}
                  label="Blocked"
                  value={blocked.length}
                  detail="No dispatch permitted by decision"
                  bars={[]}
                  tone="red"
                />
                <Metric
                  icon={<FileCheck2 size={17} />}
                  label="Awaiting approval"
                  value={pending.length}
                  detail="Pending is not execution"
                  bars={[]}
                  tone="amber"
                />
                <Metric
                  icon={<Bot size={17} />}
                  label="Active identities"
                  value={
                    workspace.agents.filter(
                      (agent) => agent.status === "active",
                    ).length
                  }
                  detail={`${workspace.agents.length} registered identities`}
                  bars={[]}
                  tone="green"
                />
              </section>
              {unknown.length > 0 && (
                <div className="error" role="alert">
                  {unknown.length} UNKNOWN outcome(s). Reconcile target state
                  with the action correlation ID before taking any further
                  action. Do not resubmit.
                </div>
              )}
              <section className="panel">
                <div className="panel-heading">
                  <h2>Recent activity</h2>
                  <button
                    className="text-button"
                    onClick={() => navigate("Activity")}
                  >
                    View all <ArrowRight size={14} />
                  </button>
                </div>
                <ActionTable
                  items={workspace.actions.slice(0, 8)}
                  open={open}
                />
              </section>
              <div className="bottom-grid">
                <section className="panel protection-panel">
                  <Shield />
                  <div>
                    <h3>Audit chain</h3>
                    <p>
                      {workspace.auditValid
                        ? "Recorded chain validated by the control API."
                        : "Chain verification failed. Inspect evidence."}
                    </p>
                  </div>
                </section>
                <section className="panel stop-panel">
                  <Square size={16} />
                  <div>
                    <h3>Emergency stop</h3>
                    <p>
                      Blocks new dispatch. Does not recall work already
                      dispatched.
                    </p>
                  </div>
                  {configure && (
                    <button
                      className="button stop-button"
                      onClick={() => setModal("stop")}
                    >
                      {workspace.paused ? "Resume" : "Emergency stop"}
                    </button>
                  )}
                </section>
              </div>
            </>
          )}
          {page === "Tasks" && (
            <Tasks
              agents={workspace.agents}
              manage={manage}
              busy={busy}
              mutate={mutate}
            />
          )}
          {page === "Activity" && (
            <ActivityPage open={open} revision={workspace.updatedAt} />
          )}
          {page === "Approvals" && (
            <>
              <div className="info-bar">
                <Fingerprint size={18} />
                <p>
                  Review the immutable target, exact arguments and adapter
                  preview before submitting a one-time proof.{" "}
                  {session.teamMode &&
                    "Mutation reviewers must be a different human from the task grant owner."}
                </p>
              </div>
              <section className="panel">
                <ActionTable items={pending} open={open} />
              </section>
            </>
          )}
          {page === "Policies" && (
            <>
              <PolicyEditor
                policies={workspace.policies}
                busy={busy}
                readOnly={!configure}
                save={(policies) =>
                  mutate(
                    "/policies",
                    policies,
                    "Policy saved. Pending requests will be rechecked.",
                    "PUT",
                  )
                }
              />
              <PolicyHistory revision={json(workspace.policies)} />
            </>
          )}
          {page === "Connections" && <Connections workspace={workspace} />}
          {page === "Evidence" && (
            <EvidencePage
              actions={workspace.actions}
              revision={workspace.updatedAt}
            />
          )}
          {page === "Demo Lab" && (
            <DemoLab manage={manage} busy={busy} mutate={mutate} open={open} />
          )}
          <footer className="workspace-footer">
            <span>
              <Shield size={12} />
              AgentBrake · Local fixture
            </span>
            <span>
              API snapshot {date(workspace.updatedAt)} · Audit chain{" "}
              {workspace.auditValid ? "valid" : "invalid"}
            </span>
          </footer>
        </main>
      </div>
      {toast && (
        <div className="toast" role="status">
          <CheckCheck size={18} />
          {toast}
        </div>
      )}
      {selected && (
        <ActionReview
          event={selected}
          workspace={workspace}
          session={session}
          refresh={refresh}
          close={() => setSelected(null)}
        />
      )}
      {modal === "agent" && (
        <Modal
          title={created ? "Task identity created" : "Create task identity"}
          close={() => {
            setModal(null);
            setCreated(null);
          }}
        >
          {created ? (
            <div className="detail-body">
              <div className="success-note">Your scoped identity is ready.</div>
              <p>
                Copy this bearer now. It is shown once and is cleared when this
                dialog closes. Review and narrow the server-issued task grant in
                Tasks before using this bearer.
              </p>
              <label>Agent bearer token</label>
              <div className="token-row">
                <code>{created.token}</code>
                <button
                  className="icon-button"
                  aria-label="Copy agent token"
                  onClick={() =>
                    void navigator.clipboard
                      .writeText(created.token)
                      .then(() => setToast("Agent token copied."))
                      .catch(() =>
                        setError(
                          "Clipboard unavailable. Copy the displayed bearer manually.",
                        ),
                      )
                  }
                >
                  <Copy size={17} />
                </button>
              </div>
              <button
                className="button dark wide"
                onClick={() => {
                  setCreated(null);
                  setModal(null);
                  navigate("Tasks");
                }}
              >
                Configure task grant
              </button>
            </div>
          ) : (
            <IdentityForm
              busy={busy}
              appRepository={workspace.connections.github === 'github-app-sandbox' ? workspace.connections.repository : undefined}
              create={async (body) => {
                const result = await mutate(
                  "/agents",
                  body,
                  "Scoped identity created.",
                );
                if (result) setCreated(result);
              }}
            />
          )}
        </Modal>
      )}
      {modal === "stop" && (
        <Modal
          title={
            workspace.paused ? "Resume gateway?" : "Pause all agent actions?"
          }
          close={() => setModal(null)}
        >
          <div className="detail-body">
            <p>
              {workspace.paused
                ? "New calls will be evaluated under current policies."
                : "New calls and queued approvals will be blocked. Operations already dispatched cannot be recalled or rolled back."}
            </p>
          </div>
          <div className="modal-actions">
            <button className="button secondary" onClick={() => setModal(null)}>
              Cancel
            </button>
            <button
              className="button danger"
              disabled={busy}
              onClick={async () => {
                if (
                  await mutate(
                    "/control",
                    { paused: !workspace.paused },
                    workspace.paused
                      ? "Gateway resumed."
                      : "Emergency stop activated.",
                  )
                )
                  setModal(null);
              }}
            >
              {workspace.paused ? "Resume gateway" : "Pause all actions"}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function IdentityForm({
  busy,
  create,
  appRepository,
}: {
  busy: boolean;
  create: (body: unknown) => Promise<void>;
  appRepository?: string;
}) {
  const [name, setName] = useState("");
  const [selected, setSelected] = useState(["github_read_file"]);
  const [scope, setScope] = useState(resources);
  const [live, setLive] = useState(false);
  const identityTools = live ? tools.filter(t => t.startsWith('github_') && t !== 'github_create_issue') : tools;
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void create({ name, tools: selected, resources: scope, sandbox: !live });
      }}
    >
      <div className="detail-body">
        <p>
          Issue a scoped identity. Its task grant will further
          restrict actions, resources, expiry and budgets.
        </p>
        {appRepository && <><label htmlFor="identity-target">Execution target</label><select id="identity-target" value={live ? 'github' : 'fixture'} onChange={event => {
          const useApp = event.target.value === 'github'; setLive(useApp); setSelected(['github_read_file']); setScope(useApp ? [appRepository] : resources);
        }}><option value="fixture">Local synthetic fixtures</option><option value="github">GitHub App sandbox: {appRepository}</option></select>
        {live && <p>Approved writes affect this GitHub repository. Confirm it is a dedicated disposable sandbox. No merge or main-branch writes are supported.</p>}</>}
        <label htmlFor="agent-name">Agent name</label>
        <input
          id="agent-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
          minLength={2}
          maxLength={60}
        />
        <ToolChecks
          values={identityTools}
          selected={selected}
          set={setSelected}
          label="Allowed identity tools"
        />
        <ToolChecks
          values={live && appRepository ? [appRepository] : resources}
          selected={scope}
          set={setScope}
          label="Identity resources"
        />
      </div>
      <div className="modal-actions">
        <button
          className="button dark wide"
          disabled={busy || !selected.length || !scope.length}
        >
          Create scoped agent
        </button>
      </div>
    </form>
  );
}
function ToolChecks({
  values,
  selected,
  set,
  label,
}: {
  values: string[];
  selected: string[];
  set: (value: string[]) => void;
  label: string;
}) {
  return (
    <fieldset className="scope-checks">
      <legend>{label}</legend>
      <div className="tool-checks">
        {values.map((value) => (
          <label key={value}>
            <input
              type="checkbox"
              checked={selected.includes(value)}
              onChange={(event) =>
                set(
                  event.target.checked
                    ? [...selected, value]
                    : selected.filter((item) => item !== value),
                )
              }
            />
            <code>{value}</code>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
function Tasks({
  agents,
  manage,
  busy,
  mutate,
}: {
  agents: Agent[];
  manage: boolean;
  busy: boolean;
  mutate: Mutate;
}) {
  const [grantAgent, setGrantAgent] = useState<Agent | null>(null);
  return (
    <>
      <div className="agent-grid">
        {agents.map((agent) => (
          <section className="panel agent-card" key={agent.id}>
            <div className="agent-card-head">
              <span className="agent-graphic">
                <Bot size={25} />
              </span>
              <Badge status={agent.status} />
            </div>
            <h2>{agent.name}</h2>
            <p>
              {agent.sandbox
                ? "Isolated fixture identity"
                : "Configured identity"}{" "}
              · {agent.id}
            </p>
            <dl className="task-details">
              <dt>Identity owner</dt>
              <dd>{agent.ownerId ?? "Unavailable"}</dd>
              <dt>Resources</dt>
              <dd>{agent.resources.join(", ")}</dd>
              <dt>Protected data accessed</dt>
              <dd>
                {agent.tainted ? "Yes · outbound boundary applies" : "No"}
              </dd>
              <dt>Bearer expiry</dt>
              <dd>
                {agent.tokenExpiresAt
                  ? date(agent.tokenExpiresAt)
                  : "Unavailable"}
              </dd>
            </dl>
            <div className="agent-scopes">
              {agent.tools.map((tool) => (
                <code key={tool}>{tool}</code>
              ))}
            </div>
            {agent.grant ? (
              <div className="task-grant">
                <h3>Current task grant</h3>
                <Badge
                  status={
                    agent.grant.revoked
                      ? "revoked"
                      : agent.grant.expires_at_ms <= Date.now()
                        ? "expired"
                        : "active"
                  }
                />
                <dl className="task-details">
                  <dt>Grant ID</dt>
                  <dd>{agent.grant.id}</dd>
                  <dt>Human owner</dt>
                  <dd>{agent.grant.human_owner}</dd>
                  <dt>Actions</dt>
                  <dd>{agent.grant.actions.join(", ")}</dd>
                  <dt>Resources</dt>
                  <dd>{agent.grant.resources.join(", ")}</dd>
                  <dt>Environment</dt>
                  <dd>{agent.grant.environments.join(", ")}</dd>
                  <dt>Expires</dt>
                  <dd>{date(agent.grant.expires_at_ms)}</dd>
                  <dt>Calls used / limit</dt>
                  <dd>
                    {agent.grant.used_calls} / {agent.grant.max_calls}
                  </dd>
                  <dt>Maximum rows</dt>
                  <dd>{agent.grant.max_rows}</dd>
                </dl>
              </div>
            ) : (
              <p>
                No task grant recorded. Calls fail closed without a valid grant.
              </p>
            )}
            {manage && (
              <div className="task-actions">
                <button
                  className="button secondary"
                  disabled={busy}
                  onClick={() =>
                    void mutate(
                      `/agents/${agent.id}`,
                      {
                        status: agent.status === "active" ? "paused" : "active",
                      },
                      "Identity state updated.",
                      "PATCH",
                    )
                  }
                >
                  {agent.status === "active" ? "Pause agent" : "Resume agent"}
                </button>
                <button
                  className="button dark"
                  disabled={busy}
                  onClick={() => setGrantAgent(agent)}
                >
                  Grant task
                </button>
                {agent.grant && (
                  <button
                    className="button secondary"
                    disabled={busy || agent.grant.revoked}
                    onClick={() =>
                      void mutate(
                        `/agents/${agent.id}/grant/revoke`,
                        {},
                        "Task grant revoked. Already dispatched work is not rolled back.",
                      )
                    }
                  >
                    Revoke grant
                  </button>
                )}
              </div>
            )}
          </section>
        ))}
      </div>
      {!agents.length && (
        <section className="panel">
          <Empty
            title="No task identities"
            description="An operator or administrator can create an identity and issue a bounded grant."
          />
        </section>
      )}
      {grantAgent && (
        <Modal
          title={`Grant task · ${grantAgent.name}`}
          close={() => setGrantAgent(null)}
        >
          <GrantForm
            agent={grantAgent}
            busy={busy}
            save={async (body) => {
              if (
                await mutate(
                  `/agents/${grantAgent.id}/grant`,
                  body,
                  "Task grant issued.",
                )
              )
                setGrantAgent(null);
            }}
          />
        </Modal>
      )}
    </>
  );
}
function GrantForm({
  agent,
  busy,
  save,
}: {
  agent: Agent;
  busy: boolean;
  save: (body: unknown) => Promise<void>;
}) {
  const [actions, setActions] = useState(
    agent.grant?.actions ?? agent.tools.slice(0, 1),
  );
  const [scope, setScope] = useState(
    agent.grant?.resources ??
      agent.resources,
  );
  const [expiry, setExpiry] = useState(300);
  const [calls, setCalls] = useState(10);
  const [rows, setRows] = useState(1);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void save({
          actions,
          resources: scope,
          environments: ["sandbox"],
          expiresInSeconds: expiry,
          maxCalls: calls,
          maxRows: rows,
        });
      }}
    >
      <div className="detail-body">
        <p>
          Target: {agent.id}. Environment: sandbox. The server records your
          signed-in identity as the human owner.
        </p>
        <ToolChecks
          values={agent.tools}
          selected={actions}
          set={setActions}
          label="Task actions"
        />
        <ToolChecks
          values={agent.resources}
          selected={scope}
          set={setScope}
          label="Task resources"
        />
        <div className="form-grid">
          <label>
            Expiry in seconds
            <input
              aria-label="Expiry in seconds"
              type="number"
              min={30}
              max={3600}
              value={expiry}
              onChange={(event) => setExpiry(Number(event.target.value))}
              required
            />
          </label>
          <label>
            Maximum calls
            <input
              aria-label="Maximum calls"
              type="number"
              min={1}
              max={1000}
              value={calls}
              onChange={(event) => setCalls(Number(event.target.value))}
              required
            />
          </label>
          <label>
            Maximum rows
            <input
              aria-label="Maximum rows"
              type="number"
              min={1}
              max={100}
              value={rows}
              onChange={(event) => setRows(Number(event.target.value))}
              required
            />
          </label>
        </div>
      </div>
      <div className="modal-actions">
        <button
          className="button dark wide"
          disabled={busy || !actions.length || !scope.length}
        >
          Issue task grant
        </button>
      </div>
    </form>
  );
}

function ActionReview({
  event,
  workspace,
  session,
  refresh,
  close,
}: {
  event: Event;
  workspace: Workspace;
  session: Session;
  refresh: () => Promise<void>;
  close: () => void;
}) {
  const [review, setReview] = useState<Review | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [invalidated, setInvalidated] = useState(false);
  const [now, setNow] = useState(Date.now());
  const requested = useRef(event.id);
  useEffect(() => {
    requested.current = event.id;
    let active = true;
    setReview(null);
    setError("");
    setInvalidated(false);
    void api(`/approvals/${event.id}`)
      .then((value) => {
        if (active) setReview(value);
      })
      .catch((err) => {
        if (active) setError(`Review unavailable: ${message(err)}`);
      });
    return () => {
      active = false;
    };
  }, [event.id]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const action = review?.action ?? event;
  const current =
    workspace.actions.find((value) => value.id === action.id) ?? action;
  const status = current.status === "pending" ? action.status : current.status;
  const currentGrant = workspace.agents.find(
    (agent) => agent.id === action.agentId,
  )?.grant;
  const humanOwner = currentGrant?.human_owner;
  const mutation = [
    "database_update",
    "github_create_branch",
    "github_open_pull_request",
    "github_create_issue",
  ].includes(action.tool);
  const own = session.teamMode && mutation && humanOwner === session.actor.id;
  const permitted = ["administrator", "approver"].includes(session.actor.role);
  const expired = Date.parse(action.expiresAt) <= now;
  const decide = async (decision: "approve" | "reject") => {
    if (!review || invalidated || busy) return;
    setBusy(true);
    setError("");
    setInvalidated(true);
    try {
      const result: Event = await api(`/approvals/${action.id}`, {
        decision,
        proof: review.proof,
      });
      if (requested.current === action.id)
        setReview({ ...review, action: result });
      await refresh().catch(() => {});
    } catch (err) {
      setError(
        `${message(err)}. This review cannot be submitted again. Close and inspect the recorded state.`,
      );
      // Read after conflict, but do not acquire a replacement proof or retry.
      if ((err as { status?: number }).status === 409)
        await refresh().catch(() => {});
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="Action details" close={close}>
      <div className="detail-body">
        <div className="detail-badges">
          <Badge status={status} />
          <span className="env-tag">
            {action.sandbox ? "Isolated fixture" : "Configured target"}
          </span>
        </div>
        <h3>{action.tool}</h3>
        <p>{current.reason}</p>
        <dl>
          <dt>Target</dt>
          <dd>{action.resource}</dd>
          <dt>Destination</dt>
          <dd className="break-all">{action.destination}</dd>
          <dt>Agent</dt>
          <dd className="break-all">{action.agentId}</dd>
          <dt>Grant</dt>
          <dd className="break-all">{action.grantId ?? "Unavailable"}</dd>
          <dt>Grant fingerprint</dt>
          <dd className="break-all">
            <code>{action.grantFingerprint}</code>
          </dd>
          <dt>Policy hash</dt>
          <dd className="break-all">
            <code>{action.policyHash}</code>
          </dd>
          <dt>Expires</dt>
          <dd>
            {date(action.expiresAt)}
            {expired ? " · Expired" : ""}
          </dd>
          <dt>Reviewer</dt>
          <dd>
            {session.actor.name} ({session.actor.id}) · {session.actor.role}
          </dd>
          <dt>Fingerprint</dt>
          <dd className="break-all">
            <code>{review?.proof.fingerprint ?? "Unavailable"}</code>
          </dd>
          <dt>Correlation</dt>
          <dd className="break-all">{action.correlationId}</dd>
        </dl>
        <label>Current task scope</label>
        <p>
          Current grant metadata is shown for context. The reviewed action is
          bound to the grant fingerprint above; changed authority is rechecked
          before dispatch.
        </p>
        <pre>{json(currentGrant ?? { unavailable: true })}</pre>
        <label>Exact arguments</label>
        <pre>{json(action.arguments)}</pre>
        <label>Immutable adapter preview</label>
        {review?.action.preview ? (
          <div data-testid="action-preview">
            <h3>{review.action.preview.summary}</h3>
            <p>{review.action.preview.kind}</p>
            <pre>{json(review.action.preview.details)}</pre>
          </div>
        ) : (
          <p>Preview unavailable. Approval is disabled.</p>
        )}
        {status === "unknown" && (
          <div className="error" role="alert">
            UNKNOWN: dispatch may have changed the target. Reconcile target
            state and audit evidence using the correlation ID. Do not retry or
            resubmit.
          </div>
        )}
        {action.approvalReceipt && (
          <>
            <label>Recorded reviewer receipt</label>
            <pre>{json(action.approvalReceipt)}</pre>
          </>
        )}
        {own && (
          <div className="error" role="alert">
            Independent reviewer required. You own this task grant and cannot
            approve its mutation.
          </div>
        )}
        {!permitted && (
          <p>
            Your {session.actor.role} role can inspect actions. An approver or
            administrator must review them.
          </p>
        )}
        {error && (
          <div className="error" role="alert">
            {error}
          </div>
        )}
        <a
          className="button secondary"
          href={`/api/evidence/${action.id}/export?format=json`}
          download
        >
          <ArrowDownToLine size={15} />
          Export evidence JSON
        </a>
      </div>
      {status === "pending" && (
        <div className="modal-actions">
          <button
            className="button secondary"
            disabled={busy || !review || invalidated || !permitted}
            onClick={() => void decide("reject")}
          >
            Reject action
          </button>
          <button
            className="button dark"
            disabled={
              busy ||
              !review?.action.preview ||
              invalidated ||
              !permitted ||
              own ||
              expired
            }
            onClick={() => void decide("approve")}
          >
            Approve &amp; execute
          </button>
        </div>
      )}
    </Modal>
  );
}

function ActivityPage({
  open,
  revision,
}: {
  open: (event: Event) => void;
  revision: string;
}) {
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [applied, setApplied] = useState<Record<string, string>>({});
  const [offset, setOffset] = useState(0);
  const [result, setResult] = useState<{
    items: Event[];
    total: number;
    limit: number;
  } | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setError("");
    setResult(null);
    const params = new URLSearchParams({
      offset: String(offset),
      limit: "50",
      ...applied,
    });
    void api(`/activity?${params}`)
      .then((value) => {
        if (active) setResult(value);
      })
      .catch((err) => {
        if (active) setError(message(err));
      });
    return () => {
      active = false;
    };
  }, [applied, offset, revision]);
  return (
    <section className="panel">
      <div className="panel-heading">
        <h2>Recorded activity</h2>
        <div className="task-actions">
          <a
            className="button secondary"
            href="/api/audit/export?format=json"
            download
          >
            Audit JSON
          </a>
          <a
            className="button secondary"
            href="/api/audit/export?format=csv"
            download
          >
            Audit CSV
          </a>
        </div>
      </div>
      <form
        className="filter-grid"
        onSubmit={(event) => {
          event.preventDefault();
          const values: Record<string, string> = {};
          for (const [key, value] of Object.entries(filters))
            if (value.trim())
              values[key] = ["from", "to"].includes(key)
                ? new Date(value).toISOString()
                : value.trim();
          setOffset(0);
          setApplied(values);
        }}
      >
        {["agentId", "grantId", "tool", "resource", "from", "to"].map((key) => (
          <label key={key}>
            {
              (
                {
                  agentId: "Agent ID",
                  grantId: "Grant ID",
                  tool: "Tool",
                  resource: "Resource",
                  from: "From",
                  to: "To",
                } as Record<string, string>
              )[key]
            }
            <input
              type={["from", "to"].includes(key) ? "datetime-local" : "text"}
              value={filters[key] ?? ""}
              onChange={(event) =>
                setFilters({ ...filters, [key]: event.target.value })
              }
            />
          </label>
        ))}
        <label>
          Status
          <select
            value={filters.status ?? ""}
            onChange={(event) =>
              setFilters({ ...filters, status: event.target.value })
            }
          >
            <option value="">All</option>
            {[
              "queued",
              "pending",
              "executing",
              "allowed",
              "blocked",
              "failed",
              "unknown",
            ].map((status) => (
              <option key={status}>{status}</option>
            ))}
          </select>
        </label>
        <button className="button dark">Apply filters</button>
      </form>
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      {result ? (
        <>
          <ActionTable items={result.items} open={open} />
          <div className="panel-footer">
            <span>
              {result.total ? offset + 1 : 0}–{offset + result.items.length} of{" "}
              {result.total} matching actions
            </span>
            <div className="task-actions">
              <button
                className="button secondary"
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - 50))}
              >
                Previous
              </button>
              <button
                className="button secondary"
                disabled={offset + result.items.length >= result.total}
                onClick={() => setOffset(offset + 50)}
              >
                Next
              </button>
            </div>
          </div>
        </>
      ) : (
        !error && <div className="section-pad">Loading activity…</div>
      )}
    </section>
  );
}
function PolicyHistory({ revision }: { revision: string }) {
  const [items, setItems] = useState<{ version: number; policies: Policies }[]>(
    [],
  );
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void api("/policies/history")
      .then((value) => {
        if (active) {
          setItems(value.items);
          setError("");
        }
      })
      .catch((err) => {
        if (active) setError(message(err));
      });
    return () => {
      active = false;
    };
  }, [revision]);
  const ordered = [...items].sort((a, b) => a.version - b.version);
  return (
    <section className="panel history-panel">
      <div className="panel-heading">
        <div>
          <h2>Policy revision history</h2>
          <p>
            Read-only recorded differences. Historical timestamps are
            unavailable.
          </p>
        </div>
      </div>
      {error && (
        <div className="error" role="alert">
          History unavailable: {error}
        </div>
      )}
      {ordered.map((item, index) => (
        <details key={item.version}>
          <summary>Revision {item.version}</summary>
          <pre>{json(item.policies)}</pre>
          <dl className="task-details">
            {(Object.keys(item.policies) as (keyof Policies)[]).map((key) => (
              <div key={key}>
                <dt>{key}</dt>
                <dd>
                  {index
                    ? `${ordered[index - 1].policies[key]} → ${item.policies[key]}`
                    : `Initial recorded: ${item.policies[key]}`}
                </dd>
              </div>
            ))}
          </dl>
        </details>
      ))}
    </section>
  );
}
function Connections({ workspace }: { workspace: Workspace }) {
  return (
    <>
      <div className="integration-grid">
        {[
          [
            workspace.connections.github === 'github-app-sandbox' ? 'GitHub App sandbox' : 'Repository fixture',
            workspace.connections.github,
            workspace.connections.repository,
          ],
          ["Customer fixture", workspace.connections.database, "customers"],
        ].map(([name, status, target]) => (
          <section className="panel integration-card" key={name}>
            <span className="integration-icon">
              <Plug size={28} />
            </span>
            <Badge status={status} />
            <h2>{name}</h2>
            <p>
              Control API configuration status. Target connectivity is not
              verified here.
            </p>
            <div className="integration-state">
              <span>Target</span>
              <code>{target}</code>
            </div>
            <p className="integration-note">
              {status === 'github-app-sandbox' ? 'A real disposable GitHub repository is configured. Writes require independent approval. Configuration does not prove live connectivity or production acceptance.' : 'Local synthetic fixture. No real system credentials or production data are used.'}
            </p>
          </section>
        ))}
      </div>
      <section className="panel config-panel">
        <div className="panel-heading">
          <div>
            <h2>Connect your MCP client</h2>
            <p>
              Server-provided configuration template. Replace the bearer
              placeholder with a scoped identity token in your client.
            </p>
          </div>
        </div>
        <pre>{json({ mcpServers: { agentbrake: workspace.mcp } })}</pre>
        <div className="panel-footer">
          The dashboard does not proxy agent tool traffic or provide target
          credentials.
        </div>
      </section>
    </>
  );
}
function EvidencePage({
  actions,
  revision,
}: {
  actions: Event[];
  revision: string;
}) {
  const [id, setId] = useState("");
  const [evidence, setEvidence] = useState<Evidence | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setEvidence(null);
    setError("");
    if (id)
      void api(`/evidence/${id}`)
        .then((value) => {
          if (active) setEvidence(value);
        })
        .catch((err) => {
          if (active) setError(message(err));
        });
    return () => {
      active = false;
    };
  }, [id, revision]);
  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <h2>Action evidence</h2>
          <p>
            Decision, review receipt, dispatch observation and bounded audit
            entries.
          </p>
        </div>
      </div>
      <div className="section-pad">
        <label htmlFor="evidence-action">Recorded action</label>
        <select
          id="evidence-action"
          value={id}
          onChange={(event) => setId(event.target.value)}
        >
          <option value="">Choose an action</option>
          {actions.map((action) => (
            <option key={action.id} value={action.id}>
              {action.tool} · {action.status} · {action.id}
            </option>
          ))}
        </select>
        {error && (
          <div className="error" role="alert">
            {error}
          </div>
        )}
        {id && !evidence && !error && (
          <p role="status">Refreshing selected evidence...</p>
        )}
        {evidence && (
          <div className="evidence-detail">
            <Badge status={evidence.execution.status} />
            <h3>Execution observation: {evidence.execution.observation}</h3>
            <p>Result disclosure: {evidence.execution.resultDisclosure ?? "unrecorded"}</p>
            {evidence.execution.resultDisclosure === "withheld" && (
              <p role="alert">Tool output was withheld after execution. This does not undo the action. Do not resubmit; reconcile target state if needed.</p>
            )}
            {evidence.execution.outcome === "not-applied" && (
              <p>The adapter reported that the reviewed target changed and no mutation was applied. The request was dispatched.</p>
            )}
            <p>
              {evidence.execution.observation === "unverified" ||
              evidence.execution.status === "unknown"
                ? "Outcome is unverified. Reconcile target state using the correlation ID. Do not resubmit this action."
                : evidence.execution.observation === "not-dispatched"
                  ? "No target dispatch was recorded for this action."
                  : "The adapter reported this outcome. This is not an independent target-state verification."}
            </p>
            <p>{evidence.coverage}</p>
            <div className="task-actions">
              <a
                className="button secondary"
                href={`/api/evidence/${id}/export?format=json`}
                download
              >
                Export evidence JSON
              </a>
              <a
                className="button secondary"
                href={`/api/evidence/${id}/export?format=csv`}
                download
              >
                Export evidence CSV
              </a>
            </div>
            <label>Decision and policy hash</label>
            <pre>{json(evidence.decision)}</pre>
            <label>Review and immutable preview</label>
            <pre>{json(evidence.review)}</pre>
            <label>Execution and correlation</label>
            <pre>{json(evidence.execution)}</pre>
            <label>
              Audit · {evidence.audit.valid ? "valid chain" : "invalid chain"}
            </label>
            <p>
              {evidence.audit.verification ??
                "The control API checked its stored chain. This display is not an independent full-chain proof."}
            </p>
            <pre>{json(evidence.audit.entries)}</pre>
          </div>
        )}
      </div>
    </section>
  );
}
function DemoLab({
  manage,
  busy,
  mutate,
  open,
}: {
  manage: boolean;
  busy: boolean;
  mutate: Mutate;
  open: (event: Event) => void;
}) {
  const [result, setResult] = useState<{
    actions: Event[];
    message: string;
  } | null>(null);
  return (
    <>
      <div className="info-bar">
        <Terminal size={18} />
        <p>
          These scenarios submit real requests through the local gateway and
          policy engine. They affect disposable fixtures only. Pending changes
          still require human review.
        </p>
      </div>
      <div className="boundary-grid">
        {[
          ["safe-read", "Safe read", "Read a bounded customer fixture sample."],
          [
            "blocked-sql",
            "Blocked destructive SQL",
            "Observe default-deny for an unsupported destructive SQL request.",
          ],
          [
            "pr-approval",
            "PR approval",
            "Queue a local repository change for independent human review.",
          ],
        ].map(([scenario, name, description]) => (
          <section className="panel boundary-card" key={scenario}>
            <h3>{name}</h3>
            <p>{description}</p>
            <button
              className="button dark"
              disabled={!manage || busy}
              onClick={async () => {
                setResult(null);
                const value = await mutate(
                  "/demo",
                  { scenario },
                  "Demo requests recorded. Inspect their outcomes.",
                );
                if (value) setResult(value);
              }}
            >
              <Play size={14} />
              Run {name}
            </button>
          </section>
        ))}
      </div>
      {!manage && (
        <p className="section-pad">
          An operator or administrator can run these scenarios.
        </p>
      )}
      {result && (
        <section className="panel">
          <div className="panel-heading">
            <h2>{result.message}</h2>
          </div>
          <ActionTable items={result.actions} open={open} />
        </section>
      )}
    </>
  );
}

