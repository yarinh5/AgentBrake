import { useEffect, useRef, useState, type ReactNode } from "react";
import { Shield, Check, ShieldAlert, Clock3, ShieldCheck, X, BookOpen, Database, Github, LockKeyhole, Fingerprint, FileCheck2 } from "lucide-react";
import type { Event, Policies } from "./types";
export function Logo({ small = false }: { small?: boolean }) {
  return (
    <div className={"brand " + (small ? "small" : "")}>
      <span className="brand-mark">
        <Shield size={24} strokeWidth={2.1} />
        <i />
        <b />
      </span>
      {!small && (
        <span>
          agent<span className="brand-bold">brake</span>
          <span className="brand-dot">.</span>
        </span>
      )}
    </div>
  );
}
export function Badge({ status }: { status: string }) {
  return (
    <span className={"badge " + status}>
      {status === "allowed" ? (
        <Check size={12} />
      ) : status === "blocked" ? (
        <ShieldAlert size={12} />
      ) : status === "pending" ? (
        <Clock3 size={12} />
      ) : (
        <span className="dot" />
      )}
      {status === "pending"
        ? "Needs approval"
        : status[0].toUpperCase() + status.slice(1)}
    </span>
  );
}
export function Empty({
  title,
  description,
  icon = <ShieldCheck size={28} />,
}: {
  title: string;
  description: string;
  icon?: ReactNode;
}) {
  return (
    <div className="empty">
      <span>{icon}</span>
      <h3>{title}</h3>
      <p>{description}</p>
    </div>
  );
}
export function Modal({
  title,
  children,
  close,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  return (
    <dialog
      ref={dialog}
      onCancel={close}
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="modal-head">
        <h2>{title}</h2>
        <button
          className="icon-button"
          onClick={close}
          aria-label="Close dialog"
        >
          <X size={19} />
        </button>
      </div>
      {children}
    </dialog>
  );
}

export function Metric({
  icon,
  label,
  value,
  detail,
  bars,
  tone,
}: {
  icon: ReactNode;
  label: string;
  value: number;
  detail: string;
  bars: Event[];
  tone: string;
}) {
  // The small bars are an event timeline, not invented metrics.
  const buckets = Array.from(
    { length: 16 },
    (_, i) =>
      bars.filter((a) => {
        const age = Date.now() - Date.parse(a.createdAt);
        return age >= (15 - i) * 60_000 && age < (16 - i) * 60_000;
      }).length,
  );
  const max = Math.max(1, ...buckets);
  return (
    <div className={"metric-card " + tone}>
      <div className="metric-label">
        {label}
        {icon}
      </div>
      <div className="metric-middle">
        <strong>{value.toLocaleString()}</strong>
        {bars.length > 0 ? (
          <div
            className="mini-bars"
            role="img"
            aria-label="Events per minute over the last 16 minutes"
          >
            {buckets.map((n, i) => (
              <span
                key={i}
                style={{
                  height: `${Math.max(6, (n / max) * 100)}%`,
                  opacity: n ? 1 : 0.14,
                }}
              />
            ))}
          </div>
        ) : (
          <span className="metric-empty-line" />
        )}
      </div>
      <p>{detail}</p>
    </div>
  );
}
export function PolicyEditor({
  policies,
  save,
  busy,
  readOnly = false,
}: {
  readOnly?: boolean;
  policies: Policies;
  save: (p: Policies) => Promise<unknown>;
  busy: boolean;
}) {
  const [draft, setDraft] = useState(policies);
  useEffect(
    () => setDraft(policies),
    [policies.reads, policies.databaseWrites, policies.githubWrites],
  );
  const items = [
    {
      key: "reads",
      icon: BookOpen,
      title: "Scoped read operations",
      description:
        "Read approved repository files and customer records within the agent grant.",
    },
    {
      key: "databaseWrites",
      icon: Database,
      title: "Customer record changes",
      description:
        "A structured status change to one customer. Raw SQL and bulk writes are never exposed.",
    },
    {
      key: "githubWrites",
      icon: Github,
      title: "Repository mutations",
      description:
        "Create branches, local pull requests and issues. Protected-data boundaries still apply.",
    },
  ] as const;
  return (
    <>
      <section className="panel policy-editor">
        <div className="panel-heading">
          <div>
            <h2>Workspace policies</h2>
            <p>Apply decisions consistently to every connected agent.</p>
          </div>
          <span className="env-tag">ENFORCED</span>
        </div>
        {items.map(({ key, icon: Icon, title, description }) => (
          <div className="policy-row" key={key}>
            <span className="square-icon">
              <Icon size={21} />
            </span>
            <div>
              <h3>{title}</h3>
              <p>{description}</p>
            </div>
            <select
              aria-label={title}
              disabled={readOnly}
              value={draft[key]}
              onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
            >
              {key === "reads" && (
                <option value="allow">Allow within scope</option>
              )}
              <option value="approval">Require approval</option>
              <option value="deny">Always block</option>
            </select>
          </div>
        ))}
        <div className="panel-footer">
          <span>New policies also apply to pending requests.</span>
          <button
            className="button dark"
            disabled={
              readOnly || busy || JSON.stringify(draft) === JSON.stringify(policies)
            }
            onClick={() => void save(draft)}
          >
            Save policies <Check size={15} />
          </button>
        </div>
      </section>
      <h2 className="section-title">
        Always-on boundaries <LockKeyhole size={16} />
      </h2>
      <div className="boundary-grid">
        {[
          {
            title: "Default deny",
            text: "Unknown tools, ungranted resources and invalid arguments are blocked.",
            icon: ShieldCheck,
          },
          {
            title: "Credential protection",
            text: "Known secret paths and credential patterns are blocked. This is a heuristic, not a complete DLP scanner.",
            icon: LockKeyhole,
          },
          {
            title: "Protected data boundary",
            text: "After reading customer data, an identity cannot create outbound GitHub issues.",
            icon: Fingerprint,
          },
          {
            title: "One action, one approval",
            text: "Approvals bind exact arguments and expire at the time shown in the review.",
            icon: FileCheck2,
          },
        ].map(({ title, text, icon: Icon }) => (
          <section className="panel boundary-card" key={title}>
            <Icon size={22} />
            <h3>{title}</h3>
            <p>{text}</p>
            <span>
              <Check size={13} />
              Always enforced
            </span>
          </section>
        ))}
      </div>
    </>
  );
}
