import { useState, type FormEvent } from "react";
import { ArrowRight, LockKeyhole, Shield } from "lucide-react";
import { api } from "../api";
import { Logo } from "../ui";
import type { Session, Setup } from "../types";

export type Landing = { kind: "invite" | "reset"; token: string };
export function AuthPanel({ setup, landing, onSession, onReset, retry, initialError }: {
  setup: Setup | null; landing: Landing | null; onSession: (session: Session) => Promise<void>;
  onReset: () => void; retry: () => void; initialError: string;
}) {
  const [fields, setFields] = useState({ key: "", name: "", email: "", password: "", confirmation: "" });
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [emergency, setEmergency] = useState(false);
  const enterprise = setup?.enterprise;
  const bootstrap = setup?.managed && !setup.initialized && !landing;
  const account = setup?.managed;
  const title = landing?.kind === "invite" ? "Accept invitation" : landing?.kind === "reset" ? "Reset password" : bootstrap ? "Set up workspace" : account ? "Sign in" : "Open your local workspace";
  const field = (key: keyof typeof fields, label: string, type = "text", password = false) => <label key={key} htmlFor={`auth-${key}`}>{label}<input id={`auth-${key}`} type={type} value={fields[key]} required maxLength={password ? 128 : key === "name" ? 80 : 254} minLength={password && (bootstrap || landing) ? 15 : undefined} autoComplete={key === "email" ? "username" : password ? (bootstrap || landing ? "new-password" : "current-password") : "off"} onChange={e => setFields({ ...fields, [key]: e.target.value })} /></label>;
  async function signInWithOrganization() {
    setBusy(true);setError('');setFields({key:'',name:'',email:'',password:'',confirmation:''});
    try {
      const value = await api('/enterprise/oidc/start',{});
      const url = new URL(value.authorizationUrl);
      if(url.protocol!=='https:' && !(url.protocol==='http:'&&['127.0.0.1','localhost'].includes(url.hostname)&&location.protocol==='http:'))throw Error('Invalid organization sign-in destination');
      location.assign(url.href);
    } catch(err) {setError(err instanceof Error?err.message:'Organization sign-in unavailable');setBusy(false);}
  }
  async function submit(e: FormEvent) {
    e.preventDefault(); setError(""); setNotice("");
    if ((bootstrap || landing) && fields.password !== fields.confirmation) { setError("Passwords do not match."); return; }
    setBusy(true);
    const entered = { ...fields };
    setFields(previous => ({ ...previous, key: "", password: "", confirmation: "" }));
    try {
      if (landing?.kind === "reset") {
        await api("/password/reset", { token: landing.token, password: entered.password });
        onReset(); setNotice("Password reset. Sign in with your new password.");
      } else {
        const value: Session = landing ? await api("/invitations/accept", { token: landing.token, name: entered.name, password: entered.password }) : bootstrap ? await api("/setup", { key: entered.key, name: entered.name, email: entered.email, password: entered.password }) : await api("/login", account ? { email: entered.email, password: entered.password } : { key: entered.key });
        await onSession(value);
      }
    } catch (err) {
      setError((err instanceof Error ? err.message : "Request failed") + (landing ? ". Ask your administrator for a fresh link if this link expired or was already used." : ""));
    } finally { setBusy(false); }
  }
  return <div className="login-shell">
    <div className="login-story"><Logo /><div><span className="eyebrow">LOCAL AGENT CONTROL</span><h1>Give your agents<br />room to work.<br /><em>Keep control.</em></h1><p>Scope tasks. Review exact changes. Inspect recorded outcomes.</p></div><small>AgentBrake / Private local evaluation</small></div>
    <main className="login-main"><div className="login-card"><span className="square-icon"><LockKeyhole /></span>
      <h2>{setup ? title : "Workspace unavailable"}</h2>
      {initialError && <div className="error" role="alert">{initialError}</div>}
      {!setup ? <button className="button secondary" onClick={retry}>Retry connection</button> : <>
        <p>{enterprise ? !setup.initialized ? 'Initialize managed accounts before enabling organization sign-in. Ask the installation operator to complete setup.' : 'Your organization manages access and verification. Use its sign-in service to continue.' : landing ? "This one-use link is kept in memory only. Choose a password of 15 to 128 characters." : bootstrap ? "Use the bootstrap key from this installation’s generated administrator entry once. Then use your email and password; no daily file editing is needed." : account ? "Use your workspace account. Need to reset your password? Ask an administrator to issue a recovery link and share it securely." : "Sign in with your generated operator credential. Your role controls the available actions."}</p>
        {enterprise && setup.initialized && <>
          <button className="button primary wide" disabled={busy} onClick={()=>void signInWithOrganization()}>Continue with {enterprise.providerLabel}<ArrowRight size={16}/></button>
          {enterprise.breakGlassEnabled && <button className="button secondary" disabled={busy} onClick={()=>{setEmergency(!emergency);setFields({key:'',name:'',email:'',password:'',confirmation:''});}}>Emergency local sign-in</button>}
          {emergency && <p>Only the designated emergency administrator can use this audited access path.</p>}
          {error && !emergency && <div className="error" role="alert">{error}</div>}
        </>}
        {(!enterprise || (emergency && setup.initialized && !landing)) && <form onSubmit={submit} className="account-form">
          {!landing && (!account || bootstrap) && field("key", bootstrap ? "Bootstrap key" : "Workspace key", "password")}
          {(bootstrap || landing?.kind === "invite") && field("name", "Full name")}
          {!landing && account && field("email", "Email", "email")}
          {(account || landing) && field("password", "Password", "password", true)}
          {(bootstrap || landing) && field("confirmation", "Confirm password", "password", true)}
          {error && <div className="error" role="alert">{error}</div>}
          {notice && <p role="status">{notice}</p>}
          <button className="button primary wide" disabled={busy}>{bootstrap ? "Set up workspace" : landing?.kind === "invite" ? "Accept invitation" : landing?.kind === "reset" ? "Reset password" : account ? "Sign in" : "Open workspace"}<ArrowRight size={16} /></button>
        </form>}
        {landing && <button className="button secondary" disabled={busy} onClick={() => { setFields({key:"",name:"",email:"",password:"",confirmation:""}); setError(""); onReset(); }}>Return to sign in</button>}
      </>}
      <div className="login-foot"><Shield size={14} />Private installation · scoped access</div>
    </div></main>
  </div>;
}
