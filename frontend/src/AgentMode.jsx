import { useState } from "react";
import { ArrowLeft, Bot, Play, Sparkles, CheckCircle2, AlertCircle, LoaderCircle } from "lucide-react";
import "./AgentMode.css";

const API = "/api/v1/agent";
async function call(url, options) {
  const response = await fetch(url, options);
  const body = await response.json();
  if (!response.ok) throw new Error(body.detail || "Request failed");
  return body;
}

export default function AgentMode() {
  const [goal, setGoal] = useState("");
  const [plan, setPlan] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [running, setRunning] = useState(-1);

  async function createPlan(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setPlan(null);
    try {
      const result = await call(`${API}/plans`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goal }),
      });
      setPlan(result);
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  async function runStep(index) {
    setRunning(index);
    setError("");
    try {
      const result = await call(`${API}/plans/${plan.plan_id}/steps/${index}/run`, { method: "POST" });
      setPlan(result);
    } catch (e) { setError(e.message); }
    finally { setRunning(-1); }
  }

  const done = plan?.steps.filter(step => step.status === "completed").length ?? 0;
  return (
    <div className="agent-page">
      <header className="agent-header">
        <a href="/" className="agent-back"><ArrowLeft size={17} /> Back to chat</a>
        <span><Bot size={19} /> NexGoAI <strong>Agent Mode</strong></span>
        <span className="agent-safety">Human-approved execution</span>
      </header>
      <main className="agent-content">
        <div className="agent-intro"><div className="agent-emblem"><Sparkles /></div>
          <h1>Turn goals into actions.</h1>
          <p>Generate a plan with Groq, review the selected tools, and run each step with LangGraph. Execution is limited to AI reasoning, arithmetic, and UTC time.</p>
        </div>
        <form onSubmit={createPlan} className="agent-goal">
          <label htmlFor="agent-goal">What would you like to accomplish?</label>
          <textarea id="agent-goal" rows={4} value={goal} onChange={e => setGoal(e.target.value)}
            minLength={3} maxLength={2000} required placeholder="Example: Calculate a 12-month savings target and create a weekly action plan." />
          <button type="submit" disabled={busy || goal.trim().length < 3}>{busy ? <LoaderCircle className="agent-spin" size={17}/> : <Sparkles size={17}/>} {busy ? "Planning…" : "Generate plan"}</button>
        </form>
        {error && <div className="agent-error" role="alert"><AlertCircle size={17}/>{error}</div>}
        {plan && <section className="agent-plan">
          <div className="agent-plan-head"><div><h2>Execution plan</h2><p>{plan.goal}</p></div><span>{done}/{plan.steps.length} complete</span></div>
          <div className="agent-progress"><div style={{width:`${100*done/plan.steps.length}%`}}/></div>
          {plan.steps.map((step, index) => {
            const available = index === 0 || plan.steps[index-1].status === "completed";
            return <article key={index} className="agent-step">
              <div className="agent-step-number">{step.status === "completed" ? <CheckCircle2 size={20}/> : index+1}</div>
              <div className="agent-step-content"><div className="agent-step-top"><h3>{step.title}</h3><span className="agent-tool">{step.tool}</span></div>
                <p>{step.instruction}</p><span className="agent-status">Status: {running === index ? "running" : step.status}</span>
                {step.result && <div className="agent-result"><strong>Tool result</strong><pre>{step.result}</pre></div>}
              </div>
              <button className="agent-run" type="button" onClick={() => runStep(index)}
                disabled={running !== -1 || !available || step.status === "completed"}>
                {running === index ? <LoaderCircle className="agent-spin" size={15}/> : <Play size={15}/>}
                {step.status === "completed" ? "Done" : running === index ? "Running" : step.status === "failed" ? "Retry" : "Run"}
              </button>
            </article>;
          })}
        </section>}
      </main>
    </div>
  );
}
