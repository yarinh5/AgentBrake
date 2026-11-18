import { useEffect, useState, type FormEvent } from "react";
import { api } from "../api";
import type { Account, Actor, Team } from "../types";

const roles: Actor["role"][] = ["administrator", "operator", "approver", "viewer"];
const message = (err: unknown) => err instanceof Error ? err.message : "Request failed";
const passwordValid = (password: string, confirmation: string) => password.length >= 15 && password.length <= 128 && password === confirmation;

export function SettingsPanel({ onSignedOut, onProfile, passwordManagedExternally = false, profileManagedExternally = false }: { onSignedOut: () => void; onProfile: () => Promise<void>; passwordManagedExternally?: boolean; profileManagedExternally?: boolean }) {
  const [account, setAccount] = useState<Account | null>(null), [name, setName] = useState("");
  const [error, setError] = useState(""), [notice, setNotice] = useState(""), [busy, setBusy] = useState(false);
  const [current, setCurrent] = useState(""), [password, setPassword] = useState(""), [confirmation, setConfirmation] = useState("");
  useEffect(() => {
    let active = true;
    void api("/profile").then(value => { if (active) { setAccount(value.account); setName(value.account.name); } }).catch(err => {if(active)setError(message(err));});
    return () => { active = false; };
  }, []);
  async function save(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError(""); setNotice("");
    try { const value = await api("/profile", { name }, "PATCH"); setAccount(value.account); await onProfile(); setNotice("Profile saved."); }
    catch(err) {setError(message(err));} finally {setBusy(false);}
  }
  async function changePassword(e: FormEvent) {
    e.preventDefault(); setError(""); setNotice("");
    if (!passwordValid(password,confirmation)) {setError("Use 15 to 128 characters and matching passwords.");return;}
    const entered = {currentPassword:current,password}; setCurrent("");setPassword("");setConfirmation("");setBusy(true);
    try {await api("/password/change",entered);onSignedOut();} catch(err){setError(message(err));} finally {setBusy(false);}
  }
  return <section className="panel"><div className="panel-heading"><h2>Account settings</h2></div><div className="section-pad account-panel">{passwordManagedExternally && <p>Your password and verification methods are managed by your organization.</p>}
    {error && <div className="error" role="alert">{error}</div>}{notice && <p role="status">{notice}</p>}
    {!account ? !error && <p role="status">Loading profile…</p> : <>
      <form className="account-form" onSubmit={save}>
        <label>Profile name<input value={name} maxLength={80} readOnly={profileManagedExternally} required onChange={e=>setName(e.target.value)} autoComplete="name" /></label>
        <label>Email<input type="email" value={account.email} readOnly /></label>
        <label>Role<input value={account.role} readOnly /></label>
        {!profileManagedExternally && <button className="button dark" disabled={busy}>Save profile</button>}
      </form>
      {!passwordManagedExternally && <form className="account-form password-form" onSubmit={changePassword}><h3>Change password</h3><p>Use 15 to 128 characters. Changing your password signs out all your sessions. Sign in again afterward.</p>
        <label>Current password<input type="password" value={current} required maxLength={128} autoComplete="current-password" onChange={e=>setCurrent(e.target.value)} /></label>
        <label>New password<input type="password" value={password} required minLength={15} maxLength={128} autoComplete="new-password" onChange={e=>setPassword(e.target.value)} /></label>
        <label>Confirm new password<input type="password" value={confirmation} required minLength={15} maxLength={128} autoComplete="new-password" onChange={e=>setConfirmation(e.target.value)} /></label>
        <button className="button dark" disabled={busy}>Change password</button>
      </form>}
    </>}
  </div></section>;
}

function MemberCard({member,busy,change,recover}: {member:Account;busy:boolean;change:(id:string,patch:{role:Actor["role"];active:boolean})=>Promise<void>;recover:(id:string)=>void}) {
  const [role,setRole]=useState(member.role),[active,setActive]=useState(member.active);
  // Polls return fresh objects; only an actual authority change resets drafts.
  useEffect(()=>{setRole(member.role);setActive(member.active);},[member.id,member.role,member.active]);
  return <article className="panel member-card"><h3>{member.name}</h3><p>{member.email}</p><p>Current role: {member.role}</p><p>{member.active ? "Active" : "Disabled"}</p>
    <form className="account-form" onSubmit={async e=>{e.preventDefault();await change(member.id,{role,active});setRole(member.role);setActive(member.active);}}>
      <label>Member role<select value={role} onChange={e=>setRole(e.target.value as Actor["role"])}>{roles.map(value=><option key={value}>{value}</option>)}</select></label>
      <label className="inline-check"><input type="checkbox" checked={active} onChange={e=>setActive(e.target.checked)} />Account active</label>
      <button className="button secondary" disabled={busy}>Save member</button>
    </form>
    <button className="button secondary" disabled={busy} onClick={()=>recover(member.id)}>Issue recovery link</button>
  </article>;
}

export function TeamPanel({revision,managedExternally=false}: {revision?:string;managedExternally?:boolean}) {
  const [team,setTeam]=useState<Team|null>(null),[email,setEmail]=useState(""),[role,setRole]=useState<Actor["role"]>("viewer");
  const [error,setError]=useState(""),[notice,setNotice]=useState(""),[busy,setBusy]=useState(false);
  const [secret,setSecret]=useState<{url:string;expiresAt:number;kind:"invite"|"reset"}|null>(null);
  const [copyError,setCopyError]=useState("");
  async function load(){const value:Team=await api("/team");setTeam(value);}
  useEffect(()=>{let active=true;void api("/team").then(value=>{if(active)setTeam(value);}).catch(err=>{if(active)setError(message(err));});return()=>{active=false;};},[revision]);
  async function run(operation:()=>Promise<void>) {setBusy(true);setError("");setNotice("");try{await operation();}catch(err){setError(message(err));}finally{setBusy(false);}}
  function show(value:{token:string;expiresAt:number},kind:"invite"|"reset") {setCopyError("");setSecret({url:window.location.origin+window.location.pathname+`#${kind}=${encodeURIComponent(value.token)}`,expiresAt:value.expiresAt,kind});}
  async function invite(e:FormEvent){e.preventDefault();await run(async()=>{const value=await api("/team/invitations",{email,role});show(value,"invite");setEmail("");await load();});}
  return <>
    {error && <div className="error" role="alert">{error}</div>}{notice && <p role="status">{notice}</p>}
    {secret && <section className="panel section-pad one-time-link"><h2>{secret.kind==="invite"?"Invitation created":"Recovery link created"}</h2><p>Shown once. Copy now and share manually through a secure channel. No email was sent. {secret.kind==="reset"?"Recovery links expire after 15 minutes.":"Invitation links expire after 24 hours."}</p><p>Expires {new Date(secret.expiresAt).toLocaleString()}</p>
      <label>One-time link<input readOnly value={secret.url} onFocus={e=>e.target.select()} /></label>
      <div className="task-actions"><button className="button secondary" onClick={()=>void navigator.clipboard.writeText(secret.url).then(()=>setNotice("Link copied."),()=>setCopyError("Copy unavailable. Select the link and copy it manually."))}>Copy link</button><button className="button secondary" onClick={()=>{setSecret(null);setCopyError("");setNotice("");}}>Dismiss link</button></div>{copyError && <p role="alert">{copyError}</p>}
    </section>}
    {managedExternally && <p>Membership and roles are managed by your organization through SCIM.</p>}
    {!managedExternally && <section className="panel"><div className="panel-heading"><h2>Invite a teammate</h2></div><form className="section-pad account-form" onSubmit={invite}>
      <label>Invitation email<input type="email" maxLength={254} required value={email} onChange={e=>setEmail(e.target.value)} /></label><label>Invitation role<select value={role} onChange={e=>setRole(e.target.value as Actor["role"])}>{roles.map(value=><option key={value}>{value}</option>)}</select></label><button className="button dark" disabled={busy || !!secret}>Create invitation</button>
    </form></section>}
    <section className="team-section"><h2>Workspace members</h2><p>Authority changes revoke the member’s current sessions. Keep at least one active administrator.</p>{!team && !error && <p role="status">Loading team…</p>}
      <div className="boundary-grid">{team?.members.map(member=>managedExternally ? <article className="panel member-card" key={member.id}><h3>{member.name}</h3><p>{member.email}</p><p>{member.role} · {member.active ? "Active" : "Disabled"}</p></article> : <MemberCard key={member.id} member={member} busy={busy} change={(id,patch)=>run(async()=>{await api(`/team/${id}`,patch,"PATCH");await load();setNotice("Member updated.");})} recover={id=>{if(!secret)void run(async()=>{show(await api(`/team/${id}/recovery`,{}),"reset");});else setError("Dismiss the current one-time link before issuing another.");}} />)}</div>
    </section>
    {!managedExternally && <section className="panel section-pad team-section"><h2>Pending invitations</h2>{team?.invitations.length===0 && <p>No pending invitations.</p>}{team?.invitations.map(invitation=><div className="invitation-row" key={invitation.id}><p>{invitation.email} · {invitation.role}<br /><small>Expires {new Date(invitation.expiresAt).toLocaleString()}</small></p><button className="button secondary" disabled={busy} onClick={()=>void run(async()=>{await api(`/team/invitations/${invitation.id}`,{},"DELETE");await load();setNotice("Invitation revoked.");})}>Revoke invitation for {invitation.email}</button></div>)}</section>}
  </>;
}
