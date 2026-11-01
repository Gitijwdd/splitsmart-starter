'use client';

import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';

const inr = (n) => '₹' + Number(n || 0).toLocaleString('en-IN');

export default function Home() {
  const [session, setSession] = useState(null);
  const [checking, setChecking] = useState(true);
  const [expenses, setExpenses] = useState([]);
  const [text, setText] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authMsg, setAuthMsg] = useState('');

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setChecking(false); });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) { setExpenses([]); return; }
    supabase.from('expenses').select('*').order('created_at', { ascending: true })
      .then(({ data }) => setExpenses(data || []));
  }, [session]);

  const signUp = async () => {
    setAuthMsg('');
    const { error } = await supabase.auth.signUp({ email, password });
    setAuthMsg(error ? error.message : 'Account created — you are signed in!');
  };
  const signIn = async () => {
    setAuthMsg('');
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setAuthMsg(error.message);
  };
  const signOut = () => supabase.auth.signOut();

  const total = expenses.reduce((sum, e) => sum + Number(e.amount || 0), 0);

  const addExpense = async () => {
    const t = text.trim();
    if (!t) return;
    try {
      const res = await fetch('/api/split', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sentence: t }),
      });
      const data = await res.json();
      if (data.error) { alert('AI error: ' + data.error); return; }
      const { data: rows, error } = await supabase.from('expenses')
        .insert({ user_id: session.user.id, name: data.description || t, paid_by: 'You', amount: data.amount || 0 })
        .select();
      if (error) { alert('Save error: ' + error.message); return; }
      setExpenses((list) => [...list, rows[0]]);
      setText('');
    } catch (e) { alert('Could not add: ' + e.message); }
  };

  const removeExpense = async (id) => {
    await supabase.from('expenses').delete().eq('id', id);
    setExpenses((list) => list.filter((e) => e.id !== id));
  };

  if (checking) return <main style={styles.page}><div style={styles.card}>Loading…</div></main>;

  if (!session) {
    return (
      <main style={styles.page}>
        <div style={styles.card}>
          <div style={styles.header}><div style={styles.brand}><div style={styles.logo}>S</div><div style={styles.title}>SplitSmart</div></div></div>
          <p style={{ color: '#6b7280', fontSize: 14, marginBottom: 16 }}>Sign in to see your expenses on any device.</p>
          <input style={styles.input2} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" />
          <input style={styles.input2} type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password (6+ characters)" />
          <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
            <button style={styles.authBtn} onClick={signUp}>Sign up</button>
            <button style={styles.authBtnAlt} onClick={signIn}>Sign in</button>
          </div>
          {authMsg && <div style={{ marginTop: 12, fontSize: 13, color: '#1C5FD4' }}>{authMsg}</div>}
        </div>
      </main>
    );
  }

  return (
    <main style={styles.page}>
      <div style={styles.card}>
        <div style={styles.header}>
          <div style={styles.brand}><div style={styles.logo}>S</div><div style={styles.title}>SplitSmart</div></div>
          <button style={styles.signout} onClick={signOut}>Sign out</button>
        </div>
        <div style={styles.addRow}>
          <input style={styles.input} value={text} onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addExpense()} placeholder="Add an expense…" />
          <button style={styles.addBtn} onClick={addExpense}>+</button>
        </div>
        <div style={styles.list}>
          {expenses.length === 0 && <div style={styles.empty}>No expenses yet — add your first one above.</div>}
          {expenses.map((e) => (
            <div key={e.id} style={styles.item}>
              <div style={styles.itemEmoji}>{e.emoji || '🧾'}</div>
              <div style={styles.itemMain}>
                <div style={styles.itemName}>{e.name}</div>
                <div style={styles.itemPaid}>paid by {e.paid_by}</div>
              </div>
              <div style={styles.itemAmount}>{inr(e.amount)}</div>
              <button style={styles.remove} onClick={() => removeExpense(e.id)}>×</button>
            </div>
          ))}
        </div>
        <div style={styles.total}>Total {inr(total)}</div>
      </div>
    </main>
  );
}

const styles = {
  page: { minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '28px 16px 48px' },
  card: { width: '100%', maxWidth: 420, background: 'var(--card)', borderRadius: 24, boxShadow: '0 24px 60px -24px rgba(13,27,62,.28)', border: '1px solid var(--line)', padding: 20, marginTop: 12 },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 },
  brand: { display: 'flex', alignItems: 'center', gap: 10 },
  logo: { width: 36, height: 36, borderRadius: 11, display: 'grid', placeItems: 'center', color: '#fff', fontWeight: 800, fontSize: 18, background: 'linear-gradient(135deg, var(--blue), var(--cyan))' },
  title: { fontSize: 20, fontWeight: 800 },
  signout: { border: '1px solid var(--line)', background: '#fff', borderRadius: 10, padding: '7px 13px', fontSize: 13, fontWeight: 700, color: 'var(--muted)', cursor: 'pointer' },
  addRow: { display: 'flex', gap: 10, marginBottom: 16 },
  input: { flex: 1, border: '1px solid var(--line)', borderRadius: 14, padding: '13px 15px', fontSize: 15, outline: 'none', background: '#f7f9fc' },
  input2: { width: '100%', border: '1px solid var(--line)', borderRadius: 12, padding: '12px 14px', fontSize: 15, outline: 'none', background: '#f7f9fc', marginBottom: 10, boxSizing: 'border-box' },
  authBtn: { flex: 1, border: 'none', borderRadius: 12, padding: '12px', color: '#fff', fontSize: 15, fontWeight: 800, background: 'linear-gradient(135deg, var(--blue), var(--cyan))', cursor: 'pointer' },
  authBtnAlt: { flex: 1, border: '1px solid var(--line)', borderRadius: 12, padding: '12px', color: 'var(--ink)', fontSize: 15, fontWeight: 800, background: '#fff', cursor: 'pointer' },
  addBtn: { flex: 'none', width: 48, borderRadius: 14, border: 'none', color: '#fff', fontSize: 24, fontWeight: 700, background: 'linear-gradient(135deg, var(--blue), var(--cyan))', cursor: 'pointer' },
  list: { display: 'flex', flexDirection: 'column', gap: 10, minHeight: 60 },
  empty: { color: 'var(--muted)', fontSize: 14, textAlign: 'center', padding: '24px 0' },
  item: { display: 'flex', alignItems: 'center', gap: 12, background: '#f7f9fc', border: '1px solid var(--line)', borderRadius: 16, padding: '12px 14px' },
  itemEmoji: { width: 38, height: 38, borderRadius: 11, display: 'grid', placeItems: 'center', background: '#fff', border: '1px solid var(--line)', fontSize: 19, flex: 'none' },
  itemMain: { flex: 1, minWidth: 0 },
  itemName: { fontWeight: 700, fontSize: 15 },
  itemPaid: { color: 'var(--muted)', fontSize: 12.5, marginTop: 1 },
  itemAmount: { fontWeight: 800, fontSize: 15.5 },
  remove: { flex: 'none', width: 26, height: 26, borderRadius: 8, border: 'none', background: 'transparent', color: 'var(--muted)', fontSize: 20, cursor: 'pointer' },
  total: { textAlign: 'center', marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--line)', fontWeight: 800, fontSize: 16 },
};