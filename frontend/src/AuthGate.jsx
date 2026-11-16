import { useEffect, useState } from 'react';
import { auth } from './auth';
import App from './App';

export default function AuthGate() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(Boolean(auth));
  const [method, setMethod] = useState('email');
  const [identity, setIdentity] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!auth) return;
    const { data } = auth.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      setLoading(false);
    });
    return () => data.subscription.unsubscribe();
  }, []);
  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const address = { [method]: identity.trim() };
      const result = sent
        ? await auth.auth.verifyOtp({ ...address, token: code.trim(), type: method === 'email' ? 'email' : 'sms' })
        : await auth.auth.signInWithOtp(address);
      if (result.error) throw result.error;
      setSent(true);
    } catch (err) { setError(err.message || 'Could not sign in. Try again.'); }
    finally { setBusy(false); }
  }
  if (loading) return <div className="auth-loading" role="status">Opening your workspace…</div>;
  if (session) return <App key={session.user.id} user={session.user} onSignOut={async () => {
    const result = await auth.auth.signOut();
    if (result.error) { setError(result.error.message); return; }
    setSent(false); setCode(''); setIdentity('');
  }} />;
  return <main className="auth-page">
    <section className="auth-story"><div className="brand"><div className="brand-icon">N</div>NexGoAI</div>
      <div><p className="eyebrow">YOUR PERSONAL KNOWLEDGE WORKSPACE</p><h1>Make room for<br />your next idea.</h1><p>Ask better questions. Explore your documents.<br />Bring your thinking together in one place.</p></div>
      <span>Chat · Documents · Knowledge</span>
    </section>
    <section className="auth-form"><div className="auth-card"><p className="eyebrow">WELCOME TO NEXGOAI</p><h2>Your workspace awaits.</h2><p>Sign in or create an account with a verification code.</p>
      {!auth ? <p role="alert">Set the Supabase environment variables to enable sign-in.</p> : <>
      <div className="auth-tabs">{['email', 'phone'].map(value => <button key={value} type="button" disabled={busy} aria-pressed={method === value} onClick={() => {setMethod(value); setSent(false); setCode(''); setIdentity(''); setError('');}}>{value === 'email' ? 'Email address' : 'Phone number'}</button>)}</div>
      <form onSubmit={submit}><label>{method === 'email' ? 'Email address' : 'Phone number with country code'}<input required type={method === 'email' ? 'email' : 'tel'} autoComplete={method === 'email' ? 'email' : 'tel'} pattern={method === 'phone' ? '\\+[1-9][0-9]{7,14}' : undefined} placeholder={method === 'email' ? 'you@example.com' : '+919876543210'} value={identity} disabled={sent || busy} onChange={event => setIdentity(event.target.value)} /></label>
      {sent && <><p role="status">Check your {method === 'email' ? 'inbox' : 'messages'} for a verification code.</p><label>Verification code<input required inputMode="numeric" autoComplete="one-time-code" value={code} onChange={event => setCode(event.target.value)} /></label></>}
      {error && <p role="alert" className="document-error">{error}</p>}
      <button className="auth-submit" disabled={busy}>{busy ? 'Please wait…' : sent ? 'Open workspace →' : 'Send verification code →'}</button>
      {sent && <button className="auth-back" type="button" disabled={busy} onClick={() => {setSent(false); setCode('');}}>Change details or request another code</button>}
      </form></>}
      <small>Your chats and documents belong to your account.</small>
    </div></section>
  </main>;
}
